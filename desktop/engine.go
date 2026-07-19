// Native audio engine (Fase 1 of the Spotify-style split): the web page stays
// the UI, but when Direct Mode is on the actual audio no longer plays inside
// WebView2 — the page hands this engine a URL and the engine downloads,
// decodes (FLAC/MP3/WAV) and plays it through miniaudio's WASAPI backend,
// reporting position/duration/ended back to the page as zenify:native events.
//
// Shared mode for now; exclusive mode + per-track sample-rate switching is
// Fase 2. The win today is that decoded samples go straight from the decoder
// to the OS with no Web Audio, no <audio> element and no browser resampler in
// between — and playback survives page reloads' worth of UI hiccups.
//
// Formats the engine cannot decode produce an "error" event; the page then
// falls back to the <audio> element for that track, so nothing is ever less
// playable than before.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gen2brain/malgo"
)

// ─── Engine ─────────────────────────────────────────────────────────────────

type audioEngine struct {
	mu        sync.Mutex
	emitJS    func(string) // runs a JS snippet on the page (UI-thread dispatched)
	ctx       *malgo.AllocatedContext
	gen       atomic.Int64 // bumped on every Load/Stop; stale goroutines self-cancel
	cur       *playback
	exclusive atomic.Bool // prefer WASAPI exclusive mode (true bit-perfect)
}

func newAudioEngine(emitJS func(string)) *audioEngine {
	e := &audioEngine{emitJS: emitJS}
	e.exclusive.Store(true) // the whole point of the native engine; the page can override
	return e
}

// SetExclusive chooses the WASAPI mode used from the NEXT track onwards.
//   - exclusive: the app takes sole ownership of the DAC, WASAPI is told not to
//     resample (NoAutoConvertSRC), and the device is opened at the file's own
//     sample rate — the DAC receives the exact bits and its rate LED follows
//     the track. Fails if another app already holds the DAC exclusively, in
//     which case startPlayback falls back to shared for that track.
//   - shared: the Windows mixer stays in the path (its default rate, other apps
//     can still play). Not bit-perfect, but never fails.
func (e *audioEngine) SetExclusive(on bool) { e.exclusive.Store(on) }

