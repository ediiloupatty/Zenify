// Decoders for the native engine. Each one turns its container into interleaved
// PCM in a malgo device format:
//
//	FLAC → S32 (16/24-bit samples left-shifted into the top bits: a lossless,
//	       bit-transparent widening — the DAC-facing mixer just sees more zeros)
//	MP3  → S16 (go-mp3 always yields 16-bit stereo)
//	WAV  → S16 or S32 (16/24-bit PCM only)
//
// Anything else errors out of openDecoder, which the page treats as "play this
// one in the browser instead".
package main

import (
	"encoding/binary"
	"fmt"
	"io"

	"github.com/gen2brain/malgo"
	mp3 "github.com/hajimehoshi/go-mp3"
	"github.com/mewkiz/flac"
)

type pcmDecoder interface {
	// ReadPCM fills dst (whose length is a multiple of the output frame size)
	// with interleaved PCM, returning the number of BYTES written. io.EOF ends
	// the stream; a short read with nil error is fine.
	ReadPCM(dst []byte) (int, error)
	// SeekFrame repositions decoding to the given frame (sample-per-channel).
	SeekFrame(n int64) error
	Info() (rate, channels, bits int, totalFrames int64, format malgo.FormatType)
}

// openDecoder sniffs the leading bytes and hands the source to the right
// decoder. The source is rewound before each attempt.
func openDecoder(src *growingFile) (pcmDecoder, error) {
	var magic [12]byte
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	if _, err := io.ReadFull(src, magic[:]); err != nil {
		return nil, fmt.Errorf("read header: %w", err)
	}
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}

	switch {
	case string(magic[0:4]) == "fLaC":
		return newFlacDecoder(src)
	case string(magic[0:4]) == "RIFF" && string(magic[8:12]) == "WAVE":
		return newWavDecoder(src)
	case string(magic[0:3]) == "ID3", magic[0] == 0xFF && magic[1]&0xE0 == 0xE0:
		return newMp3Decoder(src)
	default:
		return nil, fmt.Errorf("unsupported format (magic %x)", magic[0:4])
	}
}

// ─── FLAC ───────────────────────────────────────────────────────────────────

type flacDecoder struct {
	stream  *flac.Stream
	bits    int
	shift   uint // left-shift that widens a sample to 32 bits
	pending []byte
	skip    int64 // samples to discard after a coarse Seek landed early
}

func newFlacDecoder(src *growingFile) (*flacDecoder, error) {
	stream, err := flac.NewSeek(src)
	if err != nil {
		return nil, fmt.Errorf("flac: %w", err)
	}
	bits := int(stream.Info.BitsPerSample)
	if bits != 16 && bits != 24 {
		return nil, fmt.Errorf("flac: unsupported bit depth %d", bits)
	}
	return &flacDecoder{stream: stream, bits: bits, shift: uint(32 - bits)}, nil
}

func (d *flacDecoder) Info() (int, int, int, int64, malgo.FormatType) {
	i := d.stream.Info
	return int(i.SampleRate), int(i.NChannels), d.bits, int64(i.NSamples), malgo.FormatS32
}

func (d *flacDecoder) ReadPCM(dst []byte) (int, error) {
	written := 0
	for written < len(dst) {
		if len(d.pending) == 0 {
			frame, err := d.stream.ParseNext()
			if err != nil {
				if written > 0 && err == io.EOF {
					return written, nil
				}
				return written, err
			}
			channels := len(frame.Subframes)
			samples := len(frame.Subframes[0].Samples)
			from := 0
			if d.skip > 0 {
				from = int(min64(d.skip, int64(samples)))
				d.skip -= int64(from)
			}
			if from == samples {
				continue
			}
			buf := make([]byte, (samples-from)*channels*4)
			o := 0
			for i := from; i < samples; i++ {
				for ch := 0; ch < channels; ch++ {
					v := uint32(frame.Subframes[ch].Samples[i]) << d.shift
					binary.LittleEndian.PutUint32(buf[o:], v)
					o += 4
				}
			}
			d.pending = buf
		}
		n := copy(dst[written:], d.pending)
		d.pending = d.pending[n:]
		written += n
	}
	return written, nil
}

func (d *flacDecoder) SeekFrame(n int64) error {
	actual, err := d.stream.Seek(uint64(n))
	if err != nil {
		return fmt.Errorf("flac seek: %w", err)
	}
	d.pending = nil
	// Seek lands on a frame boundary at or before the target — decode and
	// discard the difference so the audible position is sample-exact.
	d.skip = n - int64(actual)
	if d.skip < 0 {
		d.skip = 0
	}
	return nil
}

// ─── MP3 ────────────────────────────────────────────────────────────────────

type mp3Decoder struct {
	d     *mp3.Decoder
	total int64
}

