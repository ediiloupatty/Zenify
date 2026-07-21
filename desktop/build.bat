@echo off
cd /d "%~dp0"

echo [1/4] Converting logo.png to logo.ico...
go run mkicon.go ..\public\logo.png logo.ico
if errorlevel 1 ( echo FAILED && pause && exit /b 1 )

echo [2/4] Compiling Windows resource (icon)...
windres zenify.rc -O coff -o zenify.syso
if errorlevel 1 ( echo FAILED - pastikan windres ada di PATH (C:\msys64\mingw64\bin) && pause && exit /b 1 )

echo [3/4] Building zenify-desktop.exe...
set CGO_ENABLED=1
go build -trimpath -ldflags="-H windowsgui -extldflags \"-static\" -X main.defaultURL=https://www.zenify.cc" -o zenify-desktop.exe .
if errorlevel 1 ( echo FAILED && pause && exit /b 1 )

REM Build the installer straight after, so Output\ZenifySetup.exe can never bundle
REM a stale exe (an out-of-order compile is what shipped a localhost:3000 build).
echo [4/4] Building installer (Output\ZenifySetup.exe)...
set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" ( echo SKIP - Inno Setup tidak ditemukan. Compile Zenify.iss manual di Inno Setup. && goto done )
"%ISCC%" Zenify.iss
if errorlevel 1 ( echo FAILED - Inno compile gagal && pause && exit /b 1 )

:done
echo.
echo Done! zenify-desktop.exe + Output\ZenifySetup.exe siap dibagikan.
pause
