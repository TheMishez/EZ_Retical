// EZ Reticle native helper (Windows only).
//
// One background thread owns a hidden message-only window and does two jobs:
//
// 1. Input for click/key animations, through Raw Input with RIDEV_INPUTSINK.
//    Raw Input gives this process a copy of each mouse/keyboard event after Windows has
//    already sent it on to the game. Unlike a low-level hook (WH_MOUSE_LL / WH_KEYBOARD_LL),
//    nothing waits on this thread, so it cannot add latency to the game's input even when
//    the PC is busy. Mouse movement is dropped here in C++; only button and key changes
//    reach JavaScript.
//
// 2. Foreground-window watching for per-game profiles and "follow game window", through
//    SetWinEventHook(EVENT_SYSTEM_FOREGROUND). Windows tells us when the active window
//    changes, and a cheap 500 ms timer catches window moves and resolution changes.
//    This replaces a PowerShell process that polled once a second.
//
// JavaScript API (all calls from the main process's JS thread):
//   inputStart(cb(kind, code, e0, down, vk)) -> bool   kind: 0 = mouse button, 1 = key
//   inputStop()
//   foregroundStart(cb(line)) -> bool                    line: "name|x|y|w|h"
//   foregroundStop()
//   setEfficiency(pid, on) -> bool   Windows "Efficiency mode" (EcoQoS) for one of our processes

#include <windows.h>
#include <node_api.h>

#include <mutex>
#include <string>
#include <thread>

