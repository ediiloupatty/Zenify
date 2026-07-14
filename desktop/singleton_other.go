//go:build !windows

package main

// Single-instance handover is Win32 (named mutex + broadcast message); elsewhere
// every launch is simply allowed to run.
func claimSingleInstance() bool { return true }