// emitEvent delivers an event to the page unless it belongs to a superseded
// load. The JSON goes through a CustomEvent so the web side has one listener.
func (e *audioEngine) emitEvent(gen int64, payload map[string]any) {
	if e.gen.Load() != gen {
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	e.emitJS("try{window.dispatchEvent(new CustomEvent('zenify:native',{detail:" + string(data) + "}))}catch(_){}")
}

func (e *audioEngine) context() (*malgo.AllocatedContext, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.ctx != nil {
		return e.ctx, nil
	}
	ctx, err := malgo.InitContext(nil, malgo.ContextConfig{}, nil)
	if err != nil {
		return nil, err
	}
	e.ctx = ctx
	return ctx, nil
}

// Load starts playing the given absolute URL from position 0, paused. The page
// calls play once its state machine is ready (mirrors <audio> autoplay flow).
func (e *audioEngine) Load(url string) {
	gen := e.gen.Add(1)
	e.teardown()
	go e.startPlayback(gen, url)
}

// Stop tears the current playback down and invalidates all its goroutines.
func (e *audioEngine) Stop() {
	e.gen.Add(1)
	e.teardown()
}

func (e *audioEngine) Play() {
	if p := e.current(); p != nil {
		p.paused.Store(false)
	}
}

func (e *audioEngine) Pause() {
	if p := e.current(); p != nil {
		p.paused.Store(true)
	}
}

func (e *audioEngine) Seek(sec float64) {
	if p := e.current(); p != nil {
		if sec < 0 {
			sec = 0
		}
		frame := int64(sec * float64(p.rate))
		// Optimistic position so the UI progress bar answers instantly; the
		// decode loop performs the real reposition.
		p.posFrames.Store(frame)
		p.seekReq.Store(frame)
		p.ended.Store(false)
		// The decode loop may be blocked writing into a full ring — free it so
		// it can notice the pending seek.
		p.ring.Clear()
	}
}

func (e *audioEngine) current() *playback {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.cur
}

func (e *audioEngine) teardown() {
	e.mu.Lock()
	p := e.cur
	e.cur = nil
	e.mu.Unlock()
	if p == nil {
		return
	}
	if p.device != nil {
		p.device.Uninit() // stops the data callback
	}
	p.ring.Close() // unblocks the decode loop's Write
	if p.src != nil {
		p.src.Close() // unblocks decoder reads; aborts the download
	}
}

// ─── One playback ───────────────────────────────────────────────────────────

type playback struct {
	eng           *audioEngine
	gen           int64
	device        *malgo.Device
	src           *growingFile
	dec           pcmDecoder
	rate          int
	channels      int
	bytesPerFrame int

	paused    atomic.Bool
	ended     atomic.Bool
	decDone   atomic.Bool
	posFrames atomic.Int64 // frames actually delivered to the device
	seekReq   atomic.Int64 // pending seek target in frames; -1 = none

	ring *pcmRing
}

func (e *audioEngine) startPlayback(gen int64, url string) {
	fail := func(err error) {
		e.emitEvent(gen, map[string]any{"type": "error", "message": err.Error()})
	}

	src, err := openSource(url)
	if err != nil {
		fail(err)
		return
	}
	if e.gen.Load() != gen {
		src.Close()
		return
	}

	dec, err := openDecoder(src)
	if err != nil {
		src.Close()
		fail(err)
		return
	}
	rate, channels, bits, totalFrames, format := dec.Info()

	bytesPerSample := 2
	if format == malgo.FormatS32 {
		bytesPerSample = 4
	}
	p := &playback{
		eng: e, gen: gen, src: src, dec: dec,
		rate: rate, channels: channels,
		bytesPerFrame: channels * bytesPerSample,
		// ~2 seconds of decode-ahead: enough to ride network jitter, small
		// enough that a seek never waits long for the ring to drain.
		ring: newPcmRing(rate * channels * bytesPerSample * 2),
	}
	p.paused.Store(true)
	p.seekReq.Store(-1)

	mctx, err := e.context()
	if err != nil {
		src.Close()
		fail(err)
		return
	}
	device, mode, err := e.initDevice(mctx, format, channels, rate, p.onData)
	if err != nil {
		src.Close()
		fail(fmt.Errorf("audio device: %w", err))
		return
	}
	p.device = device

	// Publish before starting so commands (play/seek) can land immediately.
	e.mu.Lock()
	if e.gen.Load() != gen {
		e.mu.Unlock()
		device.Uninit()
		src.Close()
		return
	}
	e.cur = p
	e.mu.Unlock()

	if err := device.Start(); err != nil {
		e.teardown()
		fail(fmt.Errorf("audio start: %w", err))
		return
	}

	go p.decodeLoop()
	go p.reportLoop()

	duration := 0.0
	if totalFrames > 0 {
		duration = float64(totalFrames) / float64(rate)
	}
	e.emitEvent(gen, map[string]any{
		"type": "loaded", "duration": duration,
		"sampleRate": rate, "bits": bits, "channels": channels,
		"mode": mode, // "exclusive" | "shared" — what the DAC actually got
	})
}

// initDevice opens the playback device at the file's own sample rate. When
// exclusive mode is preferred it is attempted first with sample-rate conversion
// disabled (so the DAC receives the exact rate and its LED tracks the file); if
// that fails — most often because another app already owns the DAC exclusively,
// or the DAC can't do this rate/format in hardware — it silently falls back to
// shared mode, which always works. Returns the device and the mode achieved.
func (e *audioEngine) initDevice(
	mctx *malgo.AllocatedContext,
	format malgo.FormatType, channels, rate int,
	onData func(_, _ []byte, _ uint32),
) (*malgo.Device, string, error) {
	build := func(share malgo.ShareMode) malgo.DeviceConfig {
		cfg := malgo.DefaultDeviceConfig(malgo.Playback)
		cfg.Playback.Format = format
		cfg.Playback.Channels = uint32(channels)
		cfg.SampleRate = uint32(rate)
		cfg.Playback.ShareMode = share
		if share == malgo.Exclusive {
			// Never let WASAPI resample under us — that would defeat the point
			// and light the wrong rate on the DAC.
			cfg.Wasapi.NoAutoConvertSRC = 1
		}
		return cfg
	}

	if e.exclusive.Load() {
		if dev, err := malgo.InitDevice(mctx.Context, build(malgo.Exclusive),
			malgo.DeviceCallbacks{Data: onData}); err == nil {
			return dev, "exclusive", nil
		} else {
			log.Printf("audio: exclusive mode unavailable (%v) — using shared", err)
		}
	}

	dev, err := malgo.InitDevice(mctx.Context, build(malgo.Shared),
		malgo.DeviceCallbacks{Data: onData})
	if err != nil {
		return nil, "", err
	}
	return dev, "shared", nil
}

// onData feeds the device from the ring. Paused or buffering produces silence;
// the position clock only advances by frames actually played.
func (p *playback) onData(out, _ []byte, frameCount uint32) {
	if p.paused.Load() {
		zero(out)
		return
	}
	n := p.ring.ReadInto(out)
	if n < len(out) {
		zero(out[n:])
	}
	frames := n / p.bytesPerFrame
	if frames > 0 {
		p.posFrames.Add(int64(frames))
		return
	}
	// Nothing left and the decoder has finished: the track is over. Emitted
	// from a goroutine — the audio callback must never block on the webview.
	if p.decDone.Load() && p.seekReq.Load() < 0 && !p.ended.Swap(true) {
		go p.eng.emitEvent(p.gen, map[string]any{"type": "ended"})
	}
}

func (p *playback) decodeLoop() {
	chunk := 16 * 1024
	chunk -= chunk % p.bytesPerFrame
	buf := make([]byte, chunk)
	for {
		if p.eng.gen.Load() != p.gen {
			return
		}
		if s := p.seekReq.Swap(-1); s >= 0 {
			if err := p.dec.SeekFrame(s); err == nil {
				p.ring.Clear() // drop anything decoded past the old position
				p.posFrames.Store(s)
				p.decDone.Store(false)
				p.ended.Store(false)
			}
			continue
		}
		if p.decDone.Load() {
			// Parked at EOF; wake periodically in case a seek re-arms us.
			time.Sleep(50 * time.Millisecond)
			continue
		}
		n, err := p.dec.ReadPCM(buf)
		if n > 0 {
			if !p.ring.Write(buf[:n]) {
				return // ring closed — playback torn down
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				p.decDone.Store(true)
				continue
			}
			p.eng.emitEvent(p.gen, map[string]any{"type": "error", "message": err.Error()})
			return
		}
	}
}

// reportLoop pushes the position to the page 4×/s — the web shim interpolates
// between reports, so this cadence is invisible while staying near-free.
func (p *playback) reportLoop() {
	t := time.NewTicker(250 * time.Millisecond)
	defer t.Stop()
	for range t.C {
		if p.eng.gen.Load() != p.gen {
			return
		}
		p.eng.emitEvent(p.gen, map[string]any{
			"type":    "position",
			"pos":     float64(p.posFrames.Load()) / float64(p.rate),
			"playing": !p.paused.Load() && !p.ended.Load(),
		})
	}
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

// ─── PCM ring buffer ────────────────────────────────────────────────────────
// Single producer (decode loop, blocking Write) / single consumer (audio
// callback, non-blocking ReadInto).

type pcmRing struct {
	mu     sync.Mutex
	cond   *sync.Cond
	buf    []byte
	r, w   int
	n      int
	closed bool
}

func newPcmRing(size int) *pcmRing {
	r := &pcmRing{buf: make([]byte, size)}
	r.cond = sync.NewCond(&r.mu)
	return r
}

// Write blocks while the ring is full. Returns false once the ring is closed.
func (rb *pcmRing) Write(p []byte) bool {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	for len(p) > 0 {
		for rb.n == len(rb.buf) && !rb.closed {
			rb.cond.Wait()
		}
		if rb.closed {
			return false
		}
		chunk := min(len(p), len(rb.buf)-rb.n)
		// Copy in up to two segments around the wrap point.
		first := min(chunk, len(rb.buf)-rb.w)
		copy(rb.buf[rb.w:], p[:first])
		copy(rb.buf, p[first:chunk])
		rb.w = (rb.w + chunk) % len(rb.buf)
		rb.n += chunk
		p = p[chunk:]
	}
	return true
}

// ReadInto copies up to len(p) bytes without blocking; returns bytes copied.
func (rb *pcmRing) ReadInto(p []byte) int {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	chunk := min(len(p), rb.n)
	first := min(chunk, len(rb.buf)-rb.r)
	copy(p, rb.buf[rb.r:rb.r+first])
	copy(p[first:], rb.buf[:chunk-first])
	rb.r = (rb.r + chunk) % len(rb.buf)
	rb.n -= chunk
	if chunk > 0 {
		rb.cond.Broadcast()
	}
	return chunk
}

func (rb *pcmRing) Clear() {
	rb.mu.Lock()
	rb.r, rb.w, rb.n = 0, 0, 0
	rb.cond.Broadcast()
	rb.mu.Unlock()
}

func (rb *pcmRing) Close() {
	rb.mu.Lock()
	rb.closed = true
	rb.cond.Broadcast()
	rb.mu.Unlock()
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
