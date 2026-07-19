// Progressive download source for the native engine. The decoder needs an
// io.ReadSeeker over the whole file, but waiting for a 30-100MB FLAC before
// the first note would be unusable — so the file streams into the local cache
// while a growingFile serves reads, blocking only when the decoder outruns the
// download. A fully-cached track (marker file present) plays instantly and
// costs no bandwidth. Reads past the downloaded edge (e.g. a far seek) simply
// wait for those bytes to arrive.
//
// Cache eviction is deliberately absent in Fase 1 — the library fits on disk
// many times over; revisit when that stops being true.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type growingFile struct {
	mu   sync.Mutex
	cond *sync.Cond
	f    *os.File // read handle
	have int64    // bytes present on disk
	size int64    // total size; -1 until known
	err  error    // download error, or errClosed
	pos  int64    // current read offset
}

var errSourceClosed = fmt.Errorf("audio source closed")

func cachePaths(url string) (data, marker string, err error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", "", err
	}
	dir := filepath.Join(base, "Zenify", "audio")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", err
	}
	sum := sha256.Sum256([]byte(url))
	name := hex.EncodeToString(sum[:12])
	return filepath.Join(dir, name+".audio"), filepath.Join(dir, name+".done"), nil
}

// openSource returns a ReadSeeker over the (possibly still-downloading) track.
func openSource(url string) (*growingFile, error) {
	dataPath, markerPath, err := cachePaths(url)
	if err != nil {
		return nil, err
	}

	// Complete cached copy: serve straight from disk.
	if _, err := os.Stat(markerPath); err == nil {
		if st, err := os.Stat(dataPath); err == nil {
			f, err := os.Open(dataPath)
			if err == nil {
				g := newGrowingFile(f)
				g.have, g.size = st.Size(), st.Size()
				return g, nil
			}
		}
		// Marker without data (or unreadable) — fall through and redownload.
		os.Remove(markerPath)
	}

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "ZenifyDesktop/1.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("audio fetch: HTTP %d", resp.StatusCode)
	}

	w, err := os.Create(dataPath)
	if err != nil {
		resp.Body.Close()
		return nil, err
	}
	r, err := os.Open(dataPath)
	if err != nil {
		w.Close()
		resp.Body.Close()
		return nil, err
	}

	g := newGrowingFile(r)
	g.size = resp.ContentLength // -1 when the server doesn't say

	go func() {
		defer resp.Body.Close()
		defer w.Close()
		buf := make([]byte, 64*1024)
		var written int64
		for {
			n, err := resp.Body.Read(buf)
			if n > 0 {
				if _, werr := w.Write(buf[:n]); werr != nil {
					g.fail(werr)
					return
				}
				written += int64(n)
				g.advance(written)
			}
			if err == io.EOF {
				g.complete(written)
				// Marker only after a verified full download.
				os.WriteFile(markerPath, []byte(time.Now().Format(time.RFC3339)), 0o644)
				return
			}
			if err != nil {
				g.fail(fmt.Errorf("download interrupted: %w", err))
				return
			}
		}
	}()

	return g, nil
}

func newGrowingFile(f *os.File) *growingFile {
	g := &growingFile{f: f, size: -1}
	g.cond = sync.NewCond(&g.mu)
	return g
}

func (g *growingFile) advance(have int64) {
	g.mu.Lock()
	g.have = have
	g.cond.Broadcast()
	g.mu.Unlock()
}

func (g *growingFile) complete(size int64) {
	g.mu.Lock()
	g.have, g.size = size, size
	g.cond.Broadcast()
	g.mu.Unlock()
}

func (g *growingFile) fail(err error) {
	g.mu.Lock()
	if g.err == nil {
		g.err = err
	}
	g.cond.Broadcast()
	g.mu.Unlock()
}

// Read blocks until at least one byte at the current offset exists (or the
// download ends / the source is closed).
func (g *growingFile) Read(p []byte) (int, error) {
	g.mu.Lock()
	for {
		if g.err != nil {
			err := g.err
			g.mu.Unlock()
			return 0, err
		}
		if g.pos < g.have {
			break
		}
		if g.size >= 0 && g.pos >= g.size {
			g.mu.Unlock()
			return 0, io.EOF
		}
		g.cond.Wait()
	}
	avail := g.have - g.pos
	if int64(len(p)) > avail {
		p = p[:avail]
	}
	off := g.pos
	g.mu.Unlock()

	n, err := g.f.ReadAt(p, off)

	g.mu.Lock()
	g.pos = off + int64(n)
	g.mu.Unlock()
	return n, err
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
		// The final size may be unknown mid-download (chunked responses);
		// wait for it — callers seeking from the end genuinely need it.
		for g.size < 0 && g.err == nil {
			g.cond.Wait()
		}
		if g.err != nil {
			return 0, g.err
		}
		g.pos = g.size + offset
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
	if g.err == nil {
		g.err = errSourceClosed
	}
	g.cond.Broadcast()
	g.mu.Unlock()
	return g.f.Close()
}
