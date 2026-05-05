export type Orientation = 'portrait' | 'landscape'

export type RowAlignment = 'left' | 'center' | 'right'

export type RowConfig = {
  orientation: Orientation
  panelsCount: number
}

export type PanelPreset = {
  id: string
  brand: string
  model: string
  powerW: number
  lengthMm: number
  widthMm: number
  efficiency: number
  voc: number
  vmp: number
  isc: number
  imp: number
  cellType: string
}

export type PanelSpec = {
  powerW: number
  lengthMm: number
  widthMm: number
  efficiency: number
  voc: number
  vmp: number
  isc: number
  imp: number
}

export type CalculatorState = {
  panelSelection: string
  customPanel: PanelSpec
  rowConfigs: RowConfig[]
  rowsCount: number
  rowHeightStepCm: number
  rowSpacingM: number
  panelGapM: number
  tiltDeg: number
  groundTiltDeg: number
  groundTiltAzimuthDeg: number
  rowAlignment: RowAlignment
  panelAzimuthDeg: number
  latitude: number
  longitude: number
  dayOfYear: number
  timeLabel: string
  performanceRatio: number
  temperatureC: number
  windSpeedMs: number
  windAzimuthDeg: number
  mountHeightCm: number
}

export type RowLayout = {
  rowIndex: number
  orientation: Orientation
  panelsCount: number
  panelLengthM: number
  panelRunM: number
  panelTopHeightM: number
  panelWidthAcrossRowM: number
  panelGapM: number
  rowLengthM: number
  baseOffsetM: number
  leftEdgeOffsetM: number
}

export type FieldLayout = {
  rows: RowLayout[]
  fieldWidthM: number
  fieldDepthM: number
}

export type SolarMetrics = {
  solarAltitudeDeg: number
  solarAzimuthDeg: number
  azimuthOffsetDeg: number
  recommendedTiltDeg: number
  profileAltitudeDeg: number
  profileIncidenceDeg: number
  incidenceAngleDeg: number
  incidenceFactor: number
  panelTopHeightM: number
  panelRunM: number
  shadowLengthM: number
  frontSideIrradiance: boolean
  sunAboveHorizon: boolean
}

export type YieldResult = {
  totalKwhMonth: number
  perPanelKwhMonth: number
  poaIrradianceKwhM2: number
  avgSelectedTimeGtiWm2: number
  source: 'weather-api' | 'cache' | 'fallback'
  monthDays: number
  note: string
}

export type FieldShadingResult = {
  fieldShadingPercent: number
  maxPanelShadingPercent: number
  rowShadingFractions: number[]
  panelShadingFractions: number[]
}
