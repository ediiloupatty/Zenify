; Inno Setup script — builds the Zenify installer (Output\ZenifySetup.exe).
;
; CARA PAKAI: buka file ini di Inno Setup -> Compile (Ctrl+F9). Itu saja.
; Blok #ifndef di bawah otomatis me-rebuild zenify-desktop.exe (dengan URL
; produksi ter-bake) SEBELUM packaging, jadi installer tak akan pernah membungkus
; exe basi. Kalau build exe gagal, compile ikut dibatalkan (bukan diam-diam pakai
; exe lama). Prasyarat: Go, gcc (mingw), dan windres ada di PATH.
;
; (build.bat memanggil ISCC dengan /DSKIP_EXE_BUILD supaya exe tak di-build 2x.)
;
; Hasil: Output\ZenifySetup.exe  — itu yang dibagikan ke orang lain.

#define MyAppName "Zenify"
#define MyAppVersion "1.1.0"
#define MyAppPublisher "Edii Loupatty"
#define MyAppExeName "zenify-desktop.exe"

; ── Auto-build the exe before compiling (skipped when build.bat already did it) ─
; Absolute path via SourcePath: cmd.exe won't resolve a bare batch name from the
; working dir, so build_exe.bat must be called by its full path.
#ifndef SKIP_EXE_BUILD
  #if Exec("cmd.exe", "/C call """ + SourcePath + "build_exe.bat""", SourcePath) != 0
    #error Gagal build zenify-desktop.exe. Pastikan Go, gcc (mingw), dan windres ada di PATH, lalu Compile ulang.
  #endif
#endif

[Setup]
AppId={{B7E3F1C2-9A4D-4E6B-8F12-5A7C9E2D4F01}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
; Install per-user (tanpa prompt admin / UAC).
PrivilegesRequired=lowest
DefaultDirName={localappdata}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=ZenifySetup
SetupIconFile=logo.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Buat shortcut di Desktop"; GroupDescription: "Shortcut tambahan:"

[Files]
Source: "zenify-desktop.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Jalankan {#MyAppName}"; Flags: nowait postinstall skipifsilent
