#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <stdio.h>
#include <string.h>

/* Bytes that mark the start of the attached zip. The same bytes live in this
   program, so the last copy in the file is the one in front of the payload. */
static const unsigned char MARK[] = {
    0x54, 0x52, 0x49, 0x50, 0x4c, 0x45, 0x41, 0x5a,
    0x49, 0x50, 0x21, 0x7e, 0x91, 0x02, 0xc3, 0x4d};

static void tell(const wchar_t *text) {
  MessageBoxW(NULL, text, L"TripleA IPTV Player", MB_OK | MB_ICONINFORMATION);
}

static void fail(const wchar_t *text) {
  MessageBoxW(NULL, text, L"TripleA IPTV Player", MB_OK | MB_ICONERROR);
}

static HWND splash_window = NULL;
static HWND splash_label = NULL;

static void pump_messages(void) {
  MSG message;
  while (PeekMessageW(&message, NULL, 0, 0, PM_REMOVE)) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
}

static void show_status(const wchar_t *text) {
  if (!splash_window) {
    WNDCLASSW klass;
    RECT bounds = {0, 0, 460, 130};
    int x;
    int y;
    ZeroMemory(&klass, sizeof(klass));
    klass.lpfnWndProc = DefWindowProcW;
    klass.hInstance = GetModuleHandleW(NULL);
    klass.hCursor = LoadCursor(NULL, IDC_ARROW);
    klass.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    klass.lpszClassName = L"TripleAInstall";
    RegisterClassW(&klass);
    AdjustWindowRect(&bounds, WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU, FALSE);
    x = (GetSystemMetrics(SM_CXSCREEN) - (bounds.right - bounds.left)) / 2;
    y = (GetSystemMetrics(SM_CYSCREEN) - (bounds.bottom - bounds.top)) / 2;
    splash_window = CreateWindowExW(
        WS_EX_TOPMOST,
        L"TripleAInstall",
        L"TripleA IPTV Player",
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
        x,
        y,
        bounds.right - bounds.left,
        bounds.bottom - bounds.top,
        NULL,
        NULL,
        GetModuleHandleW(NULL),
        NULL);
    splash_label = CreateWindowExW(
        0,
        L"STATIC",
        L"",
        WS_CHILD | WS_VISIBLE,
        24,
        36,
        400,
        48,
        splash_window,
        NULL,
        GetModuleHandleW(NULL),
        NULL);
  }
  SetWindowTextW(splash_label, text);
  ShowWindow(splash_window, SW_SHOWNORMAL);
  UpdateWindow(splash_window);
  SetForegroundWindow(splash_window);
  pump_messages();
}

static void hide_status(void) {
  if (!splash_window) return;
  DestroyWindow(splash_window);
  splash_window = NULL;
  splash_label = NULL;
}

static int run_wait(wchar_t *command, const wchar_t *folder, int show) {
  STARTUPINFOW info;
  PROCESS_INFORMATION process;
  DWORD code = 1;
  (void)show;
  ZeroMemory(&info, sizeof(info));
  info.cb = sizeof(info);
  info.dwFlags = STARTF_USESHOWWINDOW;
  info.wShowWindow = SW_HIDE;
  if (!CreateProcessW(NULL, command, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, folder, &info, &process)) {
    return 1;
  }
  hide_status();
  while (WaitForSingleObject(process.hProcess, 150) == WAIT_TIMEOUT) pump_messages();
  GetExitCodeProcess(process.hProcess, &code);
  CloseHandle(process.hProcess);
  CloseHandle(process.hThread);
  return code == 0 ? 0 : 1;
}

