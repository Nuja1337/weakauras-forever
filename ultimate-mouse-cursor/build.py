"""Port "Classic - Ultimate Mouse Cursor" (wago.io/GpGl-Yvr7) to WoW Forever (ForeverAuras).

Reads the Classic aura from source/classic_snapshot.lua (or any WeakAuras.lua save), rebuilds it for
ForeverAuras and writes the export table as Lua source, for test.mjs to test and tools/encode.mjs to encode.

What changes from the Classic aura:
- Same look and on-screen size as in Classic. Every part sits on the half-scale group, which follows the
  cursor, and the dot's init rescales the group for Forever's UI scale (Classic ran at 0.7).
- Textures point at ForeverAuras' copies (its importer only rewrites sound paths).
- GCD ring: a trigger on cooldown events. Readable GCD times are drawn like any timer; only while the
  game keeps them secret (combat) does the ring get the game's own timer object.
- Swing ring: ForeverAuras' Swing Timer trigger (main hand). The Classic copy had a Health trigger.
- Latency rings: the same ping-based wedges as the Classic aura, recalculated on cast events only.
- Visibility (options, right click, key press) is one event-driven trigger per part. While the key
  for "Show on key press" is held, a 0.2 s check catches a key release the game never reported
  (alt-tab). The Classic aura ran an alpha function on every frame in every part, and repainted the
  parts white whenever "Show on key press" was on.

Usage: python -I build.py [source.lua] [out.lua]
(defaults: source/classic_snapshot.lua and cursor_forever.lua next to this file)
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

SOURCE_GROUP = "Classic - Ultimate Mouse Cursor"
GROUP_ID = "Ultimate Mouse Cursor (Forever)"
ADDON_VERSION = "1.3.0"  # the ForeverAuras version the string was first built for
UID_NAMESPACE = "umc-forever"

# (Classic id, new id, Lua expression for "this part is turned on" in the aura's options)
PARTS = [
    ("Mouse Cursor Dot 2", "Mouse Cursor Dot", "true"),
    ("Mouse Cursor 3", "Mouse Cursor Ring", "true"),
    ("GCD 2", "GCD Ring", "true"),
    ("Cast-Circle 2", "Cast Ring", "c.CastBar == 1"),
    ("Swing-Circle", "Swing Ring", "c.SwingBar"),
    ("Cast-Circle Lag (Cast)", "Cast Ring Lag (Cast)", "c.CastBar == 1"),
    ("Cast-Circle Lag (Channel)", "Cast Ring Lag (Channel)", "c.CastBar == 1"),
    ("Cast-Bar 2", "Cast Bar", "c.CastBar == 2"),
]
DROPPED = []

DROP_KEYS = fa.WAGO_KEYS + ("anchorFrameFrame", "anchorFrameParent")


# --- Lua code ------------------------------------------------------------------------------------

INIT = r"""-- Options are shared by every part of the cursor (Custom Options tab).
local env = aura_env
local c = env.config
local enabled = {ENABLED}
local keyDown = ({IsLeftAltKeyDown, IsLeftShiftKeyDown, IsLeftControlKeyDown})[c.KeyOption] or IsLeftAltKeyDown
env.rightDown = false

-- If the game loses focus while the key is held (alt-tab), it may never report the release.
-- While the key is held, check it every 0.2 s so the part still hides when it is let go.
local function WatchKey()
    if env.keyTicker then return end
    env.keyTicker = C_Timer.NewTicker(0.2, function()
        if keyDown() then return end
        env.keyTicker:Cancel()
        env.keyTicker = nil
        WeakAuras.ScanEvents("UMC_FOREVER_KEY_UP")
    end)
end

-- Called by the Visible trigger on mouse button and modifier key events.
function env.IsVisible()
    if not enabled then return false end
    if c.HideOnRightClick and env.rightDown then return false end
    if not c.ShowOnKeyPress then return true end
    if keyDown() then
        WatchKey()
        return true
    end
    if env.keyTicker then
        env.keyTicker:Cancel()
        env.keyTicker = nil
    end
    return false
