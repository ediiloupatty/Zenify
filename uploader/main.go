package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/dhowden/tag"
	"github.com/joho/godotenv"
	"github.com/schollz/progressbar/v3"
)

const (
	maxWorkers = 5
	maxRetries = 3
	timeout    = 5 * time.Minute
)

// Extensions we treat as uploadable audio. Everything else (e.g. leftover
// `tmp*` download fragments) is ignored so junk never lands in the bucket.
var audioExts = map[string]bool{
	".flac": true, ".mp3": true, ".wav": true,
	".m4a": true, ".ogg": true, ".aac": true,
}

// Track is one file plus the metadata we'll write to D1.
type Track struct {
	Path        string
	Key         string // R2 object key (preserves artist/album/file structure)
	FileURL     string // what we store in tracks.file_url
	Size        int64
	Title       string
	Artist      string
	Album       string
	Genre       string
	Year        int
	ContentType string
}

func main() {
	dirPtr := flag.String("dir", "", "Directory containing songs to upload")
	categoryPtr := flag.String("category", "Library", "Playlist / category the tracks are filed under in the app")
	prefixPtr := flag.String("prefix", "", "Optional R2 key prefix (e.g. \"music\"). Empty keeps artist/album at the bucket root.")
	flag.Parse()

	if *dirPtr == "" {
		log.Fatal("❌ Error: Harap berikan lokasi folder menggunakan flag -dir (contoh: -dir=./download)")
	}
	category := strings.TrimSpace(*categoryPtr)
	if category == "" {
		category = "Library"
	}
	keyPrefix := strings.Trim(filepath.ToSlash(*prefixPtr), "/")

	// Load .env from the project root or the current dir.
	if err := godotenv.Load("../.env", ".env"); err != nil {
		log.Println("⚠️  Warning: Tidak menemukan file .env, menggunakan system environment variables.")
	}

	accountID := os.Getenv("CLOUDFLARE_ACCOUNT_ID")
	accessKey := os.Getenv("R2_ACCESS_KEY_ID")
	secretKey := os.Getenv("R2_SECRET_ACCESS_KEY")
	bucketName := os.Getenv("R2_BUCKET_NAME")
	publicURL := strings.TrimRight(os.Getenv("R2_PUBLIC_URL"), "/")

	if accountID == "" || accessKey == "" || secretKey == "" || bucketName == "" {
		log.Fatal("❌ Error: Kredensial R2 tidak lengkap di .env (butuh CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME).")
	}
	if publicURL == "" {
		// The app turns this URL into /api/audio/<key>, so it must be present.
		log.Fatal("❌ Error: R2_PUBLIC_URL belum diset di .env — dibutuhkan untuk menyusun file_url yang dikenali app.")
	}

	// D1 credentials — without these the rows can't be written and the songs
	// would never show up in the app (the whole point of this rewrite).
	d1ID := os.Getenv("D1_DATABASE_ID")
	d1Token := os.Getenv("CLOUDFLARE_API_TOKEN")
	if d1ID == "" || d1Token == "" {
		log.Fatal("❌ Error: Kredensial D1 tidak lengkap di .env (butuh D1_DATABASE_ID, CLOUDFLARE_API_TOKEN).")
	}
	d1 := &d1Client{
		endpoint: fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/d1/database/%s/query", accountID, d1ID),
		token:    d1Token,
		http:     &http.Client{Timeout: 30 * time.Second},
	}

	// AWS config for Cloudflare R2.
	cfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")),
		config.WithRegion("auto"),
	)
	if err != nil {
		log.Fatalf("❌ Gagal memuat AWS Config: %v", err)
	}
	s3Client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID))
	})

	// Make sure the tracks table exists (no-op if the app already created it).
	if err := d1.ensureSchema(context.TODO()); err != nil {
		log.Fatalf("❌ Gagal menyiapkan tabel D1: %v", err)
	}

	// Pre-load existing rows for duplicate detection: by song identity
	// (title+artist+album, like the app) and by file_url (to make re-runs safe).
	existingSongs, existingURLs, err := d1.loadExisting(context.TODO())
	if err != nil {
		log.Fatalf("❌ Gagal membaca data tracks yang ada: %v", err)
	}

	// Collect audio files + derive metadata.
	fmt.Println("🔍 Memindai folder...")
	var tracks []Track
	var totalSizeBytes int64
	skippedJunk := 0
	root := filepath.Clean(*dirPtr)
	err = filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		if !audioExts[ext] {
			skippedJunk++ // tmp fragments, .jpg, .nfo, etc.
			return nil
		}

		rel, _ := filepath.Rel(root, p)
		rel = filepath.ToSlash(rel)
		artist, album, title := deriveFromPath(rel)
		// Embedded tags win over folder-derived values when present.
		var genre string
		var year int
		if tTitle, tArtist, tAlbum, tGenre, tYear, ok := readTags(p); ok {
			if tTitle != "" {
				title = tTitle
			}
			if tArtist != "" {
				artist = tArtist
			}
			if tAlbum != "" {
				album = tAlbum
			}
			genre = tGenre
			year = tYear
		}
		key := path.Join(keyPrefix, rel)
		tracks = append(tracks, Track{
			Path:        p,
			Key:         key,
			FileURL:     publicURL + "/" + key,
			Size:        info.Size(),
			Title:       strings.TrimSpace(title),
			Artist:      strings.TrimSpace(artist),
			Album:       strings.TrimSpace(album),
			Genre:       strings.TrimSpace(genre),
			Year:        year,
			ContentType: contentTypeFor(ext),
		})
		totalSizeBytes += info.Size()
		return nil
	})
	if err != nil {
		log.Fatalf("❌ Gagal membaca folder: %v", err)
	}

	if len(tracks) == 0 {
		fmt.Printf("🤷 Tidak ada file audio yang ditemukan (mengabaikan %d file non-audio).\n", skippedJunk)
		return
	}

	fmt.Printf("📦 Ditemukan %d lagu (Total: %.2f MB) untuk bucket '%s', kategori '%s'.\n", len(tracks), float64(totalSizeBytes)/(1024*1024), bucketName, category)
	if skippedJunk > 0 {
		fmt.Printf("🧹 Mengabaikan %d file non-audio (tmp/gambar/dll).\n", skippedJunk)
	}
	fmt.Println()

	bar := progressbar.NewOptions64(
		totalSizeBytes,
		progressbar.OptionEnableColorCodes(true),
		progressbar.OptionShowBytes(true),
		progressbar.OptionSetWidth(40),
		progressbar.OptionSetDescription("[cyan]MEMPROSES...[reset]"),
		progressbar.OptionSetTheme(progressbar.Theme{
			Saucer:        "[green]=[reset]",
			SaucerHead:    "[green]>[reset]",
			SaucerPadding: " ",
			BarStart:      "[",
			BarEnd:        "]",
		}),
	)

	startTime := time.Now()

	var wg sync.WaitGroup
	jobs := make(chan Track, len(tracks))
	var successCount, skipCount, failCount int32

	// Serialise log lines so they don't tear the progress bar.
	printCh := make(chan string, 100)
	var printWg sync.WaitGroup
	printWg.Add(1)
	go func() {
		defer printWg.Done()
		for msg := range printCh {
			_ = bar.Clear()
			fmt.Println(msg)
			_ = bar.RenderBlank()
		}
	}()

	for w := 1; w <= maxWorkers; w++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for t := range jobs {
				// Advance the bar exactly once per finished file (success, skip
				// or give-up). Monotonic — no negative adjustments, no jitter.
				finish := func() { bar.Add64(t.Size) }

				// 1. Already in the library (same song)? Skip outright.
				if existingSongs[songKey(t.Title, t.Artist, t.Album)] {
					atomic.AddInt32(&skipCount, 1)
					printCh <- fmt.Sprintf("⏭️  [W%d] Sudah ada di library: %s — %s", workerID, t.Artist, t.Title)
					finish()
					continue
				}

				// 2. Upload the audio (unless the object is already in R2 from a
				//    previous run — then we still need to write the D1 row).
				alreadyUploaded := existingURLs[t.FileURL]
				if !alreadyUploaded {
					exists, err := objectExists(context.TODO(), s3Client, bucketName, t.Key)
					if err == nil && exists {
						alreadyUploaded = true
					}
				}
				if !alreadyUploaded {
					if err := uploadWithRetry(s3Client, bucketName, t, workerID, printCh); err != nil {
						atomic.AddInt32(&failCount, 1)
						finish()
						continue
					}
				}

				// 3. Write the D1 row so the song actually appears in the app.
				if err := d1.insertTrack(context.TODO(), t, category); err != nil {
					printCh <- fmt.Sprintf("❌ [W%d] Upload OK tapi GAGAL tulis D1 %s: %v", workerID, t.Title, err)
					atomic.AddInt32(&failCount, 1)
					finish()
					continue
				}

				atomic.AddInt32(&successCount, 1)
				printCh <- fmt.Sprintf("✅ [W%d] %s — %s", workerID, t.Artist, t.Title)
				finish()
			}
		}(w)
	}

	for _, t := range tracks {
		jobs <- t
	}
	close(jobs)
	wg.Wait()
	close(printCh)
	printWg.Wait()

	fmt.Println("\n=======================================")
	fmt.Printf("🚀 Selesai dalam %v\n", time.Since(startTime).Round(time.Second))
	fmt.Printf("✅ Berhasil (upload + D1): %d lagu\n", successCount)
	fmt.Printf("⏭️  Dilewati (duplikat):    %d lagu\n", skipCount)
	fmt.Printf("❌ Gagal:                  %d lagu\n", failCount)
	fmt.Println("=======================================")
	fmt.Println("ℹ️  Cover & durasi sengaja dikosongkan. Jalankan \"Backfill covers\" + \"Backfill audio specs\" di panel admin untuk melengkapinya.")
}

