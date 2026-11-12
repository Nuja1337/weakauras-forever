"""Fix "DrHeals XP Bar" (wago.io/j4YPGb_k0, v1.0.2 by DrHeal) for ForeverAuras on WoW Forever.

Reads the aura decoded from its Wago string (source/wago_v1.0.2.lua) and keeps its id and uid, so an import
also updates a copy installed straight from Wago. On Init comes from init.lua. `diff source/init_original.lua
init.lua` shows every code change.

What changes:
- Quest XP is read by quest ID. The original read objectives and XP from the quest log's selected quest, which on
  Forever is whatever quest you last clicked, so the completed and incomplete totals were wrong.
- Quests under collapsed headers still count once they've been seen.
- Session XP is counted between XP updates only. A level-up could add a whole level of XP to the session before.
- A 1 second timer drives the clock texts, and it stops when the bar hides or the aura is deleted. The original ran
  code every frame, and could keep doing so after the aura was deleted with /fa open.
- Quest log updates mark the quest XP for a rescan instead of re-reading everything on each one.
- The hover menu checks once when the mouse leaves. It used to poll 10 times a second while open.
- Right-drag moving is gone. A dragged position overrode the /fa editor for good. Place the bar in /fa.
- The Quest XP Source and Realm XP Multiplier options are gone. On Forever only the modern quest log exists, and
  realm multipliers are for private servers.

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

AURA_ID = "DrHeals XP Bar"
UID = "dhxpv1uid01"  # the uid DrHeal gave it on Wago
DROPPED_OPTIONS = ("quest_xp_source", "quest_xp_multiplier")
EVENTS = ("PLAYER_ENTERING_WORLD PLAYER_XP_UPDATE PLAYER_LEVEL_UP UPDATE_EXHAUSTION QUEST_LOG_UPDATE "
          "ENABLE_XP_GAIN DISABLE_XP_GAIN TIME_PLAYED_MSG OPTIONS DHXB_PULSE")
OPTION_DESC = {
    "native_xpbar": "Hide Blizzard's XP bar. This hides the reputation bar too.",
    "quest_xp_bonus_percent": ("Raise the quest XP shown on the bar by this much, for XP bonuses the quest log "
                               "doesn't include. 0% leaves it as is, 25% shows 1.25 times the XP."),
}


def read(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


def port(displays):
    aura = copy.deepcopy(displays[AURA_ID])
    assert aura["uid"] == UID, aura["uid"]
    assert aura["actions"]["init"]["custom"] == read(os.path.join("source", "init_original.lua")), \
        "the Wago On Init changed, so init.lua needs a fresh look"
    aura["actions"]["init"]["custom"] = read("init.lua")

    fa.normalize_triggers(aura)
    trigger = aura["triggers"][1]["trigger"]
    assert "UNIT_QUEST_LOG_CHANGED" in trigger["events"], trigger["events"]
    trigger["events"] = EVENTS

    options = aura["authorOptions"]
    if isinstance(options, dict):
        options = [options[k] for k in sorted(options)]
    kept = [o for o in options if o.get("key") not in DROPPED_OPTIONS]
    assert len(kept) == len(options) - len(DROPPED_OPTIONS)
    for o in kept:
        if o.get("key") in OPTION_DESC:
            o["desc"] = OPTION_DESC[o["key"]]
    aura["authorOptions"] = kept
    for key in DROPPED_OPTIONS:
        aura["config"].pop(key)

    aura["desc"] = (aura.get("desc") or "").rstrip() + (
        "\n\nFixed for WoW Forever (ForeverAuras) from wago.io/j4YPGb_k0 v1.0.2: quest XP by quest ID, "
        "no per-frame code, no right-drag (place it in /fa).")
    return fa.transmit(fa.finish_aura(aura))


if __name__ == "__main__":
    fa.build_main(port, HERE, os.path.join("source", "wago_v1.0.2.lua"), "xpbar_forever.lua")