end"""

GCD_INIT = r"""

-- While the GCD times are secret, check every 0.1 s for its end (isActive is never secret).
function env.WatchGCDEnd()
    if env.gcdTicker then return end
    env.gcdTicker = C_Timer.NewTicker(0.1, function()
        local info = C_Spell.GetSpellCooldown(29515)
        if info and not issecretvalue(info.isActive) and info.isActive then return end
        env.gcdTicker:Cancel()
        env.gcdTicker = nil
        WeakAuras.ScanEvents("UMC_FOREVER_GCD_END")
    end)
end"""

GCD = r"""function(allstates)
    -- 29515 is Forever's global cooldown spell. isActive is never secret; the times can be in combat.
    local state = allstates[""]
    local info = C_Spell.GetSpellCooldown(29515)
    local active = info and not issecretvalue(info.isActive) and info.isActive
    local start, duration = info and info.startTime, info and info.duration
    local readable = active and not issecretvalue(start) and not issecretvalue(duration)
    if readable and (duration <= 0 or start + duration <= GetTime()) then
        active = false
    end
    local timer = active and not readable and C_Spell.GetSpellCooldownDuration(29515)
    if not active or (not readable and not timer) then
        if state and state.show then
            state.show = false
            state.changed = true
            return true
        end
        return false
    end

    if readable then
        -- Readable times: drawn like any other timer.
        local expirationTime = start + duration
        if state and state.show and state.expirationTime == expirationTime then
            return false
        end
        allstates[""] = {
            show = true,
            changed = true,
            progressType = "timed",
            duration = duration,
            expirationTime = expirationTime,
            modRate = not issecretvalue(info.modRate) and info.modRate or nil,
            autoHide = true,
        }
        return true
    end

    -- Secret times: hand the game's own timer to the ring. Refreshed on every cooldown event,
    -- so a GCD that starts as the last one ends is picked up.
    aura_env.WatchGCDEnd()
    allstates[""] = {
        show = true,
        changed = true,
        progressType = "durationObject",
        durationObject = timer,
    }
    return true
end"""

LAG = r"""function(allstates)
    -- Your world latency as a share of the cast. Runs on your own cast events only.
    local _, _, _, startMs, endMs = {INFO}("player")
    local state = allstates[""]
    if not issecretvalue(startMs) and not issecretvalue(endMs) and startMs and endMs and endMs > startMs then
        local _, _, home, world = GetNetStats()
        local castMs = endMs - startMs
        local lagMs = math.min(world or home or 0, castMs)
        if state and state.show and state.value == lagMs and state.total == castMs then
            return false
        end
        allstates[""] = { show = true, changed = true, progressType = "static", value = lagMs, total = castMs }
        return true
    end
    if state and state.show then
        state.show = false
        state.changed = true
        return true
    end
    return false
end"""

LAG_EVENTS = {
    "UnitCastingInfo": "UNIT_SPELLCAST_START:player UNIT_SPELLCAST_DELAYED:player UNIT_SPELLCAST_STOP:player "
                       "UNIT_SPELLCAST_FAILED:player UNIT_SPELLCAST_INTERRUPTED:player",
    "UnitChannelInfo": "UNIT_SPELLCAST_CHANNEL_START:player UNIT_SPELLCAST_CHANNEL_UPDATE:player "
                       "UNIT_SPELLCAST_CHANNEL_STOP:player",
}

HIDE_CASTBAR = r"""

-- Hide Blizzard's cast bar. After turning this off, /reload to get the bar back.
if c.HideDefaultCastBar and PlayerCastingBarFrame then
    PlayerCastingBarFrame:UnregisterAllEvents()
    PlayerCastingBarFrame:Hide()
end"""

# Classic ran my UI at 0.7 scale (uiScale in its Config.wtf). Forever uses its own UI scale.
CLASSIC_UI_SCALE = 0.7

FIT_SCALE = r"""