// deriveFromPath turns a relative path like "Adele/21/Someone Like You.flac"
// into artist=Adele, album=21, title="Someone Like You".
func deriveFromPath(rel string) (artist, album, title string) {
	segs := strings.Split(rel, "/")
	base := segs[len(segs)-1]
	title = strings.TrimSuffix(base, filepath.Ext(base))
	switch {
	case len(segs) >= 3:
		artist, album = segs[0], segs[1]
	case len(segs) == 2:
		artist = segs[0]
	}
	return
}

// readTags reads embedded metadata. ok=false means the file had no usable tags.
func readTags(p string) (title, artist, album, genre string, year int, ok bool) {
	f, err := os.Open(p)
	if err != nil {
		return "", "", "", "", 0, false
	}
	defer f.Close()
	m, err := tag.ReadFrom(f)
	if err != nil {
		return "", "", "", "", 0, false
	}
	return m.Title(), m.Artist(), m.Album(), m.Genre(), yearFrom(m), true
}

// yearFrom recovers a release year that tag.Metadata.Year() cannot be trusted to
// give us.
//
// For Vorbis/FLAC, dhowden/tag switches on the *length* of the date comment and
// only knows 4 ("2006"), 7 ("2006-01") and 10 ("2006-01-02"). Any other shape —
// an ISO timestamp like "2021-05-14T00:00:00Z", or "14/05/2021" — leaves the
// layout string empty, so time.Parse fails, the error is thrown away with `_`,
// and it returns the zero time's year: 1. That is exactly how 2805 tracks in this
// library ended up filed under the year 1.
//
// So trust Year() only when the answer is plausible, and otherwise pull the first
// four-digit run out of the raw comment ourselves.
func yearFrom(m tag.Metadata) int {
	if y := m.Year(); plausibleYear(y) {
		return y
	}
	raw := m.Raw()
	for _, key := range []string{"date", "year", "originaldate", "originalyear"} {
		if s, ok := raw[key].(string); ok {
			if y, ok := firstYearIn(s); ok {
				return y
			}
		}
	}
	return 0 // unknown — nullYear turns this into a NULL, not a lie
}

