@echo off
REM ── Build zenify-desktop.exe with the production URL baked in ────────────────
REM Single source of truth for the exe build. Called by BOTH build.bat (full
REM one-shot build) and Zenify.iss (auto pre-compile in the Inno GUI), so the
REM go-build command + baked URL live in exactly one place — no drift, no way to
REM ship a stale/localhost exe again. No pause: it's meant to be called, not
REM double-clicked. Exits non-zero on any failure so callers can abort.
cd /d "%~dp0"
set CGO_ENABLED=1

echo [exe 1/3] logo.png -^> logo.ico...
go run mkicon.go ..\public\logo.png logo.ico || exit /b 1

echo [exe 2/3] compiling icon resource...
windres zenify.rc -O coff -o zenify.syso || exit /b 1

echo [exe 3/3] go build (URL: https://www.zenify.cc)...
go build -trimpath -ldflags="-H windowsgui -extldflags \"-static\" -X main.defaultURL=https://www.zenify.cc" -o zenify-desktop.exe . || exit /b 1

echo [exe] OK -^> zenify-desktop.exe
exit /b 0
