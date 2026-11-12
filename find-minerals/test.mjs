// Tests Find Minerals Missing against a mocked minimap, clock and player state, and checks its data.
// Usage: node test.mjs [data.lua]   (default: minerals_forever.lua next to this file)
import { runLuaTest } from "../tools/harness.mjs";

runLuaTest(import.meta.url, process.argv[2] || "minerals_forever.lua", String.raw`
local aura = TRANSMIT.d
common(aura)

-- Data -------------------------------------------------------------------------------------------
check(TRANSMIT.c == nil, "a single aura")
check(aura.id == "Find Minerals Missing" and aura.uid == "AuM9ny1B7t(", "same id and uid as the installed copy")
check(aura.load.use_spellknown and aura.load.spellknown == 2580, "loads only when Find Minerals is known")
check(aura.xOffset == -68.1884765625 and aura.yOffset == 152.22476196289, "keeps its place on screen")
check(aura.actions.init.do_custom and aura.actions.init.custom:find("SetTracking", 1, true), "On Init turns tracking on")
check(aura.desc:find("Turns Find Minerals on", 1, true), "description says what it does now")
local tr = aura.triggers[1].trigger
check(tr.type == "custom" and tr.custom_type == "status" and tr.check == "event", "event-driven status trigger")
check(tr.onUpdateThrottle == nil, "no timed polling")
for _, e in ipairs({ "PLAYER_ENTERING_WORLD", "MINIMAP_UPDATE_TRACKING", "SPELLS_CHANGED", "PLAYER_REGEN_ENABLED",
                     "PLAYER_ALIVE", "PLAYER_UNGHOST", "PLAYER_CONTROL_GAINED", "UPDATE_STEALTH", "FIND_MINERALS_RETRY" }) do
  check((" " .. tr.events .. " "):find(" " .. e .. " ", 1, true), "listens for " .. e)
end
check(not tr.events:find("UNIT_AURA", 1, true), "doesn't run on every aura change")

-- Mocked game ------------------------------------------------------------------------------------
local now, timers = 1000, {}
function GetTime() return now end
local function schedule(delay, fn)
  local t = { at = now + delay, fn = fn }
  function t:Cancel() self.cancelled = true end
  timers[#timers + 1] = t
  return t
end
C_Timer = { After = function(delay, fn) schedule(delay, fn) end, NewTimer = schedule }
local function pending()
  local n = 0
  for _, t in ipairs(timers) do if not t.cancelled then n = n + 1 end end
  return n
end

local types, count, calls, works = {}, nil, {}, true
local function kind(name, spellID, texture, active, kindName)
  return { name = name, spellID = spellID, texture = texture, active = active, type = kindName or "spell", subType = 0 }
end

local env, shown, nested = nil, nil, false
local trigger = compile(tr.custom, "tracking")
local inEvent = false
local function fire(event)
  if inEvent then nested = true end
  inEvent = true
  aura_env = env
  shown = trigger(event)
  inEvent = false
  return shown
end
WeakAuras = { ScanEvents = function(event) fire(event) end }
C_Minimap = {
  GetNumTrackingTypes = function() return count or #types end,
  GetTrackingInfo = function(i) return types[i] end,
  SetTracking = function(i, on)
    calls[#calls + 1] = { i, on, inEvent }
    if works and types[i] then
      types[i].active = on
      fire("MINIMAP_UPDATE_TRACKING")
    end
  end,
}
GetTrackingTexture = nil

-- Moves the clock on and runs the timers that come due, in order.
local function advance(seconds)
  now = now + seconds
  while true do
    local nextIndex
    for i, t in ipairs(timers) do
      if t.at <= now and (not nextIndex or t.at < timers[nextIndex].at) then nextIndex = i end
    end
    if not nextIndex then return end
    local t = table.remove(timers, nextIndex)
    if not t.cancelled then t.fn() end
  end
end

local combat, dead, taxi, stealth, casting, channeling, onCooldown, feigning
function InCombatLockdown() return combat end
function UnitIsFeignDeath(u) return feigning end
function UnitAffectingCombat(u) return combat end
function UnitIsDeadOrGhost(u) return dead end
function UnitOnTaxi(u) return taxi end
function IsStealthed() return stealth end
function UnitCastingInfo(u) if casting then return "Smelt Copper" end end
function UnitChannelInfo(u) if channeling then return "Fishing" end end
C_Spell = { GetSpellCooldown = function(id)
  return { isActive = onCooldown, isEnabled = true, isOnGCD = onCooldown, startTime = 0, duration = 0, modRate = 1 }
end }

-- A fresh aura (On Init again) with Find Herbs and Find Minerals both off, unless told otherwise.
local function reset(list)
  types = list or { kind("Find Herbs", 2383, 133939, false), kind("Find Minerals", 2580, 136025, false) }
  count, calls, works, timers, nested = nil, {}, true, {}, false
  combat, dead, taxi, stealth, casting, channeling, onCooldown, feigning = false, false, false, false, false, false, false, false
  now = now + 100
  env = init(aura)
end

-- Turning it on ----------------------------------------------------------------------------------
reset()
check(fire("MINIMAP_UPDATE_TRACKING") == false, "off: the icon stays hidden while it turns tracking on")
check(#calls == 0, "not turned on inside the event")
advance(0)
check(#calls == 1 and calls[1][1] == 2 and calls[1][2] == true, "turned on the next frame, at Find Minerals' slot")
check(calls[1][3] == false and not nested, "the tracking update it causes isn't nested in an event")
check(types[2].active and shown == false, "on now, icon hidden")
advance(10)
check(#calls == 1 and shown == false, "nothing more once it's on")

reset()
types[2].active = true
fire("SPELLS_CHANGED")
advance(10)
check(#calls == 0 and shown == false, "already on: left alone")

reset({ kind("Find Herbs", 2383, 133939, false), kind("Find Minerals", nil, 136025, false) })
fire("MINIMAP_UPDATE_TRACKING")
advance(0)
check(#calls == 1 and calls[1][1] == 2, "found by its icon when the spell id is missing")

reset({ kind("Flight Master", nil, 136000, true, "other"), kind("Find Minerals", 2580, 136025, false) })
fire("MINIMAP_UPDATE_TRACKING")
advance(0)
check(#calls == 1 and shown == false, "other minimap tracking (flight masters) doesn't count as a tracking spell")

-- Loading ----------------------------------------------------------------------------------------
for _, event in ipairs({ "STATUS", "PLAYER_ENTERING_WORLD" }) do
  reset()
  fire(event)
  advance(0.2)
  fire("SPELLS_CHANGED")
  fire("MINIMAP_UPDATE_TRACKING")
  advance(2.6)
  check(#calls == 0, event .. ": waits for the loading screen, even through other events")
  advance(0.3)
  check(#calls == 1, event .. ": then turns it on")
end
reset()
fire("STATUS")
advance(2)
fire("PLAYER_ENTERING_WORLD")
advance(2)
check(#calls == 0, "a later loading screen starts the wait over")
advance(1.1)
check(#calls == 1, "and it turns on 3 seconds after that")

-- Waiting for the right moment -------------------------------------------------------------------
local waits = {
  { "in combat", function(v) combat = v end, "PLAYER_REGEN_ENABLED" },
  { "dead", function(v) dead = v end, "PLAYER_UNGHOST" },
  { "a corpse brought back", function(v) dead = v end, "PLAYER_ALIVE" },
  { "on a flight path", function(v) taxi = v end, "PLAYER_CONTROL_GAINED" },
  { "stealthed", function(v) stealth = v end, "UPDATE_STEALTH" },
}
for _, w in ipairs(waits) do
  reset()
  w[2](true)
  fire("MINIMAP_UPDATE_TRACKING")
  advance(30)
  check(#calls == 0 and shown == false, w[1] .. ": waits, icon hidden")
  check(pending() == 0, w[1] .. ": no timer while it waits for an event")
  w[2](false)
  fire(w[3])
  advance(0)
  check(#calls == 1, w[1] .. ": turned on at " .. w[3])
end

reset()
taxi = true
fire("MINIMAP_UPDATE_TRACKING")
fire("PLAYER_CONTROL_GAINED")
advance(0)
check(#calls == 0 and pending() == 1, "landed but the taxi flag hasn't cleared: one more look in a second")
taxi = false
advance(1)
check(#calls == 1, "turned on at that look")
reset()
combat = true
fire("PLAYER_REGEN_ENABLED")
advance(1)
check(pending() == 0, "still blocked at that look: back to waiting for an event")
advance(60)
check(#calls == 0, "and no polling while it waits")

local soon = {
  { "feigning death", function(v) feigning = v end },
  { "casting", function(v) casting = v end },
  { "channeling", function(v) channeling = v end },
  { "on the global cooldown", function(v) onCooldown = v end },
}
for _, w in ipairs(soon) do
  reset()
  w[2](true)
  fire("MINIMAP_UPDATE_TRACKING")
  advance(0)
  check(#calls == 0, w[1] .. ": not right away")
  advance(1)
  check(#calls == 0 and pending() == 1, w[1] .. ": checks again each second")
  w[2](false)
  advance(1)
  check(#calls == 1 and shown == false, w[1] .. ": turned on once it's over")
end

reset()
casting = true
fire("MINIMAP_UPDATE_TRACKING")
fire("SPELLS_CHANGED")
fire("MINIMAP_UPDATE_TRACKING")
check(pending() == 1, "one pending check at a time")

-- When it can't ----------------------------------------------------------------------------------
reset()
works = false
fire("MINIMAP_UPDATE_TRACKING")
advance(0)
check(#calls == 1, "first try")
fire("SPELLS_CHANGED")
advance(1)
fire("MINIMAP_UPDATE_TRACKING")
check(#calls == 1, "no second try while the first takes effect")
advance(1.5)
check(#calls == 2, "tries again when the first didn't work")
advance(2.5)
check(#calls == 3 and shown == false, "a third try")
advance(2.5)
check(#calls == 3 and shown == true, "after three tries the icon shows")
advance(60)
fire("SPELLS_CHANGED")
fire("MINIMAP_UPDATE_TRACKING")
advance(60)
check(#calls == 3 and shown == true, "and it stops trying")
fire("PLAYER_REGEN_ENABLED")
advance(0)
check(#calls == 4, "leaving combat starts the count over")
advance(2.5)
advance(2.5)
advance(2.5)
check(#calls == 6 and shown == true, "three tries again, then the icon")
types[2].active = true
check(fire("MINIMAP_UPDATE_TRACKING") == false, "turned on by hand: icon hidden")
works = true
types[2].active = false
fire("MINIMAP_UPDATE_TRACKING")
advance(0)
check(#calls == 7 and types[2].active, "the count starts over once it's been on")

reset({ kind("Find Herbs", 2383, 133939, true), kind("Find Minerals", 2580, 136025, false) })
check(fire("MINIMAP_UPDATE_TRACKING") == true, "another tracking spell on: icon shows")
advance(30)
check(#calls == 0 and types[1].active, "and the other tracking spell is left on")
types[1].active = false
fire("MINIMAP_UPDATE_TRACKING")
advance(0)
check(#calls == 1 and shown == false, "turned on once the other one is off")

reset({ kind("Find Herbs", 2383, 133939, true) })
check(fire("MINIMAP_UPDATE_TRACKING") == false and #calls == 0, "Find Minerals not in the list: hidden, nothing to do")
reset({})
count = 2
check(fire("MINIMAP_UPDATE_TRACKING") == false, "no error when the game returns no info for a slot")
reset({})
check(fire("MINIMAP_UPDATE_TRACKING") == false, "no tracking types: hidden")

-- Classic clients --------------------------------------------------------------------------------
reset()
C_Minimap = nil
GetTrackingTexture = function() return 136025 end
check(fire("MINIMAP_UPDATE_TRACKING") == false, "Classic: hidden while tracking minerals")
GetTrackingTexture = function() return 133939 end
check(fire("MINIMAP_UPDATE_TRACKING") == true, "Classic: shown while tracking something else")
GetTrackingTexture = nil
check(fire("MINIMAP_UPDATE_TRACKING") == false, "no tracking functions at all: hidden, no error")
`);
