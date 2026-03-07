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
  monthOptions,
  timeOptions,
} from './utils/constants'
import { calculateSolarMetrics } from './utils/solarMath'
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
  panelsPerRow: 4,
  rowsCount: 2,
  rowPitchM: 3.2 + initialPanelRunM,
  rowSpacingM: 3.2,
  tiltDeg: 45,
  groundTiltDeg: 0,
  groundTiltAzimuthDeg: 0,
  orientation: 'portrait',
  panelAzimuthDeg: 180,
  latitude: kharkivDefaults.latitude,
  longitude: kharkivDefaults.longitude,
  monthIndex: new Date().getMonth(),
  timeLabel: '12:00',
  performanceRatio: 0.8,
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
  monthIndex: number
  timeLabel: string
  tiltDeg: number
  panelAzimuthDeg: number
  panelSpec: PanelSpec
  panelCount: number
  performanceRatio: number
  shadingLossFactor: number
}

const buildHeavyPayload = (calculatorState: CalculatorState): HeavyPayload => {
  const selectedPanel = getPanelSpecForState(calculatorState)
  const previewMetrics = calculateSolarMetrics({
    latitude: calculatorState.latitude,
    longitude: calculatorState.longitude,
    monthIndex: calculatorState.monthIndex,
    timeLabel: calculatorState.timeLabel,
    tiltDeg: calculatorState.tiltDeg,
    panelAzimuthDeg: calculatorState.panelAzimuthDeg,
    rowSpacingM: calculatorState.rowSpacingM,
    panelSpec: selectedPanel,
    orientation: calculatorState.orientation,
  })

  const panelWidthAcrossRowM = getPanelWidthAcrossRowMeters(
    selectedPanel.lengthMm,
    selectedPanel.widthMm,
    calculatorState.orientation,
  )
  const fieldShading = calculateFieldShading({
    rowsCount: calculatorState.rowsCount,
    panelsPerRow: calculatorState.panelsPerRow,
    rowSpacingM: calculatorState.rowSpacingM,
    panelRunM: previewMetrics.panelRunM,
    panelTopHeightM: previewMetrics.panelTopHeightM,
    panelWidthAcrossRowM,
    panelAzimuthDeg: calculatorState.panelAzimuthDeg,
    solarAzimuthDeg: previewMetrics.solarAzimuthDeg,
    solarAltitudeDeg: previewMetrics.solarAltitudeDeg,
      groundTiltDeg: calculatorState.groundTiltDeg,
      groundTiltAzimuthDeg: calculatorState.groundTiltAzimuthDeg,
      sunAboveHorizon: previewMetrics.sunAboveHorizon,
    frontSideIrradiance: previewMetrics.frontSideIrradiance,
  })
  const totalPanels = calculatorState.rowsCount * calculatorState.panelsPerRow

  return {
    latitude: calculatorState.latitude,
    longitude: calculatorState.longitude,
    monthIndex: calculatorState.monthIndex,
    timeLabel: calculatorState.timeLabel,
    tiltDeg: calculatorState.tiltDeg,
    panelAzimuthDeg: calculatorState.panelAzimuthDeg,
    panelSpec: selectedPanel,
    panelCount: totalPanels,
    performanceRatio: calculatorState.performanceRatio,
    shadingLossFactor: Math.max(0.55, 1 - fieldShading.maxPanelShadingPercent / 100),
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
      10,
    ),
    rowsCount: sanitizedRowsCount,
    rowPitchM: sanitizeNumber(
      candidate.rowPitchM,
      sanitizeNumber(candidate.rowSpacingM, initialState.rowSpacingM, 0, 10) + initialPanelRunM,
      0,
      20,
    ),
    rowSpacingM: sanitizeNumber(candidate.rowSpacingM, initialState.rowSpacingM, 0, 10),
    tiltDeg: sanitizeNumber(candidate.tiltDeg, initialState.tiltDeg, 0, 90),
    groundTiltDeg: sanitizeNumber(candidate.groundTiltDeg, initialState.groundTiltDeg, -10, 10),
    groundTiltAzimuthDeg: sanitizeNumber(candidate.groundTiltAzimuthDeg, initialState.groundTiltAzimuthDeg, -180, 180),
    orientation,
    panelAzimuthDeg: sanitizeNumber(candidate.panelAzimuthDeg, initialState.panelAzimuthDeg, 0, 360),
    latitude: sanitizeNumber(candidate.latitude, initialState.latitude, -90, 90),
    longitude: sanitizeNumber(candidate.longitude, initialState.longitude, -180, 180),
    monthIndex: sanitizeNumber(candidate.monthIndex, initialState.monthIndex, 0, 11),
    timeLabel:
      typeof candidate.timeLabel === 'string' && timeOptions.includes(candidate.timeLabel)
        ? candidate.timeLabel
        : initialState.timeLabel,
    performanceRatio: sanitizeNumber(candidate.performanceRatio, initialState.performanceRatio, 0.6, 0.9),
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
        monthIndex: state.monthIndex,
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
      state.monthIndex,
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
        monthIndex: heavyPayload.monthIndex,
        timeLabel: heavyPayload.timeLabel,
        tiltDeg: heavyPayload.tiltDeg,
        azimuthCompassDeg: heavyPayload.panelAzimuthDeg,
        panelSpec: heavyPayload.panelSpec,
        panelCount: heavyPayload.panelCount,
        performanceRatio: heavyPayload.performanceRatio,
        shadingLossFactor: heavyPayload.shadingLossFactor,
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
  }, [heavyPayload])

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
  const timeSliderIndex = Math.max(0, timeOptions.indexOf(state.timeLabel))

  const totalPanels = state.panelsPerRow * state.rowsCount
  const totalSystemKw = (panelSpec.powerW * totalPanels) / 1000
  const projectedPanelRunM = Math.abs(Math.cos(((state.panelAzimuthDeg - 180) * Math.PI) / 180)) * metrics.panelRunM
  const baseFieldWidthX =
    state.rowsCount > 0 ? state.rowsCount * projectedPanelRunM + Math.max(state.rowsCount - 1, 0) * state.rowSpacingM : 0
  const totalProjectedFieldWidthM = baseFieldWidthX * Math.cos((Math.abs(state.groundTiltDeg) * Math.PI) / 180)

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
                title="Month"
                currentLabel={monthOptions[state.monthIndex]}
                minLabel={monthOptions[0]}
                maxLabel={monthOptions[11]}
                value={state.monthIndex}
                min={0}
                max={11}
                step={1}
                onChange={(value) => updateState('monthIndex', value)}
                onChangeEnd={() => triggerHeavyRecalc()}
              />

              <SliderControl
                title="Time of day"
                currentLabel={state.timeLabel}
                minLabel={timeOptions[0]}
                maxLabel={timeOptions[timeOptions.length - 1]}
                value={timeSliderIndex}
                min={0}
                max={timeOptions.length - 1}
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
                maxLabel="max 10.0 m"
                value={state.rowSpacingM}
                min={0}
                max={10}
                step={0.1}
                onChange={(value) => updateState('rowSpacingM', value)}
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
                maxLabel="max 10"
                value={state.panelsPerRow}
                min={1}
                max={10}
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
                <Text size="xs" c="dimmed">{monthOptions[state.monthIndex]} output</Text>
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
                <Text size="xs" c="dimmed">Incidence X / Y</Text>
                <Title order={3}>
                  {toFixed(Math.abs(metrics.azimuthOffsetDeg), 1)}° / {toFixed(metrics.profileIncidenceDeg, 1)}°
                </Title>
                <Text size="xs" c="dimmed">Az offset {toFixed(metrics.azimuthOffsetDeg, 1)}°</Text>
              </Card>

              <Card withBorder radius="md" className="metric-card">
                <Text size="xs" c="dimmed">Shadow length</Text>
                <Title order={3}>
                  {Number.isFinite(metrics.shadowLengthM) ? `${toFixed(metrics.shadowLengthM)} m` : 'Long'}
                </Title>
                <Text size="xs" c="dimmed">Geometric estimate</Text>
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
                <Text size="xs" c="dimmed">Incidence factor</Text>
                <Title order={3}>{toFixed(metrics.incidenceFactor, 2)}</Title>
                <Text size="xs" c="dimmed">cos(incidence angle)</Text>
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
