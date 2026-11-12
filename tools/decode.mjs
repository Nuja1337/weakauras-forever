// Decodes a "!WA:2!" or "!FA:2!" import string into a snapshot file: the auras inside, written in the same
// form as a WeakAuras.lua save, so snapshot-reading tools (wa_show.py, fa_port.load_displays) can open it.
// It only unpacks data. No aura code runs.
//
// Usage: node decode.mjs <import.txt> <out.lua> [--libs <dir>]
//   --libs  the Libs folder to load LibStub, LibSerialize and LibDeflate from (default: the installed ForeverAuras)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LIBS = "C:/Program Files (x86)/World of Warcraft/_forever_/Interface/AddOns/ForeverAuras/Libs";
const args = process.argv.slice(2);
const libsAt = args.indexOf("--libs");
const libsDir = libsAt < 0 ? DEFAULT_LIBS : args.splice(libsAt, 2)[1];
const [inPath, outPath] = args;
if (!inPath || !outPath) {
  console.error("usage: node decode.mjs <import.txt> <out.lua> [--libs <dir>]");
  process.exit(2);
}
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
function run(src, name, nresults = 0) {
  if (lauxlib.luaL_loadbuffer(L, src, null, to_luastring(name)) !== lua.LUA_OK ||
      lua.lua_pcall(L, 0, nresults, 0) !== lua.LUA_OK) {
    console.error("FAILED: " + to_jsstring(lua.lua_tostring(L, -1)));
    process.exit(1);
  }
}
const file = (path) => run(readFileSync(path), "@" + path);

file(join(HERE, "compat51.lua"));
run(to_luastring(`
strmatch, strsub, strbyte, strchar, strfind, strlen = string.match, string.sub, string.byte, string.char, string.find, string.len
strrep, strlower, strupper, format, gsub = string.rep, string.lower, string.upper, string.format, string.gsub
tinsert, tremove, tconcat = table.insert, table.remove, table.concat
floor, ceil, max, min, abs = math.floor, math.ceil, math.max, math.min, math.abs
wipe = wipe or function(t) for k in pairs(t) do t[k] = nil end return t end
`), "=prelude");
file(join(libsDir, "LibStub", "LibStub.lua"));
file(join(libsDir, "LibSerialize", "LibSerialize.lua"));
file(join(libsDir, "LibDeflate", "LibDeflate.lua"));

lua.lua_pushstring(L, to_luastring(readFileSync(inPath, "utf8").trim()));
lua.lua_setglobal(L, to_luastring("IMPORT"));
// Relative to the repo, so the decoded file doesn't carry a home folder.
lua.lua_pushstring(L, to_luastring(relative(join(HERE, ".."), resolve(inPath)).replace(/\\/g, "/")));
lua.lua_setglobal(L, to_luastring("SOURCE"));

run(to_luastring(String.raw`
local LS, LD = LibStub("LibSerialize"), LibStub("LibDeflate")
local prefix, body = IMPORT:match("^(!%u%u:2!)(.+)$")
assert(prefix == "!WA:2!" or prefix == "!FA:2!", "not a !WA:2! or !FA:2! string")
local compressed = assert(LD:DecodeForPrint(body), "DecodeForPrint failed")
local serialized = assert(LD:DecompressDeflate(compressed), "DecompressDeflate failed")
local ok, t = LS:Deserialize(serialized)
assert(ok and type(t) == "table", "Deserialize failed: " .. tostring(t))
assert(type(t.d) == "table" and t.d.id, "no aura in the string")

-- Lua source that wa_list.py reads back exactly. Bytes outside printable ASCII are written as \ddd.
local function str(s)
  return '"' .. s:gsub('[%c\128-\255"\\]', function(c)
    if c == '"' or c == "\\" then return "\\" .. c end
    return string.format("\\%03d", c:byte())
  end) .. '"'
end
local function num(n)
  if math.type and math.type(n) == "integer" then return string.format("%d", n) end
  if n ~= n or n == math.huge or n == -math.huge then return "0" end
  if n == math.floor(n) and math.abs(n) < 2^53 then return string.format("%d.0", n) end
  return string.format("%.17g", n)
end
local function order(a, b)
  local ta, tb = type(a), type(b)
  if ta ~= tb then return ta == "number" end
  return a < b
end
local function val(v, depth)
  local tv = type(v)
  if tv == "string" then return str(v) end
  if tv == "number" then return num(v) end
  if tv == "boolean" then return tostring(v) end
  if tv ~= "table" then return "nil" end
  local keys = {}
  for k in pairs(v) do keys[#keys + 1] = k end
  if #keys == 0 then return "{}" end
  table.sort(keys, order)
  local pad, out = string.rep("  ", depth + 1), { "{" }
  for _, k in ipairs(keys) do
    local key = type(k) == "string" and str(k) or num(k)
    out[#out + 1] = pad .. "[" .. key .. "] = " .. val(v[k], depth + 1) .. ","
  end
  out[#out + 1] = string.rep("  ", depth) .. "}"
  return table.concat(out, "\n")
end

local displays = { [t.d.id] = t.d }
for _, child in ipairs(t.c or {}) do displays[child.id] = child end
local count = 0
for _ in pairs(displays) do count = count + 1 end
DECODED = "-- Decoded from " .. SOURCE .. " (" .. prefix .. ", " .. #IMPORT .. " characters).\n"
  .. "-- \"" .. t.d.id .. "\"" .. (count > 1 and (" and the " .. (count - 1) .. " auras inside it") or "")
  .. ", exported by version " .. tostring(t.s) .. ".\n"
  .. "WeakAurasSaved = " .. val({ displays = displays }, 0) .. "\n"
SUMMARY = t.d.id .. " [" .. tostring(t.d.regionType) .. "], " .. count .. " aura(s), internalVersion "
  .. tostring(t.d.internalVersion) .. ", exported by " .. tostring(t.s)
`), "=decode");
lua.lua_getglobal(L, to_luastring("DECODED"));
writeFileSync(outPath, to_jsstring(lua.lua_tostring(L, -1)));
lua.lua_getglobal(L, to_luastring("SUMMARY"));
console.log(to_jsstring(lua.lua_tostring(L, -1)));
console.log("wrote " + outPath);
