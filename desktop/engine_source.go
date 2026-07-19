// Progressive, shareable download cache for the native engine.
//
// The decoder needs an io.ReadSeeker over the whole file, but waiting for a
// 30-100MB FLAC before the first note would be unusable — so a file streams
// into the local cache while readers serve bytes, blocking only when a reader
// outruns the download. A fully-cached track (marker present) plays instantly
// and costs no bandwidth.
//
// One URL → one download, many readers. This matters for Fase 3 prefetch: the
// engine warms the NEXT track's cache while the current one plays, and if the
// user then jumps to it, the player attaches a reader to the SAME in-flight
// download instead of starting a second, competing writer. Each reader keeps
// its own file handle and offset; the shared `download` tracks how many bytes
// have landed. A size-capped LRU sweep runs after every completed download.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// maxCacheBytes caps the on-disk audio cache. FLAC is large, so this is roomier
// than the browser SW cache; the LRU sweep keeps it bounded.
const maxCacheBytes int64 = 6 << 30 // 6 GiB

var errSourceClosed = fmt.Errorf("audio source closed")

func cacheDir() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "Zenify", "audio")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func cachePaths(url string) (data, marker string, err error) {
	dir, err := cacheDir()
	if err != nil {
		return "", "", err
	}
	sum := sha256.Sum256([]byte(url))
	name := hex.EncodeToString(sum[:12])
	return filepath.Join(dir, name+".audio"), filepath.Join(dir, name+".done"), nil
}

// ─── Shared download ────────────────────────────────────────────────────────

type download struct {
	mu   sync.Mutex
	cond *sync.Cond
	have int64 // bytes written to disk so far
	size int64 // total size; -1 until known
	done bool  // fully downloaded and marker written
	err  error // fatal download error (network); readers surface it
}

var (
	dlMu     sync.Mutex
	dlActive = map[string]*download{} // dataPath → in-flight download
)

// getDownload returns the download for url, starting it if not already running
// or complete. A complete cached file yields a pre-finished download.
func getDownload(url string) (*download, string, error) {
	dataPath, markerPath, err := cachePaths(url)
	if err != nil {
		return nil, "", err
	}

	// Already fully cached: hand back a finished download over the existing file.
	if st, err := os.Stat(markerPath); err == nil {
		_ = st
		if fi, err := os.Stat(dataPath); err == nil {
			touch(dataPath, markerPath) // mark recently used for LRU
			d := &download{size: fi.Size(), have: fi.Size(), done: true}
			d.cond = sync.NewCond(&d.mu)
			return d, dataPath, nil
		}
		os.Remove(markerPath) // marker without data — refetch
	}

	dlMu.Lock()
	if d, ok := dlActive[dataPath]; ok {
		dlMu.Unlock()
		return d, dataPath, nil
	}
	d := &download{size: -1}
	d.cond = sync.NewCond(&d.mu)
	dlActive[dataPath] = d
	dlMu.Unlock()

	go d.run(url, dataPath, markerPath)
	return d, dataPath, nil
}

func (d *download) run(url, dataPath, markerPath string) {
	finish := func(err error) {
		d.mu.Lock()
		if err == nil {
			d.done = true
		} else if d.err == nil {
			d.err = err
		}
		d.cond.Broadcast()
		d.mu.Unlock()
		dlMu.Lock()
		delete(dlActive, dataPath)
		dlMu.Unlock()
	}

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		finish(err)
		return
	}
	req.Header.Set("User-Agent", "ZenifyDesktop/1.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		finish(err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		finish(fmt.Errorf("audio fetch: HTTP %d", resp.StatusCode))
		return
	}

	w, err := os.Create(dataPath)
	if err != nil {
		finish(err)
		return
	}
	d.mu.Lock()
	d.size = resp.ContentLength // -1 when unknown
	d.cond.Broadcast()
	d.mu.Unlock()

	buf := make([]byte, 64*1024)
	var written int64
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				w.Close()
				finish(werr)
				return
			}
			written += int64(n)
			d.mu.Lock()
			d.have = written
			d.cond.Broadcast()
			d.mu.Unlock()
		}
		if rerr == io.EOF {
			w.Close()
			d.mu.Lock()
			d.size = written
			d.mu.Unlock()
			os.WriteFile(markerPath, []byte(time.Now().Format(time.RFC3339)), 0o644)
			finish(nil)
			evictCache()
			return
		}
		if rerr != nil {
			w.Close()
			finish(fmt.Errorf("download interrupted: %w", rerr))
			return
		}
	}
}

// waitFor blocks until at least `need` bytes exist, the download completes, or
// it fails. Returns the bytes available and whether the stream is at its end.
func (d *download) waitFor(need int64) (have int64, eof bool, err error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for {
		if d.err != nil {
			return d.have, false, d.err
		}
		if need < d.have {
			return d.have, false, nil
		}
		if d.done || (d.size >= 0 && need >= d.size) {
			return d.have, true, nil
		}
		d.cond.Wait()
	}
}

