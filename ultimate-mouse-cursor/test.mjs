// Runs the cursor's custom code against mocked game functions and checks the data for things
// ForeverAuras would not load (WeakAuras texture paths, per-frame triggers, leftover animations).
//
// Usage: node test.mjs [data.lua]   (default: cursor_forever.lua next to this file)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const dataPath = process.argv[2] || join(HERE, "cursor_forever.lua");
const compatPath = join(HERE, "..", "tools", "compat51.lua");
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
function run(src, name, nresults = 0) {
  if (lauxlib.luaL_loadbuffer(L, to_luastring(src), null, to_luastring(name)) !== lua.LUA_OK ||
      lua.lua_pcall(L, 0, nresults, 0) !== lua.LUA_OK) {
    console.error("FAILED: " + to_jsstring(lua.lua_tostring(L, -1)));
    process.exit(1);
  }
}
run(readFileSync(compatPath, "utf8"), "@compat51.lua");
run(readFileSync(dataPath, "utf8"), "@" + dataPath, 1);
lua.lua_setglobal(L, to_luastring("TRANSMIT"));

run(String.raw`
local t = TRANSMIT
local failures, checks = {}, 0
local function check(ok, msg) checks = checks + 1 if not ok then failures[#failures + 1] = msg end end

-- Mocked game ------------------------------------------------------------------------------------
local now = 100
function GetTime() return now end
local SECRET = setmetatable({}, { __tostring = function() return "<secret>" end })
function issecretvalue(v) return v == SECRET end

local keys = { alt = false, shift = false, ctrl = false }
function IsLeftAltKeyDown() return keys.alt end
function IsLeftShiftKeyDown() return keys.shift end
function IsLeftControlKeyDown() return keys.ctrl end

local tickers = {}
C_Timer = { NewTicker = function(interval, fn)
  local tk = { interval = interval, fn = fn, cancelled = false }
  function tk:Cancel() self.cancelled = true end
  tickers[#tickers + 1] = tk
  return tk
end }
local function live(interval)
  local n = 0
  for _, tk in ipairs(tickers) do if not tk.cancelled and (not interval or tk.interval == interval) then n = n + 1 end end
  return n
end
local function tick() for _, tk in ipairs(tickers) do if not tk.cancelled then tk.fn(tk) end end end

local scanned = {}
WeakAuras = { ScanEvents = function(event) scanned[#scanned + 1] = event end }

local gcd, gcdTimer = nil, nil
C_Spell = {
  GetSpellCooldown = function(id) assert(id == 29515, "wrong GCD spell " .. tostring(id)) return gcd end,
  GetSpellCooldownDuration = function(id) assert(id == 29515) return gcdTimer end,
}

local casting, channeling, ping = nil, nil, { 0, 0, 50, 120 }
function UnitCastingInfo(unit) assert(unit == "player") if casting then return "Frostbolt", "", 1, casting[1], casting[2] end end
function UnitChannelInfo(unit) assert(unit == "player") if channeling then return "Arcane Missiles", "", 1, channeling[1], channeling[2] end end
function GetNetStats() return ping[1], ping[2], ping[3], ping[4] end

local castBarCalls = {}
PlayerCastingBarFrame = {
  UnregisterAllEvents = function() castBarCalls[#castBarCalls + 1] = "UnregisterAllEvents" end,
  Hide = function() castBarCalls[#castBarCalls + 1] = "Hide" end,
}

-- A frame with a scale and a parent, enough for the size fit. Only ForeverAuras frames get an id.
local function frame(scale, parent, id)
  local f = { scale = scale, parent = parent, id = id, sets = 0 }
  function f:GetScale() return self.scale end
  function f:SetScale(s) self.scale = s self.sets = self.sets + 1 end
  function f:GetParent() return self.parent end
  function f:GetEffectiveScale()
    local s, p = self.scale, self.parent
    while p do s, p = s * p.scale, p.parent end
    return s
  end
  return f
end
local function near(a, b) return math.abs(a - b) < 1e-9 end

-- Harness ----------------------------------------------------------------------------------------
local byId = {}
for _, aura in ipairs(t.c) do byId[aura.id] = aura end

-- Build one part with a given config: run On Init, then hand back its Visible trigger and, if it
-- has one, its state trigger with a states table that persists between calls.
local function setup(aura, config, region)
  local cfg = {}
  for k, v in pairs(aura.config) do cfg[k] = v end
  for k, v in pairs(config or {}) do cfg[k] = v end
  aura_env = { config = cfg, id = aura.id, region = region }
  local env = aura_env
  assert(load(aura.actions.init.custom, aura.id .. " init"))()
  local visible, main
  for _, e in ipairs(aura.triggers) do
    local tr = e.trigger
    if tr.type == "custom" and tr.custom_type == "status" then
      visible = assert(load("return " .. tr.custom, aura.id .. " visible"))()
    elseif tr.type == "custom" and tr.custom_type == "stateupdate" then
      main = assert(load("return " .. tr.custom, aura.id .. " state"))()
    end
  end
  local states = {}
  return {
    visible = function(event, arg) aura_env = env return visible(event, arg) and true or false end,
    update = function(event) aura_env = env local changed = main(states, event) return changed, states[""] end,
  }
end
local function reset() keys.alt, keys.shift, keys.ctrl = false, false, false end

-- Visibility on load -----------------------------------------------------------------------------
local lagCast, lagChannel = "Cast Ring Lag (Cast)", "Cast Ring Lag (Channel)"
local expect = {
  { {}, { ["Mouse Cursor Dot"] = true, ["Mouse Cursor Ring"] = true, ["GCD Ring"] = true, ["Cast Ring"] = true,
          [lagCast] = true, [lagChannel] = true, ["Swing Ring"] = false, ["Cast Bar"] = false } },
  { { CastBar = 2 }, { ["Cast Ring"] = false, [lagCast] = false, [lagChannel] = false, ["Cast Bar"] = true } },
  { { SwingBar = true }, { ["Swing Ring"] = true } },
}
for _, case in ipairs(expect) do
  for id, want in pairs(case[2]) do
    reset()
    check(setup(byId[id], case[1]).visible("STATUS") == want, id .. " on load with " .. tostring(next(case[1])) .. ": expected " .. tostring(want))
  end
end

for _, aura in ipairs(t.c) do
  local id = aura.id
  local on = { CastBar = id == "Cast Bar" and 2 or 1, SwingBar = true }
  local function cfg(extra) local r = { CastBar = on.CastBar, SwingBar = true } for k, v in pairs(extra) do r[k] = v end return r end

  -- Hide on right click
  reset()
  local p = setup(aura, cfg({ HideOnRightClick = true }))
  check(p.visible("STATUS") == true, id .. ": visible before right click")
  check(p.visible("GLOBAL_MOUSE_DOWN", "LeftButton") == true, id .. ": left click does not hide")
  check(p.visible("GLOBAL_MOUSE_DOWN", "RightButton") == false, id .. ": right button down hides")
  check(p.visible("MODIFIER_STATE_CHANGED", "LSHIFT") == false, id .. ": stays hidden while right button is held")
  check(p.visible("GLOBAL_MOUSE_UP", "RightButton") == true, id .. ": right button up shows again")
  reset()
  p = setup(aura, cfg({ HideOnRightClick = false }))
  check(p.visible("GLOBAL_MOUSE_DOWN", "RightButton") == true, id .. ": right click ignored when option is off")

  -- Show on key press, each key, with the release reported normally
  for option, key in ipairs({ "alt", "shift", "ctrl" }) do
    reset()
    p = setup(aura, cfg({ ShowOnKeyPress = true, KeyOption = option }))
    local before = live(0.2)
    check(p.visible("STATUS") == false, id .. ": hidden on load until " .. key .. " is held")
    check(live(0.2) == before, id .. ": no key check runs while the key is up")
    keys[key] = true
    check(p.visible("MODIFIER_STATE_CHANGED", "L" .. key:upper()) == true, id .. ": shown while " .. key .. " is held")
    check(live(0.2) == before + 1, id .. ": one key check runs while " .. key .. " is held")
    p.visible("MODIFIER_STATE_CHANGED", "L" .. key:upper())
    check(live(0.2) == before + 1, id .. ": a second event does not start a second check")
    for _, other in ipairs({ "alt", "shift", "ctrl" }) do
      if other ~= key then
        keys[key], keys[other] = false, true
        check(p.visible("MODIFIER_STATE_CHANGED", "L" .. other:upper()) == false, id .. ": " .. other .. " does not show it (key " .. key .. ")")
        keys[other] = false
      end
    end
    check(p.visible("MODIFIER_STATE_CHANGED", "L" .. key:upper()) == false, id .. ": hidden again after " .. key .. " is released")
    check(live(0.2) == before, id .. ": key check stops once " .. key .. " is released")
  end

  -- Alt-tab: the release is never reported, the 0.2 s check catches it
  reset()
  p = setup(aura, cfg({ ShowOnKeyPress = true, KeyOption = 1 }))
  local before = live(0.2)
  keys.alt = true
  check(p.visible("MODIFIER_STATE_CHANGED", "LALT") == true, id .. ": alt shows it")
  scanned = {}
  tick()
  check(#scanned == 0 and live(0.2) == before + 1, id .. ": check keeps running while alt is held")
  keys.alt = false  -- released outside the game: no event
  tick()
  check(#scanned == 1 and scanned[1] == "UMC_FOREVER_KEY_UP", id .. ": missed release is reported")
  check(live(0.2) == before, id .. ": check stops after reporting")
  check(p.visible("UMC_FOREVER_KEY_UP") == false, id .. ": hidden after the missed release")

  -- Key press and right click together
  reset()
  p = setup(aura, cfg({ ShowOnKeyPress = true, KeyOption = 1, HideOnRightClick = true }))
  keys.alt = true
  check(p.visible("MODIFIER_STATE_CHANGED", "LALT") == true, id .. ": alt shows it")
  check(p.visible("GLOBAL_MOUSE_DOWN", "RightButton") == false, id .. ": right click hides it even with alt held")
  check(p.visible("GLOBAL_MOUSE_UP", "RightButton") == true, id .. ": back after right button up")
  keys.alt = false
  p.visible("MODIFIER_STATE_CHANGED", "LALT")
end
reset()
check(live(0.2) == 0, "no key checks left running: " .. live(0.2))

-- GCD ring ---------------------------------------------------------------------------------------
do
  local p = setup(byId["GCD Ring"], {})
  gcd = { isActive = false, startTime = 0, duration = 0, modRate = 1 }
  local changed, s = p.update("STATUS")
  check(not changed and not (s and s.show), "GCD: nothing shown with no GCD")

  gcd = { isActive = true, startTime = now, duration = 1.5, modRate = 1 }
  changed, s = p.update("SPELL_UPDATE_COOLDOWN")
  check(changed and s.show and s.progressType == "timed" and s.duration == 1.5 and s.expirationTime == now + 1.5 and s.autoHide,
    "GCD: readable times drawn as a plain timer")
  check(live(0.1) == 0, "GCD: no end check while times are readable")
  changed = p.update("SPELL_UPDATE_COOLDOWN")
  check(not changed, "GCD: unchanged GCD is not redrawn")
  now = now + 2
  changed, s = p.update("SPELL_UPDATE_COOLDOWN")
  check(changed and not s.show, "GCD: hidden once a readable GCD has run out")

  gcd = { isActive = true, startTime = SECRET, duration = SECRET, modRate = SECRET }
  gcdTimer = { name = "timer 1" }
  changed, s = p.update("SPELL_UPDATE_COOLDOWN")
  check(changed and s.show and s.progressType == "durationObject" and s.durationObject == gcdTimer, "GCD: secret times use the game's timer")
  check(live(0.1) == 1, "GCD: end check starts")
  gcdTimer = { name = "timer 2" }
  changed, s = p.update("SPELL_UPDATE_COOLDOWN")
  check(changed and s.durationObject == gcdTimer, "GCD: back-to-back GCD gets the new timer")
  check(live(0.1) == 1, "GCD: still one end check")
  scanned = {}
  tick()
  check(#scanned == 0, "GCD: no end reported while active")
  gcd = { isActive = false, startTime = SECRET, duration = SECRET, modRate = SECRET }
  tick()
  check(#scanned == 1 and scanned[1] == "UMC_FOREVER_GCD_END" and live(0.1) == 0, "GCD: end reported once, check stops")
  changed, s = p.update("UMC_FOREVER_GCD_END")
  check(changed and not s.show, "GCD: hidden at the end")

  gcd = { isActive = SECRET, startTime = SECRET, duration = SECRET }
  changed, s = p.update("SPELL_UPDATE_COOLDOWN")
  check(not changed and not s.show, "GCD: a secret isActive is treated as no GCD")
  gcd = { isActive = true, startTime = SECRET, duration = SECRET }
  gcdTimer = nil
  changed, s = p.update("SPELL_UPDATE_COOLDOWN")
  check(not s.show, "GCD: nothing shown if the game gives no timer")
  gcd = nil
  changed, s = p.update("SPELL_UPDATE_COOLDOWN")
  check(not s.show, "GCD: no cooldown info at all is handled")
  for _, tk in ipairs(tickers) do tk.cancelled = true end
end

-- Latency wedges ---------------------------------------------------------------------------------
do
  local p = setup(byId[lagCast], {})
  casting, channeling, ping = nil, nil, { 0, 0, 50, 120 }
  local changed, s = p.update("STATUS")
  check(not changed and not (s and s.show), "lag: nothing shown when not casting")
  casting = { 1000, 3000 }
  changed, s = p.update("UNIT_SPELLCAST_START")
  check(changed and s.show and s.progressType == "static" and s.value == 120 and s.total == 2000, "lag: world latency over cast time")
  check(not p.update("UNIT_SPELLCAST_FAILED"), "lag: failed second spell during a cast changes nothing")
  casting = { 1000, 3500 }
  changed, s = p.update("UNIT_SPELLCAST_DELAYED")
  check(changed and s.total == 2500, "lag: pushback recalculates")
  casting = nil
  changed, s = p.update("UNIT_SPELLCAST_STOP")
  check(changed and not s.show, "lag: hidden when the cast stops")
  ping = { 0, 0, 80, nil }
  casting = { 0, 1500 }
  changed, s = p.update("UNIT_SPELLCAST_START")
  check(s.value == 80, "lag: home latency when world is missing")
  ping = { 0, 0, 5000, 5000 }
  changed, s = p.update("UNIT_SPELLCAST_DELAYED")
  check(s.value == 1500, "lag: latency is capped at the cast length")
  casting = { SECRET, SECRET }
  changed, s = p.update("UNIT_SPELLCAST_START")
  check(changed and not s.show, "lag: secret cast times hide the wedge")
  casting = nil
  channeling = { 0, 3000 }
  ping = { 0, 0, 50, 120 }
  changed, s = p.update("UNIT_SPELLCAST_START")
  check(not s.show, "lag (cast): ignores channels")

  p = setup(byId[lagChannel], {})
  changed, s = p.update("UNIT_SPELLCAST_CHANNEL_START")
  check(changed and s.show and s.value == 120 and s.total == 3000, "lag (channel): reads the channel")
  channeling = nil
  casting = { 0, 2000 }
  changed, s = p.update("UNIT_SPELLCAST_CHANNEL_STOP")
  check(changed and not s.show, "lag (channel): hidden at channel end, ignores casts")
  casting = nil
end

-- Hide default cast bar runs once (in the dot), and only when the option is on.
castBarCalls = {}
for _, aura in ipairs(t.c) do reset() setup(aura, {}) end
check(#castBarCalls == 0, "cast bar left alone when the option is off")
for _, aura in ipairs(t.c) do reset() setup(aura, { HideDefaultCastBar = true }) end
check(#castBarCalls == 2 and castBarCalls[1] == "UnregisterAllEvents" and castBarCalls[2] == "Hide",
  "cast bar hidden once: " .. table.concat(castBarCalls, ","))

-- Size fit: the group ends up at Classic's effective scale (0.5 group x 0.7 UI = 0.35) --------------
local CLASSIC = 0.5 * 0.7
local function cursor(uiScale)
  local ui = frame(uiScale)
  local mouse = frame(1, ui)                      -- ForeverAuras' mouse frame sits on UIParent
  local group = frame(0.5, mouse, t.d.id)         -- the group's Scale setting
  local dot = frame(1, group, "Mouse Cursor Dot")
  return ui, group, dot
end
for _, uiScale in ipairs({ 1, 0.64, 0.7, 1.15 }) do
  reset()
  local ui, group, dot = cursor(uiScale)
  setup(byId["Mouse Cursor Dot"], {}, dot)
  check(near(group:GetEffectiveScale(), CLASSIC), "fit at UI scale " .. uiScale .. ": group draws at " .. group:GetEffectiveScale())
end
do
  reset()
  local ui, group, dot = cursor(1)
  local p = setup(byId["Mouse Cursor Dot"], {}, dot)
  local sets = group.sets
  check(p.visible("GLOBAL_MOUSE_DOWN", "LeftButton") and group.sets == sets, "fit: a click with nothing changed does not rescale")
  group.scale = 0.5                                -- an edit in /fa applies the Scale setting again
  p.visible("GLOBAL_MOUSE_UP", "LeftButton")
  check(near(group:GetEffectiveScale(), CLASSIC), "fit: recovers after ForeverAuras resets the scale")
  group.scale = 0.6                                -- you raise the group's Scale setting
  p.visible("GLOBAL_MOUSE_DOWN", "LeftButton")
  check(near(group:GetEffectiveScale(), 0.6 * 0.7), "fit: a new Scale setting becomes the base size")
  ui.scale = 0.8                                   -- you change your UI scale
  p.visible("UI_SCALE_CHANGED")
  check(near(group:GetEffectiveScale(), 0.6 * 0.7), "fit: follows a UI scale change")
  check(byId["Mouse Cursor Dot"].triggers[1].trigger.events:find("UI_SCALE_CHANGED"), "dot listens for UI scale changes")
end
do
  reset()
  local ui = frame(1)
  local plain = frame(1, ui)                       -- a frame with no id, such as WeakAurasFrame
  local dot = frame(1, plain, "Mouse Cursor Dot")
  local p = setup(byId["Mouse Cursor Dot"], {}, dot)
  p.visible("GLOBAL_MOUSE_DOWN", "LeftButton")
  check(plain.sets == 0 and plain.scale == 1, "fit never resizes a frame that isn't a ForeverAuras display")
  setup(byId["Mouse Cursor Dot"], {}, nil).visible("GLOBAL_MOUSE_DOWN", "LeftButton")
  check(true, "fit with no region does not error")
end
for _, aura in ipairs(t.c) do
  if aura.id ~= "Mouse Cursor Dot" then
    reset()
    local ui, group, part = cursor(1)
    setup(aura, { CastBar = aura.id == "Cast Bar" and 2 or 1, SwingBar = true }, part).visible("GLOBAL_MOUSE_DOWN", "LeftButton")
    check(group.sets == 0, aura.id .. ": only the dot rescales the group")
  end
end

-- Data checks ------------------------------------------------------------------------------------
local function walk(node, path, fn)
  for k, v in pairs(node) do
    local p = path .. "." .. tostring(k)
    fn(k, v, p)
    if type(v) == "table" then walk(v, p, fn) end
  end
end
local all = { t.d }
for _, aura in ipairs(t.c) do all[#all + 1] = aura end
for _, aura in ipairs(all) do
  walk(aura, aura.id, function(k, v, p)
    if type(v) == "string" then
      check(not v:find("WeakAuras\\", 1, true), p .. " still points at WeakAuras: " .. v)
      check(not v:find("FRAME_UPDATE", 1, true), p .. " runs every frame")
    end
    if k == "check" and v == "update" then check(false, p .. " runs every frame") end
    if k == "anchorFrameFrame" then check(false, p .. " still set") end
  end)
  if aura.animation then
    for _, phase in ipairs({ "start", "main", "finish" }) do
      check(aura.animation[phase].type == "none", aura.id .. " " .. phase .. " animation should be none")
    end
  end
end
local order = { "Mouse Cursor Dot", "Mouse Cursor Ring", "GCD Ring", "Cast Ring", "Swing Ring", lagCast, lagChannel, "Cast Bar" }
check(#t.c == #order and #t.d.controlledChildren == #order, "8 parts")
for i, id in ipairs(order) do check(t.d.controlledChildren[i] == id and t.c[i].id == id, "part " .. i .. " is " .. id) end
local castRing = byId["Cast Ring"]
check(castRing.triggers[1].trigger.event == "Cast" and not castRing.triggers[1].trigger.use_showLatency and not castRing.overlays,
  "cast ring has no built-in latency overlay")
check(castRing.backgroundColor[4] == 0.5, "cast ring background back to 50%")
check(byId[lagCast].orientation == "CLOCKWISE" and byId[lagChannel].orientation == "ANTICLOCKWISE", "lag wedge directions kept")
check(byId[lagChannel].xOffset == 0 and byId[lagChannel].yOffset == 0, "channel wedge centred")
check(byId["GCD Ring"].triggers[1].trigger.custom_type == "stateupdate" and byId["GCD Ring"].triggers[1].trigger.events:find("SPELL_UPDATE_COOLDOWN"), "GCD ring on cooldown events")
check(byId["Swing Ring"].triggers[1].trigger.event == "Swing Timer" and byId["Swing Ring"].triggers[1].trigger.swingType == 0, "swing ring on main hand")
check(t.d.anchorFrameType == "MOUSE" and t.d.selfPoint == "CENTER" and t.d.scale == 0.5, "group follows the mouse, centred, at half scale")
-- Classic sizes in group units. The dot was outside the group at 10, which is 20 inside it.
local sizes = { ["Mouse Cursor Dot"] = { 20, 20 }, ["Mouse Cursor Ring"] = { 100, 100 }, ["GCD Ring"] = { 70, 70 },
  ["Cast Ring"] = { 90, 90 }, ["Swing Ring"] = { 40, 40 }, [lagCast] = { 90, 90 }, [lagChannel] = { 90, 90 }, ["Cast Bar"] = { 50, 5 } }
for _, aura in ipairs(t.c) do
  check(aura.triggers.disjunctive == "all", aura.id .. ": all triggers required")
  check(aura.parent == t.d.id, aura.id .. ": parent")
  check(aura.anchorFrameType == "SCREEN" and aura.anchorPoint == "CENTER" and aura.selfPoint == "CENTER",
    aura.id .. ": sits on the group, so it keeps the group's scale")
  check(aura.width == sizes[aura.id][1] and aura.height == sizes[aura.id][2], aura.id .. ": Classic size, got " .. aura.width .. "x" .. aura.height)
  local wantY = aura.id == "Cast Bar" and -35 or 0
  check(aura.xOffset == 0 and aura.yOffset == wantY, aura.id .. ": offset " .. aura.xOffset .. "," .. aura.yOffset)
  local vis = aura.triggers[#aura.triggers].trigger
  check(vis.custom_type == "status" and vis.events:find("UMC_FOREVER_KEY_UP"), aura.id .. ": Visible trigger listens for the missed-release check")
end

if #failures > 0 then error(#failures .. " of " .. checks .. " checks failed:\n" .. table.concat(failures, "\n")) end
print(checks .. " checks passed")
`, "=test");
