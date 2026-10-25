--------------------------------------------------------------------
--  3-POS  N-POS (via GV)      EdgeTX 2.8+ / OpenTX 2.3+
--  Put into  /SCRIPTS/FUNCTIONS/mpx.lua
--
--  v11:
--     NEW:   TELEMETRY_RULE_NAME     1..N.
--
--  v10:
--     CHANGED:        .
--          ,     .
--
--  v9:
--     NEW: POWERS   VTX  mW   .
--     NEW:   TELEMETRY_POWER_NAME    .
--
--  v8:
--     NEW: FREQUENCIES   VRX  MHz   .
--     NEW:    TELEMETRY_NAME    .
--       0     .
--
--  v7:
--     NEW: RAND_SWITCH     .
--     NEW: RANDOM_ANALOG_SOURCES     (, {"s1","s2"})
--         seed  . Seed    getTime()/getDateTime().
--       INC/DEC   :  1   .
--------------------------------------------------------------------
local CFG = {
  MIX_SLOT    = 0,
  GV_INDEX    = 1,
  POSITIONS   = 40,
  CHANNELS    = { 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12 },
  VALUES      = { -96, -91, -87, -82, -77, -72, -67, -62, -57, -52, -47, -42, -37, -32, -27, -22, -17, -12, -7, -2, 3, 8, 13, 18, 23, 28, 33, 38, 43, 48, 53, 58, 62, 67, 73, 77, 82, 87, 91, 97 },
  FREQUENCIES = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
  POWERS      = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },

  TELEMETRY_FREQUENCY = false,
  TELEMETRY_ID        = 0x0D10,
  TELEMETRY_NAME      = "VTXF",
  TELEMETRY_POWER      = false,
  TELEMETRY_POWER_ID   = 0x0D11,
  TELEMETRY_POWER_NAME = "VTXP",
  TELEMETRY_RULE       = false,
  TELEMETRY_RULE_ID    = 0x0D12,
  TELEMETRY_RULE_NAME  = "VTXN",

  EDGE_THR    = 900,
  MID_THR     = 150,

  INC_SWITCH  = { id = "sb", state = "down" },
  DEC_SWITCH  = { id = "sb", state = "mid" },

  CYCLIC      = true,
  VOICE       = true,

  HOLD        = false,
    DELAY       = 3
}



--------------------------------------------------------------------
--   
local function clamp(x, lo, hi)
  if x < lo then
    return lo
  elseif x > hi then
    return hi
  else
    return x
  end
end

local cur = 0                            --   0..N-1
local incLatch, decLatch = false, false
local randLatch = false
local lastSpoken = -1
local initDone = false

--   (  getTime; 100  = 1 )
local incNext, decNext, randNext = nil, nil, nil

local SRC_MAX = getSourceIndex("MAX")       --    MAX
local lastCh = -1
local lastVal = 0
local lastFrequency = nil
local lastFrequencyUpdate = -100
local telemetryInitialized = false
local lastPower = nil
local lastPowerUpdate = -100
local powerTelemetryInitialized = false
local lastRuleNumber = nil
local lastRuleUpdate = -100
local ruleTelemetryInitialized = false

local function positions_count()
  if type(CFG.VALUES) == "table" and #CFG.VALUES >= 1 then
    return #CFG.VALUES
  end
  return math.max(1, CFG.POSITIONS)
end

local function gv_value_for_position(idx)
  -- :   CFG.VALUES;     POSITIONS
  if type(CFG.VALUES) == "table" and #CFG.VALUES >= 1 then
    local v = CFG.VALUES[(idx or 0) + 1] or 0  -- idx = 0..N-1,  1..N
    return clamp(math.floor(v + 0.5), -100, 100)
  else
    local positions = math.max(1, CFG.POSITIONS)
    if positions <= 1 then
      return 0
    end
    local step = 200 / (positions - 1)
    local val = -100 + idx * step
    return clamp(math.floor(val + 0.5), -100, 100)
  end
end