static int file_exists(const wchar_t *path) {
  DWORD attrs = GetFileAttributesW(path);
  return attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

static int find_payload(const unsigned char *data, size_t size, size_t *start) {
  unsigned long long length = 0;
  size_t mark;
  size_t zip;
  if (size < sizeof(MARK) + 8) return 0;
  mark = size - sizeof(MARK) - 8;
  if (memcmp(data + mark, MARK, sizeof(MARK)) != 0) return 0;
  memcpy(&length, data + mark + sizeof(MARK), 8);
  if (length < 32 || length > mark) return 0;
  zip = mark - (size_t)length;
  if (data[zip] != 'P' || data[zip + 1] != 'K') return 0;
  *start = zip;
  return 1;
}

static int write_all(const wchar_t *path, const unsigned char *data, size_t size) {
  HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  DWORD wrote = 0;
  if (file == INVALID_HANDLE_VALUE) return 0;
  while (size > 0) {
    DWORD chunk = size > 1 << 20 ? 1 << 20 : (DWORD)size;
    if (!WriteFile(file, data, chunk, &wrote, NULL) || wrote != chunk) {
      CloseHandle(file);
      return 0;
    }
    data += chunk;
    size -= chunk;
  }
  CloseHandle(file);
  return 1;
}

static int unpack(const wchar_t *zip, const wchar_t *dest) {
  wchar_t system[MAX_PATH];
  wchar_t command[32768];
  GetSystemDirectoryW(system, MAX_PATH);
  _snwprintf(command, 32768, L"\"%s\\tar.exe\" -xf \"%s\" -C \"%s\"", system, zip, dest);
  if (run_wait(command, dest, 0) == 0) return 1;
  _snwprintf(
      command,
      32768,
      L"powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"Expand-Archive -LiteralPath '%s' -DestinationPath '%s' -Force\"",
      zip,
      dest);
  return run_wait(command, dest, 0) == 0;
}

static void make_shortcuts(const wchar_t *exe, const wchar_t *folder) {
  wchar_t desktop[MAX_PATH];
  wchar_t programs[MAX_PATH];
  wchar_t script[MAX_PATH];
  wchar_t command[32768];
  wchar_t temp[MAX_PATH];
  HANDLE file;
  char body[4096];
  DWORD wrote = 0;
  int length;
  GetTempPathW(MAX_PATH, temp);
  _snwprintf(script, MAX_PATH, L"%sTripleA-shortcut.ps1", temp);
  length = snprintf(
      body,
      sizeof(body),
      "$w = New-Object -ComObject WScript.Shell\r\n"
      "foreach ($link in @($env:TRIPLEA_DESKTOP, $env:TRIPLEA_MENU)) {\r\n"
      "  if (-not $link) { continue }\r\n"
      "  $s = $w.CreateShortcut($link)\r\n"
      "  $s.TargetPath = $env:TRIPLEA_EXE\r\n"
      "  $s.WorkingDirectory = $env:TRIPLEA_DIR\r\n"
      "  if ($env:TRIPLEA_ICON) { $s.IconLocation = $env:TRIPLEA_ICON }\r\n"
      "  $s.Description = 'TripleA IPTV Player'\r\n"
      "  $s.Save()\r\n"
      "}\r\n");
  if (length < 0 || length >= (int)sizeof(body)) return;
  file = CreateFileW(script, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) return;
  WriteFile(file, body, (DWORD)length, &wrote, NULL);
  CloseHandle(file);
  if (SHGetFolderPathW(NULL, CSIDL_DESKTOPDIRECTORY, NULL, 0, desktop) != S_OK) desktop[0] = 0;
  if (SHGetFolderPathW(NULL, CSIDL_PROGRAMS, NULL, 0, programs) != S_OK) programs[0] = 0;
  if (desktop[0]) wcsncat(desktop, L"\\TripleA IPTV Player.lnk", MAX_PATH - wcslen(desktop) - 1);
  if (programs[0]) wcsncat(programs, L"\\TripleA IPTV Player.lnk", MAX_PATH - wcslen(programs) - 1);
  SetEnvironmentVariableW(L"TRIPLEA_EXE", exe);
  SetEnvironmentVariableW(L"TRIPLEA_DIR", folder);
  SetEnvironmentVariableW(L"TRIPLEA_ICON", NULL);
  {
    wchar_t icon[MAX_PATH];
    _snwprintf(icon, MAX_PATH, L"%s\\public\\logo.ico", folder);
    if (file_exists(icon)) SetEnvironmentVariableW(L"TRIPLEA_ICON", icon);
  }
  SetEnvironmentVariableW(L"TRIPLEA_DESKTOP", desktop);
  SetEnvironmentVariableW(L"TRIPLEA_MENU", programs);
  _snwprintf(command, 32768, L"powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%s\"", script);
  run_wait(command, folder, 0);
  DeleteFileW(script);
}

static int launch_script(const wchar_t *folder) {
  wchar_t command[32768];
  wchar_t script[MAX_PATH];
  _snwprintf(script, MAX_PATH, L"%s\\install.ps1", folder);
  if (!file_exists(script)) {
    fail(L"TripleA did not install. install.ps1 is missing.");
    return 1;
  }
  _snwprintf(
      command,
      32768,
      L"powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%s\"",
      script);
  show_status(L"Installing TripleA. Please wait. This can take a few minutes.");
  if (run_wait(command, folder, 0) != 0) return 1;
  return 0;
}

int WINAPI WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show) {
  wchar_t self[MAX_PATH];
  wchar_t folder[MAX_PATH];
  wchar_t script[MAX_PATH];
  HANDLE file;
  LARGE_INTEGER bytes;
  unsigned char *data = NULL;
  DWORD read = 0;
  size_t size;
  size_t payload = 0;
  (void)instance;
  (void)previous;
  (void)command;
  (void)show;

  if (!GetModuleFileNameW(NULL, self, MAX_PATH)) {
    fail(L"TripleA could not find its installer.");
    return 1;
  }
  wcsncpy(folder, self, MAX_PATH);
  folder[MAX_PATH - 1] = 0;
  {
    wchar_t *slash = wcsrchr(folder, L'\\');
    if (slash) *slash = 0;
  }
  _snwprintf(script, MAX_PATH, L"%s\\install.ps1", folder);
  if (file_exists(script)) return launch_script(folder);

  file = CreateFileW(self, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE || !GetFileSizeEx(file, &bytes) || bytes.QuadPart < 64 || bytes.QuadPart > 200 * 1024 * 1024) {
    if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
    fail(L"TripleA could not read the installer.");
    return 1;
  }
  size = (size_t)bytes.QuadPart;
  data = (unsigned char *)HeapAlloc(GetProcessHeap(), 0, size);
  if (!data || !ReadFile(file, data, (DWORD)size, &read, NULL) || read != size) {
    CloseHandle(file);
    fail(L"TripleA could not read the installer.");
    return 1;
  }
  CloseHandle(file);

  if (!find_payload(data, size, &payload)) {
    HeapFree(GetProcessHeap(), 0, data);
    fail(L"This installer is empty. Download TripleA Setup again.");
    return 1;
  }

  if (SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, folder) != S_OK) {
    HeapFree(GetProcessHeap(), 0, data);
    fail(L"TripleA could not find a folder to install into.");
    return 1;
  }
  wcsncat(folder, L"\\TripleA", MAX_PATH - wcslen(folder) - 1);
  SHCreateDirectoryExW(NULL, folder, NULL);
  show_status(L"Installing TripleA. Please wait. This can take a few minutes.");

  {
    wchar_t zip[MAX_PATH];
    wchar_t launcher[MAX_PATH];
    GetTempPathW(MAX_PATH, zip);
    wcsncat(zip, L"TripleA-IPTV-Player.zip", MAX_PATH - wcslen(zip) - 1);
    if (!write_all(zip, data + payload, size - payload)) {
      HeapFree(GetProcessHeap(), 0, data);
      fail(L"TripleA could not unpack the player.");
      return 1;
    }
    _snwprintf(launcher, MAX_PATH, L"%s\\Install TripleA.exe", folder);
    write_all(launcher, data, payload);
    HeapFree(GetProcessHeap(), 0, data);
    if (!unpack(zip, folder)) {
      fail(L"TripleA could not unpack the player.");
      return 1;
    }
    DeleteFileW(zip);
    make_shortcuts(launcher, folder);
  }
  return launch_script(folder);
}
