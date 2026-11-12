"""Port two Battle Shout auras from my TBC Anniversary client to ForeverAuras on WoW Forever, in one group.

- "Zera Battle Shout Reminder" (wago.io/MtMe4SbEJ): an icon while your Battle Shout is missing or has 10 seconds
  or less left, once you're in combat or have 10 rage. It glows at 10 rage.
- "Shakeshack's Battle Shout AP Party Tracker 3" (wago.io/t5xAHQCg7): the warriors and rogues in your party (in a
  raid, your group), each with the attack power their Battle Shout gives, or "BS missing".

Both start from the copies in the TBC save (source/), which were set to "Never" load there. The group keeps their
size and place on screen.

What changes:
- Forever hides buffs from addons in combat, boss fights and PvP. The reminder's two buff triggers matched
  Battle Shout by name, and ForeverAuras' buff trigger can't look a name up while buffs are hidden, so in combat
  it would have shown the icon even with the shout up. One custom trigger replaces all four triggers. It reads the
  buff while the game shows it, and while it's hidden it counts down from what it read last and from your own
  shouts (your casts stay visible). It checks again the moment the game stops hiding buffs
  (ADDON_RESTRICTION_STATE_CHANGED). After a /reload in combat it stays quiet until it knows.
- The rage test moved into that trigger too. ForeverAuras' Power trigger only compares combo points, so the
  original "10 rage" test would have been ignored. Battle Shout costs 10 rage, so the game's usable check for the
  spell (C_Spell.IsSpellUsable) gives the same answer, and the glow reads it.
- The tracker read party buffs with UnitBuff, which Forever doesn't have, from a tooltip it filled every frame.
  It now reads the buff by name with C_UnitAuras, takes the number from the game's tooltip data
  (C_TooltipInfo) or from the buff, and runs on buff and group changes only. While buffs are hidden it keeps
  the last numbers it saw, in grey.
- Both load again (they were set to "Never"). The reminder no longer needs rank 6 of the spell, since every
  warrior has Battle Shout.
- Classic ran the UI at 0.7 scale and Forever has no UI scale saved, so the same numbers draw about 1.4 times
  larger there. Each aura's On Init scales the group to match, the way Ultimate Mouse Cursor does.
- No Wago links (Wago would offer to "update" them back), and ForeverAuras' trigger timing (forceEvents) is off.

Usage: python -I build.py [out.lua]
"""
import copy
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("fa_port", os.path.join(HERE, "..", "tools", "fa_port.py"))
assert spec and spec.loader
fa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fa)

GROUP_ID = "Battle Shout (Forever)"
REMINDER_ID = "Zera Battle Shout Reminder"
TRACKER_ID = "Shakeshack's Battle Shout AP Party Tracker 3"
SOURCES = {REMINDER_ID: "reminder.lua", TRACKER_ID: "tracker.lua"}

# Battle Shout's ranks on Forever (ForeverAuras' SecretAuraRanks.lua lists the same seven).
RANKS = "{ 6673, 5242, 6192, 11549, 11550, 11551, 25289 }"

# Both auras use this to tell whether the game hides Battle Shout from addons right now.
HIDDEN = r"""
-- Whether the game hides Battle Shout from addons right now (combat, boss fights, PvP).
local function Hidden()
    local ask = C_Secrets and C_Secrets.ShouldSpellAuraBeSecret
    if not ask then return false end
    for _, id in ipairs(RANKS) do
        local hidden = ask(id)
        if issecretvalue(hidden) or hidden then return true end
    end
    return false
end"""

# Classic ran my UI at 0.7 scale (uiScale in _anniversary_\WTF\Config.wtf). Forever has none saved.
CLASSIC_UI_SCALE = 0.7

FIT_SCALE = r"""

-- Keep the group the same size on screen as in TBC, which ran your UI at {CLASSIC} scale. Both auras in
-- the group call this, so what they've done is kept in one shared table, by group frame. The group's
-- Scale setting stays the base size, and a change to it (or to your UI scale) is picked up.
local CLASSIC_UI_SCALE = {CLASSIC}
_G.BattleShoutForeverFit = _G.BattleShoutForeverFit or setmetatable({}, { __mode = "k" })
local fits = _G.BattleShoutForeverFit
function env.FitScale()
    local group = env.region and env.region:GetParent()
    -- Only a ForeverAuras display has an id, so this never resizes a Blizzard frame.
    if not group or type(group.id) ~= "string" then return end
    local holder = group:GetParent()
    local ui = holder and holder:GetEffectiveScale()
    if not ui or ui <= 0 then return end
    local fit = fits[group] or {}
    fits[group] = fit
    local current = group:GetScale()
    if current == fit.scale and ui == fit.ui then return end
    -- Any other scale is ForeverAuras applying the group's Scale setting again.
    if current ~= fit.scale then fit.base = current end
    group:SetScale(fit.base * CLASSIC_UI_SCALE / ui)
    fit.scale, fit.ui = group:GetScale(), ui
end
env.FitScale()""".replace("{CLASSIC}", repr(CLASSIC_UI_SCALE))