--    
local function in_state(sw)
  -- sw = { id="sa", state="down"|"mid"|"up" }
  if not sw then return false end
  local v = getValue(sw.id) or 0
  if sw.state == "down" then
    return v >= CFG.EDGE_THR
  elseif sw.state == "up" then
    return v <= -CFG.EDGE_THR
  elseif sw.state == "mid" then
    return math.abs(v) <= CFG.MID_THR
  else
    return false
  end
end

local function getChannelForIndex(idx)
  if type(CFG.CHANNELS) == "table" and #CFG.CHANNELS >= 1 then
    local c = CFG.CHANNELS[(idx or 0) + 1] or CFG.CHANNELS[#CFG.CHANNELS] or 13
    c = clamp(math.floor((c or 13) + 0.5), 1, 16)
    return c - 1  -- 0-based  model.get/insertMix
  else
    return 12  -- CH13 (0-based)  
  end
end

local function getValueForIndex(idx)
  return gv_value_for_position(idx)
end

local function applyOutput(idx)
  -- Ensure channel mix with constant offset = VALUES[idx]
  local ch = getChannelForIndex(idx)
  local val = getValueForIndex(idx)

  if lastCh ~= ch or lastVal ~= val or not initDone then
    --   :  
    if initDone and lastCh >= 0 and lastCh ~= ch then
      local offMode = CFG.OFF_MODE or "delete"
      if offMode == "park" and type(CFG.OFF_VALUE) == "number" then
        local offv = clamp(math.floor((CFG.OFF_VALUE or 0) + 0.5), -100, 100)
        local pmix = model.getMix(lastCh, CFG.MIX_SLOT)
        if pmix then model.deleteMix(lastCh, CFG.MIX_SLOT) end
        model.insertMix(lastCh, CFG.MIX_SLOT, {
          name      = "LuaXP",
          source    = SRC_MAX,
          weight    = 0,
          offset    = offv,
          multiplex = 2
        })
      else
        --  :  
        model.deleteMix(lastCh, CFG.MIX_SLOT)
      end
    end
    -- /     
    local mix = model.getMix(ch, CFG.MIX_SLOT)
    if mix then model.deleteMix(ch, CFG.MIX_SLOT) end
    model.insertMix(ch, CFG.MIX_SLOT, {
      name      = "LuaXP",
      source    = SRC_MAX,   --  
      weight    = 0,         --  = offset
      offset    = val,       --   (100..+100)
      multiplex = 2          -- REPLACE
    })
    lastCh = ch
    lastVal = val
    initDone = true
  end
end

local function publishFrequency(idx, force)
  if not CFG.TELEMETRY_FREQUENCY then return end
  if type(setTelemetryValue) ~= "function" then return end
  if type(CFG.FREQUENCIES) ~= "table" then return end

  local frequency = tonumber(CFG.FREQUENCIES[(idx or 0) + 1]) or 0
  frequency = math.floor(frequency + 0.5)
  if frequency <= 0 then return end

  local now = getTime()
  if force or frequency ~= lastFrequency or now - lastFrequencyUpdate >= 100 then
    local sensorId = tonumber(CFG.TELEMETRY_ID) or 0x0D10
    local sensorName = tostring(CFG.TELEMETRY_NAME or "VTXF")
    local sensorAdded = setTelemetryValue(sensorId, 0, 1, frequency, 0, 0, sensorName)

    --    EdgeTX  ,       .
    if sensorAdded then
      setTelemetryValue(sensorId, 0, 1, frequency, 0, 0, sensorName)
    end

    telemetryInitialized = true
    lastFrequency = frequency
    lastFrequencyUpdate = now
  end
end

local function publishPower(idx, force)
  if not CFG.TELEMETRY_POWER then return end
  if type(setTelemetryValue) ~= "function" then return end
  if type(CFG.POWERS) ~= "table" then return end

  local power = tonumber(CFG.POWERS[(idx or 0) + 1]) or 0
  power = math.floor(power + 0.5)
  if power <= 0 then return end

  local now = getTime()
  if force or power ~= lastPower or now - lastPowerUpdate >= 100 then
    local sensorId = tonumber(CFG.TELEMETRY_POWER_ID) or 0x0D11
    local sensorName = tostring(CFG.TELEMETRY_POWER_NAME or "VTXP")
    local sensorUnit = UNIT_MILLIWATTS or 0
    local sensorAdded = setTelemetryValue(sensorId, 0, 1, power, sensorUnit, 0, sensorName)

    if sensorAdded then
      setTelemetryValue(sensorId, 0, 1, power, sensorUnit, 0, sensorName)
    end

    powerTelemetryInitialized = true
    lastPower = power
    lastPowerUpdate = now
  end
end

local function publishRuleNumber(idx, force)
  if not CFG.TELEMETRY_RULE then return end
  if type(setTelemetryValue) ~= "function" then return end

  --     0,      1..N.
  local ruleNumber = math.max(1, math.floor((tonumber(idx) or 0) + 1))
  local now = getTime()
  if force or ruleNumber ~= lastRuleNumber or now - lastRuleUpdate >= 100 then
    local sensorId = tonumber(CFG.TELEMETRY_RULE_ID) or 0x0D12
    local sensorName = tostring(CFG.TELEMETRY_RULE_NAME or "VTXN")
    local sensorAdded = setTelemetryValue(sensorId, 0, 1, ruleNumber, 0, 0, sensorName)

    if sensorAdded then
      setTelemetryValue(sensorId, 0, 1, ruleNumber, 0, 0, sensorName)
    end

    ruleTelemetryInitialized = true
    lastRuleNumber = ruleNumber
    lastRuleUpdate = now
  end
end

local function stepBy(delta)
  local N = positions_count()
  if N <= 1 then
    cur = 0
    return
  end
  if delta == 0 then
    return
  end
  if CFG.CYCLIC then
    cur = (cur + delta) % N
    if cur < 0 then
      cur = cur + N
    end
  else
    cur = clamp(cur + delta, 0, N - 1)
  end
end

--------------------------------------------------------------------
--    ,  .
--       .
local randomOrder = {}
local randomIndex = 1
local randomOrderN = -1
local randomSeeded = false
local randomDirty = true

--   seed  GV: , /,   
local rseed = 1
local function reseed()
  local t = getTime() or 0
  local dt = 0
  local ok, tm = pcall(getDateTime)
  if ok and tm and tm.secs then
    dt = tm.secs
  end

  local s = 1 + ((t * 1103515245 + 12345) % 2147483646)
  s = (s + dt * 1664525) % 2147483647

  if type(CFG.RANDOM_ANALOG_SOURCES) == "table" then
    for _, name in ipairs(CFG.RANDOM_ANALOG_SOURCES) do
      local av = (getValue(name) or 0) + 2048
      s = (s + av * 1013904223) % 2147483647
    end
  else
    --    S1/S2
    local s1 = (getValue("s1") or 0) + 2048
    local s2 = (getValue("s2") or 0) + 2048
    s = (s + s1 * 1013904223) % 2147483647
    s = (s + s2 * 69069)      % 2147483647
  end

  if s == 0 then s = 1 end
  rseed = s
end

local function rand32()
  rseed = (rseed * 1103515245 + 12345) % 2147483647
  if rseed == 0 then rseed = 1 end
  return rseed
end

local function rebuildRandomOrder(N)
  randomOrder = {}
  for position = 0, N - 1 do
    if position ~= cur then
      randomOrder[#randomOrder + 1] = position
    end
  end

  -- Fisher-Yates:    .
  for i = #randomOrder, 2, -1 do
    local j = (rand32() % i) + 1
    randomOrder[i], randomOrder[j] = randomOrder[j], randomOrder[i]
  end

  --          +1/1.
  --   ,       INC/DEC.
  if #randomOrder >= 3 then
    local forward = true
    local backward = true
    for offset = 1, #randomOrder do
      if randomOrder[offset] ~= ((cur + offset) % N) then forward = false end
      if randomOrder[offset] ~= ((cur - offset) % N) then backward = false end
    end
    if forward or backward then
      randomOrder[1], randomOrder[2] = randomOrder[2], randomOrder[1]
    end
  end

  randomIndex = 1
  randomOrderN = N
  randomDirty = false
end

local function invalidateRandomOrder()
  randomDirty = true
end

local function nextRandomPosition()
  local N = positions_count()
  if N <= 1 then
    cur = 0
    return false
  end

  if not randomSeeded then
    reseed()
    randomSeeded = true
  end

  if randomDirty or randomOrderN ~= N or randomIndex > #randomOrder then
    rebuildRandomOrder(N)
  end

  local nextPosition = randomOrder[randomIndex]
  if nextPosition == nil then return false end
  randomIndex = randomIndex + 1
  cur = nextPosition
  return true
end

--------------------------------------------------------------------
--  
local function run()
  -- /  INC/DEC
  local incNow = in_state(CFG.INC_SWITCH)
  local decNow = in_state(CFG.DEC_SWITCH)
  local incEdge = incNow and not incLatch
  local decEdge = decNow and not decLatch
  incLatch = incNow
  decLatch = decNow

  -- /   
  local randNow  = CFG.RAND_SWITCH and in_state(CFG.RAND_SWITCH) or false
  local randEdge = randNow and not randLatch
  randLatch = randNow

  local now = getTime()
  local holdTicks = math.max(1, math.floor((CFG.DELAY or 0.3) * 100 + 0.5))
  local stepped = false

  -- :   ,   +1/1
  if randEdge and CFG.RAND_SWITCH then
    stepped = nextRandomPosition()
    --  :      RAND (  HOLD)
    if CFG.HOLD then
      randNext = now + holdTicks
    else
      randNext = nil
    end
    incNext, decNext = nil, nil  --   INC/DEC

  elseif incEdge then
    stepBy(1);  stepped = true
    invalidateRandomOrder()
    if CFG.HOLD then
      incNext = now + holdTicks
    else
      incNext = nil
    end
    decNext = nil

  elseif decEdge then
    stepBy(-1); stepped = true
    invalidateRandomOrder()
    if CFG.HOLD then
      decNext = now + holdTicks
    else
      decNext = nil
    end
    incNext = nil

  else
    --    (  RAND  INC  DEC)
    if CFG.HOLD then
      -- RAND 
      if (not stepped) and CFG.RAND_SWITCH and randNow then
        if not randNext then
          randNext = now + holdTicks
        end
        if now >= randNext then
          stepped = nextRandomPosition()
          randNext = now + holdTicks
        end
      else
        randNext = nil
      end

      -- INC 
      if (not stepped) and incNow then
        if not incNext then
          incNext = now + holdTicks
        end
        if now >= incNext then
          stepBy(1);  stepped = true
          invalidateRandomOrder()
          incNext = now + holdTicks
        end
      else
        incNext = nil
      end

      -- DEC 
      if not stepped then
        if decNow then
          if not decNext then
            decNext = now + holdTicks
          end
          if now >= decNext then
            stepBy(-1); stepped = true
            invalidateRandomOrder()
            decNext = now + holdTicks
          end
        else
          decNext = nil
        end
      end
    else
      incNext, decNext, randNext = nil, nil, nil
    end
  end

  --  :      
  applyOutput(cur)

  --        
  publishFrequency(cur, stepped or not telemetryInitialized)

  --        
  publishPower(cur, stepped or not powerTelemetryInitialized)

  --        1..N
  publishRuleNumber(cur, stepped or not ruleTelemetryInitialized)

  --   GV    ( FM0!)
  model.setGlobalVariable(CFG.GV_INDEX - 1, 0, cur)

  -- :    1..N (  )
  if stepped and CFG.VOICE and lastSpoken ~= cur then
    lastSpoken = cur
    playNumber(cur + 1, 0)  -- 0 =   
  end
end

return { run = run }