namespace {

const UINT MSG_INPUT_ON = WM_APP + 1;
const UINT MSG_INPUT_OFF = WM_APP + 2;
const UINT MSG_FG_ON = WM_APP + 3;
const UINT MSG_FG_OFF = WM_APP + 4;
const UINT MSG_SHUTDOWN = WM_APP + 5;
const UINT_PTR FG_TIMER = 1;
const UINT FG_POLL_MS = 500;
const wchar_t kClassName[] = L"EZReticleNativeWorker";

struct InputEvent {
  int kind;  // 0 = mouse button, 1 = key
  int code;  // mouse: 1..5, key: scan code
  bool e0;   // key: extended (E0) scan code
  bool down;
  int vk;    // key: virtual-key code (for reference)
};

std::mutex g_startLock;            // thread start/stop
std::mutex g_fnLock;               // the two thread-safe functions below
napi_threadsafe_function g_inputFn = nullptr;
napi_threadsafe_function g_fgFn = nullptr;

std::thread g_thread;
HWND g_hwnd = nullptr;  // written once by the worker before it signals ready

// Worker-thread state (only touched on the worker thread).
bool g_inputRegistered = false;
HWINEVENTHOOK g_fgHook = nullptr;
std::string g_lastLine;
DWORD g_lastPid = 0;
std::string g_lastName;

// ------------------------------------------------------------------ helpers

std::string ToUtf8(const wchar_t* s, int len) {
  if (len <= 0) return std::string();
  int n = WideCharToMultiByte(CP_UTF8, 0, s, len, nullptr, 0, nullptr, nullptr);
  if (n <= 0) return std::string();
  std::string out(static_cast<size_t>(n), '\0');
  WideCharToMultiByte(CP_UTF8, 0, s, len, &out[0], n, nullptr, nullptr);
  return out;
}

// Executable name without folder or ".exe" (same as PowerShell's ProcessName).
std::string ProcessName(DWORD pid) {
  if (!pid) return std::string();
  if (pid == g_lastPid) return g_lastName;
  std::string name;
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (h) {
    wchar_t buf[MAX_PATH * 2];
    DWORD len = static_cast<DWORD>(sizeof(buf) / sizeof(buf[0]));
    if (QueryFullProcessImageNameW(h, 0, buf, &len) && len > 0) {
      int start = 0;
      for (int i = 0; i < static_cast<int>(len); i++) {
        if (buf[i] == L'\\' || buf[i] == L'/') start = i + 1;
      }
      int end = static_cast<int>(len);
      if (end - start > 4) {
        const wchar_t* ext = buf + end - 4;
        if (ext[0] == L'.' && (ext[1] | 0x20) == L'e' && (ext[2] | 0x20) == L'x' && (ext[3] | 0x20) == L'e') end -= 4;
      }
      name = ToUtf8(buf + start, end - start);
    }
    CloseHandle(h);
  }
  // Only cache names we could read; an unreadable process may become readable later.
  if (!name.empty()) {
    g_lastPid = pid;
    g_lastName = name;
  }
  return name;
}

// ------------------------------------------------------------------ JS callbacks

void CallInputJs(napi_env env, napi_value cb, void* /*context*/, void* data) {
  InputEvent* ev = static_cast<InputEvent*>(data);
  if (env && cb) {
    napi_value args[5];
    napi_create_int32(env, ev->kind, &args[0]);
    napi_create_int32(env, ev->code, &args[1]);
    napi_get_boolean(env, ev->e0, &args[2]);
    napi_get_boolean(env, ev->down, &args[3]);
    napi_create_int32(env, ev->vk, &args[4]);
    napi_value undef;
    napi_get_undefined(env, &undef);
    napi_call_function(env, undef, cb, 5, args, nullptr);
  }
  delete ev;
}

void CallFgJs(napi_env env, napi_value cb, void* /*context*/, void* data) {
  std::string* line = static_cast<std::string*>(data);
  if (env && cb) {
    napi_value arg;
    napi_create_string_utf8(env, line->c_str(), line->size(), &arg);
    napi_value undef;
    napi_get_undefined(env, &undef);
    napi_call_function(env, undef, cb, 1, &arg, nullptr);
  }
  delete line;
}

void EmitInput(int kind, int code, bool e0, bool down, int vk) {
  std::lock_guard<std::mutex> lock(g_fnLock);
  if (!g_inputFn) return;
  InputEvent* ev = new InputEvent{kind, code, e0, down, vk};
  if (napi_call_threadsafe_function(g_inputFn, ev, napi_tsfn_nonblocking) != napi_ok) delete ev;
}

void EmitForeground(const std::string& line) {
  std::lock_guard<std::mutex> lock(g_fnLock);
  if (!g_fgFn) return;
  std::string* copy = new std::string(line);
  if (napi_call_threadsafe_function(g_fgFn, copy, napi_tsfn_nonblocking) != napi_ok) delete copy;
}

// ------------------------------------------------------------------ worker: raw input

void HandleRawInput(LPARAM lParam) {
  // RAWINPUT is big enough for mouse and keyboard reports (the only devices registered).
  alignas(8) BYTE buf[sizeof(RAWINPUT)];
  UINT size = sizeof(buf);
  UINT got = GetRawInputData(reinterpret_cast<HRAWINPUT>(lParam), RID_INPUT, buf, &size, sizeof(RAWINPUTHEADER));
  if (got == static_cast<UINT>(-1) || got < sizeof(RAWINPUTHEADER)) return;
  const RAWINPUT* ri = reinterpret_cast<const RAWINPUT*>(buf);

  if (ri->header.dwType == RIM_TYPEMOUSE) {
    const USHORT f = ri->data.mouse.usButtonFlags;
    if (!f) return;  // plain movement: the common case, dropped right here
    static const USHORT kDown[5] = {RI_MOUSE_BUTTON_1_DOWN, RI_MOUSE_BUTTON_2_DOWN, RI_MOUSE_BUTTON_3_DOWN,
                                    RI_MOUSE_BUTTON_4_DOWN, RI_MOUSE_BUTTON_5_DOWN};
    static const USHORT kUp[5] = {RI_MOUSE_BUTTON_1_UP, RI_MOUSE_BUTTON_2_UP, RI_MOUSE_BUTTON_3_UP,
                                  RI_MOUSE_BUTTON_4_UP, RI_MOUSE_BUTTON_5_UP};
    // Button 1 = left, 2 = right, 3 = middle, matching "Mouse1".."Mouse5".
    for (int i = 0; i < 5; i++) {
      if (f & kDown[i]) EmitInput(0, i + 1, false, true, 0);
      if (f & kUp[i]) EmitInput(0, i + 1, false, false, 0);
    }
  } else if (ri->header.dwType == RIM_TYPEKEYBOARD) {
    const RAWKEYBOARD& k = ri->data.keyboard;
    if (k.MakeCode == KEYBOARD_OVERRUN_MAKE_CODE || k.VKey == 0xFF) return;
    if (k.Flags & RI_KEY_E1) return;  // Pause/Break prefix
    EmitInput(1, k.MakeCode, (k.Flags & RI_KEY_E0) != 0, (k.Flags & RI_KEY_BREAK) == 0, k.VKey);
  }
}

BOOL SetRawInput(HWND hwnd, bool on) {
  RAWINPUTDEVICE dev[2];
  dev[0].usUsagePage = 0x01;  // generic desktop
  dev[0].usUsage = 0x02;      // mouse
  dev[1].usUsagePage = 0x01;
  dev[1].usUsage = 0x06;      // keyboard
  for (int i = 0; i < 2; i++) {
    // INPUTSINK: receive input while another app (the game) is in front.
    // No NOLEGACY: the game and our own windows keep getting normal messages.
    dev[i].dwFlags = on ? RIDEV_INPUTSINK : RIDEV_REMOVE;
    dev[i].hwndTarget = on ? hwnd : nullptr;
  }
  return RegisterRawInputDevices(dev, 2, sizeof(RAWINPUTDEVICE));
}

// ------------------------------------------------------------------ worker: foreground window

void ReportForeground() {
  HWND fg = GetForegroundWindow();
  std::string name;
  long x = 0, y = 0, w = 0, h = 0;
  if (fg) {
    DWORD pid = 0;
    GetWindowThreadProcessId(fg, &pid);
    name = ProcessName(pid);
    RECT r;
    if (GetClientRect(fg, &r)) {
      POINT p = {0, 0};
      ClientToScreen(fg, &p);
      x = p.x;
      y = p.y;
      w = r.right - r.left;
      h = r.bottom - r.top;
    }
  }
  std::string line = name + "|" + std::to_string(x) + "|" + std::to_string(y) + "|" + std::to_string(w) + "|" +
                     std::to_string(h);
  if (line == g_lastLine) return;
  g_lastLine = line;
  EmitForeground(line);
}

void CALLBACK OnWinEvent(HWINEVENTHOOK, DWORD, HWND, LONG, LONG, DWORD, DWORD) {
  g_lastPid = 0;  // a new window came to front: re-read its process name (process ids get reused)
  ReportForeground();
}

void StopForeground(HWND hwnd) {
  if (g_fgHook) {
    UnhookWinEvent(g_fgHook);
    g_fgHook = nullptr;
  }
  KillTimer(hwnd, FG_TIMER);
  g_lastLine.clear();
}

// ------------------------------------------------------------------ worker: window + thread

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  switch (msg) {
    case WM_INPUT:
      HandleRawInput(lParam);
      break;  // DefWindowProc must still run for WM_INPUT
    case MSG_INPUT_ON:
      if (!g_inputRegistered) g_inputRegistered = SetRawInput(hwnd, true) != FALSE;
      return g_inputRegistered ? 1 : 0;
    case MSG_INPUT_OFF:
      if (g_inputRegistered) SetRawInput(hwnd, false);
      g_inputRegistered = false;
      return 1;
    case MSG_FG_ON:
      if (!g_fgHook) {
        g_fgHook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, nullptr, OnWinEvent, 0, 0,
                                   WINEVENT_OUTOFCONTEXT);
        if (!g_fgHook) return 0;
        SetTimer(hwnd, FG_TIMER, FG_POLL_MS, nullptr);
      }
      g_lastLine.clear();
      ReportForeground();
      return 1;
    case MSG_FG_OFF:
      StopForeground(hwnd);
      return 1;
    case WM_TIMER:
      if (wParam == FG_TIMER) ReportForeground();
      return 0;
    case MSG_SHUTDOWN:
      if (g_inputRegistered) SetRawInput(hwnd, false);
      g_inputRegistered = false;
      StopForeground(hwnd);
      DestroyWindow(hwnd);
      return 1;
    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;
  }
  return DefWindowProcW(hwnd, msg, wParam, lParam);
}

