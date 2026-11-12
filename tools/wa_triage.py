"""Sort the top-level auras in a WeakAuras.lua save by what would stop them working on WoW Forever.

Usage: python -I wa_triage.py <WeakAuras.lua>

Combat log auras can't be ported (Forever keeps the combat log from addons). The other flags mark code to read
closely: values that turn secret in combat, renamed functions, and functions ForeverAuras blocks in aura code.
"""
import importlib.util
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("fa_port", os.path.join(HERE, "fa_port.py"))
assert spec and spec.loader
fa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fa)

API = {
    "combat log": r"COMBAT_LOG_EVENT|CombatLogGetCurrentEventInfo",
    "blocked in ForeverAuras": r"\b(?:pcall|xpcall|loadstring|getfenv|setfenv|RunScript|SlashCmdList|DEFAULT_CHAT_FRAME"
                               r"|ChatFrame1|ChatEdit_\w+|EnumerateFrames|securecall)\b",
    "chat send": r"SendChatMessage",
    "chat read": r"CHAT_MSG_",
    "old aura API": r"\bUnitAura\b|\bUnitBuff\b|\bUnitDebuff\b",
    "old spell API": r"\bGetSpellInfo\b|\bGetSpellCooldown\b|\bGetSpellTexture\b",
    "old cast bar": r"\bCastingBarFrame\b",
    "health/power math": r"\bUnitHealth\b|\bUnitPower\b|\bUnitMana\b|\bUnitHealthMax\b",
    "threat": r"UnitDetailedThreatSituation|UnitThreatSituation",
    "nameplates": r"C_NamePlate|NAME_PLATE_",
    "addon msgs": r"SendAddonMessage|CHAT_MSG_ADDON",
    "item use": r"UseInventoryItem|EquipItemByName|PickupInventoryItem",
    "every frame": r"FRAME_UPDATE|OnUpdate",
}


def code_of(obj):
    found = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, str) and isinstance(k, str) and k.startswith("custom") and len(v) > 10:
                found.append(v)
            else:
                found.extend(code_of(v))
    elif isinstance(obj, list):
        for v in obj:
            found.extend(code_of(v))
    return found


def main():
    displays = fa.load_displays(sys.argv[1])
    for aid, d in sorted(displays.items(), key=lambda kv: kv[0].lower()):
        if d.get("parent"):
            continue
        members = [displays[m] for m in fa.group_members(displays, aid) if m in displays]
        ttypes, events = {}, set()
        for m in members:
            trig = m.get("triggers") or {}
            for t in (trig.values() if isinstance(trig, dict) else trig):
                if not isinstance(t, dict) or "trigger" not in t:
                    continue
                tt = t["trigger"]
                key = tt.get("type", "?")
                if tt.get("event"):
                    key = f"{key}:{tt['event']}"
                if tt.get("type") == "custom":
                    key = f"custom:{tt.get('custom_type', '?')}"
                    if tt.get("check") == "update":
                        events.add("FRAME_UPDATE")
                    for e in re.split(r"[\s,]+", tt.get("events") or ""):
                        if e:
                            events.add(e.split(":")[0])
                ttypes[key] = ttypes.get(key, 0) + 1
        code = "\n".join(c for m in members for c in code_of(m))
        hits = [name for name, pat in API.items() if re.search(pat, code) or any(re.search(pat, e) for e in events)]
        if any("Combat Log" in k for k in ttypes):
            hits.insert(0, "combat log (trigger)")
        top = sorted(ttypes.items(), key=lambda kv: -kv[1])[:5]
        print(f"{aid}  ({len(members)} auras, {len(code)} chars of code)")
        print("   triggers: " + ", ".join(f"{k} x{v}" for k, v in top))
        if hits:
            print("   flags: " + ", ".join(dict.fromkeys(hits)))


if __name__ == "__main__":
    main()