REMINDER_INIT = r"""-- Zera's Battle Shout Reminder, ported to ForeverAuras on WoW Forever. Shows while your Battle Shout is
-- missing or has 10 seconds or less left.
local env = aura_env
local RANKS = {RANKS}   -- Battle Shout, ranks 1 to 7
local IS_RANK = {}
for _, id in ipairs(RANKS) do IS_RANK[id] = true end
local NAME = C_Spell.GetSpellName(RANKS[1]) or "Battle Shout"
local ICON = C_Spell.GetSpellTexture(RANKS[1]) or 132333
local WARN = 10                                 -- seconds left when the icon comes up
local CHECK = "BATTLE_SHOUT_REMINDER_CHECK"     -- the aura's own event, sent by its timer
env.known = false    -- whether it has seen your shout, or seen you without one (not yet after a /reload in combat)
env.expires = nil    -- when your shout runs out: nil while you don't have it, 0 if it doesn't run out
env.duration = 120   -- how long a shout lasts, read from the buff (Booming Voice makes it longer)
env.usable = false   -- whether you have the rage to shout
{HIDDEN}

-- Reads your Battle Shout. Returns false when it can't tell, because the game hides the buff.
local function Read()
    local aura = C_UnitAuras.GetAuraDataBySpellName("player", NAME, "HELPFUL")
    if aura then
        if issecretvalue(aura) then return false end
        local expires, duration = aura.expirationTime, aura.duration
        if issecretvalue(expires) or issecretvalue(duration) then return false end
        env.expires = expires or 0
        if duration and duration > 0 then env.duration = duration end
    elseif Hidden() then
        return false   -- nothing back can mean hidden, so it isn't taken as missing
    else
        env.expires = nil
    end
    env.known = true
    return true
end

-- Battle Shout costs 10 rage, so the game's usable check is the old "10 rage" test. ForeverAuras' Power trigger
-- can't compare rage (it only filters combo points).
local function Usable()
    local usable = C_Spell.IsSpellUsable(NAME)
    return not issecretvalue(usable) and usable == true
end

local function InCombat()
    local combat = UnitAffectingCombat("player")
    return not issecretvalue(combat) and combat == true
end

-- One check later on. A newer one replaces it.
local function Later(seconds)
    if env.timer then env.timer:Cancel() end
    env.timer = C_Timer.NewTimer(seconds, function()
        env.timer = nil
        WeakAuras.ScanEvents(CHECK)
    end)
end

function env.Update(allstates, event, unit, _, spellID)
    if env.FitScale then env.FitScale() end
    if event == "UNIT_SPELLCAST_SUCCEEDED" then
        if issecretvalue(spellID) or not IS_RANK[spellID] then return false end
        -- While the game hides the buff, the countdown starts from your shout.
        env.expires = GetTime() + env.duration
        env.known = true
    elseif event == "PLAYER_DEAD" then
        env.expires = nil
        env.known = true
    end
    -- Rage changes often in combat and don't change the buff, so they skip reading it.
    if event ~= "UNIT_POWER_UPDATE" and event ~= "SPELL_UPDATE_USABLE" then Read() end
    env.usable = Usable()
    local now = GetTime()
    if env.expires and env.expires > 0 and env.expires <= now then env.expires = nil end
    local left = env.expires and env.expires > 0 and env.expires - now or nil
    if left then
        -- Look again when the icon should come up, and again when the shout runs out.
        Later((left > WARN and left - WARN or left) + 0.01)
    elseif env.timer then
        env.timer:Cancel()
        env.timer = nil
    end
    local low = env.known and (env.expires == nil or (left ~= nil and left <= WARN))
    local show = low and (env.usable or InCombat())
    local state = allstates[""]
    if not show then
        if state and state.show then
            state.show = false
            state.changed = true
            return true
        end
        return false
    end
    local expires = left and env.expires or nil
    if state and state.show and state.expirationTime == expires and state.usable == env.usable then return false end
    allstates[""] = {
        show = true,
        changed = true,
        name = NAME,
        icon = ICON,
        progressType = left and "timed" or nil,
        duration = left and env.duration or nil,
        expirationTime = expires,
        autoHide = false,
        usable = env.usable,   -- the glow
    }
    return true
end""".replace("{RANKS}", RANKS).replace("{HIDDEN}", HIDDEN) + FIT_SCALE