-- Keep the cursor the same size on screen as in Classic, which ran your UI at {CLASSIC} scale.
-- The group's Scale setting stays the base size. It is re-checked on clicks, so it recovers after
-- ForeverAuras resets the scale (an edit in /fa) or you change your UI scale.
local CLASSIC_UI_SCALE = {CLASSIC}
function env.FitScale()
    local group = env.region and env.region:GetParent()
    -- Only a ForeverAuras display has an id, so this never resizes a Blizzard frame.
    if not group or type(group.id) ~= "string" then return end
    local holder = group:GetParent()
    local ui = holder and holder:GetEffectiveScale()
    if not ui or ui <= 0 then return end
    local current = group:GetScale()
    if current == env.fitted and ui == env.fittedUI then return end
    -- Any other scale is ForeverAuras applying the group's Scale setting again.
    if current ~= env.fitted then env.baseScale = current end
    group:SetScale(env.baseScale * CLASSIC_UI_SCALE / ui)
    env.fitted, env.fittedUI = group:GetScale(), ui
end
env.FitScale()""".replace("{CLASSIC}", repr(CLASSIC_UI_SCALE))

VISIBLE = r"""function(event, button)
    if button == "RightButton" then
        aura_env.rightDown = event == "GLOBAL_MOUSE_DOWN"
    end
    if aura_env.FitScale then aura_env.FitScale() end
    return aura_env.IsVisible()