func newMp3Decoder(src *growingFile) (*mp3Decoder, error) {
	d, err := mp3.NewDecoder(src)
	if err != nil {
		return nil, fmt.Errorf("mp3: %w", err)
	}
	// Length seeks the source end; on a still-downloading file that blocks
	// until the download finishes. Acceptable: Direct Mode streams originals,
	// so MP3 here means an MP3-sourced upload — the smallest files we host.
	total := d.Length() / 4
	if total < 0 {
		total = 0
	}
	return &mp3Decoder{d: d, total: total}, nil
}

func (d *mp3Decoder) Info() (int, int, int, int64, malgo.FormatType) {
	return d.d.SampleRate(), 2, 16, d.total, malgo.FormatS16
}

func (d *mp3Decoder) ReadPCM(dst []byte) (int, error) {
	return d.d.Read(dst)
}

func (d *mp3Decoder) SeekFrame(n int64) error {
	_, err := d.d.Seek(n*4, io.SeekStart)
	return err
}

// ─── WAV ────────────────────────────────────────────────────────────────────

type wavDecoder struct {
	src       *growingFile
	dataStart int64
	dataLen   int64
	pos       int64 // bytes consumed within data
	rate      int
	channels  int
	bits      int
	inBlock   int // bytes per frame in the file
}

func newWavDecoder(src *growingFile) (*wavDecoder, error) {
	var hdr [12]byte
	if _, err := io.ReadFull(src, hdr[:]); err != nil {
		return nil, err
	}
	d := &wavDecoder{src: src}
	// Walk the RIFF chunks for fmt + data.
	off := int64(12)
	for {
		var ch [8]byte
		if _, err := src.Seek(off, io.SeekStart); err != nil {
			return nil, err
		}
		if _, err := io.ReadFull(src, ch[:]); err != nil {
			return nil, fmt.Errorf("wav: %w", err)
		}
		id := string(ch[0:4])
		size := int64(binary.LittleEndian.Uint32(ch[4:8]))
		body := off + 8
		switch id {
		case "fmt ":
			var f [16]byte
			if _, err := io.ReadFull(src, f[:]); err != nil {
				return nil, err
			}
			format := binary.LittleEndian.Uint16(f[0:2])
			if format != 1 && format != 0xFFFE { // PCM / extensible-assumed-PCM
				return nil, fmt.Errorf("wav: unsupported codec %d", format)
			}
			d.channels = int(binary.LittleEndian.Uint16(f[2:4]))
			d.rate = int(binary.LittleEndian.Uint32(f[4:8]))
			d.bits = int(binary.LittleEndian.Uint16(f[14:16]))
		case "data":
			d.dataStart, d.dataLen = body, size
		}
		if d.dataStart != 0 && d.rate != 0 {
			break
		}
		off = body + size + size%2 // chunks are word-aligned
	}
	if d.bits != 16 && d.bits != 24 {
		return nil, fmt.Errorf("wav: unsupported bit depth %d", d.bits)
	}
	if d.channels < 1 || d.channels > 8 {
		return nil, fmt.Errorf("wav: bad channel count %d", d.channels)
	}
	d.inBlock = d.channels * d.bits / 8
	if _, err := src.Seek(d.dataStart, io.SeekStart); err != nil {
		return nil, err
	}
	return d, nil
}

func (d *wavDecoder) Info() (int, int, int, int64, malgo.FormatType) {
	format := malgo.FormatS16
	if d.bits == 24 {
		format = malgo.FormatS32
	}
	return d.rate, d.channels, d.bits, d.dataLen / int64(d.inBlock), format
}

func (d *wavDecoder) ReadPCM(dst []byte) (int, error) {
	remain := d.dataLen - d.pos
	if remain <= 0 {
		return 0, io.EOF
	}
	if d.bits == 16 {
		want := int64(len(dst))
		if want > remain {
			want = remain
		}
		n, err := d.src.Read(dst[:want])
		d.pos += int64(n)
		return n, err
	}
	// 24-bit: widen each 3-byte sample into the top of an int32.
	outFrames := len(dst) / 4
	in := make([]byte, outFrames*3)
	want := int64(len(in))
	if want > remain {
		want = remain
	}
	n, err := d.src.Read(in[:want])
	d.pos += int64(n)
	samples := n / 3
	for i := 0; i < samples; i++ {
		v := uint32(in[i*3])<<8 | uint32(in[i*3+1])<<16 | uint32(in[i*3+2])<<24
		binary.LittleEndian.PutUint32(dst[i*4:], v)
	}
	return samples * 4, err
}

func (d *wavDecoder) SeekFrame(n int64) error {
	byteOff := n * int64(d.inBlock)
	if byteOff > d.dataLen {
		byteOff = d.dataLen
	}
	if _, err := d.src.Seek(d.dataStart+byteOff, io.SeekStart); err != nil {
		return err
	}
	d.pos = byteOff
	return nil
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
