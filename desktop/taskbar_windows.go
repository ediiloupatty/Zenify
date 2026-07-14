//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

// Taskbar integration: the three transport buttons under the window's taskbar
// thumbnail, and the play/pause badge drawn over the app icon. This is the native
// surface you can reach WITHOUT opening the window — hover the taskbar, skip a
// track — and its absence is one of the things that gives a web shell away.
//
// Clicks come back as WM_COMMAND with THBN_CLICKED in the high word and are
// pushed onto mediaKeyCh: the same channel the hardware media keys and the tray
// menu already use, so the transport keeps one code path rather than three.
//
// The buttons cannot be attached until the shell has actually created the taskbar
// button, which it announces with the TaskbarButtonCreated message — attaching
// earlier is silently dropped. That message also arrives again if Explorer
// restarts, and the taskbar button is a new one by then, so we re-attach rather
// than assume our first attempt still holds.

var (
	ole32             = syscall.NewLazyDLL("ole32.dll")
	pCoInitializeEx   = ole32.NewProc("CoInitializeEx")
	pCoCreateInstance = ole32.NewProc("CoCreateInstance")

	gdi32             = syscall.NewLazyDLL("gdi32.dll")
	pCreateDIBSection = gdi32.NewProc("CreateDIBSection")
	pCreateBitmap     = gdi32.NewProc("CreateBitmap")
	pDeleteObject     = gdi32.NewProc("DeleteObject")

	pCreateIconIndirect = user32.NewProc("CreateIconIndirect")
)

// msgTaskbarButtonCreated is the shell's "your taskbar button now exists" signal.
var msgTaskbarButtonCreated = registerMessage("TaskbarButtonCreated")

const (
	// ITaskbarList3 vtable slots, counted from IUnknown: QueryInterface, AddRef,
	// Release, then ITaskbarList (HrInit …), ITaskbarList2, ITaskbarList3.
	vtRelease              = 2
	vtHrInit               = 3
	vtThumbBarAddButtons   = 15
	vtThumbBarUpdateButton = 16
	vtSetOverlayIcon       = 18

	thbnClicked = 0x1800
	wmCommand   = 0x0111

	thbIcon    = 0x2
	thbTooltip = 0x4

	// Thumbbar button ids. Distinct from the tray menu's 0xA0xx so a stray
	// WM_COMMAND can never be mistaken for the other surface.
	idThumbPrev = 0xB001
	idThumbPlay = 0xB002
	idThumbNext = 0xB003
)

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

var (
	clsidTaskbarList = guid{0x56FDF344, 0xFD6D, 0x11D0, [8]byte{0x95, 0x8A, 0x00, 0x60, 0x97, 0xC9, 0xA0, 0x90}}
	iidTaskbarList3  = guid{0xEA1AFB91, 0x9E28, 0x4B86, [8]byte{0x90, 0xE9, 0x9E, 0x9F, 0x8A, 0x5E, 0xEF, 0xAF}}
)

// THUMBBUTTON. The padding is explicit because the shell reads this by offset:
// hIcon must land on an 8-byte boundary, and the struct must be 552 bytes on x64.
type thumbButton struct {
	DwMask  uint32
	IID     uint32
	IBitmap uint32
	_       uint32
	HIcon   uintptr
	SzTip   [260]uint16
	DwFlags uint32
	_       uint32
}

type iconInfo struct {
	FIcon    int32
	XHotspot uint32
	YHotspot uint32
	_        uint32
	HbmMask  uintptr
	HbmColor uintptr
}

type bitmapInfoHeader struct {
	BiSize          uint32
	BiWidth         int32
	BiHeight        int32
	BiPlanes        uint16
	BiBitCount      uint16
	BiCompression   uint32
	BiSizeImage     uint32
	BiXPelsPerMeter int32
	BiYPelsPerMeter int32
	BiClrUsed       uint32
	BiClrImportant  uint32
}

var (
	taskbarList uintptr // ITaskbarList3*
	taskbarHwnd uintptr

	iconPlay, iconPause, iconPrev, iconNext uintptr

	// Last reported now-playing state. Kept because the presence can arrive before
	// the taskbar button exists, and the buttons must then paint the truth, not a
	// default.
	taskbarPlaying  bool
	taskbarHasTrack bool
)

// taskbarInit records the window and draws the four glyphs once. The COM object
// itself is created later, when the shell says the taskbar button exists.
func taskbarInit(hwnd uintptr) {
	taskbarHwnd = hwnd

	// WebView2 has already put this thread in a single-threaded apartment; asking
	// again returns S_FALSE and costs nothing, but it means we never depend on that.
	pCoInitializeEx.Call(0, 2 /*COINIT_APARTMENTTHREADED*/)

	size, _, _ := pGetSystemMetrics.Call(smCxSmIcon)
	n := int32(size)
	if n <= 0 {
		n = 16
	}
	iconPlay = makeGlyphIcon(n, glyphPlay)
	iconPause = makeGlyphIcon(n, glyphPause)
	iconPrev = makeGlyphIcon(n, glyphPrev)
	iconNext = makeGlyphIcon(n, glyphNext)
}

