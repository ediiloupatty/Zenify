//go:build windows

package main

import (
	"os"
	"syscall"
	"unsafe"
)

// "Jalankan saat Windows menyala", toggled from the tray menu.
//
// HKCU\...\Run, not a scheduled task and not the machine-wide HKLM key: this is a
// per-user preference the user can also revoke from Task Manager's Startup tab,
// and writing it needs no elevation.
//
// The entry starts the app with -minimized, because autostart means "be there when
// I want you", not "throw a window at me the moment I log in" — Zenify comes up in
// the tray, already loaded, and opens instantly when clicked.

var (
	advapi32         = syscall.NewLazyDLL("advapi32.dll")
	pRegSetValueEx   = advapi32.NewProc("RegSetValueExW")
	pRegDeleteValue  = advapi32.NewProc("RegDeleteValueW")
	pRegCreateKeyExW = advapi32.NewProc("RegCreateKeyExW")
)

const (
	runKeyPath   = `Software\Microsoft\Windows\CurrentVersion\Run`
	runValueName = "Zenify"

	keySetValue   = 0x0002
	keyQueryValue = 0x0001
	regSz         = 1
)

// autostartCommand is what gets written to the Run key: the absolute path of this
// exe, quoted (Program Files has a space in it, and an unquoted path there is the
// classic way to hand Windows the wrong executable).
func autostartCommand() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	return `"` + exe + `" -minimized`
}

func autostartEnabled() bool {
	var h syscall.Handle
	sub, err := syscall.UTF16PtrFromString(runKeyPath)
	if err != nil {
		return false
	}
	if syscall.RegOpenKeyEx(syscall.HKEY_CURRENT_USER, sub, 0, keyQueryValue, &h) != nil {
		return false
	}
	defer syscall.RegCloseKey(h)

	name, err := syscall.UTF16PtrFromString(runValueName)
	if err != nil {
		return false
	}
	var typ, size uint32
	return syscall.RegQueryValueEx(h, name, nil, &typ, nil, &size) == nil
}

// autostartSet writes or removes the Run entry. Failures are swallowed: this is a
// convenience toggle, and there is nothing useful to tell the user if the registry
// refuses — the menu simply won't show a checkmark next time.
func autostartSet(on bool) {
	sub, err := syscall.UTF16PtrFromString(runKeyPath)
	if err != nil {
		return
	}
	// The Run key always exists in practice, but RegCreateKeyEx opens-or-creates in
	// one call and saves us from caring.
	var h syscall.Handle
	r, _, _ := pRegCreateKeyExW.Call(
		uintptr(syscall.HKEY_CURRENT_USER),
		uintptr(unsafe.Pointer(sub)),
		0, 0, 0,
		uintptr(keySetValue|keyQueryValue),
		0,
		uintptr(unsafe.Pointer(&h)),
		0,
	)
	if r != 0 {
		return
	}
	defer syscall.RegCloseKey(h)

	name, err := syscall.UTF16PtrFromString(runValueName)
	if err != nil {
		return
	}

	if !on {
		pRegDeleteValue.Call(uintptr(h), uintptr(unsafe.Pointer(name)))
		return
	}

	cmd := autostartCommand()
	if cmd == "" {
		return
	}
	val, err := syscall.UTF16FromString(cmd) // includes the NUL the registry expects
	if err != nil {
		return
	}
	pRegSetValueEx.Call(
		uintptr(h),
		uintptr(unsafe.Pointer(name)),
		0,
		regSz,
		uintptr(unsafe.Pointer(&val[0])),
		uintptr(len(val)*2), // bytes, not runes
	)
}