TRACKER_INIT = r"""-- Shakeshack's Battle Shout AP Party Tracker, ported to ForeverAuras on WoW Forever. Lists you and the
-- warriors and rogues in your party (in a raid, your group) with the attack power their Battle Shout gives.
local env = aura_env
local RANKS = {RANKS}   -- Battle Shout, ranks 1 to 7
local NAME = C_Spell.GetSpellName(RANKS[1]) or "Battle Shout"
local STRONG = 290   -- rank 7 with 5/5 Improved Battle Shout, shown green
local CHECK = "BATTLE_SHOUT_TRACKER_CHECK"   -- the aura's own event, for a second look
env.seen = {}        -- by GUID: the attack power a shout gave, 0 if the number couldn't be read, false if missing
{HIDDEN}

local function known(v)
    if issecretvalue(v) then return nil end
    return v
end

local function ClassOf(unit)
    local _, class = UnitClass(unit)
    return known(class)
end

local function KeyOf(unit)
    return known(UnitGUID(unit)) or unit
end

-- You first, then the warriors and rogues in your party, or in your group of the raid.
local function Units()
    local list = {}
    local function add(unit)
        local class = UnitExists(unit) and ClassOf(unit)
        if class == "WARRIOR" or class == "ROGUE" then list[#list + 1] = unit end
    end
    add("player")
    if IsInRaid() then
        local me = known(UnitInRaid("player"))
        local mine = me and known(select(3, GetRaidRosterInfo(me)))
        if mine then
            for i = 1, GetNumGroupMembers() do
                if i ~= me and known(select(3, GetRaidRosterInfo(i))) == mine then add("raid" .. i) end
            end
        end
    elseif IsInGroup() then
        for i = 1, 4 do add("party" .. i) end
    end
    return list
end

-- The attack power a shout gives, from the game's tooltip for the buff, or from the buff itself.
local function Strength(unit, aura)
    local instance = known(aura.auraInstanceID)
    if instance and C_TooltipInfo and C_TooltipInfo.GetUnitBuffByAuraInstanceID then
        local tip = C_TooltipInfo.GetUnitBuffByAuraInstanceID(unit, instance, "HELPFUL")
        local lines = tip and not issecretvalue(tip) and known(tip.lines)
        if type(lines) == "table" then
            for i = 2, #lines do
                local text = type(lines[i]) == "table" and known(lines[i].leftText)
                local ap = type(text) == "string" and text:lower():match("attack power%D*(%d+)")
                if ap then return tonumber(ap) end
            end
        end
    end
    local points = known(aura.points)
    local first = type(points) == "table" and known(points[1])
    if type(first) == "number" and first > 0 then return math.floor(first + 0.5) end
    return 0
end

local function Read(unit)
    local aura = C_UnitAuras.GetAuraDataBySpellName(unit, NAME, "HELPFUL")
    if not aura then
        env.seen[KeyOf(unit)] = false
    elseif not issecretvalue(aura) then
        env.seen[KeyOf(unit)] = Strength(unit, aura)
    end
end

local function Line(unit, hidden)
    local name = known(UnitName(unit)) or "Unknown"
    local class = RAID_CLASS_COLORS and RAID_CLASS_COLORS[ClassOf(unit) or ""]
    if class and class.colorStr then name = "|c" .. class.colorStr .. name .. "|r" end
    local ap = env.seen[KeyOf(unit)]
    local text, color
    if ap == nil then
        text, color = "?", "FF808080"   -- not seen yet
    elseif ap == false then
        text = "BS missing"
    elseif ap == 0 then
        text = "has BS"
    else
        text, color = ap .. " AP", ap >= STRONG and "FF00FF00" or "FFFF0000"
    end
    -- While the game hides buffs, the last ones it showed are grey.
    if hidden then color = "FF808080" end
    if color then text = "|c" .. color .. text .. "|r" end
    return name .. ": " .. text
end

function env.Update(allstates, event, unit)
    if event == "UNIT_AURA" then
        -- Buff changes only matter for someone on the list, and only while the game shows them.
        if issecretvalue(unit) or not (env.listed and env.listed[unit]) or Hidden() then return false end
    elseif event == "ADDON_RESTRICTION_STATE_CHANGED" then
        -- This comes just before the game starts hiding buffs, so look again once it has.
        C_Timer.After(0, function() WeakAuras.ScanEvents(CHECK) end)
    end
    if env.FitScale then env.FitScale() end
    local hidden = Hidden()
    -- Who's on the list only changes with the group, so a buff change keeps it.
    if event ~= "UNIT_AURA" or not env.units then
        env.units = Units()
        env.listed = {}
        for _, u in ipairs(env.units) do env.listed[u] = true end
    end
    local units = env.units
    if not hidden then
        if event == "UNIT_AURA" then
            Read(unit)
        else
            for _, u in ipairs(units) do Read(u) end
        end
    end
    local lines = {}
    for i, u in ipairs(units) do lines[i] = Line(u, hidden) end
    local text = table.concat(lines, "\n")
    local show = text ~= ""
    local state = allstates[""]
    if not state then
        if not show then return false end
    elseif state.text == text and state.show == show then
        return false
    end
    allstates[""] = { show = show, changed = true, text = text }
    return true
end""".replace("{RANKS}", RANKS).replace("{HIDDEN}", HIDDEN) + FIT_SCALE

