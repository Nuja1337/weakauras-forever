local env = aura_env

local PULSE_EVENT = "DHXB_PULSE"
local PLAYER_UNIT = "player"
local DEBUG_LINE_LIMIT = 6
local QUEST_DEBUG_TITLE_LIMIT = 14
local QUEST_SCAN_INTERVAL = 0.5
local RESET_FRAME_LEVEL_OFFSET = 200
local PLAYED_REQUEST_TIMEOUT = 15
local MAX_LEVEL_STEP, MAX_LEVEL_COUNT = 5, 24
local DEFAULT_MAX_LEVEL_INDEX = 12
local QUEST_SOURCE_AUTO = 1
local QUEST_SOURCE_NATIVE = 2
local QUEST_SOURCE_MODERN = 3
local QUEST_SOURCE_LABELS = {
  [QUEST_SOURCE_AUTO] = "Auto",
  [QUEST_SOURCE_NATIVE] = "3.3.5a Native",
  [QUEST_SOURCE_MODERN] = "Modern Client",
}

local function NormalizeQuestXPSource(value)
  if type(value) == "number" then
    local source = math.floor(value)
    if source == QUEST_SOURCE_AUTO
        or source == QUEST_SOURCE_NATIVE
        or source == QUEST_SOURCE_MODERN then
      return source
    end
  elseif type(value) == "string" then
    local normalized = value:lower():gsub("%s+", ""):gsub("%.", "")
    if normalized == "1" or normalized == "auto" then
      return QUEST_SOURCE_AUTO
    end
    if normalized == "2" or normalized == "335a"
        or normalized == "335native" or normalized == "335anative"
        or normalized == "335aclient" or normalized == "native"
        or normalized == "wotlk" then
      return QUEST_SOURCE_NATIVE
    end
    if normalized == "3"
        or normalized == "modern" or normalized == "modernclient"
        or normalized == "retail" or normalized == "tbc"
        or normalized == "tbcanniversary" or normalized == "classic" then
      return QUEST_SOURCE_MODERN
    end
  end
  return QUEST_SOURCE_AUTO
end
local Clock, WallClock = GetTime, time

local function AsTable(value)
  return type(value) == "table" and value or {}
end

-- Saved data survives /reload; runtime data survives OPTIONS and aura renames.
local auraData = WeakAuras
  and type(WeakAuras.GetData) == "function"
  and WeakAuras.GetData(env.id)
local runtimeId = auraData and auraData.uid or env.id
local runtimeKey = "DrHealsXPBarRuntime:" .. tostring(runtimeId)
local oldRuntimeKey = "DrHealsXPBarRuntime:" .. tostring(env.id)
local runtime = rawget(_G, runtimeKey)
if type(runtime) ~= "table" then runtime = rawget(_G, oldRuntimeKey) end
runtime = AsTable(runtime)
rawset(_G, runtimeKey, runtime)
if oldRuntimeKey ~= runtimeKey then rawset(_G, oldRuntimeKey, nil) end

local cache, resetMenu = AsTable(runtime.cache), AsTable(runtime.resetMenu)
runtime.cache, runtime.resetMenu = cache, resetMenu
resetMenu.open = false

env.config, env.saved = AsTable(env.config), AsTable(env.saved)

local displayText = AsTable(env.displayText)
env.displayText = displayText
displayText.levelText = displayText.levelText or "Level --"
displayText.barXPText = displayText.barXPText or "0 / 0"
displayText.barPercentText = displayText.barPercentText or "0.0%"
displayText.levelingText = displayText.levelingText or ""
displayText.detailText = displayText.detailText or ""
displayText.debugText = displayText.debugText or ""
displayText.totalPlayedText = displayText.totalPlayedText or ""
displayText.sessionStatsText = displayText.sessionStatsText or "Time this session: 0s | +0 XP"

-- Normalize persisted/runtime models on every init so code updates stay safe.
local playedTime = AsTable(env.saved.playedTime)
local playedInitialized = playedTime.initialized
env.saved.playedTime = playedTime
playedTime.initialized = playedInitialized == true
  or (playedInitialized == nil and playedTime.totalPlayedSeconds ~= nil)
playedTime.totalPlayedSeconds = tonumber(playedTime.totalPlayedSeconds) or 0
playedTime.levelPlayedSeconds = tonumber(playedTime.levelPlayedSeconds) or 0

local playedRuntime = AsTable(runtime.playedRuntime)
runtime.playedRuntime = playedRuntime
playedRuntime.requested = playedRuntime.requested == true
playedRuntime.requestAt = tonumber(playedRuntime.requestAt) or 0
playedRuntime.requestFailed = playedRuntime.requestFailed == true
playedRuntime.sampleAt = tonumber(playedRuntime.sampleAt) or 0
if playedTime.initialized ~= true then
  playedRuntime.sampleAt = 0
  playedRuntime.requested = false
  playedRuntime.requestAt = 0
end

local questXP = AsTable(runtime.questXP)
runtime.questXP = questXP
questXP.rawCompletedXP = tonumber(questXP.rawCompletedXP) or 0
questXP.rawIncompleteXP = tonumber(questXP.rawIncompleteXP) or 0
questXP.completedQuestXP = tonumber(questXP.completedQuestXP) or 0
questXP.incompleteQuestXP = tonumber(questXP.incompleteQuestXP) or 0
questXP.scannedQuestCount = tonumber(questXP.scannedQuestCount) or 0
questXP.questLogEntries = tonumber(questXP.questLogEntries) or 0
questXP.lastScanAt = tonumber(questXP.lastScanAt) or 0
questXP.lastScanText = type(questXP.lastScanText) == "string" and questXP.lastScanText or "--"
questXP.debugQuestText = type(questXP.debugQuestText) == "string" and questXP.debugQuestText or ""
questXP.hasScan = questXP.hasScan == true
questXP.lastModern = questXP.lastModern == true

local session = type(runtime.session) == "table" and runtime.session or nil
if not session and env.config.reset_session_on_reload ~= true
    and type(env.saved.session) == "table" then
  local saved = env.saved.session
  local now = Clock()
  local paused = saved.paused == true
  local savedAt = tonumber(saved.savedAt) or now
  local endTime = paused and (tonumber(saved.pausedAt) or savedAt) or savedAt
  local duration = math.max(0, endTime - (tonumber(saved.startTime) or endTime))
  session = saved
  session.startTime = now - duration
  if paused then session.pausedAt = now end
end
runtime.session = session
if env.config.reset_session_on_reload == true then env.saved.session = nil end

-- Small, stable helpers.
local function Flag(value)
  return value == true or value == 1
end