void WorkerMain(HANDLE ready) {
  // Physical pixels for window positions, like the overlay uses (per-monitor DPI aware v2).
  typedef DPI_AWARENESS_CONTEXT(WINAPI * SetCtxFn)(DPI_AWARENESS_CONTEXT);
  HMODULE user32 = GetModuleHandleW(L"user32.dll");
  SetCtxFn setCtx = user32 ? reinterpret_cast<SetCtxFn>(GetProcAddress(user32, "SetThreadDpiAwarenessContext")) : nullptr;
  if (setCtx) setCtx(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  // Work here is tiny; a slightly higher priority keeps animations snappy under game load.
  SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);

  HINSTANCE inst = GetModuleHandleW(nullptr);
  WNDCLASSEXW wc;
  ZeroMemory(&wc, sizeof(wc));
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = WndProc;
  wc.hInstance = inst;
  wc.lpszClassName = kClassName;
  RegisterClassExW(&wc);  // fails harmlessly if already registered
  HWND hwnd = CreateWindowExW(0, kClassName, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, inst, nullptr);
  g_hwnd = hwnd;
  SetEvent(ready);
  if (!hwnd) return;

  MSG m;
  while (GetMessageW(&m, nullptr, 0, 0) > 0) DispatchMessageW(&m);
}

