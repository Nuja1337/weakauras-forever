# Find Minerals Missing (Forever)

Turns Find Minerals back on when it's off, and shows the old icon only when it can't. The original is by
Xobu Of Silver Storm, at wago.io/sQz93Ia-K. This build starts from the copy in my ForeverAuras save, so importing it
updated that copy in place and kept its position.

## What was wrong

Every check threw "attempt to call a nil value", because Forever doesn't have `GetTrackingTexture`. Forever uses
retail's minimap tracking, where the game lists each kind of tracking and whether it's on.

## What it does now

- When Find Minerals is off, the aura turns it on with `C_Minimap.SetTracking`. The AutoTracker addon makes the
  same call on Forever to swap herbs and minerals.
- It waits while you're in combat, dead, on a flight path or stealthed (the cast would break stealth), and turns
  it on when that ends. While you're casting, feigning death or on the global cooldown, it checks again each
  second.
- After a login or a loading screen it waits 3 seconds first.
- If you turn on another tracking spell, such as Find Herbs, the aura leaves it alone and shows the icon. Tracking
  spells in Classic replace each other, so turning minerals back on would undo your choice.
- If you untick Find Minerals in the tracking menu, it comes straight back on. Turning on another tracking spell is
  the way to keep it off.
- If three tries in a row don't turn it on, the icon shows and the aura stops trying. It tries again when you
  leave combat, come back to life, land from a flight or load into a zone.
- It runs on events, plus a one-off timer while it waits a moment or checks that a try worked. It used to also run
  every 5 seconds and on every aura change of every unit.
- The Wago link is gone, so Wago won't offer to "update" it back to the broken version.

## Files

| File | What it is |
|---|---|
| `build.py` | Rebuilds the aura from `source/installed.lua` |
| `test.mjs` | Checks of the aura's code and data, against a mocked minimap, clock and player state |
| `break_cases.json` | Broken copies that the tests have to catch (`npm run break`) |
| `minerals_forever.lua` | The built data |
| `FindMineralsMissing_Forever.txt` | The import string |
| `source/installed.lua` | The aura as it was in my ForeverAuras save on Nov 8, 2026 |
