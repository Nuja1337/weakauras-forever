"""Break an aura's built data on purpose and confirm its tests fail each time.

A test that still passes on a broken copy isn't checking that code. Run it after changing an aura's tests.
Each aura folder has a break_cases.json:

    {"data": "<built data>.lua", "cases": {"<what breaks>": [["<text in the data>", "<replacement>"], ...]}}

Code inside the data is in Lua strings, so a quote in the code is written \\" there.

Usage: python -I break_tests.py <aura folder>
"""
import json
import os
import subprocess
import sys


def main():
    folder = os.path.abspath(sys.argv[1])
    spec = json.load(open(os.path.join(folder, "break_cases.json"), encoding="utf-8"))
    src = open(os.path.join(folder, spec["data"]), encoding="utf-8").read()
    broken = os.path.join(folder, "broken.lua")
    missed = 0
    for name, reps in spec["cases"].items():
        missing = [a for a, _ in reps if a not in src]
        if missing:
            print(f"{name}: PATTERN MISSING {missing}")
            missed += 1
            continue
        s = src
        for a, b in reps:
            s = s.replace(a, b)
        with open(broken, "w", encoding="utf-8", newline="\n") as f:
            f.write(s)
        r = subprocess.run(["node", os.path.join(folder, "test.mjs"), broken], capture_output=True, text=True,
                           encoding="utf-8", stdin=subprocess.DEVNULL, timeout=120)
        lines = (r.stdout + r.stderr).strip().splitlines()
        summary = next((line for line in lines if "checks" in line), lines[0] if lines else "")
        caught = r.returncode != 0
        missed += not caught
        print(f"{name}: {'caught' if caught else 'NOT CAUGHT'} {summary.strip()[:150]}")
    if os.path.exists(broken):
        os.remove(broken)
    if missed:
        raise SystemExit(f"{missed} broken copies passed the tests")
    print("every broken copy failed the tests")


if __name__ == "__main__":
    main()
