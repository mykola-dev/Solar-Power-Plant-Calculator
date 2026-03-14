import {
  Badge,
  Card,
  Group,
  Divider,
  Grid,
  NumberInput,
  Select,
  SegmentedControl,
  SimpleGrid,
  Slider,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import type { SelectProps } from '@mantine/core'
import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { panelPresets, customPanelDefaults } from './data/panelPresets'
import {
  kharkivDefaults,
} from './utils/constants'
import { calculateSolarMetrics, getDateFromDayOfYear, getSunriseSunsetOptions } from './utils/solarMath'
import { calculateFieldShading, getPanelWidthAcrossRowMeters } from './utils/solar3d'
import { estimateMonthlyYield } from './utils/yieldEstimator'
import type { CalculatorState, Orientation, PanelSpec, YieldResult } from './types'
import { FieldScene3D } from './components/FieldScene3D'

const LOCAL_STORAGE_KEY = 'solar-calculator-v3-state'

const DEG_TO_RAD = Math.PI / 180

const getPanelSpecForState = (calculatorState: CalculatorState): PanelSpec => {
  if (calculatorState.panelSelection === 'custom') {
    return calculatorState.customPanel
  }

  return panelPresets.find((preset) => preset.id === calculatorState.panelSelection) ?? calculatorState.customPanel
}

const getPanelLengthInViewM = (panel: PanelSpec, orientation: Orientation) =>
  (orientation === 'portrait' ? panel.lengthMm : panel.widthMm) / 1000

const getPanelRunMForState = (calculatorState: CalculatorState) => {
  const panel = getPanelSpecForState(calculatorState)
  const panelLengthM = getPanelLengthInViewM(panel, calculatorState.orientation)
  return panelLengthM * Math.cos(calculatorState.tiltDeg * DEG_TO_RAD)
}

const withSpacingConstraint = (calculatorState: CalculatorState): CalculatorState => {
  const panelRunM = getPanelRunMForState(calculatorState)
  const rowPitchM = Math.max(calculatorState.rowPitchM, panelRunM)
  const rowSpacingM = Math.max(0, rowPitchM - panelRunM)

  if (rowPitchM === calculatorState.rowPitchM && rowSpacingM === calculatorState.rowSpacingM) {
    return calculatorState
  }

  return {
    ...calculatorState,
    rowPitchM,
    rowSpacingM,
  }
}

const initialPanelRunM = (panelPresets[0].lengthMm / 1000) * Math.cos(45 * DEG_TO_RAD)

const initialState: CalculatorState = {
  panelSelection: panelPresets[0].id,
  customPanel: customPanelDefaults,
  panelsPerRow: 20,
  rowsCount: 2,
  rowPitchM: 1.5 + initialPanelRunM,
  rowSpacingM: 1.5,
  panelGapM: 0,
  tiltDeg: 35,
  groundTiltDeg: 0,
  groundTiltAzimuthDeg: 0,
  orientation: 'portrait',
  panelAzimuthDeg: 180,
  latitude: kharkivDefaults.latitude,
  longitude: kharkivDefaults.longitude,
  dayOfYear: Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 1000 / 60 / 60 / 24,
  ),
  timeLabel: '12:00',
  performanceRatio: 0.8,
  temperatureC: 25,
  windSpeedMs: 5,
  windAzimuthDeg: 180,
  mountHeightCm: 0,
}

const toFixed = (value: number, digits = 2) => Number(value.toFixed(digits))

const panelSelectData = [
  ...panelPresets.map((panel) => ({
    value: panel.id,
    label: `${panel.brand} ${panel.model}`,
  })),
  { value: 'custom', label: 'Custom panel' },
]

const panelOptionsById = new Map(
  panelPresets.map((panel) => [
    panel.id,
    `${panel.lengthMm}x${panel.widthMm} mm, ${panel.powerW}W, Voc ${panel.voc}V, Isc ${panel.isc}A`,
  ]),
)

const renderPanelOption: NonNullable<SelectProps['renderOption']> = ({ option }) => {
  const detail = panelOptionsById.get(option.value) ?? 'Custom electrical and physical parameters'

  return (
    <div className="panel-option-cell">
      <Text size="sm" fw={600}>
        {option.label}
      </Text>
      <Text size="xs" c="dimmed">
        {detail}
      </Text>
    </div>
  )
}

const isNumber = (value: string | number): value is number => typeof value === 'number' && Number.isFinite(value)

type SliderControlProps = {
  title: string
  currentLabel: string
  minLabel: string
  maxLabel: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  onChangeEnd: () => void
}

const SliderControl = ({
  title,
  currentLabel,
  minLabel,
  maxLabel,
  value,
  min,
  max,
  step,
  onChange,
  onChangeEnd,
}: SliderControlProps) => (
  <Stack gap={6} className="slider-control">
    <Group justify="space-between" className="slider-header">
      <Text size="sm" c="dimmed">
        {title}
      </Text>
      <Text size="sm" fw={600}>
        {currentLabel}
      </Text>
    </Group>

    <Slider
      value={value}
      min={min}
      max={max}
      step={step}
      label={null}
      onChange={onChange}
      onChangeEnd={onChangeEnd}
      className="slider-track"
    />

    <Group justify="space-between" className="slider-ends">
      <Text size="xs" c="dimmed">
        {minLabel}
      </Text>
      <Text size="xs" c="dimmed">
        {maxLabel}
      </Text>
    </Group>
  </Stack>
)

type HeavyPayload = {
  latitude: number
  longitude: number
  dayOfYear: number
  tiltDeg: number
  panelAzimuthDeg: number
  panelSpec: PanelSpec
  panelCount: number
  performanceRatio: number
  shadingLossFactor: number
}