bool EnsureThread() {
  std::lock_guard<std::mutex> lock(g_startLock);
  if (g_hwnd) return true;
  if (g_thread.joinable()) return false;  // started before and failed to make its window
  HANDLE ready = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (!ready) return false;
  g_thread = std::thread(WorkerMain, ready);
  WaitForSingleObject(ready, 5000);
  CloseHandle(ready);
  return g_hwnd != nullptr;
}

// ------------------------------------------------------------------ N-API glue

void ReleaseFn(napi_threadsafe_function* slot) {
  napi_threadsafe_function fn;
  {
    std::lock_guard<std::mutex> lock(g_fnLock);
    fn = *slot;
    *slot = nullptr;
  }
  if (fn) napi_release_threadsafe_function(fn, napi_tsfn_release);
}

// Clears a slot when Node destroys its function (after release, or at shutdown), so the worker
// can never call a function that has been freed.
struct FnHolder {
  napi_threadsafe_function fn;
  napi_threadsafe_function* slot;
};

void FinalizeFn(napi_env, void* data, void*) {
  FnHolder* h = static_cast<FnHolder*>(data);
  {
    std::lock_guard<std::mutex> lock(g_fnLock);
    if (*h->slot == h->fn) *h->slot = nullptr;
  }
  delete h;
}

bool MakeFn(napi_env env, napi_value cb, const char* name, napi_threadsafe_function_call_js call,
            napi_threadsafe_function* slot) {
  napi_valuetype t;
  if (napi_typeof(env, cb, &t) != napi_ok || t != napi_function) {
    napi_throw_type_error(env, nullptr, "callback must be a function");
    return false;
  }
  napi_value resName;
  napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &resName);
  FnHolder* holder = new FnHolder{nullptr, slot};
  napi_threadsafe_function fn = nullptr;
  if (napi_create_threadsafe_function(env, cb, nullptr, resName, 4096, 1, holder, FinalizeFn, nullptr, call, &fn) !=
      napi_ok) {
    delete holder;
    return false;
  }
  holder->fn = fn;
  napi_unref_threadsafe_function(env, fn);  // never keeps the app from quitting
  ReleaseFn(slot);
  std::lock_guard<std::mutex> lock(g_fnLock);
  *slot = fn;
  return true;
}

napi_value Bool(napi_env env, bool v) {
  napi_value out;
  napi_get_boolean(env, v, &out);
  return out;
}

napi_value FirstArg(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {nullptr};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) napi_get_undefined(env, &argv[0]);
  return argv[0];
}

napi_value InputStart(napi_env env, napi_callback_info info) {
  napi_value cb = FirstArg(env, info);
  if (!EnsureThread()) return Bool(env, false);
  if (!MakeFn(env, cb, "ezInput", CallInputJs, &g_inputFn)) return nullptr;
  bool ok = SendMessageW(g_hwnd, MSG_INPUT_ON, 0, 0) != 0;
  if (!ok) ReleaseFn(&g_inputFn);
  return Bool(env, ok);
}

