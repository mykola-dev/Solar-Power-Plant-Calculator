export type Orientation = 'portrait' | 'landscape'

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
  panelsPerRow: number
  rowsCount: number
  rowPitchM: number
  rowSpacingM: number
  tiltDeg: number
  groundTiltDeg: number
  groundTiltAzimuthDeg: number
  orientation: Orientation
  panelAzimuthDeg: number
  latitude: number
  longitude: number
  monthIndex: number
  timeLabel: string
  performanceRatio: number
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
