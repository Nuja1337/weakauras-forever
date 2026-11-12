# Battle Shout (Forever)

Two Battle Shout auras from my TBC Anniversary client, ported to ForeverAuras in one group.

- **Zera Battle Shout Reminder** (by Zeraxxus, wago.io/MtMe4SbEJ) shows the Battle Shout icon while your shout is missing or has
  10 seconds or less left, once you're in combat or have 10 rage. It bounces, and glows at 10 rage.
- **Shakeshack's Battle Shout AP Party Tracker 3** (shared on Wago by Znipsel, wago.io/t5xAHQCg7) lists you and the warriors and rogues in your
  party, or in your group of a raid, with the attack power their Battle Shout gives. It's green at 290 or more
  (rank 7 with 5/5 Improved Battle Shout), red below that, and says "BS missing" when someone doesn't have it.

Both were set to "Never" load in my TBC save. They load again here, with the same size and place on screen.

## What was wrong

Forever hides buffs from addons during combat, boss fights and PvP, unless Blizzard marks a spell as safe.

- The reminder looked Battle Shout up by name with ForeverAuras' buff trigger. That trigger can't look names up
  while buffs are hidden, so in combat the icon would have come up with your shout still on.
- The tracker read party buffs with `UnitBuff`, which Forever doesn't have, and filled a hidden tooltip every frame
  to find the number.

## What it does now

- The reminder reads your Battle Shout while the game shows it. While it's hidden, the reminder counts down from the
  last time it saw the buff and from your own shouts, since the game still shows your casts. Dying clears it.
- After a `/reload` in combat the reminder can't see your buff, so it stays quiet until you shout, die or leave
  combat. It won't nag you as "missing" for the whole fight.
- The rage check asks the game whether Battle Shout is usable. It costs 10 rage, so that's the old "10 rage" test.
  ForeverAuras' Power trigger, which the original used, only compares combo points and would have ignored it. The
  glow uses the same check.
- When the game stops hiding buffs (the `ADDON_RESTRICTION_STATE_CHANGED` event), both auras read them again.
- The tracker reads each listed player's Battle Shout with `C_UnitAuras`, and the number from the game's tooltip
  data or from the buff itself. It runs on buff changes of group members and on group changes only, and only
  rereads the player whose buffs changed.
- While buffs are hidden, the tracker keeps the last numbers it saw and shows them in grey. Someone it hasn't seen
  yet shows a grey `?`.
- The reminder no longer needs rank 6 of Battle Shout to load. Every warrior has the spell.
- My TBC client ran the UI at 0.7 scale, and Forever has no UI scale saved, so the same sizes would draw about 1.4
  times larger. Each aura scales the group to match when it loads, the way Ultimate Mouse Cursor does. Changing the
  group's Scale in `/fa` still works on top of that.
- The Wago links are gone, so Wago won't offer to "update" them back.

## Limits

- If another warrior's shout replaces yours in combat, the reminder still counts down from yours.
- In combat the tracker can't tell who your new shout reached, so the grey numbers are from before the pull.
- A party member out of sight (another zone, for example) shows "BS missing", as in the original.

## Files

| File | What it is |
|---|---|
| `build.py` | Builds the group from the two auras in `source/` |
| `test.mjs` | Checks of both auras' code and data, against a game mock in which buffs turn secret in combat |
| `break_cases.json` | Broken copies that the tests have to catch (`npm run break`) |
| `battle_shout_forever.lua` | The built data |
| `BattleShout_Forever.txt` | The import string |
| `source/reminder.lua`, `source/tracker.lua` | The two auras as they were in my TBC Anniversary save on Aug 28, 2026 |
