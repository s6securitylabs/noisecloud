//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

func init() {
	enableWindowsVirtualTerminal()
}

func enableWindowsVirtualTerminal() {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	procGetConsoleMode := kernel32.NewProc("GetConsoleMode")
	procSetConsoleMode := kernel32.NewProc("SetConsoleMode")
	procGetStdHandle := kernel32.NewProc("GetStdHandle")

	handle, _, _ := procGetStdHandle.Call(uintptr(uint32(0xFFFFFFF5)))
	if handle == 0 {
		return
	}

	var mode uint32
	ret, _, _ := procGetConsoleMode.Call(handle, uintptr(unsafe.Pointer(&mode)))
	if ret == 0 {
		return
	}

	mode |= 0x0004
	procSetConsoleMode.Call(handle, uintptr(mode))
}