const buildHeavyPayload = (calculatorState: CalculatorState): HeavyPayload => {
  const selectedPanel = getPanelSpecForState(calculatorState)

  const panelWidthAcrossRowM = getPanelWidthAcrossRowMeters(
    selectedPanel.lengthMm,
    selectedPanel.widthMm,
    calculatorState.orientation,
  )
  const totalPanels = calculatorState.rowsCount * calculatorState.panelsPerRow

  // Calculate daily average shading for the HeavyPayload so the monthly yield doesn't jump with the Time of Day slider.
  // We use an irradiance-weighted average: shadows at noon matter more than shadows at sunrise.
  const currentDate = getDateFromDayOfYear(calculatorState.dayOfYear)
  const timeOptions = getSunriseSunsetOptions(calculatorState.latitude, calculatorState.longitude, currentDate)
  let weightedShadeSum = 0
  let totalWeight = 0

  for (const timeOpt of timeOptions) {
    const tempMetrics = calculateSolarMetrics({
      latitude: calculatorState.latitude,
      longitude: calculatorState.longitude,
      dayOfYear: calculatorState.dayOfYear,
      timeLabel: timeOpt,
      tiltDeg: calculatorState.tiltDeg,
      panelAzimuthDeg: calculatorState.panelAzimuthDeg,
      rowSpacingM: calculatorState.rowSpacingM,
      panelSpec: selectedPanel,
      orientation: calculatorState.orientation,
    })

    // Weight by incidence factor (clamped to 0 for sun behind panels)
    const weight = tempMetrics.sunAboveHorizon ? Math.max(0, tempMetrics.incidenceFactor) : 0

    if (weight > 1e-6) {
      const tempShading = calculateFieldShading({
        rowsCount: calculatorState.rowsCount,
        panelsPerRow: calculatorState.panelsPerRow,
        rowSpacingM: calculatorState.rowSpacingM,
        panelRunM: tempMetrics.panelRunM,
        panelTopHeightM: tempMetrics.panelTopHeightM,
        panelWidthAcrossRowM,
        panelAzimuthDeg: calculatorState.panelAzimuthDeg,
        solarAzimuthDeg: tempMetrics.solarAzimuthDeg,
        solarAltitudeDeg: tempMetrics.solarAltitudeDeg,
        groundTiltDeg: calculatorState.groundTiltDeg,
        groundTiltAzimuthDeg: calculatorState.groundTiltAzimuthDeg,
        sunAboveHorizon: tempMetrics.sunAboveHorizon,
        frontSideIrradiance: tempMetrics.frontSideIrradiance,
      })

      weightedShadeSum += tempShading.fieldShadingPercent * weight
      totalWeight += weight
    }
  }

  const avgDailyShadePercent = totalWeight > 0 ? weightedShadeSum / totalWeight : 0

  return {
    latitude: calculatorState.latitude,
    longitude: calculatorState.longitude,
    dayOfYear: calculatorState.dayOfYear,
    tiltDeg: calculatorState.tiltDeg,
    panelAzimuthDeg: calculatorState.panelAzimuthDeg,
    panelSpec: selectedPanel,
    panelCount: totalPanels,
    performanceRatio: calculatorState.performanceRatio,
    shadingLossFactor: Math.max(0.55, 1 - avgDailyShadePercent / 100),
  }
}

const sanitizeNumber = (value: unknown, fallback: number, min: number, max: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, value))
}

