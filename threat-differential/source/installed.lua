-- "Threat Differential on Nameplates", copied from
-- C:\Program Files (x86)\World of Warcraft\_forever_\WTF\Account\<account>\SavedVariables\ForeverAuras.lua (saved 2026-11-08).
WeakAurasSaved = {
  displays = {
    ["Threat Differential on Nameplates"] = {
      actions = {
        finish = {
          do_custom = false,
        },
        init = {
          custom = "aura_env.secureThreatValue = aura_env.config.secureThreatValue\n\naura_env.ThreatFunc = function(unit)\n    local firstUnit, secondUnit\n    local firstThreat, secondThreat = 0, 0\n    local threat, pet\n    for member in WA_IterateGroupMembers() do\n        threat = select(5, UnitDetailedThreatSituation(member, unit))\n        if threat then\n            if threat > firstThreat then\n                secondUnit = firstUnit\n                secondThreat = firstThreat\n                firstUnit = member\n                firstThreat = threat\n            elseif threat > secondThreat then\n                secondUnit = member\n                secondThreat = threat\n            end\n        end\n        \n        pet = member..\"pet\"\n        if UnitExists(pet) then\n            threat = select(5, UnitDetailedThreatSituation(pet, unit))\n            if threat then\n                if threat > firstThreat then\n                    secondUnit = firstUnit\n                    secondThreat = firstThreat\n                    firstUnit = pet\n                    firstThreat = threat\n                elseif threat > secondThreat then\n                    secondUnit = pet\n                    secondThreat = threat\n                end\n            end\n        end\n    end\n    return firstUnit, firstThreat, secondUnit, secondThreat\nend",
          do_custom = true,
        },
        start = {
          custom = "",
          do_custom = false,
        },
      },
      alpha = 1,
      anchorFrameParent = true,
      anchorFrameType = "NAMEPLATE",
      anchorPoint = "LEFT",
      animation = {
        finish = {
          duration_type = "seconds",
          easeStrength = 3,
          easeType = "none",
          type = "none",
        },
        main = {
          alpha = 0,
          colorA = 1,
          colorB = 1,
          colorFunc = "function()    \n    --if not aura_env.state then return 0, 0, 0, 1 end  -- error checking.\n    if aura_env.state.status == 3 then\n        return unpack(aura_env.config[\"color_tanking\"]) -- Reminder: return R, G, B, Alpha (using numbers between 0 and 1)\n    elseif aura_env.state.status == 2 then        \n        return unpack(aura_env.config[\"color_insecure\"])\n    elseif aura_env.state.status == 4  then\n        return unpack(aura_env.config[\"color_others\"])\n    elseif aura_env.state.status <= 1 then\n        return unpack(aura_env.config[\"color_untanked\"])\n    else\n        return 0,0,0,1\n    end \nend",
          colorG = 1,
          colorR = 1,
          colorType = "custom",
          duration_type = "seconds",
          easeStrength = 3,
          easeType = "none",
          rotate = 0,
          scalex = 1,
          scaley = 1,
          type = "none",
          use_color = false,
          x = 0,
          y = 0,
        },
        start = {
          duration_type = "seconds",
          easeStrength = 3,
          easeType = "none",
          type = "none",
        },
      },
      authorOptions = {
        {
          default = 10000,
          desc = "The securely tanking threat differential value.",
          key = "secureThreatValue",
          max = 100000,
          min = 0,
          name = "Secure Threat Target",
          step = 100,
          type = "number",
          useDesc = true,
          width = 1,
        },
      },
      auto = true,
      automaticWidth = "Auto",
      color = {
        1,
        1,
        1,
        1,
      },
      conditions = {
        {
          changes = {
            {
              property = "color",
              value = {
                1,
                0,
                0,
                1,
              },
            },
          },
          check = {
            op = "==",
            trigger = 1,
            value = 1,
            variable = "status",
          },
        },
        {
          changes = {
            {
              property = "color",
              value = {
                1,
                0.50196078431373,
                0,
                1,
              },
            },
          },
          check = {
            op = "==",
            trigger = 1,
            value = 2,
            variable = "status",
          },
        },
        {
          changes = {
            {
              property = "color",
              value = {
                1,
                1,
                0,
                1,
              },
            },
          },
          check = {
            op = "==",
            trigger = 1,
            value = 3,
            variable = "status",
          },
        },
        {
          changes = {
            {
              property = "color",
              value = {
                0,
                0,
                1,
                1,
              },
            },
          },
          check = {
            op = "==",
            trigger = 1,
            value = 4,
            variable = "status",
          },
        },
        {
          changes = {
            {
              property = "color",
              value = {
                0,
                1,
                0,
                1,
              },
            },
          },
          check = {
            op = "==",
            trigger = 1,
            value = 5,
            variable = "status",
          },
        },
      },
      config = {
        secureThreatValue = 10000,
      },
      cooldownEdge = false,
      cooldownSwipe = true,
      cooldownTextDisabled = false,
      customAnchor = "function()\n    if (aura_env.state.unitId) then\n        return C_NamePlate.GetNamePlateForUnit(aura_env.state.unitId)\n    end\nend\n\n\n",
      customText = "function()\n    local value = aura_env.state and aura_env.state.value\n    if value then\n        if value < 1 then\n            return \"!!!\"\n        else\n            return AbbreviateNumbers(value) or value\n        end\n    end\nend",
      customTextUpdate = "event",
      desaturate = false,
      desc = "Shows the threat difference between yourself and the party/raid member with the most threat on enemy nameplates.\n\nColor determined by Tankstatus:\n\"Securely Tanking\" (default: green) - Tanking above the threat threshold\n\"Tanking\" (default: yellow) - Tanking below the threat threshold, but a Tank is second\n\"Insecurely Tanking\" (default: orange, with low warning \"!!!\") - Tanking below the threat threshold, and no Tank is second\n\"Tanked by Other Tank\"  (default: blue) - Tanked by another Tank\n\"Untanked\" (default: red) - No Tank is present\n\nOther Tanks are people marked as \"Main Tank\" in raid, or with the \"TANK\" role.",
      displayText = "%c\n",
      displayText_format_c1_format = "none",
      displayText_format_c2_format = "none",
      displayText_format_c_format = "none",
      displayText_format_displayValue_format = "none",
      displayText_format_formatDiff_format = "none",
      displayText_format_p_format = "timed",
      displayText_format_p_time_dynamic_threshold = 60,
      displayText_format_p_time_format = 0,
      displayText_format_p_time_precision = 1,
      displayText_format_s_format = "none",
      displayText_format_thing_format = "none",
      fixedWidth = 200,
      font = "Friz Quadrata TT",
      fontSize = 20,
      frameStrata = 1,
      height = 40,
      icon = true,
      id = "Threat Differential on Nameplates",
      information = {
        forceEvents = true,
        ignoreOptionsEventErrors = true,
      },
      internalVersion = 91,
      inverse = false,
      justify = "LEFT",
      keepAspectRatio = false,
      load = {
        affixes = {
          multi = {
            [16] = true,
          },
          single = 16,
        },
        class = {
          multi = {},
        },
        difficulty = {
          multi = {},
        },
        faction = {
          multi = {},
        },
        ingroup = {
          multi = {
            group = true,
            raid = true,
          },
        },
        pvptalent = {
          multi = {},
        },
        race = {
          multi = {},
        },
        role = {
          multi = {},
        },
        size = {
          multi = {},
        },
        spec = {
          multi = {},
        },
        talent = {
          multi = {},
        },
        talent2 = {
          multi = {},
        },
        use_affixes = true,
        use_ingroup = false,
        use_never = false,
        zoneIds = "",
      },
      outline = "OUTLINE",
      preferToUpdate = false,
      regionType = "text",
      selfPoint = "CENTER",
      semver = "1.0.15",
      shadowColor = {
        0,
        0,
        0,
        1,
      },
      shadowXOffset = 1,
      shadowYOffset = -1,
      source = "import",
      stickyDuration = false,
      subRegions = {
        {
          type = "subbackground",
        },
      },
      tocversion = 40402,
      triggers = {
        [1] = {
          trigger = {
            check = "event",
            custom = "function(allstates, event, unitId)\n    if not unitId then\n        return\n    end\n    \n    if event == \"NAME_PLATE_UNIT_REMOVED\" then\n        local state = allstates[unitId]\n        if state then\n            state.show = false\n            state.changed = true\n            return true\n        end\n        \n    elseif unitId ~= \"target\" then\n        if UnitIsPlayer(unitId) then\n            return\n        end\n        \n        local isTanking, threatStatus, _, _, threatValue = UnitDetailedThreatSituation(\"player\", unitId)\n        \n        if not threatValue then\n            return \n        end\n        \n        local firstUnit, firstThreat, secondUnit, secondThreat = aura_env.ThreatFunc(unitId)\n        local displayValue\n        \n        if isTanking then\n            displayValue = threatValue - secondThreat\n            if Round(math.abs(displayValue) / 100) > aura_env.secureThreatValue then\n                -- Player is securely tanking the unit\n                threatStatus = 5\n            elseif firstUnit and secondUnit and not UnitIsUnit(secondUnit, \"player\") and (UnitGroupRolesAssigned(secondUnit) == 'TANK') then\n                -- Player is tanking the unit, another tank is second on threat\n                threatStatus = 3\n            else\n                -- Player is tanking the unit, non tank is close on threat\n                threatStatus = 2\n            end\n        else\n            displayValue = threatValue - firstThreat\n            if firstUnit and not UnitIsUnit(firstUnit, \"player\") and (GetPartyAssignment(\"MAINTANK\",firstUnit) or (UnitGroupRolesAssigned(firstUnit) == 'TANK')) then\n                -- Player is not tanking the unit, another tank is first on threat\n                threatStatus = 4\n            end\n        end\n        \n        allstates[unitId] = allstates[unitId] or {unit = unitId}\n        local state = allstates[unitId]\n        state.changed = true\n        state.show = true\n        state.status = threatStatus < 1 and 1 or threatStatus\n        state.value = Round(math.abs(displayValue) / 100)\n        return true\n    end\nend",
            customVariables = "{\n    status = {\n        display = \"Threat Status\",\n        type = \"select\",\n        values = {\n            [1] = \"Untanked\", \n            [2] = \"Insecurely Tanking\", \n            [3] = \"Tanking\",\n            [4] = \"Tanked by Other Tank\",\n            [5] = \"Securely tanking\"\n        }\n    }\n}",
            custom_type = "stateupdate",
            debuffType = "HELPFUL",
            event = "Health",
            events = "NAME_PLATE_UNIT_ADDED, NAME_PLATE_UNIT_REMOVED, UNIT_THREAT_LIST_UPDATE, GROUP_ROSTER_UPDATE",
            genericShowOn = "showOnActive",
            names = {},
            spellIds = {},
            subeventPrefix = "SPELL",
            subeventSuffix = "_CAST_START",
            type = "custom",
            unit = "player",
          },
          untrigger = {},
        },
        activeTriggerMode = -10,
        disjunctive = "any",
      },
      uid = "1L3Mp1qQdkX",
      url = "https://wago.io/yssC_nf5K/16",
      version = 16,
      wagoID = "yssC_nf5K",
      width = 40,
      wordWrap = "WordWrap",
      xOffset = -50,
      yOffset = 0,
      zoom = 0,
    },
  },
}
