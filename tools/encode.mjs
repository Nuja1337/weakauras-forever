// Encodes an export table (Lua source that returns it) as a "!WA:2!" import string with ForeverAuras' own
// LibSerialize and LibDeflate, then decodes it again and checks every value came back, and that every
// piece of aura code compiles.
//
// Usage: node encode.mjs <data.lua> <out.txt> [--libs <dir>] [--hex]
//   --libs  the Libs folder to load LibStub, LibSerialize and LibDeflate from (default: the installed ForeverAuras)
//   --hex   also write the serialized and compressed bytes as hex, for debugging a failed import
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LIBS = "C:/Program Files (x86)/World of Warcraft/_forever_/Interface/AddOns/ForeverAuras/Libs";
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}
function option(name) {
  const i = args.indexOf(name);
  return i < 0 ? null : args.splice(i, 2)[1];
}
const libsDir = option("--libs") || DEFAULT_LIBS;
const writeHex = flag("--hex");
const [dataPath, outPath] = args;
if (!dataPath || !outPath) {
  console.error("usage: node encode.mjs <data.lua> <out.txt> [--libs <dir>] [--hex]");
  process.exit(2);
}
const compatPath = join(HERE, "compat51.lua");
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);

function run(path, nresults = 0) {
  const src = readFileSync(path);
  if (lauxlib.luaL_loadbuffer(L, src, null, to_luastring("@" + path)) !== lua.LUA_OK ||
      lua.lua_pcall(L, 0, nresults, 0) !== lua.LUA_OK) {
    throw new Error(to_jsstring(lua.lua_tostring(L, -1)));
  }
}

run(compatPath);
// The game's global aliases the libraries expect.
const prelude = `
strmatch, strsub, strbyte, strchar, strfind, strlen = string.match, string.sub, string.byte, string.char, string.find, string.len
strrep, strlower, strupper, format, gsub = string.rep, string.lower, string.upper, string.format, string.gsub
tinsert, tremove, tconcat = table.insert, table.remove, table.concat
floor, ceil, max, min, abs = math.floor, math.ceil, math.max, math.min, math.abs
wipe = wipe or function(t) for k in pairs(t) do t[k] = nil end return t end
`;
if (lauxlib.luaL_loadstring(L, to_luastring(prelude)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
  throw new Error(to_jsstring(lua.lua_tostring(L, -1)));
}
run(join(libsDir, "LibStub", "LibStub.lua"));
run(join(libsDir, "LibSerialize", "LibSerialize.lua"));
run(join(libsDir, "LibDeflate", "LibDeflate.lua"));
run(dataPath, 1);
lua.lua_setglobal(L, to_luastring("TRANSMIT"));

const driver = `
local LS = LibStub("LibSerialize")
local LD = LibStub("LibDeflate")
local t = TRANSMIT
local ser = LS:SerializeEx({ errorOnUnserializableType = false }, t)
local comp = LD:CompressDeflate(ser, { level = 9 })
local enc = "!WA:2!" .. LD:EncodeForPrint(comp)

local dec = LD:DecodeForPrint(enc:sub(7))
assert(dec == comp, "EncodeForPrint did not round-trip")
local decomp = LD:DecompressDeflate(dec)
assert(decomp == ser, "Deflate did not round-trip")
local ok, back = LS:Deserialize(decomp)
assert(ok, "Deserialize failed: " .. tostring(back))

local diffs = {}
local function same(a, b, path)
  if type(a) ~= type(b) then diffs[#diffs + 1] = path .. ": " .. type(a) .. " vs " .. type(b) return end
  if type(a) ~= "table" then
    if a ~= b then diffs[#diffs + 1] = path .. ": " .. tostring(a) .. " vs " .. tostring(b) end
    return
  end
  for k, v in pairs(a) do same(v, b[k], path .. "." .. tostring(k)) end
  for k in pairs(b) do if a[k] == nil then diffs[#diffs + 1] = path .. "." .. tostring(k) .. ": extra" end end
end
same(t, back, "")
assert(#diffs == 0, "values changed:\\n" .. table.concat(diffs, "\\n"))

-- Compile every piece of code the way WeakAuras does: triggers as "return <function>",
-- actions as the body of a function.
local codeKeys = { custom = true, customDuration = true, customName = true, customIcon = true,
  customTexture = true, customStacks = true, customTriggerLogic = true, alphaFunc = true,
  colorFunc = true, translateFunc = true, scaleFunc = true, rotateFunc = true, customVariables = true }
local compiled, failures = 0, {}
local function walk(node, path, inActions)
  for k, v in pairs(node) do
    local p = path .. "." .. tostring(k)
    if type(v) == "table" then
      walk(v, p, inActions or k == "actions")
    elseif type(v) == "string" and codeKeys[k] and v:find("%S") then
      local src
      if inActions then
        src = "return function() " .. v .. "\\n end"
      elseif k == "customVariables" then
        src = "return function() return \\n" .. v .. "\\n end"
      else
        src = "return " .. v
      end
      local f, err = load(src, p)
      if f then compiled = compiled + 1 else failures[#failures + 1] = p .. ": " .. err end
    end
  end
end
walk(t, "", false)
assert(#failures == 0, "code does not compile:\\n" .. table.concat(failures, "\\n"))

local function hex(s) return (s:gsub(".", function(c) return string.format("%02x", c:byte()) end)) end
return enc, hex(ser), hex(comp), compiled, #enc
`;

if (lauxlib.luaL_loadstring(L, to_luastring(driver)) !== lua.LUA_OK ||
    lua.lua_pcall(L, 0, 5, 0) !== lua.LUA_OK) {
  console.error("FAILED: " + to_jsstring(lua.lua_tostring(L, -1)));
  process.exit(1);
}
const enc = to_jsstring(lua.lua_tostring(L, -5));
const serHex = to_jsstring(lua.lua_tostring(L, -4));
const compHex = to_jsstring(lua.lua_tostring(L, -3));
const compiled = lua.lua_tointeger(L, -2);
writeFileSync(outPath, enc);
if (writeHex) {
  writeFileSync(outPath + ".ser.hex", serHex);
  writeFileSync(outPath + ".deflate.hex", compHex);
}
console.log(`ok: ${enc.length} characters, round trip exact, ${compiled} code blocks compile`);