// taskbarButtonCreated attaches the transport buttons. Called from the wndProc on
// the shell's TaskbarButtonCreated message — the earliest moment the taskbar will
// accept them.
func taskbarButtonCreated(hwnd uintptr) {
	if taskbarList == 0 {
		var obj uintptr
		hr, _, _ := pCoCreateInstance.Call(
			uintptr(unsafe.Pointer(&clsidTaskbarList)),
			0,
			1, // CLSCTX_INPROC_SERVER
			uintptr(unsafe.Pointer(&iidTaskbarList3)),
			uintptr(unsafe.Pointer(&obj)),
		)
		if hr != 0 || obj == 0 {
			return
		}
		if comCall(obj, vtHrInit) != 0 {
			comCall(obj, vtRelease)
			return
		}
		taskbarList = obj
	}

	buttons := [3]thumbButton{
		newThumbButton(idThumbPrev, iconPrev, "Lagu sebelumnya"),
		newThumbButton(idThumbPlay, iconPlay, "Putar"),
		newThumbButton(idThumbNext, iconNext, "Lagu berikutnya"),
	}
	comCall(taskbarList, vtThumbBarAddButtons, hwnd, 3, uintptr(unsafe.Pointer(&buttons[0])))

	// Paint whatever is already playing: the first track can easily start before
	// the shell gets around to creating the button.
	taskbarRefresh()
}

func newThumbButton(id uintptr, icon uintptr, tip string) thumbButton {
	b := thumbButton{
		DwMask: thbIcon | thbTooltip,
		IID:    uint32(id),
		HIcon:  icon,
	}
	copyUTF16(b.SzTip[:], tip)
	return b
}

// taskbarUpdate is fed every now-playing change, alongside the tray.
func taskbarUpdate(p presence) {
	playing := p.State == "playing"
	hasTrack := p.Title != ""
	if playing == taskbarPlaying && hasTrack == taskbarHasTrack {
		return
	}
	taskbarPlaying = playing
	taskbarHasTrack = hasTrack
	taskbarRefresh()
}

// taskbarRefresh pushes the current state onto the middle button and the icon
// badge. Only the play/pause button ever changes; prev and next are constant.
func taskbarRefresh() {
	if taskbarList == 0 || taskbarHwnd == 0 {
		return
	}

	icon, tip := iconPlay, "Putar"
	if taskbarPlaying {
		icon, tip = iconPause, "Jeda"
	}
	b := newThumbButton(idThumbPlay, icon, tip)
	comCall(taskbarList, vtThumbBarUpdateButton, taskbarHwnd, 1, uintptr(unsafe.Pointer(&b)))

	// The badge over the app icon: it says at a glance whether the thing is still
	// playing while its window is hidden in the tray. Nothing playing, no badge —
	// a permanent decoration would just be noise.
	overlay, desc := uintptr(0), ""
	if taskbarHasTrack {
		if taskbarPlaying {
			overlay, desc = iconPlay, "Sedang diputar"
		} else {
			overlay, desc = iconPause, "Dijeda"
		}
	}
	var descPtr uintptr
	if desc != "" {
		if s, err := syscall.UTF16PtrFromString(desc); err == nil {
			descPtr = uintptr(unsafe.Pointer(s))
		}
	}
	comCall(taskbarList, vtSetOverlayIcon, taskbarHwnd, overlay, descPtr)
}

// taskbarCommand routes a thumbbar click. Reports whether the message was ours.
func taskbarCommand(wparam uintptr) bool {
	if (wparam>>16)&0xffff != thbnClicked {
		return false
	}
	switch wparam & 0xffff {
	case idThumbPrev:
		sendMediaKey("prev")
	case idThumbPlay:
		sendMediaKey("play-pause")
	case idThumbNext:
		sendMediaKey("next")
	default:
		return false
	}
	return true
}

// comCall invokes the idx'th method of a COM interface. Go has no vtable calling
// convention, so the pointer arithmetic is done by hand: obj points at its vtable,
// the vtable is an array of function pointers, and every method takes the object
// as its first argument.
//
// `go vet` flags the two dereferences below as possible unsafe.Pointer misuse. Its
// rule guards against a uintptr holding a *Go* address, which the GC may move out
// from under it. This one is a COM object the shell allocated and handed us: it is
// not Go memory, it cannot be moved, and it stays put until we Release it. Calling
// a vtable from Go cannot be expressed any other way.
func comCall(obj uintptr, idx int, args ...uintptr) uintptr {
	vtbl := *(*uintptr)(unsafe.Pointer(obj))                                        //nolint:govet // COM-owned, see above
	fn := *(*uintptr)(unsafe.Pointer(vtbl + uintptr(idx)*unsafe.Sizeof(uintptr(0)))) //nolint:govet // COM-owned, see above
	r, _, _ := syscall.SyscallN(fn, append([]uintptr{obj}, args...)...)
	return r
}

