"""Print the settings, triggers and code of a group and its auras, to read before porting it.

Usage: python -I wa_show.py <WeakAuras.lua or snapshot.lua> "<group id>"
"""
import importlib.util
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("fa_port", os.path.join(HERE, "fa_port.py"))
assert spec and spec.loader
fa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fa)

SHOWN = ("texture", "foregroundTexture", "backgroundTexture", "sameTexture", "width", "height", "scale", "xOffset",
         "yOffset", "anchorFrameType", "anchorFrameFrame", "anchorPoint", "selfPoint", "frameStrata", "color",
         "foregroundColor", "backgroundColor", "orientation", "compress", "inverse", "startAngle", "endAngle",
         "crop_x", "crop_y", "rotation", "mirror", "blendMode", "desaturate", "alpha", "information", "load",
         "conditions", "actions", "animation", "subRegions", "config", "authorOptions", "desc")


def short(v):
    return json.dumps(v, default=str)[:1500]


def main():
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8")  # aura text can hold characters the console code page lacks
    displays = fa.load_displays(sys.argv[1])
    for aid in fa.group_members(displays, sys.argv[2]):
        d = displays[aid]
        print("=" * 100)
        print(aid, d.get("regionType"))
        for k in SHOWN:
            v = d.get(k)
            if v in (None, {}, [], ""):
                continue
            if k == "load":
                v = {a: b for a, b in v.items() if b not in (None, False, {}, [])
                     and not (isinstance(b, dict) and not b.get("multi") and not b.get("single"))}
            if k == "actions":
                v = {a: {x: y for x, y in b.items() if y not in (None, False, {}, [], "")} for a, b in v.items()}
            print(f"  {k}: {short(v)}")
        trig = d.get("triggers") or {}
        for tk, t in (trig.items() if isinstance(trig, dict) else enumerate(trig)):
            if not isinstance(t, dict):
                print(f"  trigger {tk}: {t}")
                continue
            tt = dict(t.get("trigger", {}))
            code = {k: tt.pop(k) for k in list(tt) if isinstance(tt[k], str) and k.startswith("custom") and len(tt[k]) > 10}
            print(f"  trigger {tk}: {short(tt)}")
            if t.get("untrigger"):
                print(f"     untrigger: {short(t['untrigger'])}")
            for k, c in code.items():
                print(f"  --- {k}:")
                print(c)


if __name__ == "__main__":
    main()
