"""Save a group and every aura in it from a WeakAuras.lua save into a small file that build scripts read.

A port keeps its source next to it this way, so it still builds after the aura is changed or deleted in game.

Usage: python -I snapshot.py <WeakAuras.lua> "<group id>" <out.lua>
"""
import datetime
import importlib.util
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("fa_port", os.path.join(HERE, "fa_port.py"))
assert spec and spec.loader
fa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fa)


def main():
    src, root, out = sys.argv[1:4]
    displays = fa.load_displays(src)
    if root not in displays:
        raise SystemExit(f"no aura named {root!r} in {src}")
    ids = fa.group_members(displays, root)
    saved = datetime.date.fromtimestamp(os.path.getmtime(src)).isoformat()
    inside = f" and the {len(ids) - 1} auras inside it" if len(ids) > 1 else ""
    # The account folder is the Battle.net account number, so it stays out of files that may be shared.
    where = re.sub(r"(Account[\\/])[^\\/]+", r"\1<account>", os.path.abspath(src))
    note = f'"{root}"{inside}, copied from\n{where} (saved {saved}).'
    fa.write_snapshot(out, displays, ids, note)
    if fa.load_displays(out) != {aid: displays[aid] for aid in ids}:
        raise SystemExit("the snapshot does not read back the same")
    depth = {root: 0}
    for aid in ids:
        d = displays[aid]
        for kid in fa.children_of(d):
            depth[kid] = depth[aid] + 1
        print("  " * depth[aid] + f"{aid} [{d.get('regionType')}] internalVersion={d.get('internalVersion')}")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
