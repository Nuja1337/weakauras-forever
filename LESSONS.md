# Lessons for Forever auras

What the first port (Ultimate Mouse Cursor, November 2026) taught us. Add to it after each new aura.

## Where things are

- WoW is installed at `C:\Program Files (x86)\World of Warcraft`, and Forever's client folder is `_forever_`.
  The beta's was `_classic_beta_`.
- ForeverAuras is at `_forever_\Interface\AddOns\ForeverAuras` (version 1.3.2 on Nov 8, 2026). When a question comes
  up about how it behaves, read its code there. Its saved file is
  `_forever_\WTF\Account\<account>\SavedVariables\ForeverAuras.lua`.
- The Classic auras to port from are in `_anniversary_\WTF\Account\<account>\SavedVariables\WeakAuras.lua`
  (14 MB, 1,802 auras) and at the same path under `_classic_era_`. `_anniversary_` is the TBC Anniversary client, which I
  call "tbc" or "bcc". `_classic_` has no WeakAuras save.
- An aura named in a request can match several in a save, some set to "Never" load or sitting inside a big group.
  List the matches with their parent and load state, and ask which one when it isn't clear.
- Forever's API docs are in the `forever` branch of Gethe/wow-ui-source, under `Blizzard_APIDocumentationGenerated`.
  A sparse clone (`git clone --depth 1 --filter=blob:none --sparse -b forever`, then `git sparse-checkout set` on
  that folder) is quick and lets you grep all 643 files.
- The docs don't mark protected functions (`CastSpellBookItem` has no flag), so a missing flag doesn't mean a
  function is safe to call. Look for an addon on Forever that already calls it.
- Addons written for Forever show what works there. ThreatClassic2 (installed) reads threat, and AutoTracker (on
  CurseForge, with a Forever build) turns tracking on and off.
- Lua errors from auras land in `_forever_\WTF\Account\<account>\SavedVariables\!BugGrabber.lua`, with the aura
  name, the line and the message. Check it first when fixing an aura I already run.
- The game writes saves on logout and `/reload` only, so a save can lag behind what's in game. Ask for a `/reload`
  when the newest state matters.
- Wago has three useful endpoints. `https://data.wago.io/api/check/?ids=<id>` gives the name, game and version.
  `https://data.wago.io/api/raw/encoded?id=<id>&version=<x.y.z>` gives the import string (it came back empty
  without the version). `tools/decode.mjs` turns that string into a snapshot the other tools read.

## ForeverAuras

- Ports go to ForeverAuras, the addon I play with. EverAuras is another fork with different trigger fields.
  The first build targeted it by mistake.
- Open it with `/fa` (or `/wa`, `/foreverauras`). The Import button is at the top of the window.
- Its Power trigger only filters combo points (`Private.PowerFilterable` in Prototypes.lua is true for power type
  4 alone). A rage or mana test in an imported aura is dropped without a warning, so the trigger is always on.
  Conditions on Power can't switch on/off properties such as a glow in combat either.
- Unit filters in a trigger's events can name a group. `UNIT_AURA:group` covers you, your party and your raid. A
  plain `UNIT_AURA` also fires for every nameplate, target and focus.
- A state-update trigger offers its own fields to conditions through `customVariables` (`{ usable = "bool" }`). A
  bool condition then checks `value = 1` for true.
- Its "Aura" buff trigger (`aura2`, BuffTrigger2.lua) can only look auras up by spell ID while they're secret
  (`SafeForEachAura`). A trigger that matches by name finds nothing in combat, so a "Show on missing" by name shows
  with the buff up. Its "Aura (Modern)" trigger (`secretAura`, SecretAuraTrigger.lua) draws hidden auras through
  Blizzard's own aura frames and has Missing and Remaining Time modes, but nothing outside the game can test it.
- It reads `!WA:2!` and `!FA:2!` strings, made with LibSerialize, then LibDeflate at level 9, then EncodeForPrint. The
  table inside is `{m="d", d=group, c={children}, v=2000, s=<addon version>}`. `tools/encode.mjs` builds it with
  ForeverAuras' own libraries.
