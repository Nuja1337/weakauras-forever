"""Fix "Threat Differential on Nameplates" (wago.io/yssC_nf5K) for ForeverAuras on WoW Forever.

Starts from the copy in my ForeverAuras save (source/installed.lua) and keeps its id, uid, look and
options, so importing the result updates that copy in place.

What changes:
- Pets are read as "pet", "partypet1" and "raidpet1". The original built "party1pet" and "playerpet", and
  Forever keeps threat secret for names built that way (compound unit tokens). The first Forever build kept
  those names, so one pet in the group turned every plate into marks.
- Forever's threat numbers are in whole points, as on retail. Classic's were in hundredths, so the original
  divided by 100, which made every number on Forever 100 times too small.
- Forever keeps threat numbers secret for some units (boss frames and compound tokens like "party1pet"), and
  comparing them threw an error on every threat update. Now each value is checked first. A pet whose number is
  secret is skipped. If a group member's number is secret, the aura falls back to the threat status the game
  still gives (who is tanking), keeps the status colors and shows a mark in place of the number: "+" while
  you're tanking, "!!!" while threat is about to change hands (someone pulling it off you, or you pulling it),
  "-" while you aren't tanking.
- The number disappears when a mob drops you from its threat list (out of combat). It used to stay on the plate.
- On load and when the group changes, every visible nameplate is refreshed, so numbers show up right after a
  /reload in combat.
- Only nameplate units get a state. "boss1" or "focus" events used to make a second copy on the same plate.
- Tank detection checks for a main tank or the tank role in both places it's used, and guards functions
  Forever may lack or keep secret (GetPartyAssignment, UnitGroupRolesAssigned, UnitIsUnit).
- Dropped the Mythic+ affix load setting (ForeverAuras disables it) and the unused custom anchor.

Usage: python -I build.py [source.lua] [out.lua]
"""
import copy
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("fa_port", os.path.join(HERE, "..", "tools", "fa_port.py"))
assert spec and spec.loader
fa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fa)

AURA_ID = "Threat Differential on Nameplates"
UID = "1L3Mp1qQdkX"  # the installed copy's uid

INIT = r"""-- Threat Differential on Nameplates, fixed for ForeverAuras on WoW Forever.
local env = aura_env
env.secureThreatValue = env.config.secureThreatValue

-- A value the game keeps secret can't be compared. Treat it as unknown.
local function known(v)
    if issecretvalue(v) then return nil end
    return v
end

local function IsTank(unit)
    if GetPartyAssignment and known(GetPartyAssignment("MAINTANK", unit)) then return true end
    return known(UnitGroupRolesAssigned(unit)) == "TANK"
end

local function IsMe(unit)
    if unit == "player" then return true end
    local same = UnitIsUnit(unit, "player")
    if not issecretvalue(same) then return same == true end
    -- If the comparison is secret, a raid token can still be matched to your raid slot.
    local slot = UnitInRaid("player")
    return not issecretvalue(slot) and slot ~= nil and unit == "raid" .. slot
end

-- A group member's pet by its own unit name. Names made by adding "pet" (party1pet) are compound unit
-- tokens, and Forever keeps threat secret for those.
local function PetOf(unit)
    if unit == "player" then return "pet" end
    local kind, n = unit:match("^(%a+)(%d+)$")
    if kind == "party" or kind == "raid" then return kind .. "pet" .. n end
end

-- The most threat anyone but you has on the mob, among the group and their pets.
-- Returns false if a group member's number is secret. A pet whose number is secret is skipped.
local function TopOther(mob)
    local topUnit, topThreat = nil, 0
    local function consider(unit)
        local threat = select(5, UnitDetailedThreatSituation(unit, mob))
        if issecretvalue(threat) then return false end
        if threat and threat > topThreat then topUnit, topThreat = unit, threat end
        return true
    end
    for member in WA_IterateGroupMembers() do
        if not IsMe(member) and not consider(member) then return false end
        local pet = PetOf(member)
        if pet and UnitExists(pet) then consider(pet) end
    end
    return true, topUnit, topThreat
end

-- While the numbers are secret: the game's threat status for you and for other tanks.
local function StatusOnly(mob)
    local status = known(UnitThreatSituation("player", mob))
    if not status then return nil end
    if status == 3 then return 3, nil, "+" end
    if status == 2 then return 2, nil, "!!!" end
    -- Status 1: you're above whoever is tanking and about to pull it. Status 0: you're below them.
    local mark = status == 1 and "!!!" or "-"
    for member in WA_IterateGroupMembers() do
        if not IsMe(member) and IsTank(member) then
            local theirs = known(UnitThreatSituation(member, mob))
            if theirs and theirs >= 2 then return 4, nil, mark end
        end
    end
    return 1, nil, mark
end

-- What one nameplate shows: a status (1-5, see the trigger's Threat Status) and the threat difference in
-- points when the numbers are readable, or a mark when they aren't. Nothing when the mob has no threat on you.
-- Forever counts threat in whole points, as retail does. (Classic counted hundredths, hence the old "/ 100".)
function env.Evaluate(mob)
    local isTanking, _, _, _, myThreat = UnitDetailedThreatSituation("player", mob)
    if issecretvalue(isTanking) or issecretvalue(myThreat) then return StatusOnly(mob) end
    if not myThreat then return nil end
    local ok, topUnit, topThreat = TopOther(mob)
    if not ok then return StatusOnly(mob) end
    local otherTank = topUnit ~= nil and IsTank(topUnit)
    local diff, status
    if isTanking then
        diff = myThreat - topThreat   -- your lead over the next one
        if diff > env.secureThreatValue then
            status = 5   -- securely tanking
        elseif otherTank then
            status = 3   -- tanking, another tank is next
        else
            status = 2   -- tanking, a non-tank is close
        end
    else
        diff = topThreat - myThreat   -- how far behind the top you are
        status = otherTank and 4 or 1   -- another tank has it, or no tank has it
    end
    -- At or past the top (a taunt, or about to pull) comes out as 0, which shows as "!!!".
    return status, math.max(math.floor(diff + 0.5), 0), nil
end

function env.Update(allstates, unit)
    if issecretvalue(unit) or type(unit) ~= "string" or not unit:find("^nameplate%d")
            or known(UnitIsPlayer(unit)) ~= false then
        return false
    end
    local status, value, mark = env.Evaluate(unit)
    local state = allstates[unit]
    if not status then
        if state and state.show then
            state.show = false
            state.changed = true
            return true
        end
        return false
    end
    if state and state.show and state.status == status and state.value == value and state.mark == mark then
        return false
    end
    allstates[unit] = { show = true, changed = true, unit = unit, status = status, value = value, mark = mark }
    return true
end"""

