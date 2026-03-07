import type { PanelSpec, YieldResult } from '../types'

const cache = new Map<string, YieldResult>()

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const toOpenMeteoAzimuth = (compassDeg: number) => {
  const shifted = ((compassDeg - 180 + 540) % 360) - 180
  return shifted
}

const getMonthDateRange = (monthIndex: number) => {
  const now = new Date()
  const year = monthIndex > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear()
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
  monthIndex: number,
  tiltDeg: number,
): YieldResult => {
  const systemKw = (panelSpec.powerW * panelCount) / 1000
  const seasonal = 3.1 + Math.cos(((monthIndex - 5) / 12) * Math.PI * 2) * 2.2
  const tiltFactor = 0.85 + 0.15 * Math.cos(((tiltDeg - 35) * Math.PI) / 180)
  const monthDays = new Date(Date.UTC(new Date().getUTCFullYear(), monthIndex + 1, 0)).getUTCDate()
  const poaIrradianceKwhM2 = Math.max(seasonal, 0.8) * monthDays
  const totalKwhMonth = poaIrradianceKwhM2 * systemKw * performanceRatio

  return {
    totalKwhMonth,
    perPanelKwhMonth: totalKwhMonth / panelCount,
    poaIrradianceKwhM2: poaIrradianceKwhM2 * tiltFactor,
    avgSelectedTimeGtiWm2: (poaIrradianceKwhM2 * 1000) / (monthDays * 10),
    source: 'fallback',
    monthDays,
    note: 'Fallback seasonal model used (weather API unavailable).',
  }
}

type EstimateInput = {
  latitude: number
  longitude: number
  monthIndex: number
  timeLabel: string
  tiltDeg: number
  azimuthCompassDeg: number
  panelSpec: PanelSpec
  panelCount: number
  performanceRatio: number
  shadingLossFactor: number
}

export const estimateMonthlyYield = async (input: EstimateInput): Promise<YieldResult> => {
  const { startDate, endDate, monthDays } = getMonthDateRange(input.monthIndex)
  const azimuth = toOpenMeteoAzimuth(input.azimuthCompassDeg)
  const cacheKey = [
    input.latitude.toFixed(3),
    input.longitude.toFixed(3),
    input.monthIndex,
    input.timeLabel,
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

    const [selectedHour, selectedMinute] = input.timeLabel.split(':').map((item) => Number(item))
    const nearestHour = selectedMinute < 30 ? selectedHour : (selectedHour + 1) % 24
    const hourlyPairs = time.map((iso, index) => ({
      iso,
      gti: gti[index] ?? 0,
    }))

    const selectedTimeSamples = hourlyPairs.filter(({ iso }) => {
      const date = new Date(iso)
      return date.getHours() === nearestHour
    })

    const avgSelectedTimeGtiWm2 =
      selectedTimeSamples.length > 0
        ? selectedTimeSamples.reduce((sum, item) => sum + item.gti, 0) / selectedTimeSamples.length
        : 0

    const poaIrradianceKwhM2 = gti.reduce((sum, value) => sum + Math.max(value, 0), 0) / 1000
    const systemKw = (input.panelSpec.powerW * input.panelCount) / 1000
    const effectivePr = input.performanceRatio * clamp(input.shadingLossFactor, 0.45, 1)
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
      input.performanceRatio * clamp(input.shadingLossFactor, 0.5, 1),
      input.monthIndex,
      input.tiltDeg,
    )
  }
}