// ─── Glyphs ─────────────────────────────────────────────────────────────────
//
// The transport icons are drawn here rather than shipped as assets: they are four
// flat shapes, they must follow the system icon size (and therefore DPI), and a
// .ico per size per glyph is a lot of binary to carry for two triangles and a bar.
//
// Each glyph is a coverage function over the unit square. Sampling it on a 4×4
// grid per pixel gives antialiased edges — without that, the play triangle's
// diagonal is a visible staircase at 16px.

type glyph func(x, y float64) bool

func glyphPlay(x, y float64) bool {
	return inTriangle(x, y, 0.30, 0.18, 0.30, 0.82, 0.80, 0.50)
}

func glyphPause(x, y float64) bool {
	return inRect(x, y, 0.30, 0.20, 0.43, 0.80) || inRect(x, y, 0.57, 0.20, 0.70, 0.80)
}

func glyphNext(x, y float64) bool {
	return inTriangle(x, y, 0.22, 0.20, 0.22, 0.80, 0.60, 0.50) ||
		inRect(x, y, 0.63, 0.20, 0.75, 0.80)
}

func glyphPrev(x, y float64) bool {
	return inTriangle(x, y, 0.78, 0.20, 0.78, 0.80, 0.40, 0.50) ||
		inRect(x, y, 0.25, 0.20, 0.37, 0.80)
}

func inRect(x, y, x0, y0, x1, y1 float64) bool {
	return x >= x0 && x <= x1 && y >= y0 && y <= y1
}

func inTriangle(px, py, ax, ay, bx, by, cx, cy float64) bool {
	// Barycentric sign test: inside iff the point is on the same side of all three
	// edges. Works whichever way round the vertices are wound.
	d1 := (px-bx)*(ay-by) - (ax-bx)*(py-by)
	d2 := (px-cx)*(by-cy) - (bx-cx)*(py-cy)
	d3 := (px-ax)*(cy-ay) - (cx-ax)*(py-ay)
	hasNeg := d1 < 0 || d2 < 0 || d3 < 0
	hasPos := d1 > 0 || d2 > 0 || d3 > 0
	return !(hasNeg && hasPos)
}

// makeGlyphIcon rasterises g into a size×size HICON: white, antialiased, on full
// transparency. Windows alpha-blends a 32-bit icon, so the pixels are premultiplied
// — for pure white that simply means every channel equals the coverage.
func makeGlyphIcon(size int32, g glyph) uintptr {
	bi := bitmapInfoHeader{
		BiWidth:     size,
		BiHeight:    -size, // negative: top-down, so row 0 is the top row
		BiPlanes:    1,
		BiBitCount:  32,
		BiSizeImage: uint32(size * size * 4),
	}
	bi.BiSize = uint32(unsafe.Sizeof(bi))

	var bits unsafe.Pointer
	hbmColor, _, _ := pCreateDIBSection.Call(
		0, uintptr(unsafe.Pointer(&bi)), 0 /*DIB_RGB_COLORS*/, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if hbmColor == 0 || bits == nil {
		return 0
	}

	px := unsafe.Slice((*byte)(bits), int(size)*int(size)*4)
	const sub = 4 // 4×4 samples per pixel
	for y := int32(0); y < size; y++ {
		for x := int32(0); x < size; x++ {
			hits := 0
			for sy := 0; sy < sub; sy++ {
				for sx := 0; sx < sub; sx++ {
					fx := (float64(x) + (float64(sx)+0.5)/sub) / float64(size)
					fy := (float64(y) + (float64(sy)+0.5)/sub) / float64(size)
					if g(fx, fy) {
						hits++
					}
				}
			}
			a := byte(hits * 255 / (sub * sub))
			i := (y*size + x) * 4
			px[i], px[i+1], px[i+2], px[i+3] = a, a, a, a // BGRA, premultiplied white
		}
	}

	// A 32-bit colour bitmap carries its own alpha, so the mask is ignored — but
	// CreateIconIndirect still insists on being handed one.
	hbmMask, _, _ := pCreateBitmap.Call(uintptr(size), uintptr(size), 1, 1, 0)

	info := iconInfo{FIcon: 1, HbmMask: hbmMask, HbmColor: hbmColor}
	hIcon, _, _ := pCreateIconIndirect.Call(uintptr(unsafe.Pointer(&info)))

	// CreateIconIndirect copies the bitmaps; the originals are ours to clean up.
	pDeleteObject.Call(hbmColor)
	pDeleteObject.Call(hbmMask)
	return hIcon
}
