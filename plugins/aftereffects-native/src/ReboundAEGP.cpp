#include "AE_GeneralPlug.h"
#include "AEGP_SuiteHandler.h"

#include <windows.h>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>

namespace {

const char kDispatchMenuName[] = "Rebound: Native Shortcut Dispatch";
const wchar_t kQueueFolder[] = L"\\Rebound\\NativeCommands";
const wchar_t kRequestName[] = L"\\request.json";
const wchar_t kResultName[] = L"\\result.json";

struct PluginState {
  SPBasicSuite* basic;
  AEGP_PluginID pluginId;
  AEGP_Command dispatchCommand;
};

std::wstring queuePath()
{
  wchar_t appData[MAX_PATH];
  DWORD length = GetEnvironmentVariableW(L"APPDATA", appData, MAX_PATH);
  if (!length || length >= MAX_PATH) return L"";
  std::wstring root(appData);
  std::wstring rebound = root + L"\\Rebound";
  std::wstring queue = root + kQueueFolder;
  if (!CreateDirectoryW(rebound.c_str(), nullptr) &&
      GetLastError() != ERROR_ALREADY_EXISTS) return L"";
  if (!CreateDirectoryW(queue.c_str(), nullptr) &&
      GetLastError() != ERROR_ALREADY_EXISTS) return L"";
  return queue;
}

bool readIntegerField(const std::string& json, const char* name, long* value)
{
  const std::string needle = std::string("\"") + name + "\":";
  std::string::size_type pos = json.find(needle);
  if (pos == std::string::npos) return false;
  pos += needle.size();
  while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) ++pos;
  if (pos >= json.size() || json[pos] < '0' || json[pos] > '9') return false;
  char* end = nullptr;
  long parsed = std::strtol(json.c_str() + pos, &end, 10);
  if (end == json.c_str() + pos || parsed <= 0) return false;
  *value = parsed;
  return true;
}

bool readRequestId(const std::string& json, std::string* requestId)
{
  const std::string needle = "\"requestId\":\"";
  std::string::size_type pos = json.find(needle);
  if (pos == std::string::npos) return false;
  pos += needle.size();
  std::string::size_type end = json.find('"', pos);
  if (end == std::string::npos) return false;
  std::string value = json.substr(pos, end - pos);
  if (value.size() < 8 || value.size() > 80) return false;
  for (std::string::size_type i = 0; i < value.size(); ++i) {
    const char c = value[i];
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
  }
  *requestId = value;
  return true;
}

bool readActionId(const std::string& json, std::string* actionId)
{
  const std::string needle = "\"commandActionId\":\"";
  std::string::size_type pos = json.find(needle);
  if (pos == std::string::npos) return false;
  pos += needle.size();
  std::string::size_type end = json.find('"', pos);
  if (end == std::string::npos) return false;
  std::string value = json.substr(pos, end - pos);
  if (value.size() < 5 || value.size() > 80 || value.compare(0, 3, "ae-") != 0) return false;
  for (std::string::size_type i = 0; i < value.size(); ++i) {
    const char c = value[i];
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')) return false;
  }
  *actionId = value;
  return true;
}

bool readRequest(const std::wstring& path, std::string* json)
{
  FILE* file = _wfopen(path.c_str(), L"rb");
  if (!file) return false;
  char buffer[4096];
  size_t count = std::fread(buffer, 1, sizeof(buffer), file);
  bool readError = std::ferror(file) != 0;
  std::fclose(file);
  if (readError || count == 0 || count == sizeof(buffer)) return false;
  json->assign(buffer, count);
  return true;
}

