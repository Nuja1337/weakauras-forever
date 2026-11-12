// Runs an aura's Lua tests in fengari (Lua 5.3 in Node) against its built data.
//
// The test script gets these globals:
//   TRANSMIT            the built export table ({ d = aura or group, c = children })
//   check(ok, message)  records one check
//   compile(code, name) compiles a trigger-style function ("return " .. code)
//   init(aura, env)     sets aura_env to env (plus config and id) and runs the aura's On Init
//   common(aura)        checks every port needs: ForeverAuras texture paths, nothing every frame,
//                       no Wago link left that would offer to "update" back to the broken original
//   SECRET, issecretvalue   a stand-in for the game's secret values
//   finish()            prints the count, or fails with the list of failed checks
//
// Usage from a test file:  runLuaTest(import.meta.url, process.argv[2] || "<default data>.lua", luaSource)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");

const PRELUDE = String.raw`
local failures, checks = {}, 0
function check(ok, msg) checks = checks + 1 if not ok then failures[#failures + 1] = msg end end
function finish()
  if #failures > 0 then error(#failures .. " of " .. checks .. " checks failed:\n" .. table.concat(failures, "\n"), 0) end
  print(checks .. " checks passed")
end
function compile(code, name) return assert(load("return " .. code, name))() end
function init(aura, env)
  env = env or {}
  env.id = aura.id
  local cfg = {}
  for k, v in pairs(aura.config or {}) do cfg[k] = v end
  for k, v in pairs(env.config or {}) do cfg[k] = v end
  env.config = cfg
  aura_env = env
  local code = aura.actions and aura.actions.init and aura.actions.init.do_custom and aura.actions.init.custom
  if code then assert(load(code, aura.id .. " init"))() end
  return env
end
SECRET = setmetatable({}, { __tostring = function() return "<secret>" end,
  __lt = function() error("attempt to compare a secret value", 2) end,
  __le = function() error("attempt to compare a secret value", 2) end,
  __sub = function() error("attempt to do math on a secret value", 2) end,
  __add = function() error("attempt to do math on a secret value", 2) end })
function issecretvalue(v) return v == SECRET end
local WAGO = { url = true, wagoID = true, version = true, semver = true, preferToUpdate = true, source = true }
-- Functions ForeverAuras blocks in aura code (AuraEnvironment.lua). Calling one stops the aura.
local BLOCKED = { "pcall", "xpcall", "loadstring", "getfenv", "setfenv", "RunScript", "securecall",
  "EnumerateFrames", "SlashCmdList", "DEFAULT_CHAT_FRAME", "ChatFrame1", "ChatEdit_%w+" }
function common(aura)
  local function walk(node, path)
    for k, v in pairs(node) do
      local p = path .. "." .. tostring(k)
      if type(v) == "string" then
        check(not v:find("WeakAuras\\", 1, true), p .. " still points at WeakAuras: " .. v)
        check(not v:find("FRAME_UPDATE", 1, true), p .. " runs every frame")
        if v:find("function") or v:find("%f[%w]end%f[%W]") then
          for _, name in ipairs(BLOCKED) do
            check(not v:find("%f[%w_]" .. name .. "%f[^%w_]"), p .. " uses " .. name .. ", which ForeverAuras blocks")
          end
        end
      elseif type(v) == "table" then
        walk(v, p)
      end
      if k == "check" and v == "update" then check(false, p .. " runs every frame") end
    end
  end
  walk(aura, aura.id)
  for k in pairs(WAGO) do check(aura[k] == nil, aura.id .. ": " .. k .. " still set") end
  check(aura.tocversion == 16001, aura.id .. ": tocversion " .. tostring(aura.tocversion))
  check(type(aura.uid) == "string" and #aura.uid == 11, aura.id .. ": uid")
end
`;

export function runLuaTest(testUrl, dataPath, script) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const run = (src, name, nresults = 0) => {
    if (lauxlib.luaL_loadbuffer(L, to_luastring(src), null, to_luastring(name)) !== lua.LUA_OK ||
        lua.lua_pcall(L, 0, nresults, 0) !== lua.LUA_OK) {
      console.error("FAILED: " + to_jsstring(lua.lua_tostring(L, -1)));
      process.exit(1);
    }
  };
  run(readFileSync(join(HERE, "compat51.lua"), "utf8"), "@compat51.lua");
  const data = resolve(dirname(fileURLToPath(testUrl)), dataPath);
  run(readFileSync(data, "utf8"), "@" + data, 1);
  lua.lua_setglobal(L, to_luastring("TRANSMIT"));
  run(PRELUDE, "=harness");
  run(script + "\nfinish()", "=test");
}