var fourDigits = regexp.MustCompile(`\d{4}`)

func firstYearIn(s string) (int, bool) {
	for _, match := range fourDigits.FindAllString(s, -1) {
		y, err := strconv.Atoi(match)
		if err == nil && plausibleYear(y) {
			return y, true
		}
	}
	return 0, false
}

func plausibleYear(y int) bool {
	return y >= 1900 && y <= time.Now().Year()+1
}

func contentTypeFor(ext string) string {
	switch ext {
	case ".mp3":
		return "audio/mpeg"
	case ".flac":
		return "audio/flac"
	case ".wav":
		return "audio/wav"
	case ".m4a":
		return "audio/mp4"
	case ".ogg":
		return "audio/ogg"
	case ".aac":
		return "audio/aac"
	}
	if ct := mime.TypeByExtension(ext); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

// songKey is the normalised identity used for duplicate detection (mirrors the
// app: lowercase, collapsed whitespace, title+artist+album).
func songKey(title, artist, album string) string {
	return normalize(title) + "|" + normalize(artist) + "|" + normalize(album)
}

func normalize(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(s)), " ")
}

func objectExists(ctx context.Context, client *s3.Client, bucket, key string) (bool, error) {
	_, err := client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		var notFound *types.NotFound
		if errors.As(err, &notFound) || strings.Contains(err.Error(), "NotFound") || strings.Contains(err.Error(), "404") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func uploadWithRetry(client *s3.Client, bucket string, t Track, workerID int, printCh chan string) error {
	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		err := putObject(client, bucket, t)
		if err == nil {
			return nil
		}
		lastErr = err
		msg := err.Error()
		if errors.Is(err, context.DeadlineExceeded) {
			msg = "Koneksi terlalu lambat (Timeout 5 Menit)"
		}
		printCh <- fmt.Sprintf("🔄 [W%d] [%d/%d] Gagal upload %s: %s", workerID, attempt, maxRetries, t.Title, msg)
		if attempt < maxRetries {
			time.Sleep(time.Duration(attempt*2) * time.Second)
		}
	}
	printCh <- fmt.Sprintf("❌ [W%d] MENYERAH setelah %d percobaan: %s", workerID, maxRetries, t.Title)
	return lastErr
}