const sanitizeState = (raw: unknown): CalculatorState => {
  if (!raw || typeof raw !== 'object') {
    return withSpacingConstraint(initialState)
  }

  const candidate = raw as Partial<CalculatorState>
  const legacyPanelCount =
    typeof (raw as { panelCount?: unknown }).panelCount === 'number' ? (raw as { panelCount: number }).panelCount : undefined
  const panelExists = candidate.panelSelection === 'custom' || panelPresets.some((panel) => panel.id === candidate.panelSelection)

  const panelSelection = panelExists && typeof candidate.panelSelection === 'string' ? candidate.panelSelection : initialState.panelSelection
  const orientation = candidate.orientation === 'landscape' ? 'landscape' : 'portrait'

  const sanitizedRowsCount = sanitizeNumber(candidate.rowsCount, initialState.rowsCount, 1, 5)
  const derivedPanelsPerRowFromLegacy = legacyPanelCount ? Math.max(1, Math.round(legacyPanelCount / sanitizedRowsCount)) : undefined

  const sanitized: CalculatorState = {
    panelSelection,
    customPanel: {
      powerW: sanitizeNumber(candidate.customPanel?.powerW, initialState.customPanel.powerW, 100, 900),
      lengthMm: sanitizeNumber(candidate.customPanel?.lengthMm, initialState.customPanel.lengthMm, 1000, 2600),
      widthMm: sanitizeNumber(candidate.customPanel?.widthMm, initialState.customPanel.widthMm, 600, 1600),
      efficiency: sanitizeNumber(candidate.customPanel?.efficiency, initialState.customPanel.efficiency, 10, 30),
      voc: sanitizeNumber(candidate.customPanel?.voc, initialState.customPanel.voc, 20, 80),
      vmp: sanitizeNumber(candidate.customPanel?.vmp, initialState.customPanel.vmp, 20, 70),
      isc: sanitizeNumber(candidate.customPanel?.isc, initialState.customPanel.isc, 2, 25),
      imp: sanitizeNumber(candidate.customPanel?.imp, initialState.customPanel.imp, 2, 25),
    },
    panelsPerRow: sanitizeNumber(
      (candidate as { panelsPerRow?: number }).panelsPerRow ?? derivedPanelsPerRowFromLegacy,
      initialState.panelsPerRow,
      1,
      100,
    ),
    rowsCount: sanitizedRowsCount,
    rowPitchM: sanitizeNumber(
      candidate.rowPitchM,
      sanitizeNumber(candidate.rowSpacingM, initialState.rowSpacingM, 0, 10) + initialPanelRunM,
      0,
      20,
    ),
    rowSpacingM: sanitizeNumber(candidate.rowSpacingM, initialState.rowSpacingM, 0, 10),
    panelGapM: sanitizeNumber(candidate.panelGapM, initialState.panelGapM, 0, 1.0),
    tiltDeg: sanitizeNumber(candidate.tiltDeg, initialState.tiltDeg, 0, 90),
    groundTiltDeg: sanitizeNumber(candidate.groundTiltDeg, initialState.groundTiltDeg, -10, 10),
    groundTiltAzimuthDeg: sanitizeNumber(candidate.groundTiltAzimuthDeg, initialState.groundTiltAzimuthDeg, -180, 180),
    orientation,
    panelAzimuthDeg: sanitizeNumber(candidate.panelAzimuthDeg, initialState.panelAzimuthDeg, 0, 360),
    latitude: sanitizeNumber(candidate.latitude, initialState.latitude, -90, 90),
    longitude: sanitizeNumber(candidate.longitude, initialState.longitude, -180, 180),
    dayOfYear: sanitizeNumber(candidate.dayOfYear, initialState.dayOfYear, 1, 365),
    timeLabel:
      typeof candidate.timeLabel === 'string'
        ? candidate.timeLabel
        : initialState.timeLabel,
    performanceRatio: sanitizeNumber(candidate.performanceRatio, initialState.performanceRatio, 0.6, 0.9),
    temperatureC: sanitizeNumber(candidate.temperatureC, initialState.temperatureC, -30, 30),
    windSpeedMs: sanitizeNumber(candidate.windSpeedMs, initialState.windSpeedMs, 0, 30),
    windAzimuthDeg: sanitizeNumber(candidate.windAzimuthDeg, initialState.windAzimuthDeg, 0, 360),
    mountHeightCm: sanitizeNumber(candidate.mountHeightCm, initialState.mountHeightCm, 0, 100),
  }

  return withSpacingConstraint(sanitized)
}

const loadInitialState = (): CalculatorState => {
  try {
    const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!stored) {
      return withSpacingConstraint(initialState)
    }

    return sanitizeState(JSON.parse(stored))
  } catch {
    return withSpacingConstraint(initialState)
  }
}

