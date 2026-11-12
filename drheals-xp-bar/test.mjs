// Runs DrHeals XP Bar's On Init and trigger against a mocked Forever client: the retail quest log (where an
// argument-less quest call reads the selected quest), XP, timers and frames. Also checks its data.
// Usage: node test.mjs [data.lua]   (default: xpbar_forever.lua next to this file)
import { runLuaTest } from "../tools/harness.mjs";

runLuaTest(import.meta.url, process.argv[2] || "xpbar_forever.lua", String.raw`
local aura = TRANSMIT.d
common(aura)

-- Data -------------------------------------------------------------------------------------------
check(TRANSMIT.c == nil, "a single aura")
check(aura.id == "DrHeals XP Bar" and aura.uid == "dhxpv1uid01", "same id and uid as on Wago")
check(aura.regionType == "aurabar" and aura.width == 600, "the same bar")
local tr = aura.triggers[1].trigger
check(tr.custom_type == "stateupdate" and tr.check == "event", "event-driven state trigger")
check(not tr.events:find("UNIT_QUEST_LOG_CHANGED", 1, true), "party quest changes don't run it")
for _, e in ipairs({ "PLAYER_ENTERING_WORLD", "PLAYER_XP_UPDATE", "PLAYER_LEVEL_UP", "UPDATE_EXHAUSTION",
    "QUEST_LOG_UPDATE", "ENABLE_XP_GAIN", "DISABLE_XP_GAIN", "TIME_PLAYED_MSG", "OPTIONS", "DHXB_PULSE" }) do
  check(tr.events:find(e, 1, true), "listens for " .. e)
end
local options = {}
for _, o in ipairs(aura.authorOptions) do if o.key then options[o.key] = o end end
check(#aura.authorOptions == 18, "18 option rows, got " .. #aura.authorOptions)
check(options.quest_xp_source == nil and options.quest_xp_multiplier == nil, "no Quest XP Source or Realm Multiplier option")
check(aura.config.quest_xp_source == nil and aura.config.quest_xp_multiplier == nil, "and no saved values for them")
check(options.native_xpbar.desc:find("reputation", 1, true), "the XP bar option says it hides the reputation bar")
for _, key in ipairs({ "max_level", "quest_xp_bonus_percent", "show_session_text", "reset_session_on_reload",
    "show_played_time_text", "show_leveling_text", "show_rested_text", "show_quest_text", "show_incomplete_quest_xp",
    "show_at_max_level", "native_xpbar", "native_bagbar", "quest_debug" }) do
  check(options[key], "keeps the " .. key .. " option")
end
local code = aura.actions.init.custom
check(not code:find("RegisterForDrag", 1, true) and not code:find("StartBarDrag", 1, true), "no right-drag moving")
check(aura.desc:find("WoW Forever", 1, true), "description says what changed")

-- Mocked Forever client --------------------------------------------------------------------------
local now = 1000
function GetTime() return now end
time, date = os.time, os.date
WOW_PROJECT_ID = 19
local everyFrame, dragScripts = {}, 0
local function frame(kind, parent)
  local f = { shown = true, scripts = {}, parent = parent, kind = kind }
  local m = {}
  function m:Show() self.shown = true end
  function m:Hide() self.shown = false end
  function m:IsShown() return self.shown end
  function m:SetScript(k, fn)
    self.scripts[k] = fn
    if k == "OnUpdate" then everyFrame[self] = fn and true or nil end
    if k == "OnDragStart" or k == "OnDragStop" then dragScripts = dragScripts + 1 end
  end
  function m:GetScript(k) return self.scripts[k] end
  function m:GetParent() return self.parent end
  function m:SetParent(p) self.parent = p end
  function m:CreateTexture() return frame("Texture", self) end
  function m:CreateFontString() return frame("FontString", self) end
  function m:GetFrameLevel() return 1 end
  function m:GetWidth() return 600 end
  function m:GetHeight() return 20 end
  function m:GetEffectiveScale() return 1 end
  function m:IsForbidden() return false end
  return setmetatable(f, { __index = function(_, k) return m[k] or function() end end })
end
local function liveScripts() local n = 0 for _ in pairs(everyFrame) do n = n + 1 end return n end
CreateFrame = function(kind, _, parent) return frame(kind, parent) end
UIParent, StatusTrackingBarManager, BagsBar = frame("Frame"), frame("Frame"), frame("Frame")
GetCursorPosition = function() return 0, 0 end
GetMouseFoci = function() return {} end

local level, xp, maxXP, rested = 20, 2000, 10000, 0
UnitLevel = function() return level end
UnitXP = function() return xp end
UnitXPMax = function() return maxXP end
GetXPExhaustion = function() return rested end
IsXPUserDisabled = function() return false end
local playedRequests = 0
RequestTimePlayed = function() playedRequests = playedRequests + 1 end

-- Quest log. An argument-less call reads the selected quest, as Blizzard's retail QuestInfo does.
local quests = { [100] = { xp = 1000, complete = true }, [200] = { xp = 500, complete = false }, [300] = { xp = 0, complete = false } }
local log = { { header = "Elwynn" }, { id = 100 }, { id = 200 }, { id = 300 } }
local selected = 0
C_QuestLog = {
  GetNumQuestLogEntries = function()
    local n = 0
    for _, e in ipairs(log) do if e.id then n = n + 1 end end
    return #log, n
  end,
  GetInfo = function(i)
    local e = log[i]
    if not e then return nil end
    if e.header then return { title = e.header, isHeader = true, questID = 0 } end
    return { title = "Quest " .. e.id, questID = e.id, isHeader = false, isHidden = false }
  end,
  GetQuestIDForLogIndex = function(i) return log[i] and log[i].id end,
  IsComplete = function(id) return quests[id] ~= nil and quests[id].complete end,
  ReadyForTurnIn = function(id) return quests[id] ~= nil and quests[id].complete end,
  IsOnQuest = function(id) return quests[id] ~= nil end,
  GetSelectedQuest = function() return selected end,
}
GetQuestLogRewardXP = function(id) local q = quests[id or selected] return q and q.xp or 0, q and q.xp or 0 end
GetNumQuestLeaderBoards = function() local q = quests[selected] return q and 1 or 0 end
GetQuestLogLeaderBoard = function() local q = quests[selected] return "objective", "monster", q and q.complete end

local tickers = {}
C_Timer = {
  NewTicker = function(d, fn) local t = { d = d, fn = fn, live = true } function t:Cancel() self.live = false end tickers[#tickers + 1] = t return t end,
  NewTimer = function(d, fn) local t = { d = d, fn = fn, live = true } function t:Cancel() self.live = false end return t end,
  After = function(_, fn) fn() end,
}
local function live() local n, last = 0 for _, t in ipairs(tickers) do if t.live then n, last = n + 1, t end end return n, last end
local function tick() for _, t in ipairs(tickers) do if t.live then t.fn(t) end end end

local scanned, regionAlive, regionId = {}, true, aura.id
local region = frame("StatusBar", UIParent)
WeakAuras = {
  GetData = function() return { uid = "dhxpv1uid01" } end,
  ScanEvents = function(e) scanned[#scanned + 1] = e end,
  IsOptionsOpen = function() return false end,
  IsPaused = function() return false end,
  GetRegion = function(id) return regionAlive and id == regionId and region or nil end,
}

-- A frame the original version left in the runtime table, still running every frame.
local runtimeKey = "DrHealsXPBarRuntime:dhxpv1uid01"
local leftover = { controllerFrame = frame("Frame"), hoverFrame = frame("Frame") }
leftover.controllerFrame:SetScript("OnUpdate", function() end)
leftover.hoverFrame:SetScript("OnUpdate", function() end)
rawset(_G, runtimeKey, leftover)

local saved = { position = { x = 50, y = -20 } }
local env = init(aura, { region = region, saved = saved })
local rt = rawget(_G, runtimeKey)
local trigger = compile(tr.custom, "trigger")
local states = {}
local function ev(event, ...) aura_env = env now = now + 1 return trigger(states, event, ...) end

-- Setup ------------------------------------------------------------------------------------------
check(liveScripts() == 0, "nothing runs every frame, and the original's leftover frames are stopped")
check(dragScripts == 0, "no drag handlers")
check(env.saved.position == nil, "an old right-drag position no longer overrides the editor")
local n, pulse = live()
check(n == 1 and pulse.d == 1, "one 1 second timer drives the clock texts")

ev("PLAYER_ENTERING_WORLD", true, false)
check(states[""] and states[""].show == true, "the bar shows")
check(rt.questXP.completedQuestXP == 1000 and rt.questXP.incompleteQuestXP == 500,
  "quest XP on login: 1000 completed, 500 incomplete, got " .. rt.questXP.completedQuestXP .. "/" .. rt.questXP.incompleteQuestXP)

-- Quest XP doesn't depend on the selected quest --------------------------------------------------
for _, pick in ipairs({ 100, 200, 300, 0 }) do
  selected = pick
  check(ev("QUEST_LOG_UPDATE") == false, "a quest log update only marks a rescan")
  ev("DHXB_PULSE")
  check(rt.questXP.completedQuestXP == 1000 and rt.questXP.incompleteQuestXP == 500,
    "selected quest " .. pick .. ": still 1000/500, got " .. rt.questXP.completedQuestXP .. "/" .. rt.questXP.incompleteQuestXP)
end
quests[200].complete = true
ev("QUEST_LOG_UPDATE")
check(rt.questXP.completedQuestXP == 1000, "no rescan on the update itself")
ev("DHXB_PULSE")
check(rt.questXP.completedQuestXP == 1500 and rt.questXP.incompleteQuestXP == 0, "the next pulse picks up the finished quest")

log = { { header = "Elwynn" } }
ev("QUEST_LOG_UPDATE") ev("DHXB_PULSE")
check(rt.questXP.completedQuestXP == 1500, "quests under a collapsed header still count")
quests[200] = nil
ev("QUEST_LOG_UPDATE") ev("DHXB_PULSE")
check(rt.questXP.completedQuestXP == 1000, "an abandoned quest drops out")
log = { { header = "Elwynn" }, { id = 100 }, { id = 300 } }

-- Session XP across a level-up, in every event order ---------------------------------------------
local function set(l, x, m) level, xp, maxXP = l, x, m end
local function gained() return rt.session.gainedXP end
set(20, 9900, 10000) ev("PLAYER_XP_UPDATE", "player")
local before = gained()
set(20, 9950, 10000) ev("PLAYER_XP_UPDATE", "player")
check(gained() - before == 50, "a normal gain counts 50")
for _, case in ipairs({
  { "level already updated at PLAYER_LEVEL_UP", function() set(20, 400, 11000) ev("PLAYER_LEVEL_UP", 21) set(21, 400, 11000) ev("PLAYER_XP_UPDATE", "player") end },
  { "XP still old at PLAYER_LEVEL_UP", function() set(20, 9900, 10000) ev("PLAYER_LEVEL_UP", 21) set(21, 400, 11000) ev("PLAYER_XP_UPDATE", "player") end },
  { "XP update before the level changes", function() set(20, 400, 10000) ev("PLAYER_XP_UPDATE", "player") ev("PLAYER_LEVEL_UP", 21) set(21, 400, 11000) ev("PLAYER_XP_UPDATE", "player") end },
}) do
  set(20, 9900, 10000) ev("PLAYER_XP_UPDATE", "player")
  before = gained()
  case[2]()
  check(gained() - before == 500, case[1] .. ": a 500 XP ding counts 500, got " .. (gained() - before))
end
rt.session.paused = true
before = gained()
set(21, 900, 11000) ev("PLAYER_XP_UPDATE", "player")
check(gained() == before, "nothing counts while paused")
rt.session.paused = false
set(21, 1000, 11000) ev("PLAYER_XP_UPDATE", "player")
check(gained() - before == 100, "no jump after unpausing")

-- The timer --------------------------------------------------------------------------------------
scanned = {}
tick()
check(#scanned == 1 and scanned[1] == "DHXB_PULSE", "each tick sends one pulse")
env = init(aura, { region = region, saved = saved })
n = live()
check(n == 1, "running On Init again leaves one timer, got " .. n)
aura_env = env env.dhxbOnHide()
check(live() == 0, "the timer stops when the bar hides")
ev("PLAYER_XP_UPDATE", "player")
check(live() == 1, "and starts again when it shows")
regionAlive = false
scanned = {}
tick()
check(live() == 0 and #scanned == 0, "the timer stops itself once the aura is deleted")
regionAlive = true
ev("PLAYER_XP_UPDATE", "player")

-- Renaming the aura runs On Init again under the new name. The old timer must not be the one left running.
local renamed = setmetatable({ id = "DrHeals XP Bar (renamed)" }, { __index = aura })
regionId = renamed.id
env = init(renamed, { region = region, saved = saved })
scanned = {}
tick()
check(live() == 1 and #scanned == 1, "after a rename the timer keeps pulsing")
ev("PLAYER_XP_UPDATE", "player")

set(60, 0, 0)
ev("PLAYER_LEVEL_UP", 60)
check(states[""].show == false, "hidden at max level")
check(live() == 0, "no timer while hidden")
set(21, 1000, 11000)
ev("PLAYER_XP_UPDATE", "player")

-- Hover menu -------------------------------------------------------------------------------------
local menu = rt.resetMenu
check(menu.left and menu.left.scripts.OnEnter and menu.left.scripts.OnLeave, "reset and pause halves exist")
menu.left.scripts.OnEnter()
check(menu.open == true, "hovering opens the menu")
check(liveScripts() == 0, "an open menu doesn't poll")
menu.left.scripts.OnLeave()
check(menu.open == false, "leaving closes it")
check(dragScripts == 0, "still no drag handlers")
`);