TRIGGER = r"""function(allstates, event, unit)
    local env = aura_env
    if event == "NAME_PLATE_UNIT_REMOVED" then
        local state = allstates[unit]
        if state and state.show then
            state.show = false
            state.changed = true
            return true
        end
        return false
    end
    if event == "NAME_PLATE_UNIT_ADDED" or event == "UNIT_THREAT_LIST_UPDATE" then
        return env.Update(allstates, unit)
    end
    -- On load, after a /reload and when the group changes: refresh every visible nameplate.
    local changed = false
    for _, plate in ipairs(C_NamePlate.GetNamePlates() or {}) do
        local token = plate.namePlateUnitToken or (plate.UnitFrame and plate.UnitFrame.unit)
        if env.Update(allstates, token) then changed = true end
    end
    return changed
end"""

EVENTS = "NAME_PLATE_UNIT_ADDED NAME_PLATE_UNIT_REMOVED UNIT_THREAT_LIST_UPDATE GROUP_ROSTER_UPDATE"

TEXT = r"""function()
    local state = aura_env.state
    if not state then return end
    if state.mark then return state.mark end
    local value = state.value
    if value then
        if value < 1 then return "!!!" end
        return AbbreviateNumbers and AbbreviateNumbers(value) or tostring(value)
    end
end"""

DESC = """Shows the threat difference between yourself and the party/raid member with the most threat on enemy nameplates.

Color determined by Tankstatus:
"Securely Tanking" (default: green) - Tanking above the threat threshold
"Tanking" (default: yellow) - Tanking below the threat threshold, but a Tank is second
"Insecurely Tanking" (default: orange, with low warning "!!!") - Tanking below the threat threshold, and no Tank is second
"Tanked by Other Tank"  (default: blue) - Tanked by another Tank
"Untanked" (default: red) - No Tank is present

Other Tanks are people marked as "Main Tank" in raid, or with the "TANK" role.

The number is in threat points, the same scale as the Secure Threat Target.

If WoW Forever hides a group member's threat numbers, the aura shows "+" while you're tanking, "!!!" while someone is about to pull threat off you or you're about to pull it, and "-" while you aren't tanking, still colored by status.

Fixed for WoW Forever (ForeverAuras) from wago.io/yssC_nf5K."""


def port(displays):
    aura = copy.deepcopy(displays[AURA_ID])
    assert aura["uid"] == UID, aura["uid"]
    fa.normalize_triggers(aura)
    trigger = aura["triggers"][1]["trigger"]
    assert trigger["custom_type"] == "stateupdate" and "ThreatFunc" in trigger["custom"], trigger
    assert "ThreatFunc" in aura["actions"]["init"]["custom"]
    trigger.update(custom=TRIGGER, events=EVENTS, check="event")
    aura["actions"]["init"] = {"do_custom": True, "custom": INIT}
    aura["customText"] = TEXT
    aura["desc"] = DESC
    # One STATUS run on load refreshes every plate. forceEvents would run the trigger once per event instead.
    aura["information"] = {"ignoreOptionsEventErrors": True}
    for key in ("affixes", "use_affixes"):
        aura["load"].pop(key, None)
    return fa.transmit(fa.finish_aura(aura, drop=("customAnchor",)))


if __name__ == "__main__":
    fa.build_main(port, HERE, os.path.join("source", "installed.lua"), "threat_forever.lua")