end"""

VISIBLE_EVENTS = "GLOBAL_MOUSE_DOWN GLOBAL_MOUSE_UP MODIFIER_STATE_CHANGED UMC_FOREVER_KEY_UP"

VISIBLE_TRIGGER = {
    "type": "custom",
    "custom_type": "status",
    "check": "event",
    "events": VISIBLE_EVENTS,
    "custom": VISIBLE,
    "unit": "player",
    "debuffType": "HELPFUL",
}


def state_trigger(code, events):
    return {"type": "custom", "custom_type": "stateupdate", "check": "event", "events": events,
            "custom": code, "unit": "player", "debuffType": "HELPFUL"}


GCD_TRIGGER = state_trigger(GCD, "SPELL_UPDATE_COOLDOWN UMC_FOREVER_GCD_END")
SWING_TRIGGER = {"type": "unit", "event": "Swing Timer", "unit": "player", "swingType": 0}

NO_ANIMATION = {"type": "none", "easeType": "none", "easeStrength": 3, "duration_type": "seconds"}


def port(displays):
    group = copy.deepcopy(displays[SOURCE_GROUP])
    old_children = group["controlledChildren"]
    if isinstance(old_children, dict):
        old_children = [old_children[k] for k in sorted(old_children)]
    expected = {old for old, _, _ in PARTS} | set(DROPPED)
    if set(old_children) != expected:
        raise SystemExit(f"unexpected children: {sorted(set(old_children) ^ expected)}")

    children = []
    for old_id, new_id, enabled in PARTS:
        aura = copy.deepcopy(displays[old_id])
        fa.normalize_triggers(aura)
        old_main = aura["triggers"].get(2, {}).get("trigger", {})

        aura["id"] = new_id
        aura["parent"] = GROUP_ID
        # Sit on the group, which follows the cursor. A part anchored to the mouse itself is moved out
        # of the group and loses its half scale. In Classic only the dot was, and the rings fell back
        # to the group because their anchor named an aura that doesn't exist.
        aura["anchorFrameType"] = "SCREEN"
        aura["anchorPoint"], aura["selfPoint"] = "CENTER", "CENTER"
        for key in DROP_KEYS:
            aura.pop(key, None)
        if new_id == "Mouse Cursor Dot":
            # Classic drew the dot outside the half-scale group at 10 x 10. Inside it, that is 20 x 20.
            assert (aura["width"], aura["height"]) == (10, 10), (aura["width"], aura["height"])
            aura["width"], aura["height"] = 20, 20

        # Trigger 1 drives the display, trigger 2 says whether it may show. Both must be active.
        if new_id == "Mouse Cursor Dot":
            dot_visible = dict(VISIBLE_TRIGGER, events=VISIBLE_EVENTS + " UI_SCALE_CHANGED")
            triggers: dict = {1: fa.entry(dot_visible)}
        elif new_id == "Mouse Cursor Ring":
            triggers: dict = {1: fa.entry(dict(VISIBLE_TRIGGER))}
        else:
            if new_id == "GCD Ring":
                main = dict(GCD_TRIGGER)
            elif new_id == "Swing Ring":
                main = dict(SWING_TRIGGER)
            elif new_id.startswith("Cast Ring Lag"):
                info = "UnitChannelInfo" if "Channel" in new_id else "UnitCastingInfo"
                main = state_trigger(LAG.replace("{INFO}", info), LAG_EVENTS[info])
            else:
                assert old_main.get("event") == "Cast", (new_id, old_main)
                main = copy.deepcopy(old_main)
            triggers: dict = {1: fa.entry(main), 2: fa.entry(dict(VISIBLE_TRIGGER))}
        triggers["disjunctive"] = "all"
        triggers["activeTriggerMode"] = -10
        aura["triggers"] = triggers

        # Hiding is now done by the Visible trigger, so only the ring's combat colour stays.
        aura["conditions"] = [cond for cond in aura.get("conditions") or []
                              if any(ch.get("property") == "color" for ch in cond.get("changes") or [])]

        init = INIT.replace("{ENABLED}", enabled)
        if new_id == "Mouse Cursor Dot":
            init += HIDE_CASTBAR + FIT_SCALE
        elif new_id == "GCD Ring":
            init += GCD_INIT
        aura["actions"] = {"init": {"do_custom": True, "custom": init}, "start": {}, "finish": {}}
        aura["animation"] = {"start": dict(NO_ANIMATION), "main": dict(NO_ANIMATION),
                             "finish": dict(NO_ANIMATION)}
        # One STATUS run on load is enough; forceEvents would run the trigger once per event.
        aura["information"] = {"ignoreOptionsEventErrors": True, "showNilIsFalse": True}

        if new_id == "Cast Ring Lag (Channel)":
            # Was 11 px above the cast ring, which looks like an accidental drag.
            aura["xOffset"], aura["yOffset"] = 0, 0

        fa.fix_textures(aura)
        aura["uid"] = fa.uid_for(UID_NAMESPACE, new_id)
        aura["tocversion"] = fa.FOREVER_TOC
        children.append(aura)

    group["id"] = GROUP_ID
    group["controlledChildren"] = [c["id"] for c in children]
    group["desc"] = ("Cursor reticle with cast, GCD and swing rings. Ported to WoW Forever (ForeverAuras) "
                     "from wago.io/GpGl-Yvr7.")
    fa.normalize_triggers(group)
    group["triggers"] = {1: fa.entry({"type": "unit", "event": "Conditions", "unit": "player",
                                   "use_alwaystrue": True})}
    for key in DROP_KEYS:
        group.pop(key, None)
    # The group frame is 2 units wide. Centre it on the cursor (Classic put its corner there).
    assert group["anchorFrameType"] == "MOUSE" and group["scale"] == 0.5, (group["anchorFrameType"], group["scale"])
    group["selfPoint"] = "CENTER"
    group["information"] = {"groupOffset": True}
    fa.fix_textures(group)
    group["uid"] = fa.uid_for(UID_NAMESPACE, GROUP_ID)
    group["tocversion"] = fa.FOREVER_TOC

    return {"m": "d", "d": group, "c": children, "v": 2000, "s": ADDON_VERSION}


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "source", "classic_snapshot.lua")
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "cursor_forever.lua")
    transmit = port(fa.load_displays(src))
    fa.write_transmit(out, transmit, "ultimate-mouse-cursor/build.py")
    print(f"wrote {out}: group + {len(transmit['c'])} auras")


if __name__ == "__main__":
    main()
