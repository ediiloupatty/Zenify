; Inno Setup script — builds the Zenify installer (Output\ZenifySetup.exe).
;
; SEBELUM compile:
;   1) build exe produksi dulu dari CMD di folder desktop:
;        release.bat https://www.zenify.cc/player
;   2) buka file ini di Inno Setup -> Build -> Compile (Ctrl+F9)
;
; Hasil: Output\ZenifySetup.exe  — itu yang dibagikan ke orang lain.

#define MyAppName "Zenify"
#define MyAppVersion "1.1.0"
#define MyAppPublisher "Edii Loupatty"
#define MyAppExeName "zenify-desktop.exe"

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
