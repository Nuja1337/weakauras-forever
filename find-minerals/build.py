"""Fix "Find Minerals Missing" (wago.io/sQz93Ia-K) for ForeverAuras on WoW Forever, and make it turn Find
Minerals on by itself.

Starts from the copy in my ForeverAuras save (source/installed.lua) and keeps its id and uid, so
importing the result updates that copy in place, with its position and look.

What changes:
- GetTrackingTexture doesn't exist on Forever, which loads retail's minimap code. The aura reads
  C_Minimap.GetTrackingInfo instead.
- When Find Minerals is off, the aura turns it on with C_Minimap.SetTracking, the call the AutoTracker addon
  makes on Forever. It waits while you're in combat, dead, on a flight path, stealthed (the cast would break
  stealth), feigning death, casting or on the global cooldown, and for 3 seconds after a loading screen.
- The icon now shows only when the aura can't turn it on: another tracking spell is on (it's left alone, since
  Classic-style tracking spells replace each other), or three tries in a row didn't work. The count of tries
  starts over when combat ends, you come back to life, land from a flight or load into a zone.
- It runs on events, plus a one-off timer while it waits a moment or checks that a try worked. It used to also
  run every 5 seconds and on every aura change of every unit.

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

AURA_ID = "Find Minerals Missing"
UID = "AuM9ny1B7t("  # the installed copy's uid

INIT = r"""-- Find Minerals Missing, for ForeverAuras on WoW Forever: turns Find Minerals on when it's off.
local env = aura_env
local SPELL, ICON = 2580, 136025   -- Find Minerals and its icon
local RETRY = "FIND_MINERALS_RETRY"  -- the aura's own event, sent by its timer
local MAX_TRIES = 3
-- Events that end a wait. Each starts the count of tries over.
local FRESH = { PLAYER_ENTERING_WORLD = true, PLAYER_REGEN_ENABLED = true, PLAYER_ALIVE = true,
                PLAYER_UNGHOST = true, PLAYER_CONTROL_GAINED = true }
env.tries = 0       -- tries in a row that didn't turn it on
env.waitUntil = 0   -- no new try before this, while the last one takes effect

-- Where Find Minerals is in the tracking list, whether it's on, and whether another tracking spell is on.
local function Scan()
    local index, active, otherSpell = nil, false, false
    for i = 1, C_Minimap.GetNumTrackingTypes() do
        local info = C_Minimap.GetTrackingInfo(i)
        if info then
            if info.spellID == SPELL or info.texture == ICON then
                index, active = i, info.active
            elseif info.active and (info.type == "spell" or (info.spellID or 0) > 0) then
                otherSpell = true
            end
        end
    end
    return index, active, otherSpell
end

-- Why the spell can't go out now: "wait" until an event says it's over, "soon" for what passes in a
-- moment. Nil when it can.
local function Blocked()
    if InCombatLockdown() or UnitAffectingCombat("player") then return "wait" end
    if UnitIsDeadOrGhost("player") or UnitOnTaxi("player") then return "wait" end
    if IsStealthed() then return "wait" end   -- the cast would break stealth
    if UnitIsFeignDeath("player") then return "soon" end   -- and this would break Feign Death
    if UnitCastingInfo("player") or UnitChannelInfo("player") then return "soon" end
    local cooldown = C_Spell.GetSpellCooldown(SPELL)
    if cooldown and cooldown.isActive then return "soon" end   -- the global cooldown
    return nil
end

-- Check again in a few seconds. A newer request replaces an older one.
local function Later(seconds)
    if env.timer then env.timer:Cancel() end
    env.timer = C_Timer.NewTimer(seconds, function()
        env.timer = nil
        WeakAuras.ScanEvents(RETRY)
    end)
end

-- Runs on each event. Returns true to show the icon, which happens only when the aura can't turn
-- Find Minerals on by itself.
function env.Check(event)
    if not (C_Minimap and C_Minimap.SetTracking) then
        -- Classic clients: the old reminder icon
        return GetTrackingTexture ~= nil and GetTrackingTexture() ~= ICON
    end
    if FRESH[event] then env.tries = 0 end
    local index, active, otherSpell = Scan()
    if not index then return false end
    if active then
        env.tries = 0
        return false
    end
    if otherSpell then return true end              -- you picked another tracking spell
    if env.tries >= MAX_TRIES then return true end  -- turning it on didn't work
    local now = GetTime()
    if event == "STATUS" or event == "PLAYER_ENTERING_WORLD" then
        env.waitUntil = now + 3   -- let the loading screen finish first
        Later(3)
        return false
    end
    if now < env.waitUntil then return false end    -- still loading, or the last try is taking effect
    local blocked = Blocked()
    -- "soon" checks again each second. A wait gets one more look when the event that should end it
    -- arrives a moment early (the taxi flag can lag behind landing).
    if blocked == "soon" or (blocked and (FRESH[event] or event == "UPDATE_STEALTH")) then Later(1) end
    if blocked then return false end
    env.tries = env.tries + 1
    env.waitUntil = now + 2
    -- Next frame, so the tracking update it causes doesn't arrive inside this event.
    C_Timer.After(0, function() C_Minimap.SetTracking(index, true) end)
    Later(2.5)   -- see whether it worked
    return false
end"""

TRACKING = r"""function(event)
    return aura_env.Check(event)
end"""

EVENTS = ("PLAYER_ENTERING_WORLD MINIMAP_UPDATE_TRACKING SPELLS_CHANGED PLAYER_REGEN_ENABLED PLAYER_ALIVE "
          "PLAYER_UNGHOST PLAYER_CONTROL_GAINED UPDATE_STEALTH FIND_MINERALS_RETRY")


def port(displays):
    aura = copy.deepcopy(displays[AURA_ID])
    assert aura["uid"] == UID, aura["uid"]
    fa.normalize_triggers(aura)
    trigger = aura["triggers"][1]["trigger"]
    assert "GetTrackingTexture" in trigger["custom"], trigger["custom"]
    trigger.update(custom=TRACKING, events=EVENTS, check="event")
    trigger.pop("onUpdateThrottle", None)
    aura["actions"]["init"] = {"do_custom": True, "custom": INIT}
    aura["desc"] = ("Turns Find Minerals on when it's off, once you're out of combat, alive and not casting. The "
                    "icon shows only when it can't: another tracking spell is on, or three tries didn't work. "
                    "Fixed for WoW Forever (ForeverAuras) from wago.io/sQz93Ia-K.")
    return fa.transmit(fa.finish_aura(aura))


if __name__ == "__main__":
    fa.build_main(port, HERE, os.path.join("source", "installed.lua"), "minerals_forever.lua")
