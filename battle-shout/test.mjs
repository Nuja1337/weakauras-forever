// Tests the Battle Shout reminder and party tracker against a mocked game in which buffs turn secret the way
// Forever's do in combat, and checks their data.
// Usage: node test.mjs [data.lua]   (default: battle_shout_forever.lua next to this file)
import { runLuaTest } from "../tools/harness.mjs";

runLuaTest(import.meta.url, process.argv[2] || "battle_shout_forever.lua", String.raw`
-- Indexing a secret throws in game too.
getmetatable(SECRET).__index = function() error("attempt to index a secret value", 2) end

local group = TRANSMIT.d
local children = TRANSMIT.c
common(group)
for _, c in ipairs(children) do common(c) end
local reminder, tracker = children[1], children[2]

local function has(events, e) return (" " .. events .. " "):find(" " .. e .. " ", 1, true) ~= nil end

-- Data -------------------------------------------------------------------------------------------
check(group.id == "Battle Shout (Forever)" and group.regionType == "group", "one group")
check(#children == 2 and group.controlledChildren[1] == reminder.id and group.controlledChildren[2] == tracker.id,
  "the group holds both auras")
check(reminder.id == "Zera Battle Shout Reminder" and reminder.uid == "U(IKD5AMZUQ", "reminder keeps its name and uid")
check(tracker.id == "Shakeshack's Battle Shout AP Party Tracker 3" and tracker.uid == "R48XlkVV1jL",
  "tracker keeps its name and uid")
for _, c in ipairs(children) do
  check(c.parent == group.id, c.id .. ": inside the group")
  check(c.anchorFrameType == "SCREEN" and c.anchorPoint == "CENTER", c.id .. ": placed from the group's center")
  check(c.load.use_never == nil, c.id .. ": loads (it was set to Never)")
  check(not (c.information and c.information.forceEvents), c.id .. ": no forced events")
  check(c.actions.init.custom:find("FitScale", 1, true), c.id .. ": fits the group to Forever's UI scale")
end
check(group.anchorFrameType == "SCREEN" and group.anchorPoint == "CENTER" and group.selfPoint == "CENTER"
  and group.xOffset == 0 and group.yOffset == 0 and group.scale == 1, "group sits at the center, base scale 1")
check(group.information.groupOffset == true, "children are placed relative to the group")

check(reminder.regionType == "icon" and reminder.width == 64 and reminder.height == 64, "reminder: 64 x 64 icon")
check(reminder.xOffset == -199.6187133789063 and reminder.yOffset == -125.7141418457031, "reminder: same place")
check(reminder.animation.main.type == "preset" and reminder.animation.main.preset == "bounce", "reminder: still bounces")
check(reminder.load.use_class and reminder.load.class.single == "WARRIOR", "reminder: warriors only")
check(reminder.load.use_spellknown == nil and reminder.load.spellknown == nil, "reminder: no rank 6 needed")
local rt = reminder.triggers
check(rt[1].trigger.type == "custom" and rt[1].trigger.custom_type == "stateupdate" and rt[1].trigger.check == "event",
  "reminder: event-driven state trigger first")
for _, e in ipairs({ "PLAYER_ENTERING_WORLD", "UNIT_AURA:player", "UNIT_SPELLCAST_SUCCEEDED:player",
                     "UNIT_POWER_UPDATE:player", "SPELL_UPDATE_USABLE", "PLAYER_DEAD", "PLAYER_REGEN_DISABLED",
                     "PLAYER_REGEN_ENABLED", "ADDON_RESTRICTION_STATE_CHANGED", "BATTLE_SHOUT_REMINDER_CHECK" }) do
  check(has(rt[1].trigger.events, e), "reminder listens for " .. e)
end
-- ForeverAuras' Power trigger ignores a rage test (it only filters combo points), so none is kept.
check(rt[2] == nil, "reminder: one trigger")
check(rt.disjunctive == "any" and rt.activeTriggerMode == -10 and rt.customTriggerLogic == nil,
  "reminder: no custom trigger logic")
local vars = compile(rt[1].trigger.customVariables, "custom variables")
check(vars.usable == "bool", "reminder: the trigger offers its usable value to conditions")
local glow = reminder.conditions[1]
check(#reminder.conditions == 1 and glow.check.trigger == 1 and glow.check.variable == "usable"
  and glow.check.value == 1 and glow.changes[1].property == "sub.3.glow" and glow.changes[1].value == true,
  "reminder: glows while you have the rage to shout")
check(reminder.subRegions[3].type == "subglow", "reminder: the glow is still sub-region 3")
check(reminder.desc:find("hides buffs", 1, true), "reminder: description explains combat")

check(tracker.regionType == "text" and tracker.xOffset == -437.9625854492188 and tracker.yOffset == -336.7982177734375
  and tracker.selfPoint == "BOTTOM", "tracker: same place")
check(tracker.fixedWidth == 200 and tracker.justify == "RIGHT" and tracker.fontSize == 12 and tracker.outline == "OUTLINE",
  "tracker: same text look")
check(tracker.displayText == "%c" and tracker.customTextUpdate == "event", "tracker: text changes on events only")
check(tracker.load.use_class == false, "tracker: every class")
local tt = tracker.triggers[1].trigger
check(tt.type == "custom" and tt.custom_type == "stateupdate" and tt.check == "event", "tracker: event-driven")
for _, e in ipairs({ "PLAYER_ENTERING_WORLD", "GROUP_ROSTER_UPDATE", "UNIT_AURA:group", "UNIT_NAME_UPDATE:group",
                     "ADDON_RESTRICTION_STATE_CHANGED", "PLAYER_REGEN_ENABLED", "PLAYER_REGEN_DISABLED",
                     "BATTLE_SHOUT_TRACKER_CHECK" }) do
  check(has(tt.events, e), "tracker listens for " .. e)
end
check(not has(tt.events, "UNIT_AURA") and not has(tt.events, "UNIT_NAME_UPDATE"),
  "tracker: group members only, not every nameplate")
check(not tracker.actions.init.custom:find("%f[%w_]UnitBuff%f[^%w_]"), "tracker: no UnitBuff (gone on Forever)")
check(not tracker.actions.init.custom:find("CreateFrame", 1, true), "tracker: no hidden tooltip frame")

-- Mocked game ------------------------------------------------------------------------------------
local now, timers = 5000, {}
function GetTime() return now end
local function schedule(delay, fn)
  local t = { at = now + delay, fn = fn }
  function t:Cancel() self.cancelled = true end
  timers[#timers + 1] = t
  return t
end
C_Timer = { After = function(delay, fn) schedule(delay, fn) end, NewTimer = schedule }
local function pending()
  local n = 0
  for _, t in ipairs(timers) do if not t.cancelled then n = n + 1 end end
  return n
end
local function advance(seconds)
  local target = now + seconds
  while true do
    local nextIndex
    for i, t in ipairs(timers) do
      if t.at <= target and (not nextIndex or t.at < timers[nextIndex].at) then nextIndex = i end
    end
    if not nextIndex then break end
    local t = table.remove(timers, nextIndex)
    now = math.max(now, t.at)
    if not t.cancelled then t.fn() end
  end
  now = target
end

local RANKS = { 6673, 5242, 6192, 11549, 11550, 11551, 25289 }
local usableNow, combatNow = true, false
C_Spell = {
  GetSpellName = function(id) if id == 6673 then return "Battle Shout" end end,
  GetSpellTexture = function(id) if id == 6673 then return 132333 end end,
  IsSpellUsable = function(spell)
    check(spell == "Battle Shout", "usable check by name: " .. tostring(spell))
    return usableNow, not usableNow
  end,
}
function UnitAffectingCombat(u) if u == "player" then return combatNow end end

-- Buffs by unit: { expirationTime, duration, points, tip, id }. hiddenSpells: spell IDs whose aura is secret.
local buffs, hiddenSpells, reads = {}, {}, 0
local secretAnswer = false
C_Secrets = { ShouldSpellAuraBeSecret = function(id)
  if secretAnswer then return SECRET end
  return hiddenSpells[id] == true
end }
local function hideAll(on) for _, id in ipairs(RANKS) do hiddenSpells[id] = on or nil end end
local secretAura, secretFields
C_UnitAuras = { GetAuraDataBySpellName = function(unit, name, filter)
  reads = reads + 1
  check(name == "Battle Shout" and filter == "HELPFUL", "looks the buff up by name: " .. tostring(name))
  local b = buffs[unit]
  -- A hidden aura returns nothing (RequiresNonSecretAura).
  if not b or hiddenSpells[b.id or 25289] then return nil end
  if secretAura then return SECRET end
  if secretFields then return { expirationTime = SECRET, duration = SECRET, auraInstanceID = SECRET, points = SECRET } end
  return { name = "Battle Shout", spellId = b.id or 25289, expirationTime = b.expirationTime, duration = b.duration,
           auraInstanceID = b.instance or 77, points = b.points }
end }
local tipSecret
C_TooltipInfo = { GetUnitBuffByAuraInstanceID = function(unit, instance, filter)
  local b = buffs[unit]
  if tipSecret then return SECRET end
  if not b or not b.tip then return nil end
  return { lines = { { leftText = "Battle Shout" }, { leftText = b.tip }, { leftText = "1 min remaining" } } }
end }

-- The group frame the auras scale.
local holder = { effective = 1 }
function holder:GetEffectiveScale() return self.effective end
local groupFrame = { id = "Battle Shout (Forever)", scale = 1 }
function groupFrame:GetParent() return holder end
function groupFrame:GetScale() return self.scale end
function groupFrame:SetScale(s) self.scale = s end
local function regionIn(parent)
  local r = {}
  function r:GetParent() return parent end
  return r
end

-- Reminder ---------------------------------------------------------------------------------------
local remTrigger = compile(rt[1].trigger.custom, "reminder trigger")
local remEnv, remStates
local function fireR(event, ...)
  aura_env = remEnv
  local changed = remTrigger(remStates, event, ...)
  return changed, remStates[""]
end
local fireT
WeakAuras = { ScanEvents = function(event, ...)
  if event == "BATTLE_SHOUT_REMINDER_CHECK" then fireR(event, ...) end
  if event == "BATTLE_SHOUT_TRACKER_CHECK" and fireT then fireT(event, ...) end
end }
local function shown() local s = remStates[""] return s ~= nil and s.show == true end

local function resetR()
  buffs, hiddenSpells, timers, reads = {}, {}, {}, 0
  secretAura, secretFields, secretAnswer = nil, nil, false
  usableNow, combatNow = true, false
  now = now + 1000
  _G.BattleShoutForeverFit = nil
  groupFrame.scale, holder.effective = 1, 1
  remStates = {}
  remEnv = init(reminder, { region = regionIn(groupFrame) })
end

resetR()
local changed, s = fireR("STATUS")
check(changed and shown(), "no shout: icon shown")
check(s.icon == 132333 and s.name == "Battle Shout", "the Battle Shout icon and name")
check(s.progressType == nil and s.expirationTime == nil, "no countdown while it's missing")
check(pending() == 0, "no timer while it's missing")
check(fireR("UNIT_AURA", "player") == false, "nothing new: no redraw")

resetR()
buffs.player = { expirationTime = now + 60, duration = 120 }
fireR("STATUS")
check(not shown(), "60 seconds left: hidden")
check(pending() == 1, "one timer for when it comes up")
advance(49.9)
check(not shown(), "still hidden at 10.1 seconds left")
advance(0.2)
s = remStates[""]
check(shown() and s.progressType == "timed" and s.expirationTime == buffs.player.expirationTime and s.duration == 120,
  "shown with a countdown at 10 seconds left")
check(pending() == 1, "one timer for when it runs out")
buffs.player = nil
advance(10)
s = remStates[""]
check(shown() and s.expirationTime == nil, "ran out: shown as missing")
check(pending() == 0, "no timer left")

resetR()
buffs.player = { expirationTime = 0, duration = 0 }
fireR("STATUS")
check(not shown() and pending() == 0, "a shout that doesn't run out: hidden, no timer")

-- Hidden in combat: counts down from what it read, and from your own shouts.
resetR()
buffs.player = { expirationTime = now + 100, duration = 180 }   -- Booming Voice
fireR("STATUS")
check(not shown() and remEnv.duration == 180, "reads how long the shout lasts")
hideAll(true)
fireR("ADDON_RESTRICTION_STATE_CHANGED", 0, 2)
check(not shown(), "combat starts: the buff it saw still counts")
fireR("UNIT_AURA", "player")
check(not shown(), "a hidden buff isn't taken as missing")
advance(89.9)
check(not shown(), "still hidden at 10.1 seconds left")
advance(0.2)
check(shown() and remStates[""].expirationTime == remEnv.expires, "comes up 10 seconds before the estimate")
local castAt = now
fireR("UNIT_SPELLCAST_SUCCEEDED", "player", "cast-1", 25289)
check(not shown() and remEnv.expires == castAt + 180, "your shout restarts the countdown")
fireR("UNIT_SPELLCAST_SUCCEEDED", "player", "cast-2", 11567)
check(remEnv.expires == castAt + 180, "another spell changes nothing")
check(fireR("UNIT_SPELLCAST_SUCCEEDED", "player", "cast-3", SECRET) == false, "a hidden spell ID is skipped")
advance(170.1)
check(shown(), "comes up 10 seconds before the new estimate")
advance(10)
check(shown() and remStates[""].expirationTime == nil, "then shows it missing")
check(pending() == 0, "no timer left")

resetR()
buffs.player = { expirationTime = now + 100, duration = 120 }
fireR("STATUS")
hideAll(true)
fireR("PLAYER_DEAD")
check(shown(), "dead: missing, even while buffs are hidden")

resetR()
buffs.player = { expirationTime = now + 100, duration = 120 }
fireR("STATUS")
hideAll(true)
advance(95)
check(shown(), "hidden: shown near the estimate")
buffs.player = { expirationTime = now + 110, duration = 120 }   -- another warrior shouted
hideAll(false)
fireR("ADDON_RESTRICTION_STATE_CHANGED", 0, 0)
check(not shown() and remEnv.expires == buffs.player.expirationTime, "combat ends: reads the buff again")

-- Hidden only for one rank, or a hidden answer, still counts as hidden.
resetR()
buffs.player = { expirationTime = now + 100, duration = 120 }
fireR("STATUS")
hiddenSpells[25289] = true
fireR("UNIT_AURA", "player")
check(not shown() and remEnv.expires ~= nil, "one hidden rank is enough to keep the estimate")
hiddenSpells = {}
secretAnswer = true
buffs.player = nil   -- while hidden the game returns nothing for it
fireR("UNIT_AURA", "player")
check(not shown() and remEnv.expires ~= nil, "a secret answer counts as hidden")

-- The game returns secrets without saying it hides them.
resetR()
buffs.player = { expirationTime = now + 100, duration = 120 }
fireR("STATUS")
local before = remEnv.expires
secretAura = true
fireR("UNIT_AURA", "player")
check(remEnv.expires == before and not shown(), "a secret aura keeps the estimate")
secretAura, secretFields = nil, true
fireR("UNIT_AURA", "player")
check(remEnv.expires == before and not shown(), "secret times keep the estimate")

-- No C_Secrets (an older client): reads every time.
resetR()
local savedSecrets = C_Secrets
C_Secrets = nil
buffs.player = { expirationTime = now + 100, duration = 120 }
fireR("STATUS")
check(not shown() and remEnv.expires == buffs.player.expirationTime, "works without C_Secrets")
C_Secrets = savedSecrets

-- Rage and combat.
resetR()
usableNow = false
fireR("STATUS")
check(not shown(), "missing, no rage, out of combat: hidden")
combatNow = true
fireR("PLAYER_REGEN_DISABLED")
check(shown() and remStates[""].usable == false, "in combat: shown without the glow")
reads = 0
usableNow = true
check(fireR("UNIT_POWER_UPDATE", "player") == true and remStates[""].usable == true, "10 rage: the glow comes on")
check(reads == 0, "a rage change doesn't read the buff")
check(fireR("UNIT_POWER_UPDATE", "player") == false, "more rage: no redraw")
combatNow = false
fireR("PLAYER_REGEN_ENABLED")
check(shown() and remStates[""].usable == true, "out of combat with the rage: still shown")
usableNow = false
fireR("SPELL_UPDATE_USABLE")
check(not shown(), "the rage runs out out of combat: hidden")
usableNow = SECRET
fireR("SPELL_UPDATE_USABLE")
check(not shown() and remEnv.usable == false, "a secret usable answer counts as no rage")
combatNow = SECRET
fireR("UNIT_AURA", "player")
check(not shown(), "a secret combat answer counts as out of combat")

-- After a /reload in combat it doesn't know, so it stays quiet until it does.
resetR()
hideAll(true)
combatNow = true
fireR("STATUS")
check(not shown() and remEnv.known == false, "reload in combat: quiet while it can't tell")
fireR("UNIT_AURA", "player")
check(not shown(), "still quiet")
fireR("UNIT_SPELLCAST_SUCCEEDED", "player", "cast-1", 25289)
check(remEnv.known and remEnv.expires == now + 120 and not shown(), "your shout starts the countdown")
fireR("PLAYER_DEAD")
check(shown(), "dead: shown as missing")
resetR()
hideAll(true)
combatNow = true
fireR("STATUS")
fireR("PLAYER_DEAD")
check(shown() and remEnv.known, "dying tells it too")

-- A buff the game returns is used, even while other ranks are hidden.
resetR()
buffs.player = { expirationTime = now + 100, duration = 120 }
fireR("STATUS")
hiddenSpells[6673] = true
buffs.player = { expirationTime = now + 150, duration = 150 }
fireR("UNIT_AURA", "player")
check(remEnv.expires == buffs.player.expirationTime and remEnv.duration == 150, "reads what the game returns")

-- One timer at a time.
resetR()
buffs.player = { expirationTime = now + 100, duration = 120 }
for _ = 1, 5 do fireR("UNIT_AURA", "player") end
check(pending() == 1, "repeated events keep one timer")

-- Scale: the group draws as large as it did at 0.7 in TBC.
resetR()
check(groupFrame.scale == 0.7, "group scaled to 0.7 at a UI scale of 1")
local trEnvA = init(tracker, { region = regionIn(groupFrame) })
check(groupFrame.scale == 0.7, "the second aura doesn't scale it again")
groupFrame.scale = 1.2   -- ForeverAuras applies a new Scale setting
fireR("UNIT_AURA", "player")
check(math.abs(groupFrame.scale - 0.84) < 1e-9, "a new Scale setting is kept as the base")
holder.effective = 0.5
fireR("UNIT_AURA", "player")
check(math.abs(groupFrame.scale - 1.68) < 1e-9, "follows a UI scale change")
local loose = { scale = 1 }
function loose:GetParent() return holder end
function loose:GetScale() return self.scale end
function loose:SetScale(v) self.scale = v end
init(reminder, { region = regionIn(loose) })
check(loose.scale == 1, "leaves a frame without an id alone")

-- Tracker ----------------------------------------------------------------------------------------
local units, raid = {}, nil
local function member(token, name, class, guid) units[token] = { name = name, class = class, guid = guid or name } end
function UnitExists(u) return units[u] ~= nil end
function UnitClass(u) local m = units[u] if m then return m.class, m.class end end
function UnitName(u) local m = units[u] if m then return m.name end end
function UnitGUID(u) local m = units[u] if m then return m.guid end end
local rosterScans = 0
function IsInRaid() rosterScans = rosterScans + 1 return raid ~= nil end
function IsInGroup() return raid ~= nil or units.party1 ~= nil end
function GetNumGroupMembers() return raid and #raid or 0 end
local mySlot
function UnitInRaid(u) if u == "player" then return mySlot end end
function GetRaidRosterInfo(i) local r = raid and raid[i] if r then return r.name, 0, r.group end end
RAID_CLASS_COLORS = {
  WARRIOR = { colorStr = "ffc79c6e" }, ROGUE = { colorStr = "fffff569" },
  MAGE = { colorStr = "ff3fc7eb" }, PALADIN = { colorStr = "fff58cba" },
}

local trTrigger = compile(tt.custom, "tracker trigger")
local trEnv, trStates
function fireT(event, ...)
  local saved = aura_env
  aura_env = trEnv
  local changed = trTrigger(trStates, event, ...)
  aura_env = saved
  return changed
end
local function text() local s = trStates[""] return s and s.show and s.text or "" end
local function resetT()
  units, raid, mySlot, buffs, hiddenSpells, reads = {}, nil, nil, {}, {}, 0
  secretAura, secretFields, secretAnswer, tipSecret = nil, nil, false, nil
  trStates = {}
  trEnv = init(tracker, { region = regionIn(groupFrame) })
end
local W, R = "|cffc79c6e", "|cfffff569"
local GREEN, RED, GREY = "|cFF00FF00", "|cFFFF0000", "|cFF808080"

resetT()
member("player", "Nuja", "WARRIOR")
buffs.player = { tip = "Attack power increased by 290.", points = { 232 } }
fireT("STATUS")
check(text() == W .. "Nuja|r: " .. GREEN .. "290 AP|r", "solo: you, green at 290, from the tooltip: " .. text())

resetT()
member("player", "Nuja", "WARRIOR")
member("party1", "Sneaky", "ROGUE")
member("party2", "Frosty", "MAGE")
member("party3", "Tanky", "WARRIOR")
buffs.player = { tip = "Attack power increased by 290." }
buffs.party1 = { tip = "Increases your melee attack power by 232." }
fireT("GROUP_ROSTER_UPDATE")
check(text() == W .. "Nuja|r: " .. GREEN .. "290 AP|r\n" .. R .. "Sneaky|r: " .. RED .. "232 AP|r\n"
  .. W .. "Tanky|r: BS missing", "party: you first, rogue red at 232, mage left out, warrior missing: " .. text())

-- Only the unit whose buffs changed is read again.
reads, rosterScans = 0, 0
buffs.party3 = { tip = "Attack power increased by 290." }
check(fireT("UNIT_AURA", "party3") == true and reads == 1, "one read for one unit's change")
check(rosterScans == 0, "a buff change doesn't go through the group again")
check(text():find("Tanky|r: " .. GREEN .. "290 AP|r", 1, true), "Tanky now has it")
reads = 0
check(fireT("UNIT_AURA", "nameplate4") == false and reads == 0, "units not on the list are skipped")
check(fireT("UNIT_AURA", "party2") == false and reads == 0, "the mage is skipped")
check(fireT("UNIT_AURA", "party1") == false, "nothing new: no redraw")

-- Combat: the game hides buffs. The last numbers stay, in grey. The event comes just before the hiding starts
-- (state 1, Activating), so the tracker looks again on the next frame.
timers = {}
check(fireT("ADDON_RESTRICTION_STATE_CHANGED", 0, 1) == false, "combat about to start: nothing hidden yet")
hideAll(true)
reads = 0
advance(0)
check(text():find(GREY, 1, true), "a frame later: grey")
check(text() == W .. "Nuja|r: " .. GREY .. "290 AP|r\n" .. R .. "Sneaky|r: " .. GREY .. "232 AP|r\n"
  .. W .. "Tanky|r: " .. GREY .. "290 AP|r", "hidden: last numbers in grey: " .. text())
check(reads == 0, "nothing read while hidden")
check(fireT("UNIT_AURA", "party1") == false and reads == 0, "buff changes are skipped while hidden")
member("party4", "Stabby", "ROGUE")
fireT("GROUP_ROSTER_UPDATE")
check(text():find("Stabby|r: " .. GREY .. "?|r", 1, true), "someone not seen yet shows a grey ?")
buffs.party1 = nil
hideAll(false)
fireT("ADDON_RESTRICTION_STATE_CHANGED", 0, 0)
check(text():find("Sneaky|r: BS missing", 1, true) and text():find("Nuja|r: " .. GREEN, 1, true),
  "combat ends: read again, colors back")

-- Strength from the buff when the tooltip has none, and "has BS" when neither does.
resetT()
member("player", "Nuja", "WARRIOR")
buffs.player = { points = { 290 } }
fireT("STATUS")
check(text() == W .. "Nuja|r: " .. GREEN .. "290 AP|r", "number from the buff's points")
buffs.player = {}
fireT("PLAYER_REGEN_ENABLED")
check(text() == W .. "Nuja|r: has BS", "no number anywhere: has BS")
tipSecret = true
buffs.player = { tip = "Attack power increased by 290.", points = { 193 } }
fireT("PLAYER_REGEN_ENABLED")
check(text() == W .. "Nuja|r: " .. RED .. "193 AP|r", "a secret tooltip falls back to the buff")
tipSecret = nil
secretFields = true
fireT("PLAYER_REGEN_ENABLED")
check(text() == W .. "Nuja|r: has BS", "secret fields: has BS, no error")
secretFields, secretAura = nil, true
fireT("PLAYER_REGEN_ENABLED")
check(text() == W .. "Nuja|r: has BS", "a secret aura keeps what was seen")

-- Not a warrior or rogue: only the others are listed. Alone: nothing.
resetT()
member("player", "Holy", "PALADIN")
fireT("STATUS")
check(text() == "" and not trStates[""], "a paladin alone: nothing shown")
member("party1", "Sneaky", "ROGUE")
buffs.party1 = { tip = "Attack power increased by 232." }
fireT("GROUP_ROSTER_UPDATE")
check(text() == R .. "Sneaky|r: " .. RED .. "232 AP|r", "a paladin sees the rogue: " .. text())
units.party1 = nil
fireT("GROUP_ROSTER_UPDATE")
check(trStates[""].show == false, "the rogue leaves: hidden")

-- Raid: your group only.
resetT()
member("player", "Nuja", "WARRIOR")
member("raid3", "Sneaky", "ROGUE")
member("raid5", "Nuja", "WARRIOR")
member("raid7", "Other", "WARRIOR")
raid = { {}, {}, { name = "Sneaky", group = 2 }, {}, { name = "Nuja", group = 2 }, {}, { name = "Other", group = 1 } }
for i = 1, 7 do raid[i].name = raid[i].name or ("x" .. i) raid[i].group = raid[i].group or 3 end
mySlot = 5
buffs.player = { tip = "Attack power increased by 290." }
buffs.raid3 = { tip = "Attack power increased by 290." }
fireT("GROUP_ROSTER_UPDATE")
check(text() == W .. "Nuja|r: " .. GREEN .. "290 AP|r\n" .. R .. "Sneaky|r: " .. GREEN .. "290 AP|r",
  "raid: you and your group, not raid group 1: " .. text())
mySlot = SECRET
fireT("GROUP_ROSTER_UPDATE")
check(text() == W .. "Nuja|r: " .. GREEN .. "290 AP|r", "a secret raid slot lists only you")

-- Secret names and classes.
resetT()
member("player", "Nuja", "WARRIOR")
member("party1", SECRET, "ROGUE", SECRET)
member("party2", "Hidden", SECRET)
buffs.party1 = { tip = "Attack power increased by 290." }
fireT("GROUP_ROSTER_UPDATE")
check(text():find(R .. "Unknown|r: " .. GREEN .. "290 AP|r", 1, true), "a secret name shows Unknown: " .. text())
check(not text():find("Hidden", 1, true), "a secret class isn't listed")
`);
