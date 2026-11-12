# Threat Differential on Nameplates (Forever)

Shows your threat lead or deficit on enemy nameplates, colored by who is tanking. The original is
Justbob's, at wago.io/yssC_nf5K. This build starts from the copy in my ForeverAuras save, so importing it updated that
copy in place and kept its position, colors and Secure Threat Target.

## What was wrong

In groups the original threw "attempt to compare local 'threat' (a secret number value)" on threat updates. Forever
hides threat numbers for some unit names, and the aura compared them without checking. It read threat for
`boss1` frames, which are always hidden, and for pets as `party1pet`, a compound name that Forever also hides.

The first Forever build (Nov 8) stopped the errors but showed only `+` or `-`. It still read pets as `party1pet`,
so one pet in the group sent every plate to the fallback marks. It also kept Classic's divide by 100. Classic
counts threat in hundredths, but Forever counts whole points like retail, so every number would have come out 100
times too small.

## Changes

- Pets are read as `pet`, `partypet1` and `raidpet1`, the names ThreatClassic2 uses on Forever, and the number is
  in whole threat points.
- Every threat value is checked before it's used. A pet whose number is hidden is skipped.
- If a group member's number is hidden, the aura falls back to the threat status the game still gives. The colors
  stay, and a mark replaces the number:
  - `+` while you're tanking
  - `!!!` while someone is about to pull threat off you, or you're about to pull it
  - `-` while you aren't tanking (blue if another tank has it, red if not)
- `!!!` also shows when you're level with the top or behind it while tanking (after a taunt, for example), and when
  you're ahead of the tank without having pulled yet.
- The number goes away when the mob drops you from its threat list. It used to stay on the plate after combat.
- Every visible plate is refreshed on load and when the group changes, so numbers show right after a `/reload` in
  combat.
- Only nameplates get a number. Events for `target`, `focus` or `boss1` used to draw a second copy on the same plate.
- Main tanks and the tank role count as tanks everywhere the aura checks.
- The Mythic+ affix load setting is gone (ForeverAuras ignores it), and so is the Wago link.

Green ("securely tanking") needs a lead of more than the Secure Threat Target, which is set to 10,000 threat points.
If green rarely shows in your fights, lower it in the aura's Custom Options.

No addon can show a number while the game hides it. Aura code can't subtract or compare hidden numbers, and the
helpers Blizzard added for them (curves, durations, `math.lerp` and the like) only take hidden numbers from
Blizzard's own code.

## Files

| File | What it is |
|---|---|
| `build.py` | Rebuilds the aura from `source/installed.lua` |
| `test.mjs` | Checks of the trigger, the text and the data, with secret values that throw like the game's |
| `break_cases.json` | Broken copies that the tests have to catch (`npm run break`) |
| `threat_forever.lua` | The built data |
| `ThreatDifferential_Forever.txt` | The import string |
| `source/installed.lua` | The aura as it was in my ForeverAuras save on Nov 8, 2026 |