local function SetField(target, key, value)
  if target[key] == value then return false end
  target[key] = value
  return true
end

local function ApiFunction(api, name)
  return type(api) == "table" and type(api[name]) == "function" and api[name] or nil
end

local function NonNegativeNumber(value)
  return math.max(0, tonumber(value) or 0)
end

local function StoreSession(now)
  if env.config.reset_session_on_reload == true or not session then
    env.saved.session = nil
    return
  end
  session.savedAt = tonumber(now) or Clock()
  env.saved.session = session
end

local function FormatNumber(value)
  value = tonumber(value) or 0
  if value >= 1000000 then return string.format("%.1fm", value / 1000000) end
  if value >= 1000 then return string.format("%.1fk", value / 1000) end
  return tostring(math.floor(value))
end

local function FormatBarXP(value)
  return string.format("%.1fk", (tonumber(value) or 0) / 1000)
end

local function FormatTime(seconds)
  seconds = math.floor(tonumber(seconds) or 0)
  local days = math.floor(seconds / 86400)
  local hours = math.floor((seconds % 86400) / 3600)
  local minutes = math.floor((seconds % 3600) / 60)
  local secs = seconds % 60

  if days > 0 then return string.format("%dd %02dh", days, hours) end
  if hours > 0 then return string.format("%dh %02dm", hours, minutes) end
  if minutes > 0 then return string.format("%dm %02ds", minutes, secs) end
  return string.format("%ds", secs)
end

local function Percent(value)
  return string.format("%.1f%%", tonumber(value) or 0)
end

local function MultiplierText(value)
  value = tonumber(value) or 1
  local rounded = math.floor(value * 100 + 0.5) / 100
  if math.abs(rounded - 0.5) < 0.001 then return "x0,5" end
  if math.abs(rounded - math.floor(rounded)) < 0.001 then
    return "x" .. tostring(math.floor(rounded)) .. ",0"
  end
  return "x" .. string.format("%.2f", rounded):gsub("%.", ",")
end

-- Typed WeakAuras author options.
local function ReadOptions(force)
  local options = cache.options
  if options and not force then return options end

  local config = env.config
  options = options or {}
  options.hideNativeXPBar = config.native_xpbar ~= false
  options.hideNativeBagBar = config.native_bagbar ~= false
  options.showSessionText = config.show_session_text ~= false
  options.resetSessionOnReload = config.reset_session_on_reload == true
  if options.resetSessionOnReload then env.saved.session = nil end
  options.showLevelingText = config.show_leveling_text ~= false
  options.showRestedText = config.show_rested_text ~= false
  options.showPlayedTimeText = config.show_played_time_text ~= false
  options.showQuestText = config.show_quest_text ~= false
  options.showIncompleteQuestXP = config.show_incomplete_quest_xp == true
  options.showAtMaxLevel = config.show_at_max_level == true
  options.questDebug = config.quest_debug == true
  local rawQuestSource = config.quest_xp_source
  local questSource = NormalizeQuestXPSource(rawQuestSource)
  options.questXPSource = questSource
  options.questXPSourceText = QUEST_SOURCE_LABELS[questSource] or tostring(questSource)
  options.questXPSourceRaw = tostring(rawQuestSource)

  local maxIndex = math.floor(tonumber(config.max_level) or DEFAULT_MAX_LEVEL_INDEX)
  maxIndex = math.max(1, math.min(MAX_LEVEL_COUNT, maxIndex))
  options.maxLevel = maxIndex * MAX_LEVEL_STEP

  local multiplierIndex = math.floor(tonumber(config.quest_xp_multiplier) or 2)
  local realmMultiplier = multiplierIndex == 1 and 0.5
    or math.max(1, math.min(10, multiplierIndex - 1))

  local bonusPercent = tonumber(config.quest_xp_bonus_percent) or 0
  if bonusPercent < 0 then bonusPercent = 0 end
  if bonusPercent > 250 then bonusPercent = 250 end

  local effectiveMultiplier = realmMultiplier * (1 + bonusPercent / 100)
  local bonusPercentText = string.format("%.2f", bonusPercent)
  bonusPercentText = bonusPercentText:gsub("0+$", ""):gsub("%.$", ""):gsub("%.", ",")

  options.questXPRealmMultiplier = realmMultiplier
  options.questXPBonusPercent = bonusPercent
  options.questXPEffectiveMultiplier = effectiveMultiplier
  options.questXPRealmMultiplierText = MultiplierText(realmMultiplier)
  options.questXPBonusPercentText = "+" .. bonusPercentText .. "%"
  options.questXPEffectiveMultiplierText = MultiplierText(effectiveMultiplier)
  options.needsQuestXP = options.showQuestText or options.showIncompleteQuestXP
    or options.questDebug

  cache.options = options
  return options
end

local function ApplyNativeBarVisibility(options)
  local nativeBar = StatusTrackingBarManager or MainMenuExpBar
  if not nativeBar then return end
  if options and options.hideNativeXPBar == false then nativeBar:Show()
  else nativeBar:Hide() end
end

-- Cloned from the Blizzard XP-bar toggle; do not hide the micro menu.
local function ApplyNativeBagBarVisibility(options)
  local bagBar = BagsBar
  if bagBar then
    if options and options.hideNativeBagBar == false then bagBar:Show()
    else bagBar:Hide() end
    return
  end

  -- Fallback for 3.3.5a and clients without a dedicated BagsBar frame.
  local bagButtons = {
    MainMenuBarBackpackButton, CharacterBag0Slot, CharacterBag1Slot,
    CharacterBag2Slot, CharacterBag3Slot,
  }
  for _, bagButton in ipairs(bagButtons) do
    if bagButton then
      if options and options.hideNativeBagBar == false then bagButton:Show()
      else bagButton:Hide() end
    end
  end
end

local function ReadPlayerUnitNumber(func)
  return type(func) == "function" and NonNegativeNumber(func(PLAYER_UNIT)) or 0
end

local function ReadPlayerXPDisabled()
  local reader = ApiFunction(C_PlayerInfo, "IsXPUserDisabled")
    or (type(IsXPUserDisabled) == "function" and IsXPUserDisabled)
  return Flag(reader and reader())
end

local function ReadPlayerState(options, levelOverride)
  local player = cache.playerState or {}
  cache.playerState = player

  player.currentXP, player.maxXP, player.level, player.restedXP, player.xpDisabled =
    ReadPlayerUnitNumber(UnitXP), ReadPlayerUnitNumber(UnitXPMax),
    levelOverride ~= nil and NonNegativeNumber(levelOverride)
      or ReadPlayerUnitNumber(UnitLevel),
    type(GetXPExhaustion) == "function" and NonNegativeNumber(GetXPExhaustion()) or 0,
    ReadPlayerXPDisabled()

  player.isAtMaxLevel = player.level >= options.maxLevel
  player.hasUsableXPData = player.isAtMaxLevel or player.maxXP > 0
  return player