TSU = r"""function(allstates, event, ...)
    return aura_env.Update(allstates, event, ...)
end"""

REMINDER_EVENTS = ("PLAYER_ENTERING_WORLD UNIT_AURA:player UNIT_SPELLCAST_SUCCEEDED:player UNIT_POWER_UPDATE:player "
                   "SPELL_UPDATE_USABLE PLAYER_DEAD PLAYER_REGEN_DISABLED PLAYER_REGEN_ENABLED "
                   "ADDON_RESTRICTION_STATE_CHANGED UI_SCALE_CHANGED BATTLE_SHOUT_REMINDER_CHECK")
# UNIT_AURA:group covers you and your party or raid. A plain UNIT_AURA also fires for every nameplate.
TRACKER_EVENTS = ("PLAYER_ENTERING_WORLD GROUP_ROSTER_UPDATE UNIT_AURA:group UNIT_NAME_UPDATE:group "
                  "ADDON_RESTRICTION_STATE_CHANGED PLAYER_REGEN_ENABLED PLAYER_REGEN_DISABLED UI_SCALE_CHANGED "
                  "BATTLE_SHOUT_TRACKER_CHECK")

TRACKER_TEXT = r"""function()
    local state = aura_env.state
    return state and state.text or ""
end"""

REMINDER_DESC = ("Shows Battle Shout while it's missing or has 10 seconds or less left, once you're in combat or have "
                 "the 10 rage to shout. It glows while you have the rage. In combat WoW Forever hides buffs from "
                 "addons, so it counts down from the buff it last saw and from your own shouts. Ported to WoW "
                 "Forever (ForeverAuras) from Zera's aura, wago.io/MtMe4SbEJ.")
TRACKER_DESC = ("Lists you and the warriors and rogues in your party (in a raid, your group) with the attack power "
                "their Battle Shout gives: green at 290 or more (rank 7 with 5/5 Improved Battle Shout), red below, "
                "or \"BS missing\". In combat WoW Forever hides buffs from addons, so the list keeps the last numbers "
                "it saw, in grey. Ported to WoW Forever (ForeverAuras) from Shakeshack's aura, wago.io/t5xAHQCg7.")
GROUP_DESC = "Battle Shout reminder and party tracker from TBC, ported to WoW Forever (ForeverAuras)."


def state_trigger(code, events):
    return {"type": "custom", "custom_type": "stateupdate", "check": "event", "events": events, "custom": code,
            "unit": "player", "debuffType": "HELPFUL"}


def enable(aura):
    """Both were set to "Never" load in the TBC save."""
    assert aura["load"].get("use_never") is True, aura["load"]
    aura["load"].pop("use_never")