- Its data version is 91. Classic data at version 90 gets upgraded on import.
- The importer only rewrites sound paths. Texture paths under `Interface\AddOns\WeakAuras\` have to become
  `Interface\AddOns\ForeverAuras\` (`fa_port.fix_textures`). The files have the same names.
- Keep each aura's uid the same between builds (`fa_port.uid_for`). Importing a new build then offers to update the
  old one.
- Imports find the installed aura by uid (Transmission.lua and ForeverAurasOptions' Update.lua). To fix an aura the
  user already has, snapshot it from their ForeverAuras.lua and keep its id and uid. Drop the Wago link
  (`fa_port.finish_aura`), or Wago may offer to "update" it back to the broken original.
- An update import leaves size and position alone unless "Size & Position" is ticked. When a build changes sizes or
  anchors, delete the old group first or tick that box.
- Don't write to ForeverAuras.lua while WoW is running. The game rewrites it from memory on logout or `/reload`, so
  hand over an import string instead.

## Aura code in ForeverAuras

- **Blocked:** pcall, xpcall, loadstring, getfenv, setfenv, RunScript, securecall, EnumerateFrames, SlashCmdList, the
  chat frames and ChatEdit functions, macros, mail, trade, guild management, Quit and Logout, and the saved-variable
  tables. Guard with checks instead of pcall. The full list is `blockedFunctions` in AuraEnvironment.lua.
- **Allowed:** CreateFrame (wrapped and timed per aura), SetCursor and ResetCursor, C_Timer, and
  `WeakAuras.ScanEvents` for custom events.
- C_Timer is wrapped per aura, but the wrapper doesn't cancel timers when the aura unloads. Cancel your own tickers.
- `WeakAuras.ScanEventsByID` fails for ids with spaces, because the events field is split on spaces.
- `aura_env.region` is set before On Init runs, and every display region has `region.id`. Checking for `id` tells a
  ForeverAuras frame apart from a Blizzard one.

## Forever's API

Forever runs on the retail 12.1 engine with Midnight's addon rules (interface 16001, game type "camelot").

- Many values turn secret in combat, encounters and PvP. Check `issecretvalue(v)` before doing math or comparisons
  with them.
- The combat log is closed to addons, so auras built on COMBAT_LOG_EVENT can't be ported. In my Anniversary
  save that rules out the taunt and parry announcers, the Void Zone and Avoid Lava alerts, and most Fojji raid packs.
- In `C_Spell.GetSpellCooldown`, isActive, isEnabled and isOnGCD are never secret. startTime, duration and modRate
  can be. `C_Spell.GetSpellCooldownDuration` returns a timer object that a ring or bar can draw, through the state
  field `progressType = "durationObject"`.
- Check `issecretvalue` before any comparison or math, including `== nil`. In my error log, a plain
  `if threat then` on a secret number passed and the `>` on the next line threw.
- Forever loads Blizzard's retail ("Mainline") UI, as `Blizzard_UIPanels_Game.toc` shows for camelot. That means the
  retail quest log (C_QuestLog) and retail minimap tracking, so Classic-only globals may be missing.
- Threat numbers (`UnitDetailedThreatSituation`, `UnitThreatPercentageOfLead`) turn secret depending on the unit
  names. The docs say you, your pet or an ally against a nameplate or a non-boss unit is generally readable, and
  `boss1` frames are not. Compound names come back secret too. The original threat aura threw on `party1pet` in my
  error log, and ThreatClassic2 notes the same for `targettarget`. Read pets as `pet`, `partypet1` and
  `raidpet1`, the way ThreatClassic2 does. Threat status (`UnitThreatSituation`,
  0 to 3) stays readable for you or an ally against a nameplate. `C_Secrets.ShouldUnitThreatValuesBeSecret(unit,
  mob)` says which case applies.
- Threat numbers are in whole points, as on retail. Classic counts hundredths, so a Classic aura that divides by 100
  shows numbers 100 times too small on Forever.
- Aura code can't do math on a secret number. `math.lerp`, `math.remap` and the other math extensions, curves,
  durations and numeric formatters take secret values only from Blizzard's own code (`SecretArguments =
  "AllowedWhenUntainted"`). Only `C_StringUtil`'s formatting functions, such as `RoundToNearestString`, take them
  from any code. String concatenation, `string.format` and `tostring` work.
- ForeverAuras shows a secret value kept in a state field as text (`HiddenText` in ForeverAuras.lua). A custom text
  function that returns one is riskier, because `ReplaceValuePlaceHolders` compares the result with nil.
- `WOW_PROJECT_CAMELOT` isn't set in Blizzard's Forever Lua, and one addon falls back to 18, so don't count on it.
- `C_Minimap.SetTracking(index, true)` turns a kind of tracking on. AutoTracker calls it on Forever from a timer,
  out of combat, without a click. Tracking spells cost a global cooldown, and casting one breaks stealth. Classic's
  tracking spells (Find Herbs, Find Minerals, Track Beasts) replace each other, so an aura that turns one on can
  undo the player's choice.
- `UnitGroupRolesAssigned` and `UnitIsUnit` can also be secret, and `GetPartyAssignment` isn't in the docs. Guard all
  three.
- Buffs turn secret in combat, boss encounters, Mythic+ and PvP (`SecretWhenUnitAuraRestricted`), unless Blizzard
  flags a spell as never secret. `C_Secrets.ShouldSpellAuraBeSecret(id)` says whether a spell's aura is hidden right
  now. Lookups that need a readable aura (`GetAuraDataBySpellName`, `GetUnitAuraBySpellID`, `GetPlayerAuraBySpellID`)
  return nothing while it's hidden, so nil doesn't mean the buff is missing. Ask `ShouldSpellAuraBeSecret` first and
  keep the last state while it says yes. ThreatClassic2 does the same for Righteous Fury.
- `ADDON_RESTRICTION_STATE_CHANGED` (type, state) fires before a restriction starts and after it ends. Types are
  Combat 0, Encounter 1, ChallengeMode 2, PvPMatch 3, Map 4 and Chat 5. States are Inactive 0, Activating 1 and
  Active 2. At the start it arrives with Activating, while values are still readable, so to see the hidden state
  look again a frame later (`C_Timer.After(0, ...)`). After it ends, values are readable during the event.
- Your own casts stay readable (`UNIT_SPELLCAST_SUCCEEDED` for the player), so a buff you cast can be counted down
  from the cast while the buff itself is hidden. After a `/reload` in combat there's nothing to count from, so stay
  quiet until there is.
- `UnitPower` is secret for power types Blizzard hasn't flagged as never secret. `C_Spell.IsSpellUsable` has no
  secret flag and its second return says the power is short, so a "has the rage or mana for it" test can use it.
- A lookup that returns data can be used even while `ShouldSpellAuraBeSecret` says another rank is hidden. Read
  first, and only ask whether it's hidden when the lookup comes back empty.
- Forever's spells are vanilla ranks. Battle Shout is 6673, 5242, 6192, 11549, 11550, 11551 and 25289, and 290
  attack power is rank 7 with 5/5 Improved Battle Shout. ForeverAuras' `SecretAuraRanks.lua` lists the rank families
  and `SpellNameData.lua` maps each name to every spell ID with it.
- `UnitBuff` is gone. Use `C_UnitAuras`, and `C_TooltipInfo.GetUnitBuffByAuraInstanceID` for a buff's tooltip text in
  place of a hidden GameTooltip.
- `GetTrackingTexture` is gone. `C_Minimap.GetNumTrackingTypes()` and `C_Minimap.GetTrackingInfo(i)` (name, texture,
  active, type, subType, spellID) replace it, with MINIMAP_UPDATE_TRACKING when tracking changes. Several kinds of
  tracking can be on at once.
- The global cooldown spell is 29515 on Forever. Classic and retail use 61304.
- On the retail quest log, quest calls without an argument (`GetQuestLogRewardXP()`, `GetNumQuestLeaderBoards()`,
  `GetQuestLogLeaderBoard(i)`) read the selected quest, which is whatever the player last clicked, and
  `SelectQuestLogEntry` doesn't exist. Read by quest ID: `C_QuestLog.GetInfo(i)` for the IDs, then
  `GetQuestLogRewardXP(id)`, `C_QuestLog.IsComplete(id)` and `C_QuestLog.IsOnQuest(id)`.
- `C_QuestLog.GetNumQuestLogEntries()` and `GetInfo(i)` skip quests under collapsed headers. Remember IDs seen earlier
  and check them with `IsOnQuest`.
- Asking for played time (`RequestTimePlayed`) prints two chat lines, and aura code can't reach the chat frame to hide
  them.
- Hiding `StatusTrackingBarManager` hides the reputation bar too.
- UnitCastingInfo and UnitChannelInfo stay readable for the player and pet.
- Only `PlayerCastingBarFrame` exists. Classic's `CastingBarFrame` is gone.
- Also in the docs: GLOBAL_MOUSE_DOWN and GLOBAL_MOUSE_UP (with the button), MODIFIER_STATE_CHANGED,
  IsLeftAltKeyDown and its Shift and Ctrl versions, GetNetStats (home and world latency), UI_SCALE_CHANGED and
  PLAYER_SWING.
- Hiding the system pointer is unconfirmed. Blizzard's docs say SetCursor does nothing over the game world. The
  CursorForge addon claims that calling `SetCursor("Interface\\CURSOR\\HiddenCursor")` every frame hides it.
  Ultimate Mouse Cursor never hid it.

## Built-in triggers that work on Forever

Prefer these to custom code.

- **Global Cooldown** works in combat and always draws with the game's timer object.
- **Swing Timer** takes `swingType` 0 for main hand, 1 for off hand and 2 for ranged.
- **Cast** on the player works in combat. Its `use_showLatency` overlay times the gap between the key press and the
  cast start, so it may show empty on queued casts. A wedge based on ping is steadier.
- **Conditions** with `use_alwaystrue` keeps an aura on at all times.

## Groups, anchors and scale

- A child anchored to MOUSE is moved out of its group onto the mouse frame and loses the group's scale. Anchor
  children to the group (anchor type SCREEN inside a group) and only the group to MOUSE. The first build drew the
  rings at twice their size because of this.
- The group frame is 2 by 2 units. A selfPoint of CENTER centers it on the cursor.
- When several auras in a group fit its scale, they share what they've done (a table in the sandbox `_G`, by group
  frame). Otherwise the second one takes the first one's fit for the base and scales the group again.
- An anchor that names a missing aura falls back to the group. The Classic cursor's rings only lined up because of
  that.
- Compare sizes on screen. My Classic clients run uiScale 0.7 at 2560x1440, and Forever has no saved UI scale,
  so the same numbers draw larger there. The cursor corrects this at runtime (base scale x 0.7 / UI scale) and checks
  again on clicks, because ForeverAuras resets a group's scale after an edit.

## Triggers and code

- Custom status and state-update triggers get one forced "STATUS" run on load. With `information.forceEvents` they
  run once per registered event instead, so leave it off.
- On Init runs before the first custom function call.
- GenericTrigger registers each event name inside an xpcall, so an event made up for `WeakAuras.ScanEvents` can go
  in a trigger's events list. Find Minerals uses one to check again after a `C_Timer.NewTimer`.
- `disjunctive = "all"` needs every trigger active, and `activeTriggerMode = -10` takes progress from the first active
  trigger. The cursor uses trigger 1 for what to draw and trigger 2 for whether to show it.
- Copying the same author options into every child gives the group one shared options panel. Keep that pattern.
- A triggers table with no named keys parses as a 0-based list. `fa_port.normalize_triggers` fixes it.
- WoW colors run from 0 to 1, so a value like 255 draws white.
- A "start" animation plays once when the aura shows, and code inside it stops when it ends. "main" repeats.
- FRAME_UPDATE, `check = "update"` and animation functions run every frame. Replace them with events, plus a short
  ticker that only runs while it's needed.
- ForeverAuras disables the Mythic+ affix load setting, so imported auras that have one load as if it weren't there.
  Drop it from ports.
- On Init runs again on every edit and rename, but `_G` in aura code is ForeverAuras' shared sandbox table, so data
  kept there survives until `/reload`. Reuse frames and timers stored there, and stop the previous run's ticker at the
  top of each run.
- For a clock that has to tick, use `C_Timer.NewTicker` and have it stop itself when `WeakAuras.GetRegion(aura_env.id)`
  returns nothing (the aura was deleted or renamed). An OnUpdate script runs every frame and outlives the aura.
- Event order at a level-up varies (PLAYER_LEVEL_UP can arrive with old or new XP). Count XP on PLAYER_XP_UPDATE only,
  and treat a drop in XP as a level-up.
- A large On Init can live in its own `init.lua` next to `source/init_original.lua`. Then `diff` shows every change,
  and the build fails if the Wago original changes underneath it (see `drheals-xp-bar`).
- For a long aura, a reviewer agent's audit (APIs checked against the docs and my Forever addons) found bugs
  the error log never showed. Questie and RXPGuides in `_forever_\Interface\AddOns` show which quest functions work
  on Forever.

## What I want from a port

- Optimized, event-driven code. Built-in triggers come first, and nothing runs every frame unless there's no other
  way.
- The look and size of the aura I used before. When an aura has Classic and retail versions, confirm which one I
  mean before building. The first Forever build of the cursor wasn't what I had in mind, and it took a question
  about retail versus Classic to settle it.
- When I ask whether old code was spaghetti or a necessity, answer for each piece.
- Say which parts were tested outside the game and which still need a look in game, and give a short checklist.
- Put the import string on the clipboard and in a file. I may copy something else before pasting.
- Some auras I run came straight from Wago (Find Minerals Missing, Threat Differential, DrHeals XP Bar). Fix those
  in place, keeping my position and options.

## Testing

- Tests run the aura's Lua in fengari (Lua 5.3 in Node) with `tools/compat51.lua`, against mocked game functions.
  Mock what the code calls, such as GetTime, issecretvalue, C_Timer, C_Spell, key state and frames with a scale and
  parent.
- New tests use `tools/harness.mjs`. Its `SECRET` stand-in throws on comparison and math the way the game does, so an
  unguarded secret fails the test. Its `common()` checks texture paths, every-frame code, blocked functions and
  leftover Wago links.
- `tools/break_tests.py <folder>` runs the cases in that folder's `break_cases.json`.
- Test behavior (events in, shown or hidden out) and the data (sizes, anchors, no WeakAuras paths, nothing every
  frame).
- Afterwards, break the code on purpose (`break_tests.py`) to prove each test can fail. One test once passed only
  because a fake frame had no parent.
- Make the mocks hide what the game hides. The first threat build passed its tests because the mock gave a number
  for `party2pet`. In game that name is secret, every plate fell back to marks, and I saw only `+` and `-`.
  A fallback for hidden values should be rare, so test that ordinary play takes the normal path.
- Fire events in the order the game sends them. The first Battle Shout tests sent the restriction event with buffs
  already hidden, which the game never does, and missed that the tracker never turned grey.
- The `SECRET` stand-in can't catch `secret == x`. Lua only calls `__eq` when both sides are tables, so an unguarded
  `==` passes the tests and throws in game. Check every `==` on a value that can be secret by reading the code.
- Test what ForeverAuras does with kept built-in triggers, or read its source. The Battle Shout tests only ran the
  custom trigger logic with made-up booleans, so they passed while ForeverAuras ignored the rage test.
- The encoder decodes its own output, compares every value and compiles every piece of code the way ForeverAuras
  does.
- LibStub and the libraries expect WoW's global aliases (strmatch, tinsert, wipe and others). `encode.mjs` defines
  them before loading the libraries.

## Shell habits on this machine

- Under `python -I`, PYTHONIOENCODING is ignored. Call `sys.stdout.reconfigure(encoding="utf-8")` before printing
  aura text.
- Heredocs sent through the Bash tool can lose a backslash. Put scripts that edit escaped Lua strings in a file.
- Give subprocesses `stdin=DEVNULL`. A stray `cat` waiting on input once hung a run for five minutes.
- Don't add `< /dev/null` to a command that reads a heredoc (`python -I - <<'EOF'`). The redirect replaces the
  script, and Python opens its interactive prompt and hangs until the timeout. Put the script in a file instead.
- Set-Clipboard in PowerShell works. Check the length afterwards.
- CurseForge blocks its API and download pages for scripts. Files come from
  `https://mediafilez.forgecdn.net/files/<first 4 digits of the file id>/<last 3 digits>/<file name>`.