end

local function Refresh() WeakAuras.ScanEvents(PULSE_EVENT) end

local function QuestLogFunction(name)
  return ApiFunction(C_QuestLog, name)
end

local function ReadNativeQuestLogEntry(index)
  if type(GetQuestLogTitle) ~= "function" then return nil end

  local title, _, _, raw4, raw5, raw6, raw7, raw8, raw9 =
    GetQuestLogTitle(index)
  if not title then return nil end

  local explicitID = type(GetQuestLogQuestID) == "function"
    and (NonNegativeNumber(GetQuestLogQuestID(index))) or 0
  local raw8Number = NonNegativeNumber(raw8)
  local privateLayout = raw9 ~= nil
    or (explicitID > 0 and raw8Number ~= explicitID)

  if privateLayout then
    return title, Flag(raw5), raw7, raw9 or explicitID
  end
  return title, Flag(raw4), raw6, raw8 or explicitID
end

local function GetQuestLogEntryCount(useModern)
  local getCount = useModern and QuestLogFunction("GetNumQuestLogEntries") or nil
  if getCount then return NonNegativeNumber(getCount()) end
  return type(GetNumQuestLogEntries) == "function"
    and NonNegativeNumber(GetNumQuestLogEntries()) or 0
end

local function FindQuestIDFromLink(index)
  if type(GetQuestLink) ~= "function" then return 0 end
  local link = GetQuestLink(index)
  return link and NonNegativeNumber(link:match("quest:(%d+)")) or 0
end

local function SelectQuestLogEntrySafe(index)
  if type(SelectQuestLogEntry) == "function" then
    SelectQuestLogEntry(index)
  end
end

local function IsNativeQuestCompleted(questID, completeFlag)
  if Flag(completeFlag) then return true end
  questID = NonNegativeNumber(questID)
  if questID <= 0 then return false end

  if type(IsQuestComplete) == "function"
      and Flag(IsQuestComplete(questID)) then
    return true
  end
  if type(QuestReadyForTurnIn) == "function"
      and Flag(QuestReadyForTurnIn(questID)) then
    return true
  end
  return false
end

local function GetQuestRewardXP(index, questID, preferID)
  if type(GetQuestLogRewardXP) ~= "function" then return 0 end
  questID = NonNegativeNumber(questID)

  if preferID and questID > 0 then
    local xp = NonNegativeNumber(GetQuestLogRewardXP(questID))
    if xp > 0 then return xp end
  end

  SelectQuestLogEntrySafe(index)
  local xp = NonNegativeNumber(GetQuestLogRewardXP())
  if xp > 0 or questID <= 0 then return xp end
  return NonNegativeNumber(GetQuestLogRewardXP(questID))
end

local function GetModernQuestData(index)
  local questID, title, titleQuestID = 0, nil, 0

  if type(GetQuestLogTitle) == "function" then
    local rawTitle, _, _, _, _, _, _, rawQuestID = GetQuestLogTitle(index)
    title = rawTitle
    titleQuestID = NonNegativeNumber(rawQuestID)
  end

  local getQuestID = QuestLogFunction("GetQuestIDForLogIndex")
  if getQuestID then
    questID = NonNegativeNumber(getQuestID(index))
  end

  local getInfo = QuestLogFunction("GetInfo")
  if getInfo then
    local info = getInfo(index)
    if type(info) == "table" then
      if not title then title = info.title end
      if questID <= 0 then questID = NonNegativeNumber(info.questID) end
    end
  end

  if questID <= 0 and type(GetQuestLogQuestID) == "function" then
    questID = NonNegativeNumber(GetQuestLogQuestID(index))
  end

  if questID <= 0 then questID = titleQuestID end
  return questID, title
end

local function HasModernRuntime()
  return type(WOW_PROJECT_ID) == "number"
end

local function UseModernQuestLog(source)
  source = NormalizeQuestXPSource(source)
  if source == QUEST_SOURCE_NATIVE then return false end
  return source == QUEST_SOURCE_MODERN or HasModernRuntime()
end

local function AreSelectedQuestObjectivesComplete()
  if type(GetNumQuestLeaderBoards) ~= "function"
      or type(GetQuestLogLeaderBoard) ~= "function" then
    return nil, "no-objective-api"
  end

  local rawCount = GetNumQuestLeaderBoards()
  local objectiveCount = NonNegativeNumber(rawCount)
  if objectiveCount <= 0 then
    return nil, "no-objectives"
  end

  for objectiveIndex = 1, objectiveCount do
    local _, _, isDone = GetQuestLogLeaderBoard(objectiveIndex)
    if not Flag(isDone) then
      return false, "objective-open"
    end
  end

  return true, "objectives-complete"
end

local function GetCompletionReason(func, questID, prefix)
  if not func then return nil end
  local result = func(questID)
  return Flag(result) and (prefix .. tostring(result)) or nil
end

local function GetModernQuestCompletion(questID, completeFlag)
  questID = NonNegativeNumber(questID)
  if questID <= 0 then return false, "no-id" end

  local objectiveComplete, objectiveReason = AreSelectedQuestObjectivesComplete()
  if objectiveComplete == false then return false, objectiveReason end

  local reason = GetCompletionReason(QuestLogFunction("ReadyForTurnIn"),
    questID, "c-ready=")
    or GetCompletionReason(QuestLogFunction("IsComplete"),
      questID, "c-complete=")
  if reason then return true, reason end

  if objectiveComplete == true then return true, objectiveReason end
  if Flag(completeFlag) then
    return true, "selected-complete=" .. tostring(completeFlag)
  end

  return false, objectiveReason or "open"
end

local function SaveQuestLogSelection()
  return type(GetQuestLogSelection) == "function"
    and NonNegativeNumber(GetQuestLogSelection()) or 0
end

local function RestoreQuestLogSelection(index)
  if index > 0 then SelectQuestLogEntrySafe(index) end
end

