# WeakAuras for WoW Forever

WeakAuras I moved from the TBC Anniversary client to ForeverAuras on WoW Forever, with the tools that build, test and
encode them. Each aura's import string is the `.txt` file in its folder. In game, type `/fa`, click Import and paste it.

[LESSONS.md](LESSONS.md) has everything the ports taught me, in more detail than this page. Read it before starting a
new port.

## Auras

| Folder | Aura | Original | State |
|---|---|---|---|
| [ultimate-mouse-cursor](ultimate-mouse-cursor) | Ultimate Mouse Cursor | sarthe, [wago.io/GpGl-Yvr7](https://wago.io/GpGl-Yvr7) | Works in game (Nov 8, 2026) |
| [find-minerals](find-minerals) | Find Minerals Missing | Xobu Of Silver Storm, [wago.io/sQz93Ia-K](https://wago.io/sQz93Ia-K) | Works in game (Nov 12, 2026) |
| [threat-differential](threat-differential) | Threat Differential on Nameplates | Justbob, [wago.io/yssC_nf5K](https://wago.io/yssC_nf5K) | Works in game (Nov 12, 2026) |
| [drheals-xp-bar](drheals-xp-bar) | DrHeals XP Bar | DrHeal, [wago.io/j4YPGb_k0](https://wago.io/j4YPGb_k0) | Works in game (Nov 12, 2026) |
| [battle-shout](battle-shout) | Zera's Battle Shout Reminder and Shakeshack's Battle Shout AP Party Tracker, in one group | Zeraxxus, [wago.io/MtMe4SbEJ](https://wago.io/MtMe4SbEJ), and Znipsel, [wago.io/t5xAHQCg7](https://wago.io/t5xAHQCg7) | Works in game (Nov 12, 2026) |

Each folder's README says what was wrong with the aura on Forever and what changed.

## From Anniversary to Forever

WoW Forever has vanilla's spells, but its client runs the retail 12.1 engine with Midnight's rules for addons. The
auras I used on the TBC Anniversary client broke there in two ways. Some of the functions they called are gone, and
many of the values they read turn secret in combat. ForeverAuras, the WeakAuras fork that Forever players use, adds a
few rules of its own.

### Secret values

In combat, boss fights, Mythic+ and PvP, the game gives addons "secret" values in place of threat numbers, buffs, power
and some unit checks. Aura code can't compare a secret value or do math on it, so an unguarded `if threat > lead` throws.
This is how I fixed the auras that ran into it:

- Every value that can be secret goes through `issecretvalue` before any comparison, including `== nil`. A plain
  `if threat then` passes on a secret number, and the `>` on the next line throws.
- When a number is hidden, the aura falls back to what the game still shows. Threat status (0 to 3) stays readable when
  the threat number doesn't, so Threat Differential shows a `+`, `-` or `!!!` mark in place of the number. Your own
  casts stay readable, so the Battle Shout reminder counts down from your last shout while the buff itself is hidden.
- The rage check asks `C_Spell.IsSpellUsable`, because `UnitPower` can be secret.
- While buffs are hidden, the Battle Shout tracker keeps the last numbers it saw and shows them in grey. Both Battle
  Shout auras read again when `ADDON_RESTRICTION_STATE_CHANGED` says the restriction is over.
- Units are read by names the game doesn't hide. Compound names such as `party1pet` come back secret, and so does threat
  on `boss1` frames, so Threat Differential reads pets as `pet`, `partypet1` and `raidpet1`, the way ThreatClassic2 does.

### Functions that changed

| On Anniversary | On Forever |
|---|---|
| `UnitBuff`, and a hidden tooltip filled every frame to read the number | `C_UnitAuras`, and `C_TooltipInfo.GetUnitBuffByAuraInstanceID` for the tooltip text |
| `GetTrackingTexture` | `C_Minimap.GetTrackingInfo` and `C_Minimap.SetTracking`, with `MINIMAP_UPDATE_TRACKING` when tracking changes |
| Quest XP and objectives read from the selected quest | `C_QuestLog`, read by quest ID, since the selected quest is whatever you clicked last |
| Threat counted in hundredths | Threat counted in whole points, as on retail |
| `CastingBarFrame` | `PlayerCastingBarFrame` |
| Global cooldown spell 61304 | Global cooldown spell 29515 |

The combat log is closed to addons, so auras built on `COMBAT_LOG_EVENT` can't be ported at all. In my Anniversary save
that ruled out the taunt and parry announcers, the Void Zone and Avoid Lava alerts, and most of Fojji's raid packs.

### ForeverAuras

- Texture paths under `Interface\AddOns\WeakAuras\` have to become `Interface\AddOns\ForeverAuras\`. The importer only
  fixes sound paths.
- Its Power trigger only filters combo points. A rage or mana check in an imported aura is dropped without a warning,
  so the trigger is always on.
- Its buff trigger can't find a buff by name while buffs are secret. A "show when missing" aura that looks up Battle
  Shout by name would show in combat with the shout still up.
- `pcall`, `loadstring` and the chat frames are blocked in aura code, so the code guards with checks.
- Each build keeps the aura's uid, so importing it updates the copy already installed. The Wago link is dropped, so
  Wago won't offer to "update" it back to the broken original.

### Other changes along the way

- Code that ran every frame now runs on events, with a short timer only while one is needed.
- My Anniversary client ran the UI at 0.7 scale, and Forever has no saved UI scale, so the same sizes draw about 1.4
  times larger. The cursor and the Battle Shout group rescale themselves at load to keep the size they had.
- Bugs in the originals got fixed too, such as colors set to 255 that drew white and a latency wedge 11 pixels
  off center.

## How the ports are tested

The tests run each aura's Lua outside the game, in fengari (Lua 5.3 in Node), against mocked game functions.
`tools/compat51.lua` fills in what the game's Lua 5.1 has. The mocks hide what the game hides. `tools/harness.mjs` has
a `SECRET` stand-in that throws on comparison and math the way the game does, so an unguarded secret fails its test.

- `npm run break` breaks copies of each aura on purpose and checks that the tests catch every one. One test once passed
  only because a fake frame had no parent.
- `tools/encode.mjs` builds the import string with ForeverAuras' own libraries, then decodes it, compares every value
  and compiles every piece of code the way ForeverAuras does.
- Lua only calls `__eq` when both sides are tables, so the stand-in can't catch `secret == x`. Those comparisons get
  read by hand.

A port is done when its tests pass, its break cases fail the tests, and the encoder round-trips the string. Then I check
it in game.

## Setup

You need Python 3, Node 22 or newer, and WoW Forever with ForeverAuras installed. Run `npm install` once in this
folder to get fengari, the Lua engine the tests and the encoder run on.

The encoder and decoder load LibSerialize and LibDeflate from the installed ForeverAuras in
`C:\Program Files (x86)\World of Warcraft\_forever_`. Pass `--libs <folder>` to use another copy.

## Commands

| Command | What it does |
|---|---|
| `npm run cursor` | Builds the cursor, runs its tests and writes its import string |
| `npm run minerals` | The same for Find Minerals Missing |
| `npm run threat` | The same for Threat Differential on Nameplates |
| `npm run xpbar` | The same for DrHeals XP Bar |
| `npm run shout` | The same for the Battle Shout group |
| `npm run break` | Breaks copies of each aura on purpose and checks that the tests catch every one |
| `npm run all` | All of the above |

## Tools

| File | What it does |
|---|---|
| `tools/wa_list.py` | Lists the auras in a WeakAuras.lua or ForeverAuras.lua save. `--json out.json` dumps them all |
| `tools/wa_triage.py` | Flags what would stop each aura in a save from working on Forever |
| `tools/wa_show.py` | Prints a group's settings, triggers and code |
| `tools/snapshot.py` | Copies a group or aura out of a save into a small file that a build reads |
| `tools/decode.mjs` | Turns an import string (from Wago, say) into the same kind of file |
| `tools/fa_port.py` | Shared build helpers for texture paths, uids, Wago links and writing Lua |
| `tools/encode.mjs` | Turns built data into an import string with ForeverAuras' own libraries, then decodes it to check it |
| `tools/harness.mjs` | Runs an aura's Lua tests, with secret values that throw like the game's |
| `tools/break_tests.py` | Runs the broken copies listed in an aura's `break_cases.json` |
| `tools/compat51.lua` | Lets the Lua 5.3 engine run the game's Lua 5.1 code (from my Guild Golem project) |

Run the Python tools with `python -I`. Each file's first lines show how to call it.

## Porting or fixing an aura

1. Check the error log (`_forever_\WTF\Account\<account>\SavedVariables\!BugGrabber.lua`) for the aura's errors.
2. Get its source into `<folder>/source/`. Use `snapshot.py` for an aura in a save, or `decode.mjs` for an import
   string. For an aura that's already installed, snapshot it from ForeverAuras.lua, so the fix keeps its uid and
   updates it in place.
3. Read it with `wa_show.py`, and check a Classic save with `wa_triage.py`. Auras that need the combat log can't be
   ported.
4. Start from `find-minerals` (a small fix), `drheals-xp-bar` (a large On Init kept in its own file) or
   `ultimate-mouse-cursor` (a full port). Change the aura in `build.py`, test its code in `test.mjs` and list broken
   copies in `break_cases.json`.
5. Add an npm script like `minerals`, and add the folder to `break` and `all`.
6. In game, type `/fa`, click Import and paste the string.

## Credits

The auras belong to their authors, linked in the table above. These are fixes and ports so they run on Forever, shared
for other Forever players. If you made one of them and want it changed or taken down, open an issue. LibSerialize and
LibDeflate load from your own ForeverAuras install and aren't included here.
