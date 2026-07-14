//go:build !windows

package main

// The thumbbar and the icon overlay are ITaskbarList3, i.e. Windows shell COM.
func taskbarInit(hwnd uintptr)    {}
func taskbarUpdate(p presence)    {}