local function AddQuestDebugRow(rows, index, title, questID, xp, source, completed, extra)
  if not rows or #rows >= DEBUG_LINE_LIMIT then return end
  title = tostring(title or "")
  local shortTitle = #title > QUEST_DEBUG_TITLE_LIMIT
    and title:sub(1, QUEST_DEBUG_TITLE_LIMIT) or title
  rows[#rows + 1] = tostring(index)
    .. ":" .. shortTitle
    .. " id=" .. tostring(questID)
    .. " xp=" .. tostring(xp)
    .. " src=" .. source
    .. " c=" .. tostring(completed)
    .. extra
end

local function ReadModernQuestEntry(index)
  SelectQuestLogEntrySafe(index)

  local questID, title = GetModernQuestData(index)
  if questID <= 0 then return false end

  local _nativeTitle, _isHeader, completeFlag = ReadNativeQuestLogEntry(index)
  local rewardXP = GetQuestRewardXP(index, questID, true)
  local completed, completeReason = GetModernQuestCompletion(questID, completeFlag)
  return true, title or ("Quest " .. tostring(questID)), questID,
    rewardXP, completed, " cr=" .. tostring(completeReason)
end

local function ReadNativeQuestEntry(index)
  local title, isHeader, completeFlag, questID = ReadNativeQuestLogEntry(index)
  if not title or isHeader then return false end

  questID = NonNegativeNumber(questID)
  if questID <= 0 then questID = FindQuestIDFromLink(index) end

  local rewardXP = GetQuestRewardXP(index, questID, false)
  local completed = IsNativeQuestCompleted(questID, completeFlag)
  return true, title, questID, rewardXP, completed,
    " f=" .. tostring(completeFlag)
end

local function ScanQuestEntries(captureDebug, entries, source, readEntry)
  entries = NonNegativeNumber(entries)
  local completedBase, openBase, scanned = 0, 0, 0
  local debugRows = captureDebug and {} or nil
  local savedSelection = SaveQuestLogSelection()

  for index = 1, entries do
    local ok, title, questID, rewardXP, completed, extra = readEntry(index)
    if ok then
      rewardXP = NonNegativeNumber(rewardXP)
      scanned = scanned + 1
      if completed then
        completedBase = completedBase + rewardXP
      else
        openBase = openBase + rewardXP
      end
      AddQuestDebugRow(debugRows, index, title, questID, rewardXP,
        source, completed, extra)
    end
  end

  RestoreQuestLogSelection(savedSelection)
  return completedBase, openBase, scanned, entries,
    debugRows and table.concat(debugRows, "\n") or ""
end

local function ScanQuestLog(captureDebug, source)
  local modern = UseModernQuestLog(source)
  questXP.lastModern = modern
  return ScanQuestEntries(captureDebug, GetQuestLogEntryCount(modern),
    modern and "modern" or "native",
    modern and ReadModernQuestEntry or ReadNativeQuestEntry)
end

local function UpdateQuestXP(options)
  if runtime.questXPDirty then
    local scanAt = Clock()
    if questXP.lastScanAt <= 0
        or scanAt < questXP.lastScanAt
        or (scanAt - questXP.lastScanAt) >= QUEST_SCAN_INTERVAL then
      local completed, incomplete, scanned, entries, debugText =
        ScanQuestLog(options.questDebug, options.questXPSource)

      questXP.rawCompletedXP = NonNegativeNumber(completed)
      questXP.rawIncompleteXP = NonNegativeNumber(incomplete)
      questXP.scannedQuestCount = NonNegativeNumber(scanned)
      questXP.questLogEntries = NonNegativeNumber(entries)
      questXP.debugQuestText = type(debugText) == "string" and debugText or ""
      questXP.lastScanAt = scanAt
      if options.questDebug then
        local scanTime = WallClock()
        questXP.lastScanText = (scanTime > 0 and date)
          and date("%H:%M:%S", scanTime) or tostring(scanTime)
      end
      questXP.hasScan = true
      runtime.questXPDirty = nil
    end
  end

  local effectiveMultiplier = tonumber(options.questXPEffectiveMultiplier) or 1
  questXP.completedQuestXP = math.floor(
    questXP.rawCompletedXP * effectiveMultiplier + 0.5
  )
  questXP.incompleteQuestXP = math.floor(
    questXP.rawIncompleteXP * effectiveMultiplier + 0.5
  )
end

-- Session and /played state machines.
local function UpdateSession(now, player, mode)
  if session then
    session.startTime = tonumber(session.startTime) or now
    session.gainedXP = NonNegativeNumber(session.gainedXP)
    session.paused = session.paused == true
    session.pausedAt = session.paused and (tonumber(session.pausedAt) or now) or nil
    session.hasXPBaseline = session.hasXPBaseline == true
  end

  if mode == "reset" or not session then
    session = {
      startTime = now,
      gainedXP = 0,
      paused = false,
      lastLevel = player.level,
      hasXPBaseline = false,
    }
    runtime.session = session
  elseif mode == "gain" and not session.paused and session.hasXPBaseline then
    local previousLevel = tonumber(session.lastLevel) or player.level
    local previousXP = tonumber(session.lastXP) or player.currentXP
    local previousMax = tonumber(session.maxXP) or player.maxXP
    local gained = 0
    if player.level > previousLevel then
      gained = math.max(0, previousMax - previousXP + player.currentXP)
    elseif player.level == previousLevel and player.currentXP >= previousXP then
      gained = player.currentXP - previousXP
    end
    if gained > 0 then session.gainedXP = session.gainedXP + gained end
  end

  if mode or not session.hasXPBaseline then
    local hasXP = player.maxXP > 0
    session.lastLevel, session.lastXP, session.maxXP, session.hasXPBaseline =
      player.level, hasXP and player.currentXP or nil, hasXP and player.maxXP or nil, hasXP
  end
  StoreSession(now)
end

local function ClearPlayedRequest()
  playedRuntime.requested, playedRuntime.requestAt, playedRuntime.requestFailed =
    false, 0, false
end

local function RequestPlayed(now, reset, enabled, optionsOpen)
  if reset then
    ClearPlayedRequest()
  elseif playedRuntime.requested
      and (now - playedRuntime.requestAt) >= PLAYED_REQUEST_TIMEOUT then
    playedRuntime.requested, playedRuntime.requestFailed = false, true
  end

  if not enabled or optionsOpen or playedRuntime.requested or playedRuntime.requestFailed
      or (playedTime.initialized == true and playedRuntime.sampleAt > 0 and not reset)
      or (WeakAuras.IsPaused and WeakAuras.IsPaused()) then
    return
  end
  if type(RequestTimePlayed) ~= "function" then
    playedRuntime.requestFailed = true
    return
  end

  playedRuntime.requested, playedRuntime.requestAt, playedRuntime.requestFailed =
    true, now, false
  RequestTimePlayed()
end

local function UpdatePulseState(options)
  local frame = runtime.controllerFrame
  if not frame then return end

  options = options or ReadOptions()
  local shouldRun = not not (cache.xpDataPending or resetMenu.optionsOpen or (
    cache.displayActive ~= false and (
      (runtime.questXPDirty and options.needsQuestXP)
      or options.showPlayedTimeText
      or (not (session and session.paused)
        and (options.showSessionText or options.showLevelingText))
    )
  ))
  if cache.pulseActive == shouldRun then return end

  cache.pulseActive = shouldRun
  if shouldRun then frame:Show() else frame:Hide() end
end

-- Reset/Pause is an independent UI overlay, not part of the TSU state.
local function SetControlVisible(control, visible)
  if not control then return end
  control:EnableMouse(not not visible)
  if visible then control:Show() else control:Hide() end
end

local function HideResetUI()
  SetControlVisible(resetMenu.left, false); SetControlVisible(resetMenu.right, false); SetControlVisible(resetMenu.button, false)
  if runtime.hoverFrame then runtime.hoverFrame:Hide() end
  resetMenu.hoverOutsideSince = nil
end

local AttachResetUI

local RESET_R, RESET_G, RESET_B = 0, 0.14509804546833, 0.7607843875885
local PAUSE_R, PAUSE_G, PAUSE_B = 0.64313727617264, 0.64313727617264, 0.64313727617264
local PAUSED_R, PAUSED_G, PAUSED_B = 1, 0.69411766529083, 0
local COMPLETE_TEXT_COLOR = "|cFFFF9700"
local INCOMPLETE_TEXT_COLOR = "|cFFFFD24F"
local RESTED_TEXT_COLOR = "|cFF4F90FF"
local PAUSED_TEXT_COLOR = "|cFFFFB100"
local COLOR_END = "|r"

local function SetResetActionColor(button, r, g, b)
  if button and button.dhxbBackground then button.dhxbBackground:SetVertexColor(r, g, b, 1) end
end

local function UpdateResetMenuLabels()
  local paused, right = session and session.paused, resetMenu.right
  if right and right.dhxbLabel then
    right.dhxbLabel:SetText(paused and "Unpause Session" or "Pause Session")
  end
  SetResetActionColor(resetMenu.left, RESET_R, RESET_G, RESET_B)
  SetResetActionColor(right, paused and PAUSED_R or PAUSE_R,
    paused and PAUSED_G or PAUSE_G, paused and PAUSED_B or PAUSE_B)
end

-- Mouse focus, not just mouse coordinates, determines which UI receives hover.
-- This avoids retaining the buttons while another addon's overlay covers them.
local HOVER_CHECK_INTERVAL, HOVER_CLOSE_GRACE = 0.10, 0.15

local function MouseInsideClient()
  if type(GetCursorPosition) ~= "function" or not UIParent
      or not UIParent.GetWidth or not UIParent.GetHeight then return true end
  local x, y = GetCursorPosition()
  if not x or not y then return false end
  local scale = UIParent.GetEffectiveScale and UIParent:GetEffectiveScale() or 1
  if not scale or scale <= 0 then scale = 1 end
  x, y = x / scale, y / scale
  return x >= 0 and y >= 0
    and x <= UIParent:GetWidth() and y <= UIParent:GetHeight()
end

local function MouseInsideResetUI()
  if resetMenu.dragging then return true end
  if not MouseInsideClient() then return false end

  local focus
  if type(GetMouseFoci) == "function" then
    local foci = GetMouseFoci()
    if type(foci) == "table" then focus = foci[1]
    else focus = foci end
  end
  if not focus and type(GetMouseFocus) == "function" then
    focus = GetMouseFocus()
  end

  if focus then
    -- Textures/font strings can be the focus; follow parent frames.
    local depth = 0
    while focus and depth < 32 do
      if focus == resetMenu.button or focus == resetMenu.left
          or focus == resetMenu.right then return true end
      if not focus.GetParent then break end
      focus = focus:GetParent()
      depth = depth + 1
    end
    return false
  end
  -- If the focus API exists but reports nothing, the menu isn't hovered.
  if type(GetMouseFoci) == "function" or type(GetMouseFocus) == "function" then
    return false
  end
  -- Legacy client fallback; only used when no focus API exists.
  return type(MouseIsOver) == "function" and (
    (resetMenu.button and MouseIsOver(resetMenu.button))
    or (resetMenu.left and MouseIsOver(resetMenu.left))
    or (resetMenu.right and MouseIsOver(resetMenu.right))) or false
end

local function SetResetMenuOpen(open)
  resetMenu.open = not not open
  resetMenu.hoverOutsideSince = nil
  UpdateResetMenuLabels()
  AttachResetUI()
  UpdatePulseState()

  local hoverFrame = runtime.hoverFrame
  if resetMenu.open and not hoverFrame then
    hoverFrame = CreateFrame("Frame")
    runtime.hoverFrame = hoverFrame
    hoverFrame:SetScript("OnUpdate", function(self, elapsed)
      self.elapsed = (self.elapsed or 0) + (elapsed or 0)
      if self.elapsed < HOVER_CHECK_INTERVAL then return end
      self.elapsed = self.elapsed % HOVER_CHECK_INTERVAL
      if not resetMenu.open then self:Hide(); return end
      if MouseInsideResetUI() then
        resetMenu.hoverOutsideSince = nil
      else
        local now = Clock()
        if not resetMenu.hoverOutsideSince then
          resetMenu.hoverOutsideSince = now
        elseif now - resetMenu.hoverOutsideSince >= HOVER_CLOSE_GRACE then
          SetResetMenuOpen(false)
        end
      end
    end)
  end
  if hoverFrame then
    hoverFrame.elapsed = 0
    if resetMenu.open then hoverFrame:Show() else hoverFrame:Hide() end
  end
end

local function CloseResetMenuIfOutside()
  if not resetMenu.open then return end
  if MouseInsideResetUI() then
    resetMenu.hoverOutsideSince = nil
  else
    resetMenu.hoverOutsideSince = resetMenu.hoverOutsideSince or Clock()
  end
end

local function ToggleSessionPaused(now)
  if not session then return end
  if session.paused then
    session.startTime = (tonumber(session.startTime) or now)
      + math.max(0, now - (tonumber(session.pausedAt) or now))
    session.paused, session.pausedAt = false, nil
  else
    session.paused, session.pausedAt = true, now
  end
  StoreSession(now)
end

local function HandleResetAction(control, button)
  if not resetMenu.open or button ~= "LeftButton" then return end

  local now, action = Clock(), control and control.dhxbAction
  if action == "reset" then
    UpdateSession(now, ReadPlayerState(ReadOptions()), "reset")
  elseif action == "pause" then
    ToggleSessionPaused(now)
  end
  UpdateResetMenuLabels()
  Refresh()
end

local function CreateResetAction(parent, action)
  local isReset = action == "reset"
  local button = CreateFrame("Button", nil, parent)
  button.dhxbAction = action

  local background = button:CreateTexture(nil, "ARTWORK")
  background:SetTexture("Interface\\BUTTONS\\WHITE8X8")
  background:SetAllPoints(button)
  button.dhxbBackground = background

  local label = button:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  local lib = LibStub and LibStub("LibSharedMedia-3.0", true)
  label:SetFont((lib and lib.Fetch and lib:Fetch("font", "Expressway", true))
    or STANDARD_TEXT_FONT or "Fonts\\FRIZQT__.TTF", 14, "OUTLINE")
  label:SetTextColor(1, 1, 1, 1)
  label:SetShadowColor(0, 0, 0, 1)
  label:SetShadowOffset(1, -1)
  label:SetPoint("CENTER", button, "CENTER", 0, 1)
  label:SetText(isReset and "Reset Session" or "Pause Session")
  button.dhxbLabel = label
  SetResetActionColor(button, isReset and RESET_R or PAUSE_R,
    isReset and RESET_G or PAUSE_G, isReset and RESET_B or PAUSE_B)

  SetControlVisible(button, false)
  return button
end

local function IsAuraFrame(frame)
  return frame and frame.GetLeft and frame.GetRight
    and frame.GetTop and frame.GetBottom and frame.SetPoint
end

local function StartBarDrag(_, button)
  if button ~= "RightButton" then return end
  local target = resetMenu.target
  if not IsAuraFrame(target) or not target.SetMovable or not target.StartMoving then return end
  target:SetMovable(true)
  if target.SetClampedToScreen then target:SetClampedToScreen(true) end
  target:StartMoving()
  resetMenu.dragging = true
end

local function StopBarDrag()
  if not resetMenu.dragging then return end
  resetMenu.dragging = false

  local target = resetMenu.target
  if not IsAuraFrame(target) or not target.StopMovingOrSizing then return end
  target:StopMovingOrSizing()
  if not target.GetCenter or not UIParent then return end

  local x, y = target:GetCenter()
  local ux, uy = UIParent:GetCenter()
  if not x or not y or not ux or not uy then return end
  env.saved.position = env.saved.position or {}
  env.saved.position.x, env.saved.position.y = x - ux, y - uy
end

local function BindResetControl(control, onMouseUp)
  if not control then return end
  control:SetScript("OnEnter", function() SetResetMenuOpen(true) end)
  control:SetScript("OnLeave", CloseResetMenuIfOutside)
  control:SetScript("OnMouseUp", onMouseUp)
  control:SetScript("OnDragStart", StartBarDrag)
  control:SetScript("OnDragStop", StopBarDrag)
  if control.RegisterForDrag then control:RegisterForDrag("RightButton") end
end

function AttachResetUI()
  local target = IsAuraFrame(env.region) and env.region
  if not target and WeakAuras and type(WeakAuras.GetRegion) == "function"
      and env.id then
    target = WeakAuras.GetRegion(env.id, env.cloneId)
    if not IsAuraFrame(target) and env.cloneId then target = WeakAuras.GetRegion(env.id) end
  end
  if not IsAuraFrame(target) then HideResetUI(); return end

  resetMenu.target = target
  if not resetMenu.dragging then
    local pos = env.saved and env.saved.position
    if type(pos) == "table" and UIParent then
      target:ClearAllPoints()
      target:SetPoint("CENTER", UIParent, "CENTER", tonumber(pos.x) or 0, tonumber(pos.y) or 0)
    end
  end

  local overlay, left, right = resetMenu.button, resetMenu.left, resetMenu.right
  if not overlay then
    overlay = CreateFrame("Button", nil, target)
    left, right = CreateResetAction(overlay, "reset"), CreateResetAction(overlay, "pause")
    resetMenu.button, resetMenu.left, resetMenu.right = overlay, left, right
    left:SetPoint("TOPLEFT", overlay, "TOPLEFT", 0, 0)
    left:SetPoint("BOTTOMRIGHT", overlay, "BOTTOM", 0, 0)
    right:SetPoint("TOPLEFT", overlay, "TOP", 0, 0)
    right:SetPoint("BOTTOMRIGHT", overlay, "BOTTOMRIGHT", 0, 0)
  end

  if overlay:GetParent() ~= target then overlay:SetParent(target) end
  BindResetControl(overlay, nil)
  BindResetControl(left, HandleResetAction)
  BindResetControl(right, HandleResetAction)
  overlay:ClearAllPoints()
  overlay:SetAllPoints(target)
  overlay:SetFrameStrata("TOOLTIP")
  left:SetFrameStrata("TOOLTIP")
  right:SetFrameStrata("TOOLTIP")
  local level = (target:GetFrameLevel() or 0) + RESET_FRAME_LEVEL_OFFSET
  overlay:SetFrameLevel(level)
  left:SetFrameLevel(level + 1)
  right:SetFrameLevel(level + 1)
  UpdateResetMenuLabels()
  SetControlVisible(overlay, true)
  SetControlVisible(left, resetMenu.open)
  SetControlVisible(right, resetMenu.open)
end

-- Display text and TSU state are built separately for easier auditing.
local function JoinText(left, right)
  if left ~= "" and right ~= "" then return left .. " | " .. right end
  return left ~= "" and left or right
end

local function FormatXPLine(label, color, xp, percent)
  return label .. ": " .. color .. FormatNumber(xp)
    .. " (" .. Percent(percent) .. ")" .. COLOR_END
end

local function BuildDetailText(options, completedXP, incompleteXP, restedXP, maxXP, percentCompleted)
  local percentIncomplete = maxXP > 0 and incompleteXP / maxXP * 100 or 0
  local percentRested = maxXP > 0 and restedXP / maxXP * 100 or 0

  local questText = ""
  if options.showQuestText or options.showIncompleteQuestXP then
    local completed = options.showQuestText and completedXP > 0
      and FormatXPLine("Completed", COMPLETE_TEXT_COLOR, completedXP, percentCompleted) or ""
    local incomplete = options.showIncompleteQuestXP and incompleteXP > 0
      and FormatXPLine("Incomplete", INCOMPLETE_TEXT_COLOR, incompleteXP, percentIncomplete) or ""
    questText = JoinText(completed, incomplete)
    if questText == "" then questText = "Quests: 0" end
  end

  local restedText = ""
  if options.showRestedText then
    restedText = restedXP > 0
      and FormatXPLine("Rested", RESTED_TEXT_COLOR, restedXP, percentRested)
      or "Rested: --"
  end
  local detailText = JoinText(questText, restedText)

  local debugText = ""
  if options.questDebug then
    local rows = (questXP.debugQuestText or "") ~= ""
      and questXP.debugQuestText or "no quest rows captured"
    debugText =
      "QuestScan: " .. tostring(questXP.lastScanText or "--")
      .. "\nEntries: " .. tostring(questXP.questLogEntries or 0)
      .. " | Scanned: " .. tostring(questXP.scannedQuestCount or 0)
      .. "\nDone: " .. FormatNumber(questXP.completedQuestXP or 0)
      .. " | Open: " .. FormatNumber(questXP.incompleteQuestXP or 0)
      .. " | Total: " .. tostring(options.questXPEffectiveMultiplierText or "x1,0")
      .. "\nRealm: " .. tostring(options.questXPRealmMultiplierText or "x1,0")
      .. " | Bonus: " .. tostring(options.questXPBonusPercentText or "+0%")
      .. "\nSource: " .. tostring(options.questXPSourceText or options.questXPSource or "--")
      .. " | Raw: " .. tostring(options.questXPSourceRaw or "nil")
      .. " | Modern: " .. tostring(questXP.lastModern == true)
      .. " | Project: " .. tostring(WOW_PROJECT_ID or "nil")
      .. "\nRewardAPI: " .. tostring(type(GetQuestLogRewardXP) == "function")
      .. " | ObjectiveAPI: " .. tostring(type(GetNumQuestLeaderBoards) == "function"
        and type(GetQuestLogLeaderBoard) == "function")
      .. "\nSample quests:\n" .. rows
  end
  return detailText, debugText
end

local function BuildPlayedText(now, atMax, enabled)
  if not enabled then return "" end

  if playedTime.initialized == true and playedRuntime.sampleAt > 0 then
    local delta = math.max(0, now - playedRuntime.sampleAt)
    local played = (atMax and playedTime.totalPlayedSeconds
      or playedTime.levelPlayedSeconds) + delta
    return (atMax and "Time played: " or "Time this level: ")
      .. FormatTime(played)
  end
  return playedRuntime.requestFailed and "Time played: unavailable"
    or "Time played: requesting..."
end

local function CommitDisplayState(state, changed, currentXP, maxXP, atMax,
  completedXP, shownIncomplete, restedXP, stateName)
  local stateValue = atMax and 1 or (maxXP > 0 and currentXP or 1)
  local stateTotal = atMax and 1 or (maxXP > 0 and maxXP or 1)
  changed = SetField(state, "show", true) or changed
  changed = SetField(state, "progressType", "static") or changed
  changed = SetField(state, "value", stateValue) or changed
  changed = SetField(state, "total", stateTotal) or changed
  changed = SetField(state, "name", stateName) or changed

  local progress = state.additionalProgress
  if not progress or not progress[1] or not progress[2] or not progress[3] then
    progress = {
      { direction = "forward", width = 0 },
      { direction = "forward", width = 0, offset = 0 },
      { direction = "forward", width = 0, offset = 0 },
    }
    state.additionalProgress = progress
    changed = true
  end

  local progressTotal = not atMax and maxXP > 0 and maxXP or 0
  if progressTotal > 0 then
    completedXP = math.min(NonNegativeNumber(completedXP), progressTotal)
    shownIncomplete = math.min(NonNegativeNumber(shownIncomplete), progressTotal - completedXP)
    restedXP = math.min(NonNegativeNumber(restedXP), progressTotal - completedXP - shownIncomplete)
  else
    completedXP, shownIncomplete, restedXP = 0, 0, 0
  end

  changed = SetField(progress, 4, nil) or changed
  local p1, p2, p3 = progress[1], progress[2], progress[3]
  changed = SetField(p1, "width", completedXP) or changed
  changed = SetField(p1, "offset", nil) or changed
  changed = SetField(p2, "width", shownIncomplete) or changed
  changed = SetField(p2, "offset", completedXP) or changed
  changed = SetField(p3, "width", restedXP) or changed
  changed = SetField(p3, "offset", completedXP + shownIncomplete) or changed
  state.changed = changed
end

local function RenderDisplay(state, options, now, player)
  local currentXP = NonNegativeNumber(player.currentXP)
  local maxXP = NonNegativeNumber(player.maxXP)
  local level = NonNegativeNumber(player.level)
  local atMax = not not player.isAtMaxLevel
  local remainingXP = math.max(0, maxXP - currentXP)
  local completedXP = options.showQuestText
    and NonNegativeNumber(questXP.completedQuestXP) or 0
  local incompleteXP = NonNegativeNumber(questXP.incompleteQuestXP)
  local shownIncomplete = options.showIncompleteQuestXP and incompleteXP or 0
  local restedXP = options.showRestedText
    and NonNegativeNumber(player.restedXP) or 0
  local percentCompleted = maxXP > 0 and completedXP / maxXP * 100 or 0

  local levelText = "Level " .. tostring(level)
  local xpText, barXPText, percentText, barPercentText
  if atMax then
    xpText, barXPText, percentText, barPercentText =
      "Max Level", "Max Level", "100.0%", "100.0%"
  elseif maxXP <= 0 then
    xpText, barXPText, percentText, barPercentText =
      "XP unavailable", "XP unavailable", "--", "--"
  else
    local percentXP = currentXP / maxXP * 100
    xpText = FormatBarXP(currentXP) .. " / " .. FormatBarXP(maxXP)
    percentText = Percent(percentXP)
    barXPText = xpText .. " (" .. FormatBarXP(remainingXP) .. ")"
    barPercentText = completedXP > 0
      and (percentText .. " (" .. Percent(percentXP + percentCompleted) .. ")")
      or percentText
  end

  local detailText, debugText = BuildDetailText(
    options, completedXP, incompleteXP, restedXP, maxXP, percentCompleted)

  local sessionTime = math.max(0,
    ((session.paused and tonumber(session.pausedAt)) or now) - session.startTime)
  local sessionXP = NonNegativeNumber(session.gainedXP)
  local levelingText = ""
  if options.showLevelingText then
    local xpPerHour = not session.paused and sessionTime > 0 and sessionXP > 0
      and math.floor((sessionXP / sessionTime) * 3600 + 0.5) or 0
    if not atMax and remainingXP > 0 and xpPerHour > 0 then
      local timeToLevel = math.max(1, math.floor((remainingXP / xpPerHour) * 3600 + 0.5))
      levelingText = "Leveling in: " .. FormatTime(timeToLevel)
        .. " (" .. FormatNumber(xpPerHour) .. " XP/h)"
    else
      levelingText = "Leveling in: N/A"
    end
  end

  local sessionStatsText = ""
  if options.showSessionText then
    sessionStatsText = "Time this session: " .. FormatTime(sessionTime)
      .. (session.paused and " (Paused)" or "")
      .. " | +" .. FormatNumber(sessionXP) .. " XP"
    if session.paused then
      sessionStatsText = PAUSED_TEXT_COLOR .. sessionStatsText .. COLOR_END
    end
  end

  local changed, text = false, displayText
  changed = SetField(text, "levelText", levelText) or changed
  changed = SetField(text, "barXPText", barXPText) or changed
  changed = SetField(text, "barPercentText", barPercentText) or changed
  changed = SetField(text, "levelingText", levelingText) or changed
  changed = SetField(text, "detailText", detailText) or changed
  changed = SetField(text, "debugText", debugText) or changed
  changed = SetField(text, "totalPlayedText",
    BuildPlayedText(now, atMax, options.showPlayedTimeText)) or changed
  changed = SetField(text, "sessionStatsText", sessionStatsText) or changed

  CommitDisplayState(
    state, changed, currentXP, maxXP, atMax, completedXP, shownIncomplete,
    restedXP, levelText .. "  " .. xpText .. "  " .. percentText
  )
end

local function ProcessEvent(eventName, options, now, player, optionsOpen, ...)
  if eventName == "TIME_PLAYED_MSG" then
    local total, level = ...
    total = tonumber(total) or tonumber(_G and _G.arg1)
    level = tonumber(level) or tonumber(_G and _G.arg2)
    if total and level then
      playedTime.totalPlayedSeconds, playedTime.levelPlayedSeconds =
        math.max(0, total), math.max(0, level)
      playedTime.initialized, playedRuntime.sampleAt = true, now
      ClearPlayedRequest()
    end
  elseif eventName == "PLAYER_ENTERING_WORLD" then
    UpdateSession(now, player, "baseline")
    runtime.questXPDirty = true
  elseif eventName == "PLAYER_XP_UPDATE" then
    UpdateSession(now, player, "gain")
  elseif eventName == "PLAYER_LEVEL_UP" then
    UpdateSession(now, player, "gain")
    if playedTime.initialized == true and playedRuntime.sampleAt > 0 then
      playedTime.totalPlayedSeconds, playedRuntime.sampleAt =
        playedTime.totalPlayedSeconds + math.max(0, now - playedRuntime.sampleAt), now
    end
    playedTime.levelPlayedSeconds = 0
    if options.showPlayedTimeText then RequestPlayed(now, true, true, optionsOpen) end
    runtime.questXPDirty = true
  elseif eventName == "QUEST_LOG_UPDATE" or eventName == "UNIT_QUEST_LOG_CHANGED" then
    runtime.questXPDirty = true
  end
end

-- External WeakAuras custom-trigger entry point.
local function RunTrigger(allstates, eventName, ...)
  local isOptions = eventName == "OPTIONS"
  local optionsOpen = isOptions
    or (WeakAuras and WeakAuras.IsOptionsOpen and WeakAuras.IsOptionsOpen()) == true
  local options = ReadOptions(isOptions)
  local now = Clock()
  if isOptions then
    ApplyNativeBarVisibility(options)
    ApplyNativeBagBarVisibility(options)
    runtime.questXPDirty = true
    questXP.lastScanAt = 0
  end

  local levelOverride = eventName == "PLAYER_LEVEL_UP"
    and (tonumber((...)) or tonumber(_G and _G.arg1)) or nil

  local player = cache.playerState and (
    (eventName == PULSE_EVENT and not cache.xpDataPending)
    or (optionsOpen and cache.playerState.hasUsableXPData)
  ) and cache.playerState or ReadPlayerState(options, levelOverride)
  if optionsOpen then
    player.isAtMaxLevel = player.level >= options.maxLevel
    player.hasUsableXPData = player.isAtMaxLevel or player.maxXP > 0
  end
  ProcessEvent(eventName, options, now, player, optionsOpen, ...)

  local state = allstates[""] or {}
  allstates[""] = state
  local wasActive, wasOptionsOpen = cache.displayActive == true, resetMenu.optionsOpen == true
  resetMenu.optionsOpen = optionsOpen or nil
  if optionsOpen then resetMenu.open = false; HideResetUI() end
  local pendingXP = not player.xpDisabled and not player.hasUsableXPData
  local shouldHide = player.xpDisabled
    or pendingXP
    or (player.isAtMaxLevel and not options.showAtMaxLevel)

  if shouldHide then
    cache.xpDataPending, cache.displayActive, resetMenu.open = pendingXP and true or nil, false, false
    HideResetUI()
    state.changed = SetField(state, "show", false)
    UpdatePulseState(options)
    return not not state.changed
  end

  cache.xpDataPending = nil
  cache.displayActive = true
  if not optionsOpen and (not wasActive or eventName == "PLAYER_ENTERING_WORLD" or wasOptionsOpen) then
    AttachResetUI()
  end

  if options.needsQuestXP and (runtime.questXPDirty or isOptions) then
    UpdateQuestXP(options)
  end
  RequestPlayed(now, false, options.showPlayedTimeText, optionsOpen)
  RenderDisplay(state, options, now, player)
  StoreSession(now)
  UpdatePulseState(options)
  return not not state.changed
end

local function OnControllerUpdate(self, elapsed)
  self.elapsed = (self.elapsed or 0) + (elapsed or 0)
  if self.elapsed < 0.5 then return end

  self.elapsed = self.elapsed % 0.5
  Refresh()
end

local function OnAuraHidden()
  cache.displayActive, resetMenu.open = false, false
  HideResetUI()
  UpdatePulseState()
end

env.dhxbRunTrigger = RunTrigger
env.dhxbOnHide = OnAuraHidden

-- Startup is intentionally linear: initialize models, bind UI, then arm the pulse.
local startupTime = Clock()
local startupOptions = ReadOptions(true)
ApplyNativeBarVisibility(startupOptions)
ApplyNativeBagBarVisibility(startupOptions)
local startupPlayer = ReadPlayerState(startupOptions)
UpdateSession(startupTime, startupPlayer)
if not questXP.hasScan then runtime.questXPDirty = true end
AttachResetUI()

local controller = runtime.controllerFrame
if not controller then
  controller = CreateFrame("Frame")
  runtime.controllerFrame = controller
end
controller.elapsed = 0
controller:SetScript("OnUpdate", OnControllerUpdate)
cache.pulseActive = nil
UpdatePulseState(startupOptions)
