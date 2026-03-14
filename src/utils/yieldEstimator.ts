import type { PanelSpec, YieldResult } from '../types'
import { calculateSolarMetrics, getDateFromDayOfYear, getSunriseSunsetOptions } from './solarMath'

const cache = new Map<string, YieldResult>()

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const toOpenMeteoAzimuth = (compassDeg: number) => {
  const shifted = ((compassDeg - 180 + 540) % 360) - 180
  return shifted
}

const getMonthDateRange = (dayOfYear: number) => {
  const now = new Date()
  const year = new Date(now.getFullYear(), 0, dayOfYear).getMonth() > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear()
  const monthIndex = new Date(year, 0, dayOfYear).getMonth()
  const start = new Date(Date.UTC(year, monthIndex, 1))
  const end = new Date(Date.UTC(year, monthIndex + 1, 0))
  const startDate = start.toISOString().slice(0, 10)
  const endDate = end.toISOString().slice(0, 10)

  return { startDate, endDate, monthDays: end.getUTCDate() }
}

const computeFallbackYield = (
  panelSpec: PanelSpec,
  panelCount: number,
  performanceRatio: number,
  dayOfYear: number,
  tiltDeg: number,
  latitude: number,
  longitude: number,
  panelAzimuthDeg: number,
  rowSpacingM: number,
  orientation: 'portrait' | 'landscape',
): YieldResult => {
  const systemKw = (panelSpec.powerW * panelCount) / 1000
  const monthIndex = new Date(new Date().getFullYear(), 0, dayOfYear).getMonth()

  // Base clear-sky seasonal irradiance (kWh/m²/day) for flat panels
  // Varies by month for Kharkiv-like latitudes as a baseline
  const seasonalFlatGhi = 3.1 + Math.cos(((monthIndex - 5) / 12) * Math.PI * 2) * 2.2

  // Daily Integration: Calculate the Ratio of Tilted light vs Flat light for a representative day
  const currentDate = getDateFromDayOfYear(dayOfYear)
  const timeOptions = getSunriseSunsetOptions(latitude, longitude, currentDate)

  let sumTilted = 0
  let sumFlat = 0

  for (const timeLabel of timeOptions) {
    // Tilted configuration
    const metricsTilted = calculateSolarMetrics({
      latitude,
      longitude,
      dayOfYear,
      timeLabel,
      tiltDeg,
      panelAzimuthDeg,
      panelSpec,
      rowSpacingM,
      orientation,
    })

    // Flat configuration (0 deg tilt)
    const metricsFlat = calculateSolarMetrics({
      latitude,
      longitude,
      dayOfYear,
      timeLabel,
      tiltDeg: 0,
      panelAzimuthDeg,
      panelSpec,
      rowSpacingM,
      orientation,
    })

    if (metricsFlat.sunAboveHorizon) {
      sumFlat += metricsFlat.incidenceFactor
      sumTilted += metricsTilted.incidenceFactor
    }
  }

  // The physics-based tilt factor is the ratio of daily integrated light
  const tiltFactor = sumFlat > 0 ? sumTilted / sumFlat : 1.0

  const monthDays = new Date(Date.UTC(new Date().getUTCFullYear(), monthIndex + 1, 0)).getUTCDate()
  const poaIrradianceKwhM2 = Math.max(seasonalFlatGhi, 0.8) * monthDays * tiltFactor

  // Shading usually only affects direct light (~85% of total in clear sky)
  const totalKwhMonth = poaIrradianceKwhM2 * systemKw * performanceRatio

  return {
    totalKwhMonth,
    perPanelKwhMonth: totalKwhMonth / panelCount,
    poaIrradianceKwhM2,
    avgSelectedTimeGtiWm2: (poaIrradianceKwhM2 * 1000) / (monthDays * 10),
    source: 'fallback',
    monthDays,
    note: 'Fallback mode: Yield estimated via physical solar integration (API offline).',
  }
}

type EstimateInput = {
  latitude: number
  longitude: number
  dayOfYear: number
  tiltDeg: number
  azimuthCompassDeg: number
  panelSpec: PanelSpec
  panelCount: number
  performanceRatio: number
  shadingLossFactor: number
  panelAzimuthDeg: number
  rowSpacingM: number
  orientation: 'portrait' | 'landscape'
}

export const estimateMonthlyYield = async (input: EstimateInput): Promise<YieldResult> => {
  const { startDate, endDate, monthDays } = getMonthDateRange(input.dayOfYear)
  const azimuth = toOpenMeteoAzimuth(input.azimuthCompassDeg)
  const monthIndex = new Date(new Date().getFullYear(), 0, input.dayOfYear).getMonth()
  const cacheKey = [
    input.latitude.toFixed(3),
    input.longitude.toFixed(3),
    monthIndex,
    input.tiltDeg.toFixed(1),
    azimuth.toFixed(0),
    input.panelSpec.powerW,
    input.panelCount,
    input.performanceRatio.toFixed(2),
    input.shadingLossFactor.toFixed(2),
  ].join('|')

  const cached = cache.get(cacheKey)
  if (cached) {
    return { ...cached, source: 'cache', note: 'Loaded from local cache.' }
  }

  try {
    const params = new URLSearchParams({
      latitude: input.latitude.toString(),
      longitude: input.longitude.toString(),
      start_date: startDate,
      end_date: endDate,
      timezone: 'auto',
      tilt: input.tiltDeg.toFixed(1),
      azimuth: azimuth.toFixed(1),
      hourly:
        'global_tilted_irradiance,direct_normal_irradiance,diffuse_radiation,sunshine_duration,cloud_cover,temperature_2m',
    })

    const response = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params.toString()}`)
    if (!response.ok) {
      throw new Error(`Open-Meteo response ${response.status}`)
    }

    const data = (await response.json()) as {
      hourly?: {
        time?: string[]
        global_tilted_irradiance?: number[]
      }
    }

    const time = data.hourly?.time ?? []
    const gti = data.hourly?.global_tilted_irradiance ?? []

    if (time.length === 0 || gti.length === 0) {
      throw new Error('No GTI data')
    }

    const avgSelectedTimeGtiWm2 = 0 // Deprecated field, handled by exact math

    const poaIrradianceKwhM2 = gti.reduce((sum, value) => sum + Math.max(value, 0), 0) / 1000
    const systemKw = (input.panelSpec.powerW * input.panelCount) / 1000

    // Improved Shading Model: 
    // Shading primarily blocks direct beam. Diffuse light (approx 15% of total GTI) 
    // is much less affected. 
    const shadedFraction = 1 - input.shadingLossFactor
    const effectiveShadingLoss = shadedFraction * 0.85 // 85% of GTI is shade-able direct
    const effectivePr = input.performanceRatio * (1 - effectiveShadingLoss)

    const totalKwhMonth = poaIrradianceKwhM2 * systemKw * effectivePr

    const result: YieldResult = {
      totalKwhMonth,
      perPanelKwhMonth: totalKwhMonth / input.panelCount,
      poaIrradianceKwhM2,
      avgSelectedTimeGtiWm2,
      source: 'weather-api',
      monthDays,
      note: `Based on Open-Meteo archive (${startDate} to ${endDate}).`,
    }

    cache.set(cacheKey, result)
    return result
  } catch {
    return computeFallbackYield(
      input.panelSpec,
      input.panelCount,
      input.performanceRatio * (0.15 + 0.85 * clamp(input.shadingLossFactor, 0.5, 1)),
      input.dayOfYear,
      input.tiltDeg,
      input.latitude,
      input.longitude,
      input.panelAzimuthDeg,
      input.rowSpacingM,
      input.orientation,
    )
  }
}