function App() {
  const [state, setState] = useState<CalculatorState>(loadInitialState)
  const [heavyPayload, setHeavyPayload] = useState<HeavyPayload>(() => buildHeavyPayload(loadInitialState()))
  const [yieldResult, setYieldResult] = useState<YieldResult | null>(null)
  const [isYieldLoading, setIsYieldLoading] = useState(false)

  const selectedPreset = panelPresets.find((preset) => preset.id === state.panelSelection)
  const panelSpec: PanelSpec = state.panelSelection === 'custom' || !selectedPreset ? state.customPanel : selectedPreset

  const metrics = useMemo(
    () =>
      calculateSolarMetrics({
        latitude: state.latitude,
        longitude: state.longitude,
        dayOfYear: state.dayOfYear,
        timeLabel: state.timeLabel,
        tiltDeg: state.tiltDeg,
        panelAzimuthDeg: state.panelAzimuthDeg,
        rowSpacingM: state.rowSpacingM,
        panelSpec,
        orientation: state.orientation,
      }),
    [
      state.latitude,
      state.longitude,
      state.dayOfYear,
      state.timeLabel,
      state.tiltDeg,
      state.panelAzimuthDeg,
      state.rowSpacingM,
      state.orientation,
      panelSpec,
    ],
  )

  const fieldShading = useMemo(() => {
    const panelWidthAcrossRowM = getPanelWidthAcrossRowMeters(panelSpec.lengthMm, panelSpec.widthMm, state.orientation)
    return calculateFieldShading({
      rowsCount: state.rowsCount,
      panelsPerRow: state.panelsPerRow,
      rowSpacingM: state.rowSpacingM,
      panelRunM: metrics.panelRunM,
      panelTopHeightM: metrics.panelTopHeightM,
      panelWidthAcrossRowM,
      panelAzimuthDeg: state.panelAzimuthDeg,
      solarAzimuthDeg: metrics.solarAzimuthDeg,
      solarAltitudeDeg: metrics.solarAltitudeDeg,
      groundTiltDeg: state.groundTiltDeg,
      groundTiltAzimuthDeg: state.groundTiltAzimuthDeg,
      sunAboveHorizon: metrics.sunAboveHorizon,
      frontSideIrradiance: metrics.frontSideIrradiance,
    })
  }, [
    state.rowsCount,
    state.panelsPerRow,
    state.rowSpacingM,
    state.orientation,
    state.panelAzimuthDeg,
    panelSpec.lengthMm,
    panelSpec.widthMm,
    metrics.panelRunM,
    metrics.panelTopHeightM,
    metrics.solarAzimuthDeg,
    metrics.solarAltitudeDeg,
    state.groundTiltDeg,
    state.groundTiltAzimuthDeg,
    metrics.sunAboveHorizon,
    metrics.frontSideIrradiance,
  ])

  useEffect(() => {
    let active = true
    const run = async () => {
      setIsYieldLoading(true)

      const result = await estimateMonthlyYield({
        latitude: heavyPayload.latitude,
        longitude: heavyPayload.longitude,
        dayOfYear: heavyPayload.dayOfYear,
        tiltDeg: heavyPayload.tiltDeg,
        azimuthCompassDeg: heavyPayload.panelAzimuthDeg,
        panelSpec: heavyPayload.panelSpec,
        panelCount: heavyPayload.panelCount,
        performanceRatio: heavyPayload.performanceRatio,
        shadingLossFactor: heavyPayload.shadingLossFactor,
        panelAzimuthDeg: heavyPayload.panelAzimuthDeg,
        rowSpacingM: state.rowSpacingM,
        orientation: state.orientation,
      })

      if (!active) {
        return
      }

      setYieldResult(result)
      setIsYieldLoading(false)
    }

    void run()

    return () => {
      active = false
    }
  }, [heavyPayload, state.rowSpacingM, state.orientation])

  useEffect(() => {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const triggerHeavyRecalc = (nextState?: CalculatorState) => {
    setHeavyPayload(buildHeavyPayload(withSpacingConstraint(nextState ?? state)))
  }

  const updateState = <K extends keyof CalculatorState>(key: K, value: CalculatorState[K], trigger = false) => {
    setState((prev) => {
      const nextRaw =
        key === 'rowSpacingM'
          ? {
            ...prev,
            rowSpacingM: value as number,
            rowPitchM: (value as number) + getPanelRunMForState(prev),
          }
          : { ...prev, [key]: value }
      const next = withSpacingConstraint(nextRaw)
      if (trigger) {
        triggerHeavyRecalc(next)
      }
      return next
    })
  }

  const updateCustomPanel = <K extends keyof PanelSpec>(key: K, value: PanelSpec[K], trigger = false) => {
    setState((prev) => {
      const nextRaw = {
        ...prev,
        customPanel: { ...prev.customPanel, [key]: value },
      }
      const next = withSpacingConstraint(nextRaw)

      if (trigger) {
        triggerHeavyRecalc(next)
      }

      return next
    })
  }

  const isCustom = state.panelSelection === 'custom'

  const currentDate = getDateFromDayOfYear(state.dayOfYear)
  const timeOptions = useMemo(() => {
    return getSunriseSunsetOptions(state.latitude, state.longitude, currentDate)
  }, [state.latitude, state.longitude, currentDate])

  let timeSliderIndex = timeOptions.indexOf(state.timeLabel)
  if (timeSliderIndex === -1) {
    // If current time is no longer in the valid bounds, clamp it visually to the closest edge
    const [h, m] = state.timeLabel.split(':').map(Number)
    const currentMins = h * 60 + m

    // Find closest valid time
    let closestIdx = 0
    let minDiff = Infinity
    for (let i = 0; i < timeOptions.length; i += 1) {
      const [optH, optM] = timeOptions[i].split(':').map(Number)
      const optMins = optH * 60 + optM
      const diff = Math.abs(optMins - currentMins)
      if (diff < minDiff) {
        minDiff = diff
        closestIdx = i
      }
    }
    timeSliderIndex = closestIdx
  }

  const totalPanels = state.panelsPerRow * state.rowsCount
  const totalSystemKw = (panelSpec.powerW * totalPanels) / 1000
  const projectedPanelRunM = Math.abs(Math.cos(((state.panelAzimuthDeg - 180) * Math.PI) / 180)) * metrics.panelRunM
  const baseFieldWidthX =
    state.rowsCount > 0 ? state.rowsCount * projectedPanelRunM + Math.max(state.rowsCount - 1, 0) * state.rowSpacingM : 0
  const totalProjectedFieldWidthM = baseFieldWidthX * Math.cos((Math.abs(state.groundTiltDeg) * Math.PI) / 180)

  // Real-time Clear Sky Simulation
  // Assuming a max clear-sky irradiance of 1000 W/m² (900 Direct + 100 Diffuse scatter)
  // Direct irradiance scales down by cos(incidence_angle) and drops to 0 if sun is below horizon or behind the panel
  // Diffuse is available whenever the sun is above horizon
  let currentPowerKw = 0
  let systemCurrent = 0
  let systemVoltage = 0 // Vmp (Operating)
  let systemVoc = 0    // Voc (Open Circuit - for safety/specs)

  if (metrics.sunAboveHorizon) {
    const rawDirectW = Math.max(0, 900 * metrics.incidenceFactor)
    const diffuseW = 100

    // Voltage stays relatively constant across a string, but degrades with heat.
    // Typical crystalline silicon temp coefficient for Voltage is ~ -0.3% / °C (Vmp)
    // and ~ -0.25% / °C (Voc).
    const TEMP_COEFF_VMP = -0.003
    const TEMP_COEFF_VOC = -0.0025
    const tempDiffC = state.temperatureC - 25 // 25°C is Standard Test Conditions (STC)

    const vmpAdjusted = panelSpec.vmp * (1 + TEMP_COEFF_VMP * tempDiffC)
    const vocAdjusted = panelSpec.voc * (1 + TEMP_COEFF_VOC * tempDiffC)

    let activeSystemVoltage = 0

    // Calculate total power and voltage considering shading
    for (let r = 0; r < state.rowsCount; r++) {
      const rowShadeFraction = fieldShading.rowShadingFractions[r] ?? 0

      // Bypass Diode Model:
      // When a section of a panel is shaded, bypass diodes activate to prevent high series resistance
      // and hotspot damage. This drops the specific section out of the circuit, removing its Voltage
      // from the total string summation, but enabling the unshaded sections to pass optimal current.
      // We assume shade triggers proportional fractional diode bypass.
      const activeVoltageFraction = 1 - rowShadeFraction
      const rowActiveVoltage = vmpAdjusted * state.panelsPerRow * activeVoltageFraction
      activeSystemVoltage += rowActiveVoltage

      // Direct light is linearly blocked by shade. Diffuse light remains fully available.
      // E.g. 100% shade = 0 direct + 100 diffuse = ~10% ambient power.
      const directIncidentW = rawDirectW * (1 - rowShadeFraction)
      const totalIrradianceW = directIncidentW + diffuseW
      // Module efficiency converts irradiance into electricity
      const rowPowerW = totalIrradianceW * panelSpec.lengthMm / 1000 * panelSpec.widthMm / 1000 * panelSpec.efficiency / 100 * state.panelsPerRow
      currentPowerKw += rowPowerW / 1000
    }

    // Assign final bypassed total voltage block
    systemVoltage = activeSystemVoltage
    // Voc is the "safety" voltage, usually we care about the cold Voc of the entire string
    systemVoc = vocAdjusted * (state.rowsCount * state.panelsPerRow)

    // In a pure series connection, system current is effectively total Power / total Voltage
    systemCurrent = systemVoltage > 0 ? (currentPowerKw * 1000) / systemVoltage : 0
  }

  // --- Advanced Wind Load Model (Eurocode 1 / NEN 7250) ---
  const q_pa = 0.613 * Math.pow(state.windSpeedMs, 2)
  const panelAreaM2 = (panelSpec.lengthMm / 1000) * (panelSpec.widthMm / 1000)

  // Angle of wind relative to panel face (0 = direct head-on, 180 = direct back-on)
  const relativeWindAz = Math.abs(((state.windAzimuthDeg - state.panelAzimuthDeg + 540) % 360) - 180)
  const cosRel = Math.cos((relativeWindAz * Math.PI) / 180)
  const isNorthWind = relativeWindAz > 90 // Wind hitting the back of panels

  // Shielding factor (Psi) based on d/h ratio
  // d = clear distance between rows (rowSpacingM)
  // h = total height (panelTopHeightM + mountHeightM)
  const mountHeightM = state.mountHeightCm / 100
  const totalHeightH = Math.max(metrics.panelTopHeightM + mountHeightM, 0.1)
  const d_h_ratio = state.rowSpacingM / totalHeightH
  const psi = d_h_ratio <= 2.0 ? 0.53 : d_h_ratio >= 4.0 ? 1.0 : 0.53 + (d_h_ratio - 2.0) * (0.47 / 2.0)

  let totalUpliftN = 0
  let totalDragN = 0

  for (let r = 0; r < state.rowsCount; r++) {
    const rowArea = state.panelsPerRow * panelAreaM2
    let cp_uplift = 1.5 // Multiplier for exposed row

    if (isNorthWind) {
      // North wind hits the back: worst case Cp = 2.0 for all rows (no shielding effectively)
      cp_uplift = 2.0
    } else {
      // South wind hits the front: Row 0 is exposed, others shielded
      if (r > 0) {
        cp_uplift = 0.8 * psi
      }
    }

    const tiltRad = (state.tiltDeg * Math.PI) / 180
    // Uplift peaks at 45 deg, 0 at 0 and 90 deg
    const tiltUpliftScaling = Math.sin(2 * tiltRad)
    // Drag peaks at 90 deg, 0 at 0 deg
    const tiltDragScaling = Math.pow(Math.sin(tiltRad), 2)

    // Scale by direction: peaks at 0/180 (head-on), drops at 90 (side wind)
    const directionScale = Math.abs(cosRel)

    const rowUpliftN = q_pa * cp_uplift * rowArea * directionScale * tiltUpliftScaling
    const rowDragN = q_pa * 2.1 * rowArea * directionScale * tiltDragScaling // 2.1 is typical Cd for flat plate

    totalUpliftN += rowUpliftN
    totalDragN += rowDragN
  }

  // --- Gap Effect (Openness Adjustment) ---
  // When panels are lifted, air flows underneath: 
  // 1. Drag decreases (less stagnation pressure)
  // 2. Uplift increases (high pressure underside + suction topside = parasail effect)
  const gapFraction = state.mountHeightCm / 100
  const dragMultiplier = 1 - 0.2 * gapFraction
  const upliftMultiplier = 1 + 0.3 * gapFraction

  const windUpliftKg = (totalUpliftN * upliftMultiplier) / 9.81
  const windDragKg = (totalDragN * dragMultiplier) / 9.81
  const windTotalKg = Math.sqrt(Math.pow(windUpliftKg, 2) + Math.pow(windDragKg, 2))


  return (
    <Stack className="app-shell" gap="lg">
      <Grid gutter="lg">
        {/* Input column A: panel, time/month, orientation */}
        <Grid.Col span={{ base: 12, md: 6, xl: 3 }}>
          <Card withBorder radius="lg" className="panel-card" h="100%">
            <Stack gap="md">
              <Title order={4} className="input-col-title">Panel &amp; Time</Title>

              <Select
                label="Panel model"
                value={state.panelSelection}
                data={panelSelectData}
                renderOption={renderPanelOption}
                onChange={(value) => {
                  if (!value) {
                    return
                  }
                  updateState('panelSelection', value, true)
                }}
              />

              {isCustom ? (
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  <NumberInput
                    label="Power (W)"
                    value={state.customPanel.powerW}
                    min={100}
                    max={900}
                    onChange={(value) => {
                      if (isNumber(value)) {
                        updateCustomPanel('powerW', value)
                      }
                    }}
                    onBlur={() => triggerHeavyRecalc()}
                  />
                  <NumberInput
                    label="Efficiency (%)"
                    value={state.customPanel.efficiency}
                    min={10}
                    max={30}
                    decimalScale={2}
                    onChange={(value) => {
                      if (isNumber(value)) {
                        updateCustomPanel('efficiency', value)
                      }
                    }}
                    onBlur={() => triggerHeavyRecalc()}
                  />
                  <NumberInput
                    label="Length (mm)"
                    value={state.customPanel.lengthMm}
                    min={1000}
                    max={2600}
                    onChange={(value) => {
                      if (isNumber(value)) {
                        updateCustomPanel('lengthMm', value)
                      }
                    }}
                    onBlur={() => triggerHeavyRecalc()}
                  />
                  <NumberInput
                    label="Width (mm)"
                    value={state.customPanel.widthMm}
                    min={600}
                    max={1600}
                    onChange={(value) => {
                      if (isNumber(value)) {
                        updateCustomPanel('widthMm', value)
                      }
                    }}
                    onBlur={() => triggerHeavyRecalc()}
                  />
                  <NumberInput
                    label="Voc (V)"
                    value={state.customPanel.voc}
                    min={20}
                    max={80}
                    decimalScale={2}
                    onChange={(value) => {
                      if (isNumber(value)) {
                        updateCustomPanel('voc', value)
                      }
                    }}
                    onBlur={() => triggerHeavyRecalc()}
                  />
                  <NumberInput
                    label="Vmp (V)"
                    value={state.customPanel.vmp}
                    min={20}
                    max={70}
                    decimalScale={2}
                    onChange={(value) => {
                      if (isNumber(value)) {
                        updateCustomPanel('vmp', value)
                      }
                    }}
                    onBlur={() => triggerHeavyRecalc()}
                  />
                  <NumberInput
                    label="Isc (A)"
                    value={state.customPanel.isc}
                    min={2}
                    max={25}
                    decimalScale={2}
                    onChange={(value) => {
                      if (isNumber(value)) {
                        updateCustomPanel('isc', value)
                      }
                    }}
                    onBlur={() => triggerHeavyRecalc()}
                  />
                  <NumberInput
                    label="Imp (A)"
                    value={state.customPanel.imp}
                    min={2}
                    max={25}
                    decimalScale={2}
                    onChange={(value) => {
                      if (isNumber(value)) {
                        updateCustomPanel('imp', value)
                      }
                    }}
                    onBlur={() => triggerHeavyRecalc()}
                  />
                </SimpleGrid>
              ) : null}

              <Divider />

              <SliderControl
                title="Temperature"
                currentLabel={`${state.temperatureC > 0 ? '+' : ''}${state.temperatureC}°C`}
                minLabel="-30°C"
                maxLabel="+30°C"
                value={state.temperatureC}
                min={-30}
                max={30}
                step={1}
                onChange={(value) => updateState('temperatureC', value)}
                onChangeEnd={() => triggerHeavyRecalc()}
              />

              <SliderControl
                title="Wind speed"
                currentLabel={`${state.windSpeedMs} m/s`}
                minLabel="0 m/s"
                maxLabel="30 m/s"
                value={state.windSpeedMs}
                min={0}
                max={30}
                step={1}
                onChange={(value) => updateState('windSpeedMs', value)}
                onChangeEnd={() => triggerHeavyRecalc()}
              />

              <SliderControl
                title="Wind direction"
                currentLabel={(() => {
                  const v = state.windAzimuthDeg
                  if (v === 0 || v === 360) return 'North (0°)'
                  if (v === 90) return 'East (90°)'
                  if (v === 180) return 'South (180°)'
                  if (v === 270) return 'West (270°)'
                  return `${v}°`
                })()}
                minLabel="0° N"
                maxLabel="360°"
                value={state.windAzimuthDeg}
                min={0}
                max={360}
                step={5}
                onChange={(value) => updateState('windAzimuthDeg', value)}
                onChangeEnd={() => triggerHeavyRecalc()}
              />

              <SliderControl
                title="Date"
                currentLabel={currentDate.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}
                minLabel="1 Jan"
                maxLabel="31 Dec"
                value={state.dayOfYear}
                min={1}
                max={365}
                step={1}
                onChange={(value) => updateState('dayOfYear', value)}
                onChangeEnd={() => triggerHeavyRecalc()}
              />

              <SliderControl
                title="Time of day"
                currentLabel={timeOptions[timeSliderIndex]}
                minLabel={timeOptions[0]}
                maxLabel={timeOptions[timeOptions.length - 1]}
                value={timeSliderIndex}
                min={0}
                max={Math.max(0, timeOptions.length - 1)}
                step={1}
                onChange={(value) => updateState('timeLabel', timeOptions[value])}
                onChangeEnd={() => triggerHeavyRecalc()}
              />

              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <NumberInput
                  label="Latitude"
                  value={state.latitude}
                  min={-90}
                  max={90}
                  decimalScale={4}
                  onChange={(value) => {
                    if (isNumber(value)) {
                      updateState('latitude', value)
                    }
                  }}
                  onBlur={() => triggerHeavyRecalc()}
                />
                <NumberInput
                  label="Longitude"
                  value={state.longitude}
                  min={-180}
                  max={180}
                  decimalScale={4}
                  onChange={(value) => {
                    if (isNumber(value)) {
                      updateState('longitude', value)
                    }
                  }}
                  onBlur={() => triggerHeavyRecalc()}
                />
              </SimpleGrid>

              <SegmentedControl
                data={[
                  { label: 'Portrait', value: 'portrait' },
                  { label: 'Landscape', value: 'landscape' },
                ]}
                value={state.orientation}
                onChange={(value) => updateState('orientation', value as Orientation, true)}
              />
            </Stack>
          </Card>
        </Grid.Col>

        {/* Input column B: geometry, tilt, field layout */}
        <Grid.Col span={{ base: 12, md: 6, xl: 3 }}>
          <Card withBorder radius="lg" className="panel-card" h="100%">
            <Stack gap="md">
              <Title order={4} className="input-col-title">Field Geometry</Title>

              <SliderControl
                title="Facing direction"
                currentLabel={(() => {
                  const v = state.panelAzimuthDeg - 180
                  if (v === 0) return 'South (0°)'
                  if (v === -90) return 'East (-90°)'
                  if (v === 90) return 'West (90°)'
                  if (Math.abs(v) === 180) return 'North (±180°)'
                  return `${v > 0 ? '+' : ''}${v}°`
                })()}
                minLabel="-180° N"
                maxLabel="+180° N"
                value={state.panelAzimuthDeg - 180}
                min={-180}
                max={180}
                step={5}
                onChange={(value) => updateState('panelAzimuthDeg', ((value + 180) + 360) % 360)}
                onChangeEnd={() => triggerHeavyRecalc()}
              />

              <SliderControl
                title="Tilt"
                currentLabel={`${state.tiltDeg}°`}
                minLabel="min 0°"
                maxLabel="max 90°"
                value={state.tiltDeg}
                min={0}
                max={90}
                onChange={(value) => updateState('tiltDeg', value)}
                onChangeEnd={() => triggerHeavyRecalc()}
              />

              <SliderControl
                title="Row spacing (projected X gap)"
                currentLabel={`${state.rowSpacingM.toFixed(1)} m`}
                minLabel="min 0.0 m"
                maxLabel="max 3.0 m"
                value={state.rowSpacingM}
                min={0}
                max={3}
                step={0.1}
                onChange={(value) => updateState('rowSpacingM', value)}
                onChangeEnd={() => triggerHeavyRecalc()}
              />

              <SliderControl
                title="Gap between panels (cm)"
                currentLabel={`${(state.panelGapM * 100).toFixed(0)} cm`}
                minLabel="0 cm"
                maxLabel="100 cm"
                value={state.panelGapM * 100}
                min={0}
                max={100}
                step={1}
                onChange={(value) => updateState('panelGapM', value / 100)}
                onChangeEnd={() => triggerHeavyRecalc()}
              />

              <SliderControl
                title="Mounting height (cm)"
                currentLabel={`${state.mountHeightCm} cm`}
                minLabel="0 cm"
                maxLabel="100 cm"
                value={state.mountHeightCm}
                min={0}
                max={100}
                step={5}
                onChange={(value) => updateState('mountHeightCm', value)}
                onChangeEnd={() => triggerHeavyRecalc()}
              />

              <SliderControl
                title="Ground tilt"
                currentLabel={`${state.groundTiltDeg.toFixed(1)}°`}
                minLabel="min -10°"
                maxLabel="max 10°"
                value={state.groundTiltDeg}
                min={-10}
                max={10}
                step={0.1}
                onChange={(value) => updateState('groundTiltDeg', value)}
                onChangeEnd={() => triggerHeavyRecalc()}
              />

              <SliderControl
                title="Ground tilt direction"
                currentLabel={
                  state.groundTiltAzimuthDeg === 0
                    ? 'South (0°)'
                    : state.groundTiltAzimuthDeg === -90 || state.groundTiltAzimuthDeg === 90
                      ? `${state.groundTiltAzimuthDeg > 0 ? 'West' : 'East'} (${state.groundTiltAzimuthDeg}°)`
                      : state.groundTiltAzimuthDeg === 180 || state.groundTiltAzimuthDeg === -180
                        ? `North (${state.groundTiltAzimuthDeg}°)`
                        : `${state.groundTiltAzimuthDeg > 0 ? '+' : ''}${state.groundTiltAzimuthDeg}°`
                }
                minLabel="-180° N"
                maxLabel="+180° N"
                value={state.groundTiltAzimuthDeg}
                min={-180}
                max={180}
                step={5}
                onChange={(value) => updateState('groundTiltAzimuthDeg', value)}
                onChangeEnd={() => triggerHeavyRecalc()}
              />

              <SliderControl
                title="Performance ratio"
                currentLabel={state.performanceRatio.toFixed(2)}
                minLabel="min 0.60"
                maxLabel="max 0.90"
                value={state.performanceRatio}
                min={0.6}
                max={0.9}
                step={0.01}
                onChange={(value) => updateState('performanceRatio', value)}
                onChangeEnd={() => triggerHeavyRecalc()}
              />

              <SliderControl
                title="Panels per row"
                currentLabel={`${state.panelsPerRow} panels`}
                minLabel="min 1"
                maxLabel="max 100"
                value={state.panelsPerRow}
                min={1}
                max={100}
                onChange={(value) => updateState('panelsPerRow', value)}
                onChangeEnd={() => triggerHeavyRecalc()}
              />

              <SliderControl
                title="Rows"
                currentLabel={`${state.rowsCount} rows`}
                minLabel="min 1"
                maxLabel="max 5"
                value={state.rowsCount}
                min={1}
                max={5}
                onChange={(value) => updateState('rowsCount', value)}
                onChangeEnd={() => triggerHeavyRecalc()}
              />
            </Stack>
          </Card>
        </Grid.Col>

        {/* Results column */}
        <Grid.Col span={{ base: 12, md: 12, xl: 6 }}>
          <Stack gap="lg">
            <Card withBorder radius="lg" className="panel-card">
              <FieldScene3D
                rowsCount={state.rowsCount}
                panelsPerRow={state.panelsPerRow}
                rowPitchM={state.rowPitchM}
                panelWidthAcrossRowM={getPanelWidthAcrossRowMeters(panelSpec.lengthMm, panelSpec.widthMm, state.orientation)}
                metrics={metrics}
                panelAzimuthDeg={state.panelAzimuthDeg}
                groundTiltDeg={state.groundTiltDeg}
                groundTiltAzimuthDeg={state.groundTiltAzimuthDeg}
                rowShadingFractions={fieldShading.rowShadingFractions}
                panelGapM={state.panelGapM}
                windAzimuthDeg={state.windAzimuthDeg}
                windSpeedMs={state.windSpeedMs}
                mountHeightM={state.mountHeightCm / 100}
              />
            </Card>

            <SimpleGrid cols={{ base: 1, sm: 2, md: 3, xl: 3 }} spacing="sm">
              <Card withBorder radius="md" className="metric-card">
                <Text size="xs" c="dimmed">Max panel shading</Text>
                <Title order={3} c={fieldShading.maxPanelShadingPercent > 0 ? 'red' : undefined}>
                  {toFixed(fieldShading.maxPanelShadingPercent, 1)}%
                </Title>
                <Text size="xs" c="dimmed">Worst module</Text>
              </Card>

              <Card withBorder radius="md" className="metric-card">
                <Text size="xs" c="dimmed">Recommended tilt</Text>
                <Title order={3}>{metrics.recommendedTiltDeg}°</Title>
                <Text size="xs" c="dimmed">Current {state.tiltDeg}°</Text>
              </Card>

              <Card withBorder radius="md" className="metric-card">
                <Group justify="space-between" align="flex-start">
                  <Text size="xs" c="dimmed">{currentDate.toLocaleDateString('en-GB', { month: 'long' })} output</Text>
                  {yieldResult?.source === 'fallback' && (
                    <Badge size="xs" color="orange" variant="light">Fallback Mode</Badge>
                  )}
                </Group>
                <Title order={3}>{yieldResult ? `${toFixed(yieldResult.totalKwhMonth)} kWh` : '--'}</Title>
                <Text size="xs" c="dimmed">Per panel: {yieldResult ? `${toFixed(yieldResult.perPanelKwhMonth)} kWh` : '--'}</Text>
              </Card>

              <Card withBorder radius="md" className="metric-card">
                <Text size="xs" c="dimmed">Sun alt / az</Text>
                <Title order={3}>
                  {toFixed(metrics.solarAltitudeDeg, 1)}° / {toFixed(metrics.solarAzimuthDeg, 1)}°
                </Title>
                <Text size="xs" c="dimmed">Profile {toFixed(metrics.profileAltitudeDeg, 1)}°</Text>
              </Card>

              <Card withBorder radius="md" className="metric-card">
                <Text size="xs" c="dimmed">Incidence offset</Text>
                <Title order={3}>
                  {toFixed(Math.abs(metrics.azimuthOffsetDeg), 1)}°
                </Title>
                <Text size="xs" c="dimmed">Factor x{toFixed(metrics.incidenceFactor, 2)}</Text>
              </Card>

              <Card withBorder radius="md" className="metric-card">
                <Text size="xs" c="dimmed">Current power</Text>
                <Title order={3}>
                  {toFixed(currentPowerKw, 2)} kW
                </Title>
                <Text size="xs" c="dimmed">Instant clear-sky estimate</Text>
              </Card>

              <Card withBorder radius="md" className="metric-card">
                <Text size="xs" c="dimmed">System size</Text>
                <Title order={3}>{toFixed(totalSystemKw, 2)} kWp</Title>
                <Text size="xs" c="dimmed">{totalPanels} panels</Text>
              </Card>

              <Card withBorder radius="md" className="metric-card">
                <Text size="xs" c="dimmed">Field width</Text>
                <Title order={3}>{toFixed(totalProjectedFieldWidthM, 2)} m</Title>
                <Text size="xs" c="dimmed">Projected ground span</Text>
              </Card>

              <Card withBorder radius="md" className="metric-card">
                <Text size="xs" c="dimmed">DC combination</Text>
                <Title order={3}>
                  {toFixed(systemVoltage, 0)} V / {toFixed(systemCurrent, 1)} A
                </Title>
                <Text size="xs" c="dimmed">Operating (Vmp / Imp)</Text>
                {systemVoc > 0 && (
                  <Text size="xs" fw={600} c="orange.8" mt={4}>
                    Max Voc: {toFixed(systemVoc, 0)} V
                  </Text>
                )}
              </Card>

              <Card withBorder radius="md" className="metric-card">
                <Text size="xs" c="dimmed">Wind drag</Text>
                <Title order={3}>
                  {toFixed(windDragKg, 1)} kg
                </Title>
                <Text size="xs" c="dimmed">Horizontal force</Text>
              </Card>

              <Card withBorder radius="md" className="metric-card">
                <Text size="xs" c="dimmed">Lift force</Text>
                <Title order={3}>
                  {toFixed(windUpliftKg, 1)} kg
                </Title>
                <Text size="xs" c="dimmed">Vertical uplift force</Text>
              </Card>

              <Card withBorder radius="md" className="metric-card" bg="blue.9" c="white">
                <Text size="xs" c="blue.1">Total wind load</Text>
                <Title order={3} c="white">
                  {toFixed(windTotalKg, 1)} kg
                </Title>
                <Text size="xs" c="blue.1">Resultant vector force</Text>
              </Card>

            </SimpleGrid>

            <Group justify="space-between" px={2}>
              <Text size="xs" c={isYieldLoading ? 'yellow.3' : 'dimmed'}>
                {isYieldLoading ? 'Updating...' : yieldResult?.note ?? 'Ready'}
              </Text>
              <Badge variant="light" color={yieldResult?.source === 'fallback' ? 'orange' : 'cyan'}>
                {yieldResult?.source ?? 'pending'}
              </Badge>
            </Group>
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  )
}

export default App
