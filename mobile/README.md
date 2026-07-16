# Zenify Remote

Aplikasi Android untuk mengontrol Zenify yang sedang diputar di laptop — gaya
Spotify Connect. Fitur (sengaja dikunci segini saja): login, previous,
play/pause, next, dan cari lagu lalu putar di laptop.

## Cara pakai

1. Jalankan Zenify di laptop (`npm run dev` atau `npm run build && npm start`)
   dan buka playernya di browser laptop dalam keadaan login.
2. Cari IP laptop di Wi-Fi: `ipconfig` → IPv4 Address (mis. `192.168.1.10`).
3. Di HP (Wi-Fi yang sama), buka app → isi alamat server
   `192.168.1.10:3000`, lalu login dengan akun Zenify yang sama.

## Build APK

```
cd mobile
flutter build apk --release
```

Hasilnya di `build/app/outputs/flutter-apk/app-release.apk` — kirim ke HP
(USB/WhatsApp/Drive) lalu instal (izinkan "install unknown apps").

## Arsitektur

- HP tidak memutar audio; ia hanya mengirim perintah ke server Next.js
  (`/api/remote/command`) dan membaca status (`/api/remote/state`).
- Browser laptop (komponen `RemoteBridge`) polling `/api/remote/sync` tiap 2
  detik: melaporkan lagu yang sedang diputar dan mengeksekusi perintah antrian.
- Login HP memakai `/api/remote/login` (kredensial sama dengan web) dan
  menerima token HMAC yang tetap berlaku walau server restart.