bool writeResponse(
  const std::wstring& path,
  const std::string& requestId,
  const std::string& actionId,
  long commandId,
  A_Err result)
{
  std::wstring temporary = path + L".tmp";
  FILE* file = _wfopen(temporary.c_str(), L"wb");
  if (!file) return false;
  const std::string response =
    std::string("{\"schemaVersion\":1,\"requestId\":\"") + requestId +
    "\",\"commandActionId\":\"" + actionId +
    "\",\"commandId\":" + std::to_string(commandId) +
    ",\"ok\":" + (result == A_Err_NONE ? "true" : "false") +
    ",\"executed\":" + (result == A_Err_NONE ? "true" : "false") +
    ",\"result\":\"AEGP_DoCommand returned " +
    (result == A_Err_NONE ? "success" : "an error") +
    ".\",\"errorCode\":" + std::to_string(static_cast<long>(result)) + "}";
  const size_t written = std::fwrite(response.data(), 1, response.size(), file);
  const bool closed = std::fclose(file) == 0;
  if (written != response.size() || !closed) return false;
  return MoveFileExW(
    temporary.c_str(), path.c_str(),
    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != 0;
}

A_Err executeRequest(PluginState* state)
{
  const std::wstring folder = queuePath();
  if (folder.empty()) return A_Err_GENERIC;
  const std::wstring requestPath = folder + kRequestName;
  const std::wstring resultPath = folder + kResultName;
  std::string requestJson;
  std::string requestId;
  std::string actionId;
  long schemaVersion = 0;
  long commandId = 0;
  if (!readRequest(requestPath, &requestJson) ||
      !readIntegerField(requestJson, "schemaVersion", &schemaVersion) ||
      schemaVersion != 1 ||
      !readIntegerField(requestJson, "commandId", &commandId) ||
      !readRequestId(requestJson, &requestId) ||
      !readActionId(requestJson, &actionId)) {
    DeleteFileW(requestPath.c_str());
    return A_Err_GENERIC;
  }
  DeleteFileW(requestPath.c_str());

  AEGP_SuiteHandler suites(state->basic);
  A_Err result = suites.CommandSuite1()->AEGP_DoCommand(
    static_cast<AEGP_Command>(commandId));
  if (!writeResponse(resultPath, requestId, actionId, commandId, result)) {
    return A_Err_GENERIC;
  }
  return result;
}

A_Err commandHook(
  AEGP_GlobalRefcon globalRefcon,
  AEGP_CommandRefcon,
  AEGP_Command command,
  AEGP_HookPriority,
  A_Boolean alreadyHandled,
  A_Boolean* handled)
{
  PluginState* state = reinterpret_cast<PluginState*>(globalRefcon);
  if (!state || command != state->dispatchCommand || alreadyHandled) return A_Err_NONE;
  if (handled) *handled = TRUE;
  return executeRequest(state);
}

A_Err updateMenuHook(
  AEGP_GlobalRefcon globalRefcon,
  AEGP_UpdateMenuRefcon,
  AEGP_WindowType)
{
  PluginState* state = reinterpret_cast<PluginState*>(globalRefcon);
  if (!state) return A_Err_GENERIC;
  AEGP_SuiteHandler suites(state->basic);
  return suites.CommandSuite1()->AEGP_EnableCommand(state->dispatchCommand);
}

}

extern "C" DllExport A_Err EntryPointFunc(
  SPBasicSuite* basic,
  A_long,
  A_long,
  AEGP_PluginID pluginId,
  AEGP_GlobalRefcon* globalRefcon)
{
  if (!basic || !globalRefcon) return A_Err_GENERIC;
  PluginState* state = new PluginState();
  state->basic = basic;
  state->pluginId = pluginId;
  state->dispatchCommand = 0;
  *globalRefcon = reinterpret_cast<AEGP_GlobalRefcon>(state);

  AEGP_SuiteHandler suites(basic);
  A_Err result = suites.CommandSuite1()->AEGP_GetUniqueCommand(
    &state->dispatchCommand);
  if (result == A_Err_NONE) {
    result = suites.CommandSuite1()->AEGP_InsertMenuCommand(
      state->dispatchCommand,
      kDispatchMenuName,
      AEGP_Menu_WINDOW,
      AEGP_MENU_INSERT_SORTED);
  }
  if (result == A_Err_NONE) {
    result = suites.RegisterSuite5()->AEGP_RegisterCommandHook(
      pluginId,
      AEGP_HP_BeforeAE,
      state->dispatchCommand,
      commandHook,
      state);
  }
  if (result == A_Err_NONE) {
    result = suites.RegisterSuite5()->AEGP_RegisterUpdateMenuHook(
      pluginId,
      updateMenuHook,
      state);
  }
  return result;
}