func (d *download) totalSize() (int64, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for d.size < 0 && d.err == nil && !d.done {
		d.cond.Wait()
	}
	if d.err != nil {
		return 0, d.err
	}
	return d.size, nil
}

// ─── Reader ─────────────────────────────────────────────────────────────────

// growingFile is one reader over a shared download: its own OS handle and
// offset, waiting on the download for bytes it hasn't received yet.
type growingFile struct {
	dl     *download
	f      *os.File
	pos    int64
	mu     sync.Mutex
	closed bool
}

// openSource returns a ReadSeeker over the (possibly still-downloading) track,
// attaching to any in-flight download for the same URL.
func openSource(url string) (*growingFile, error) {
	dl, dataPath, err := getDownload(url)
	if err != nil {
		return nil, err
	}
	// Wait for the file to exist on disk before opening a read handle.
	if _, _, err := dl.waitFor(0); err != nil {
		return nil, err
	}
	f, err := os.Open(dataPath)
	if err != nil {
		return nil, err
	}
	return &growingFile{dl: dl, f: f}, nil
}

func (g *growingFile) Read(p []byte) (int, error) {
	g.mu.Lock()
	if g.closed {
		g.mu.Unlock()
		return 0, errSourceClosed
	}
	pos := g.pos
	g.mu.Unlock()

	have, eof, err := g.dl.waitFor(pos)
	if err != nil {
		return 0, err
	}
	if eof && pos >= have {
		return 0, io.EOF
	}
	avail := have - pos
	if int64(len(p)) > avail {
		p = p[:avail]
	}
	n, rerr := g.f.ReadAt(p, pos)

	g.mu.Lock()
	g.pos = pos + int64(n)
	g.mu.Unlock()
	return n, rerr
}

func (g *growingFile) Seek(offset int64, whence int) (int64, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	switch whence {
	case io.SeekStart:
		g.pos = offset
	case io.SeekCurrent:
		g.pos += offset
	case io.SeekEnd:
		size, err := g.dl.totalSize()
		if err != nil {
			return 0, err
		}
		g.pos = size + offset
	default:
		return 0, fmt.Errorf("bad whence %d", whence)
	}
	if g.pos < 0 {
		g.pos = 0
	}
	return g.pos, nil
}

func (g *growingFile) Close() error {
	g.mu.Lock()
	g.closed = true
	g.mu.Unlock()
	// The download keeps running to fill the cache; only this reader closes.
	return g.f.Close()
}

// ─── Prefetch, stats, eviction ──────────────────────────────────────────────

// prefetch warms the cache for a track the user is likely to play next. It just
// kicks (or joins) the shared download and returns; no reader is attached.
func prefetch(url string) {
	if url == "" {
		return
	}
	go getDownload(url) // dedup + completion handled inside
}

type cacheStats struct {
	Count int   `json:"count"`
	Bytes int64 `json:"bytes"`
}

func cacheStatsNow() cacheStats {
	var s cacheStats
	dir, err := cacheDir()
	if err != nil {
		return s
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if filepath.Ext(e.Name()) != ".audio" {
			continue
		}
		if fi, err := e.Info(); err == nil {
			s.Count++
			s.Bytes += fi.Size()
		}
	}
	return s
}

func clearCache() {
	dir, err := cacheDir()
	if err != nil {
		return
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		os.Remove(filepath.Join(dir, e.Name()))
	}
}

// touch bumps mtime so a replayed cached track counts as recently used.
func touch(paths ...string) {
	now := time.Now()
	for _, p := range paths {
		os.Chtimes(p, now, now)
	}
}

// evictCache drops least-recently-used tracks until the cache is under the cap.
// Never removes a file with an in-flight download.
func evictCache() {
	dir, err := cacheDir()
	if err != nil {
		return
	}
	entries, _ := os.ReadDir(dir)
	type item struct {
		base    string
		size    int64
		mod     time.Time
		dataAbs string
	}
	var items []item
	var total int64
	for _, e := range entries {
		if filepath.Ext(e.Name()) != ".audio" {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		abs := filepath.Join(dir, e.Name())
		items = append(items, item{
			base:    e.Name()[:len(e.Name())-len(".audio")],
			size:    fi.Size(),
			mod:     fi.ModTime(),
			dataAbs: abs,
		})
		total += fi.Size()
	}
	if total <= maxCacheBytes {
		return
	}
	sort.Slice(items, func(i, j int) bool { return items[i].mod.Before(items[j].mod) })

	dlMu.Lock()
	for _, it := range items {
		if total <= maxCacheBytes {
			break
		}
		if _, busy := dlActive[it.dataAbs]; busy {
			continue // don't evict something being downloaded right now
		}
		os.Remove(it.dataAbs)
		os.Remove(filepath.Join(dir, it.base+".done"))
		total -= it.size
	}
	dlMu.Unlock()
}
