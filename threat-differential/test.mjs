// Tests the threat aura against a mocked group and threat table, including Forever's secret values, and checks
// its data.
// Usage: node test.mjs [data.lua]   (default: threat_forever.lua next to this file)
import { runLuaTest } from "../tools/harness.mjs";

runLuaTest(import.meta.url, process.argv[2] || "threat_forever.lua", String.raw`
local aura = TRANSMIT.d
common(aura)

-- Data -------------------------------------------------------------------------------------------
check(TRANSMIT.c == nil, "a single aura")
check(aura.id == "Threat Differential on Nameplates" and aura.uid == "1L3Mp1qQdkX", "same id and uid as the installed copy")
check(aura.regionType == "text" and aura.anchorFrameType == "NAMEPLATE", "text on nameplates")
check(aura.xOffset == -50 and aura.anchorPoint == "LEFT" and aura.fontSize == 20, "keeps its place and look")
check(aura.config.secureThreatValue == 10000, "keeps the installed Secure Threat Target")
check(#aura.conditions == 5, "keeps the five status colors")
check(aura.information.forceEvents == nil, "one STATUS run on load")
check(aura.load.use_affixes == nil and aura.load.affixes == nil, "no Mythic+ affix load setting")
check(aura.customAnchor == nil, "no leftover custom anchor")
check(aura.customTextUpdate == "event", "text updates with the state")
check(aura.desc:find("WoW Forever", 1, true), "description explains the Forever marks")
local tr = aura.triggers[1].trigger
check(tr.custom_type == "stateupdate" and tr.check == "event", "event-driven state trigger")
for _, e in ipairs({ "NAME_PLATE_UNIT_ADDED", "NAME_PLATE_UNIT_REMOVED", "UNIT_THREAT_LIST_UPDATE", "GROUP_ROSTER_UPDATE" }) do
  check(tr.events:find(e, 1, true), "listens for " .. e)
end
check(tr.customVariables:find("Securely tanking", 1, true), "keeps the Threat Status variable for conditions")

-- Mocked game ------------------------------------------------------------------------------------
-- Threat is in whole points, as on Forever. Pets are listed by owner (pets.party2 = true).
local me = "player"
local group, pets, roles, mainTanks, players = {}, {}, {}, {}, {}
local threat, situation = {}, {}
local function norm(u) if u == "player" then return me end return u end
-- Whose pet a unit name points at, for both the real names (pet, partypet2, raidpet3) and the compound
-- ones (playerpet, party2pet, raid3pet).
local function ownerOf(u)
  if u == "pet" then return "player" end
  local kind, n = u:match("^(%a+)pet(%d+)$")
  if kind then return kind .. n end
  return u:match("^(.+)pet$")
end
local function compound(u) return u ~= "pet" and u:sub(-3) == "pet" end
function WA_IterateGroupMembers() local i = 0 return function() i = i + 1 return group[i] end end
function UnitExists(u) local owner = ownerOf(u) return owner ~= nil and pets[owner] == true end
local unitIsUnitSecret = false
function UnitIsUnit(a, b) if unitIsUnitSecret then return SECRET end return norm(a) == norm(b) end
local isPlayerSecret = false
function UnitIsPlayer(u) if isPlayerSecret then return SECRET end return players[u] == true end
local rolesSecret = false
function UnitGroupRolesAssigned(u) if rolesSecret then return SECRET end return roles[norm(u)] or "NONE" end
local function partyAssignment(kind, u) if kind == "MAINTANK" and mainTanks[norm(u)] then return true end end
GetPartyAssignment = partyAssignment
function UnitDetailedThreatSituation(unit, mob)
  if compound(unit) then return SECRET, SECRET, SECRET, SECRET, SECRET end  -- like Forever
  local e = threat[mob] and threat[mob][norm(unit)]
  if e == "secret" then return SECRET, SECRET, SECRET, SECRET, SECRET end
  if not e then return end
  return e[1], e[2], 50, 50, e[3]
end
function UnitThreatSituation(unit, mob) return situation[mob] and situation[mob][norm(unit)] end
local plates = {}
local noPlates = false
C_NamePlate = { GetNamePlates = function()
  if noPlates then return nil end
  local out = {}
  for _, token in ipairs(plates) do
    -- { frame = "nameplate5" } stands for a plate that only names its unit on its unit frame
    if type(token) == "table" and token ~= SECRET then
      out[#out + 1] = { UnitFrame = { unit = token.frame } }
    else
      out[#out + 1] = { namePlateUnitToken = token }
    end
  end
  return out
end }
local raidSlotSecret = false
function UnitInRaid(u)
  if raidSlotSecret then return SECRET end
  local n = me:match("^raid(%d+)$")
  return n and tonumber(n)
end
AbbreviateNumbers = function(v) return v >= 1000 and string.format("%.1fk", v / 1000) or tostring(v) end

local env = init(aura)
local trigger = compile(tr.custom, "trigger")
local function fire(states, event, unit) aura_env = env return trigger(states, event, unit) end
local mob = "nameplate1"
local function show(threatTable, situationTable)
  threat[mob], situation[mob] = threatTable, situationTable or {}
  local states = {}
  fire(states, "UNIT_THREAT_LIST_UPDATE", mob)
  return states[mob] or {}
end

-- Readable numbers (whole threat points) ---------------------------------------------------------
group, roles = { "player", "party1", "party2" }, { party1 = "TANK" }
local states = {}
threat[mob] = { player = { true, 3, 15000 }, party1 = { false, 0, 4000 }, party2 = { false, 0, 1000 } }
check(fire(states, "UNIT_THREAT_LIST_UPDATE", mob) == true, "threat update draws the plate")
local s = states[mob]
check(s.show and s.unit == mob and s.status == 5 and s.value == 11000 and s.mark == nil, "securely tanking: status 5, lead 11000")
check(fire(states, "UNIT_THREAT_LIST_UPDATE", mob) == false, "unchanged threat isn't redrawn")

s = show({ player = { true, 3, 5000 }, party1 = { false, 0, 4000 }, party2 = { false, 0, 1000 } })
check(s.status == 3 and s.value == 1000, "tanking with a tank second: status 3, lead 1000 (whole points, not hundredths)")
s = show({ player = { true, 3, 5000 }, party1 = { false, 0, 1000 }, party2 = { false, 0, 4500 } })
check(s.status == 2 and s.value == 500, "tanking with a non-tank close: status 2")
s = show({ player = { false, 0, 3000 }, party1 = { true, 3, 9000 }, party2 = { false, 0, 0 } })
check(s.status == 4 and s.value == 6000, "another tank has it: status 4, 6000 behind")
s = show({ player = { false, 1, 3000 }, party1 = { false, 0, 1000 }, party2 = { true, 3, 9000 } })
check(s.status == 1 and s.value == 6000, "a non-tank has it: status 1")
s = show({ player = { true, 3, 4000 }, party1 = { false, 0, 4000 } })
check(s.status == 3 and s.value == 0, "a lead of 0 still shows (as !!!)")
s = show({ player = { true, 3, 3000 }, party1 = { false, 0, 4000 }, party2 = { false, 0, 5000 } })
check(s.status == 2 and s.value == 0, "tanking with less threat than someone (a taunt): 0, shown as !!!")
s = show({ player = { false, 1, 5000 }, party1 = { true, 3, 4000 } })
check(s.status == 4 and s.value == 0, "not tanking but ahead of the tank: 0, shown as !!!")
s = show({ player = { true, 3, 2500.4 }, party1 = { false, 0, 1000 } })
check(s.value == 1500, "rounded to whole points")

pets.party2 = true
s = show({ player = { true, 3, 10000 }, party1 = { false, 0, 4000 }, partypet2 = { false, 0, 9000 } })
check(s.status == 2 and s.value == 1000, "pets count, read as partypet2: a pet close behind makes it insecure")
s = show({ player = { false, 0, 1000 }, party1 = { false, 0, 4000 }, partypet2 = { true, 3, 9000 } })
check(s.status == 1 and s.value == 8000, "a pet holding the mob is the top")
s = show({ player = { true, 3, 10000 }, party1 = { false, 0, 4000 }, partypet2 = "secret" })
check(s.value == 6000 and s.mark == nil, "a pet whose number is secret is skipped, the number still shows")
pets.party2 = nil
pets.player = true
s = show({ player = { true, 3, 10000 }, party1 = { false, 0, 2000 }, pet = { false, 0, 8000 } })
check(s.status == 2 and s.value == 2000, "your own pet counts, read as pet")
pets.player = nil
s = show({ player = { true, 3, 10000 }, party1 = { false, 0, 2000 }, pet = { false, 0, 8000 } })
check(s.value == 8000, "no pet out: pet threat isn't read")

roles, mainTanks = {}, { party1 = true }
s = show({ player = { false, 0, 3000 }, party1 = { true, 3, 9000 } })
check(s.status == 4, "a raid main tank counts as a tank")
GetPartyAssignment = nil
s = show({ player = { false, 0, 3000 }, party1 = { true, 3, 9000 } })
check(s.status == 1, "no GetPartyAssignment on this client: no error, role decides")
roles = { party1 = "TANK" }
s = show({ player = { false, 0, 3000 }, party1 = { true, 3, 9000 } })
check(s.status == 4, "no GetPartyAssignment: the tank role still counts")
rolesSecret = true
s = show({ player = { false, 0, 3000 }, party1 = { true, 3, 9000 } })
check(s.status == 1, "a secret role counts as not a tank, no error")
rolesSecret, GetPartyAssignment, mainTanks = false, partyAssignment, {}

unitIsUnitSecret = true
s = show({ player = { false, 0, 3000 }, party1 = { true, 3, 9000 } })
check(s.status == 4 and s.value == 6000, "a secret unit comparison doesn't error")
unitIsUnitSecret = false

group, me, roles = { "raid1", "raid2", "raid3" }, "raid2", { raid3 = "TANK" }
s = show({ raid1 = { false, 0, 1000 }, raid2 = { true, 3, 7000 }, raid3 = { false, 0, 6000 } })
check(s.status == 3 and s.value == 1000, "raid: you are found by unit comparison, the tank is second")
unitIsUnitSecret = true
s = show({ raid1 = { false, 0, 1000 }, raid2 = { true, 3, 7000 }, raid3 = { false, 0, 6000 } })
check(s.status == 3 and s.value == 1000, "raid, secret unit comparison: you are found by your raid slot")
raidSlotSecret = true
s = show({ raid1 = { false, 0, 1000 }, raid2 = { true, 3, 7000 }, raid3 = { false, 0, 6000 } })
check(s.show, "raid slot secret too: no error")
unitIsUnitSecret, raidSlotSecret = false, false
pets.raid1 = true
s = show({ raid1 = { false, 0, 1000 }, raid2 = { true, 3, 7000 }, raid3 = { false, 0, 2000 }, raidpet1 = { false, 0, 6500 } })
check(s.status == 2 and s.value == 500, "raid pets count, read as raidpet1")
pets.raid1 = nil
group, me, roles = { "player", "party1", "party2" }, "player", { party1 = "TANK" }

-- Secret numbers ---------------------------------------------------------------------------------
s = show({ player = "secret", party1 = "secret" }, { player = 3 })
check(s.show and s.status == 3 and s.value == nil and s.mark == "+", "secret numbers, tanking: status 3 and +")
s = show({ player = "secret", party1 = "secret" }, { player = 2 })
check(s.status == 2 and s.mark == "!!!", "secret numbers, about to lose it: status 2 and !!!")
s = show({ player = "secret", party1 = "secret" }, { player = 0, party1 = 3 })
check(s.status == 4 and s.mark == "-", "secret numbers, another tank has it: status 4 and -")
s = show({ player = "secret", party1 = "secret" }, { player = 0, party2 = 3 })
check(s.status == 1 and s.mark == "-", "secret numbers, a non-tank has it: status 1 and -")
s = show({ player = "secret", party1 = "secret" }, { player = 1, party1 = 3 })
check(s.status == 4 and s.mark == "!!!", "secret numbers, above the tank and about to pull: status 4 and !!!")
s = show({ player = "secret", party1 = "secret" }, { player = 1, party2 = 3 })
check(s.status == 1 and s.mark == "!!!", "secret numbers, above a non-tank holding it: status 1 and !!!")
s = show({ player = "secret" }, { player = SECRET })
check(not s.show, "status secret too: nothing shown, no error")
s = show({ player = "secret" }, {})
check(not s.show, "secret numbers and no status: nothing shown")
s = show({ player = { true, 3, 1500000 }, party1 = "secret" }, { player = 3 })
check(s.status == 3 and s.value == nil and s.mark == "+", "your number readable but a group member's secret: status only")

-- Hiding and which units count -------------------------------------------------------------------
states = {}
threat[mob] = { player = { true, 3, 1500000 }, party1 = { false, 0, 400000 } }
fire(states, "UNIT_THREAT_LIST_UPDATE", mob)
threat[mob] = {}
check(fire(states, "UNIT_THREAT_LIST_UPDATE", mob) == true and states[mob].show == false, "hidden once the mob drops you from its threat list")
check(fire(states, "UNIT_THREAT_LIST_UPDATE", mob) == false, "already hidden: no redraw")
threat[mob] = { player = { true, 3, 1500000 }, party1 = { false, 0, 400000 } }
fire(states, "NAME_PLATE_UNIT_ADDED", mob)
check(states[mob].show == true, "nameplate added: drawn")
check(fire(states, "NAME_PLATE_UNIT_REMOVED", mob) == true and states[mob].show == false, "nameplate removed: hidden")
check(fire(states, "NAME_PLATE_UNIT_REMOVED", mob) == false, "removed twice: no redraw")
check(fire(states, "NAME_PLATE_UNIT_REMOVED", "nameplate9") == false, "unknown plate removed: no error")
for _, other in ipairs({ "target", "boss1", "focus" }) do
  threat[other] = { player = { true, 3, 1500000 } }
  check(fire(states, "UNIT_THREAT_LIST_UPDATE", other) == false and states[other] == nil, other .. " is ignored (its nameplate has its own state)")
end
check(fire(states, "UNIT_THREAT_LIST_UPDATE", nil) == false, "no unit: no error")
players.nameplate2 = true
threat.nameplate2 = { player = { true, 3, 1500000 } }
check(fire(states, "UNIT_THREAT_LIST_UPDATE", "nameplate2") == false and states.nameplate2 == nil, "players are ignored")
isPlayerSecret = true
check(fire(states, "UNIT_THREAT_LIST_UPDATE", "nameplate3") == false, "secret player check: skipped, no error")
isPlayerSecret = false

-- Refresh on load and on group changes ------------------------------------------------------------
threat = { nameplate1 = { player = { true, 3, 1500000 }, party1 = { false, 0, 400000 } },
           nameplate2 = { player = { true, 3, 1500000 } },
           nameplate4 = { player = { false, 0, 100000 }, party1 = { true, 3, 900000 } } }
plates = { "nameplate1", "nameplate2", "nameplate4" }
local fresh = {}
check(fire(fresh, "STATUS") == true, "load refreshes the visible plates")
check(fresh.nameplate1 and fresh.nameplate1.show and fresh.nameplate4 and fresh.nameplate4.status == 4, "each enemy plate drawn")
check(fresh.nameplate2 == nil, "player plates skipped on refresh")
roles = {}
check(fire(fresh, "GROUP_ROSTER_UPDATE") == true and fresh.nameplate4.status == 1, "group change re-evaluates tanks")
check(fire(fresh, "GROUP_ROSTER_UPDATE") == false, "nothing changed: no redraw")
plates = { { frame = "nameplate1" }, SECRET }
local realType = type
type = function(v) if v == SECRET then return "string" end return realType(v) end  -- a secret unit token is a string
local viaFrame = {}
check(fire(viaFrame, "STATUS") == true and viaFrame.nameplate1 and viaFrame.nameplate1.show,
  "a plate without namePlateUnitToken is found by its unit frame, and a secret token is skipped")
type = realType
plates = {}
check(fire({}, "STATUS") == false, "no plates: nothing to do")
noPlates = true
check(fire({}, "STATUS") == false, "no plate list from the game: no error")
noPlates = false

-- Text -------------------------------------------------------------------------------------------
local text = compile(aura.customText, "text")
aura_env = { state = { mark = "+" } }
check(text() == "+", "text shows the mark")
aura_env = { state = { value = 0 } }
check(text() == "!!!", "a lead under 1 shows !!!")
aura_env = { state = { value = 11000 } }
check(text() == "11.0k", "the lead is abbreviated")
AbbreviateNumbers = nil
check(text() == "11000", "no AbbreviateNumbers: the plain number")
aura_env = {}
check(text() == nil, "no state: no text")
`);