func putObject(client *s3.Client, bucket string, t Track) error {
	file, err := os.Open(t.Path)
	if err != nil {
		return err
	}
	defer file.Close()

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	_, err = client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(t.Key),
		Body:        file,
		ContentType: aws.String(t.ContentType),
	})
	return err
}

// ─── D1 REST client ─────────────────────────────────────────────────────────
// Talks to the same endpoint the Next.js app uses:
// POST /accounts/{acct}/d1/database/{db}/query  body {sql, params}

type d1Client struct {
	endpoint string
	token    string
	http     *http.Client
}

func (c *d1Client) query(ctx context.Context, sql string, params []interface{}) ([]map[string]interface{}, error) {
	if params == nil {
		params = []interface{}{}
	}
	body, _ := json.Marshal(map[string]interface{}{"sql": sql, "params": params})
	req, err := http.NewRequestWithContext(ctx, "POST", c.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var out struct {
		Success bool `json:"success"`
		Errors  []struct {
			Message string `json:"message"`
		} `json:"errors"`
		Result []struct {
			Results []map[string]interface{} `json:"results"`
		} `json:"result"`
	}
	raw, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("respons D1 tidak valid (HTTP %d): %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	if !out.Success {
		msg := "unknown error"
		if len(out.Errors) > 0 {
			msg = out.Errors[0].Message
		}
		return nil, fmt.Errorf("%s", msg)
	}
	if len(out.Result) > 0 {
		return out.Result[0].Results, nil
	}
	return nil, nil
}

func (c *d1Client) ensureSchema(ctx context.Context) error {
	// CREATE IF NOT EXISTS is a no-op when the app already made the table; for a
	// fresh DB it creates it with the full column set the app expects.
	_, err := c.query(ctx, `CREATE TABLE IF NOT EXISTS tracks (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		category TEXT NOT NULL,
		file_url TEXT NOT NULL,
		artist TEXT,
		cover_url TEXT,
		lyrics TEXT,
		album TEXT,
		year INTEGER,
		genre TEXT,
		duration INTEGER,
		bit_depth INTEGER,
		sample_rate INTEGER,
		play_count INTEGER DEFAULT 0,
		last_played_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`, nil)
	return err
}

func (c *d1Client) loadExisting(ctx context.Context) (songs map[string]bool, urls map[string]bool, err error) {
	rows, err := c.query(ctx, "SELECT title, artist, album, file_url FROM tracks", nil)
	if err != nil {
		return nil, nil, err
	}
	songs = make(map[string]bool, len(rows))
	urls = make(map[string]bool, len(rows))
	for _, r := range rows {
		songs[songKey(asString(r["title"]), asString(r["artist"]), asString(r["album"]))] = true
		if u := asString(r["file_url"]); u != "" {
			urls[u] = true
		}
	}
	return songs, urls, nil
}

func (c *d1Client) insertTrack(ctx context.Context, t Track, category string) error {
	_, err := c.query(ctx,
		`INSERT INTO tracks (id, title, category, file_url, artist, cover_url, lyrics, album, year, genre, duration, bit_depth, sample_rate)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[]interface{}{
			newUUID(),
			t.Title,
			category,
			t.FileURL,
			nullStr(t.Artist),
			nil, // cover_url — filled later by admin "Backfill covers"
			nil, // lyrics
			nullStr(t.Album),
			nullYear(t.Year),
			nullStr(t.Genre),
			nil, // duration — filled later by admin "Backfill audio specs"
			nil, // bit_depth
			nil, // sample_rate
		},
	)
	return err
}

// ─── small helpers ──────────────────────────────────────────────────────────

func asString(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func nullStr(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// nullYear keeps anything we can't vouch for out of the database. `y <= 0` was
// too weak a guard: the value that actually got through was 1.
func nullYear(y int) interface{} {
	if !plausibleYear(y) {
		return nil
	}
	return y
}

func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