def port_reminder(aura):
    fa.normalize_triggers(aura)
    triggers = aura["triggers"]
    assert [triggers[i]["trigger"].get("type") for i in (1, 2, 3, 4)] == ["aura2", "aura2", "unit", "unit"]
    assert triggers[3]["trigger"]["event"] == "Power" and triggers[4]["trigger"]["event"] == "Conditions"
    # One trigger does it all. The Power trigger's rage test is ignored by ForeverAuras (it only filters combo
    # points), and the in-combat check is one line of code.
    trigger = state_trigger(TSU, REMINDER_EVENTS)
    trigger["customVariables"] = '{\n  usable = "bool",\n}'
    aura["triggers"] = {1: fa.entry(trigger), "activeTriggerMode": -10, "disjunctive": "any"}
    # The glow at 10 rage now reads the trigger's "usable" value.
    (condition,) = aura["conditions"]
    assert condition["check"] == {"op": ">=", "trigger": 3, "value": "10", "variable": "power"}, condition
    condition["check"] = {"trigger": 1, "variable": "usable", "value": 1}
    enable(aura)
    assert aura["load"]["spellknown"] == 11551
    for key in ("spellknown", "use_spellknown"):
        aura["load"].pop(key)
    aura["information"].pop("forceEvents")
    aura["actions"]["init"] = {"do_custom": True, "custom": REMINDER_INIT}
    aura["desc"] = REMINDER_DESC
    return aura


def port_tracker(aura):
    fa.normalize_triggers(aura)
    trigger = aura["triggers"][1]["trigger"]
    assert trigger["custom_type"] == "status" and "UnitBuff" in trigger["custom"], trigger
    aura["triggers"][1] = fa.entry(state_trigger(TSU, TRACKER_EVENTS))
    assert "APScanTooltip" in aura["actions"]["init"]["custom"]
    aura["actions"]["init"] = {"do_custom": True, "custom": TRACKER_INIT}
    assert aura["customTextUpdate"] == "update" and aura["displayText"] == "%c"
    aura["customText"] = TRACKER_TEXT
    aura["customTextUpdate"] = "event"   # the text changes only when the trigger does
    enable(aura)
    aura["desc"] = TRACKER_DESC
    return aura


def make_group(children):
    return {
        "id": GROUP_ID,
        "uid": fa.uid_for("battle-shout", GROUP_ID),
        "regionType": "group",
        "controlledChildren": [c["id"] for c in children],
        "desc": GROUP_DESC,
        "groupIcon": "132333",
        "anchorFrameType": "SCREEN",
        "anchorPoint": "CENTER",
        "selfPoint": "CENTER",
        "xOffset": 0,
        "yOffset": 0,
        "scale": 1,
        "alpha": 1,
        "frameStrata": 1,
        "border": False,
        "information": {"groupOffset": True},
        "internalVersion": 90,
        "actions": {"start": {}, "init": {}, "finish": {}},
        "animation": {part: {"type": "none", "duration_type": "seconds", "easeType": "none", "easeStrength": 3}
                      for part in ("start", "main", "finish")},
        "conditions": {},
        "config": {},
        "authorOptions": {},
        "subRegions": {},
        "load": {"class": {"multi": {}}, "spec": {"multi": {}}, "talent": {"multi": {}}, "size": {"multi": {}},
                 "zoneIds": ""},
        "triggers": {1: fa.entry({"type": "unit", "event": "Conditions", "unit": "player", "use_alwaystrue": True})},
    }


def port(sources):
    reminder = port_reminder(copy.deepcopy(sources[REMINDER_ID]))
    tracker = port_tracker(copy.deepcopy(sources[TRACKER_ID]))
    children = []
    for aura in (reminder, tracker):
        # Inside the group, an aura anchored to the screen sits at its offset from the group, which is at the
        # center of the screen like the screen anchor was.
        assert aura["anchorFrameType"] == "SCREEN" and aura["anchorPoint"] == "CENTER", aura["id"]
        assert "parent" not in aura
        aura["parent"] = GROUP_ID
        children.append(fa.finish_aura(aura))
    group = fa.finish_aura(make_group(children))
    return fa.transmit(group, children)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "battle_shout_forever.lua")
    sources = {}
    for aid, name in SOURCES.items():
        displays = fa.load_displays(os.path.join(HERE, "source", name))
        sources[aid] = displays[aid]
    t = port(sources)
    fa.write_transmit(out, t, "battle-shout/build.py")
    print(f"wrote {out}: {t['d']['id']} + {len(t['c'])} auras")


if __name__ == "__main__":
    main()