napi_value InputStop(napi_env env, napi_callback_info) {
  if (g_hwnd) SendMessageW(g_hwnd, MSG_INPUT_OFF, 0, 0);
  ReleaseFn(&g_inputFn);
  return nullptr;
}

napi_value ForegroundStart(napi_env env, napi_callback_info info) {
  napi_value cb = FirstArg(env, info);
  if (!EnsureThread()) return Bool(env, false);
  if (!MakeFn(env, cb, "ezForeground", CallFgJs, &g_fgFn)) return nullptr;
  bool ok = SendMessageW(g_hwnd, MSG_FG_ON, 0, 0) != 0;
  if (!ok) ReleaseFn(&g_fgFn);
  return Bool(env, ok);
}

napi_value ForegroundStop(napi_env env, napi_callback_info) {
  if (g_hwnd) SendMessageW(g_hwnd, MSG_FG_OFF, 0, 0);
  ReleaseFn(&g_fgFn);
  return nullptr;
}

void Cleanup(void*) {
  // Node destroys the thread-safe functions itself at shutdown; just stop using them.
  {
    std::lock_guard<std::mutex> lock(g_fnLock);
    g_inputFn = nullptr;
    g_fgFn = nullptr;
  }
  std::lock_guard<std::mutex> lock(g_startLock);
  if (g_hwnd) {
    SendMessageW(g_hwnd, MSG_SHUTDOWN, 0, 0);
    g_hwnd = nullptr;
  }
  if (g_thread.joinable()) g_thread.join();
}

// Same as Task Manager's "Efficiency mode" (with idle priority, which JS sets): Windows runs the
// process on efficient cores / low clocks. Resolved at runtime; needs Windows 10 1709+ (11 for full effect).
struct EzPowerThrottling {
  ULONG Version;
  ULONG ControlMask;
  ULONG StateMask;
};
const int kProcessPowerThrottling = 4;          // PROCESS_INFORMATION_CLASS::ProcessPowerThrottling
const ULONG kThrottleExecutionSpeed = 0x1;      // PROCESS_POWER_THROTTLING_EXECUTION_SPEED
const ULONG kThrottleIgnoreTimerRes = 0x4;      // PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION

napi_value SetEfficiency(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2] = {nullptr, nullptr};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  int32_t pid = 0;
  bool on = false;
  if (argc < 2 || napi_get_value_int32(env, argv[0], &pid) != napi_ok || napi_get_value_bool(env, argv[1], &on) != napi_ok ||
      pid <= 0) {
    return Bool(env, false);
  }
  typedef BOOL(WINAPI * SetInfoFn)(HANDLE, int, LPVOID, DWORD);
  static SetInfoFn setInfo = nullptr;
  static bool looked = false;
  if (!looked) {
    looked = true;
    HMODULE k32 = GetModuleHandleW(L"kernel32.dll");
    if (k32) setInfo = reinterpret_cast<SetInfoFn>(GetProcAddress(k32, "SetProcessInformation"));
  }
  if (!setInfo) return Bool(env, false);
  HANDLE h = OpenProcess(PROCESS_SET_INFORMATION, FALSE, static_cast<DWORD>(pid));
  if (!h) return Bool(env, false);
  EzPowerThrottling st;
  st.Version = 1;
  st.ControlMask = kThrottleExecutionSpeed | kThrottleIgnoreTimerRes;
  st.StateMask = on ? (kThrottleExecutionSpeed | kThrottleIgnoreTimerRes) : 0;
  BOOL ok = setInfo(h, kProcessPowerThrottling, &st, sizeof(st));
  CloseHandle(h);
  return Bool(env, ok != FALSE);
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor props[] = {
      {"inputStart", nullptr, InputStart, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"inputStop", nullptr, InputStop, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"foregroundStart", nullptr, ForegroundStart, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"foregroundStop", nullptr, ForegroundStop, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setEfficiency", nullptr, SetEfficiency, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  napi_add_env_cleanup_hook(env, Cleanup, nullptr);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
