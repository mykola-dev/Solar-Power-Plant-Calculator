import SunCalc from 'suncalc'
import type { PanelSpec, SolarMetrics } from '../types'

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const toRadians = (degrees: number) => degrees * DEG_TO_RAD

const toDegrees = (radians: number) => radians * RAD_TO_DEG

const normalizeAzimuth = (azimuthDeg: number) => {
  if (azimuthDeg < 0) {
    return azimuthDeg + 360
  }

  if (azimuthDeg >= 360) {
    return azimuthDeg - 360
  }

  return azimuthDeg
}

const normalizeSignedAngle = (angleDeg: number) => {
  let angle = ((angleDeg + 180) % 360 + 360) % 360 - 180
  if (angle === -180) {
    angle = 180
  }
  return angle
}

const panelLengthInViewMeters = (panel: PanelSpec, orientation: 'portrait' | 'landscape') => {
  const lengthMm = orientation === 'portrait' ? panel.lengthMm : panel.widthMm

  return lengthMm / 1000
}

const suncalcAzimuthToCompassDeg = (suncalcAzimuthRad: number) => {
  const suncalcDeg = toDegrees(suncalcAzimuthRad)
  const compass = normalizeAzimuth(suncalcDeg + 180)
  return compass
}

const getRecommendedTilt = (latitude: number, dayOfYear: number) => {
  // Solar declination via Spencer approximation: δ = 23.45° × sin(2π(284+n)/365)
  const declinationDeg = 23.45 * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365)
  // Optimal fixed tilt for single month ≈ latitude − declination (N hemisphere)
  // For S hemisphere panels face north, sign flips: |lat| + declination×sign(lat<0)
  const latSign = latitude >= 0 ? 1 : -1
  const optimalTilt = Math.abs(latitude) - latSign * declinationDeg
  return clamp(Math.round(optimalTilt), 0, 90)
}

export type SolarInput = {
  latitude: number
  longitude: number
  dayOfYear: number
  timeLabel: string
  tiltDeg: number
  panelAzimuthDeg: number
  rowSpacingM: number
  panelSpec: PanelSpec
  orientation: 'portrait' | 'landscape'
}

export const getDateFromDayOfYear = (dayOfYear: number) => {
  const year = new Date().getFullYear()
  // Month is 0-indexed, but day of month can overflow to the correct month
  const date = new Date(year, 0, dayOfYear, 12, 0, 0)
  // Ensure we stick to the correct year even if it's a leap year quirk
  if (date.getFullYear() > year) {
    date.setFullYear(year)
  }
  return date
}

export const getSunriseSunsetOptions = (latitude: number, longitude: number, date: Date): string[] => {
  const times = SunCalc.getTimes(date, latitude, longitude)
  const sunrise = times.sunrise
  const sunset = times.sunset

  if (Number.isNaN(sunrise.getTime()) || Number.isNaN(sunset.getTime())) {
    return ['12:00'] // Fallback if no sunrise/sunset (polar regions)
  }

  const options: string[] = []
  // Start from sunrise hour:minute, round up to next 10-minute interval
  const current = new Date(sunrise)
  const minutes = current.getMinutes()
  const remainder = minutes % 10
  if (remainder !== 0) {
    current.setMinutes(minutes + (10 - remainder))
  }
  current.setSeconds(0, 0)

  // Stop exactly at or just before sunset
  while (current <= sunset) {
    const hh = String(current.getHours()).padStart(2, '0')
    const mm = String(current.getMinutes()).padStart(2, '0')
    options.push(`${hh}:${mm}`)
    current.setMinutes(current.getMinutes() + 10)
  }

  return options.length > 0 ? options : ['12:00']
}

export const withTimeApplied = (baseDate: Date, timeLabel: string) => {
  const [hours, minutes] = timeLabel.split(':').map((part) => Number(part))
  const date = new Date(baseDate)
  date.setHours(hours, minutes, 0, 0)

  return date
}

export const calculateSolarMetrics = (input: SolarInput): SolarMetrics => {
  const representativeDate = getDateFromDayOfYear(input.dayOfYear)
  const selectedDate = withTimeApplied(representativeDate, input.timeLabel)
  const position = SunCalc.getPosition(selectedDate, input.latitude, input.longitude)
  const solarAltitudeDeg = toDegrees(position.altitude)
  const solarAzimuthDeg = suncalcAzimuthToCompassDeg(position.azimuth)
  const panelAzimuthDeg = input.panelAzimuthDeg
  const panelTiltRad = toRadians(input.tiltDeg)
  const altitudeRad = toRadians(solarAltitudeDeg)
  const azimuthOffsetDeg = normalizeSignedAngle(solarAzimuthDeg - panelAzimuthDeg)
  const azimuthDiffRad = toRadians(azimuthOffsetDeg)

  const cosIncidence =
    Math.sin(altitudeRad) * Math.cos(panelTiltRad) +
    Math.cos(altitudeRad) * Math.sin(panelTiltRad) * Math.cos(azimuthDiffRad)
  const incidenceFactor = clamp(cosIncidence, 0, 1)
  const incidenceAngleDeg = toDegrees(Math.acos(clamp(cosIncidence, -1, 1)))

  const panelLengthM = panelLengthInViewMeters(input.panelSpec, input.orientation)
  const panelTopHeightM = panelLengthM * Math.sin(panelTiltRad)
  const panelRunM = panelLengthM * Math.cos(panelTiltRad)

  const effectiveAltitude = clamp(solarAltitudeDeg, -90, 90)
  // frontSideIrradiance: sun actually hits the front face (cosIncidence > 0).
  // Previously used cos(azimuthDiff) > 0 which is wrong — a high sun at large azimuth
  // offset can still illuminate the front face when the panel is tilted.
  const isFrontFacing = cosIncidence > 0
  const sunAboveHorizon = effectiveAltitude > 0
  const profileAltitudeDeg = sunAboveHorizon
    ? toDegrees(Math.atan(Math.tan(altitudeRad) / Math.max(Math.abs(Math.cos(azimuthDiffRad)), 0.12)))
    : -Math.abs(effectiveAltitude)
  const profileIncidenceDeg = clamp(Math.abs((90 - input.tiltDeg) - profileAltitudeDeg), 0, 180)

  const shadowLengthM =
    sunAboveHorizon && isFrontFacing
      ? panelTopHeightM / Math.max(Math.tan(toRadians(Math.max(profileAltitudeDeg, 0.1))), 0.01)
      : Number.POSITIVE_INFINITY

  return {
    solarAltitudeDeg,
    solarAzimuthDeg,
    azimuthOffsetDeg,
    recommendedTiltDeg: getRecommendedTilt(input.latitude, input.dayOfYear),
    profileAltitudeDeg,
    profileIncidenceDeg,
    incidenceAngleDeg,
    incidenceFactor,
    panelTopHeightM,
    panelRunM,
    shadowLengthM,
    frontSideIrradiance: isFrontFacing,
    sunAboveHorizon,
  }
}

type Point = {
  x: number
  y: number
}

type ProjectedRayInput = {
  panelAzimuthDeg: number
  solarAzimuthDeg: number
  profileAltitudeDeg: number
}

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x

const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })

const intersectRayWithSegment = (rayOrigin: Point, rayDirection: Point, segA: Point, segB: Point) => {
  const segmentDirection = subtract(segB, segA)
  const denominator = cross(rayDirection, segmentDirection)

  if (Math.abs(denominator) < 1e-6) {
    return null
  }

  const delta = subtract(segA, rayOrigin)
  const rayT = cross(delta, segmentDirection) / denominator
  const segmentT = cross(delta, rayDirection) / denominator

  if (rayT < 0 || segmentT < 0 || segmentT > 1) {
    return null
  }

  return {
    segmentT,
  }
}

export const getProjectedSunRay = (input: ProjectedRayInput) => {
  const panelSouthProjection = Math.cos(toRadians(input.panelAzimuthDeg - 180))
  const sunSouthProjection = Math.cos(toRadians(input.solarAzimuthDeg - 180))
  const sunRight = sunSouthProjection >= 0
  const panelLeansLeft = panelSouthProjection >= 0
  const profileAngleRad = toRadians(Math.max(input.profileAltitudeDeg, 2))

  const rawDirection = {
    x: sunRight ? -1 : 1,
    y: -Math.tan(profileAngleRad),
  }
  const directionLength = Math.hypot(rawDirection.x, rawDirection.y)

  return {
    panelLeansLeft,
    sunRight,
    panelSouthProjection,
    rayDirection: {
      x: rawDirection.x / directionLength,
      y: rawDirection.y / directionLength,
    },
  }
}

type ShadingInput = {
  rowsCount: number
  rowSpacingM: number
  panelRunM: number
  panelTopHeightM: number
  panelAzimuthDeg: number
  solarAzimuthDeg: number
  profileAltitudeDeg: number
  sunAboveHorizon: boolean
}

export const calculateMaxPanelShadingPercent = (input: ShadingInput) => {
  if (input.rowsCount < 2 || !input.sunAboveHorizon) {
    return 0
  }

  const { panelLeansLeft, sunRight, panelSouthProjection, rayDirection } = getProjectedSunRay({
    panelAzimuthDeg: input.panelAzimuthDeg,
    solarAzimuthDeg: input.solarAzimuthDeg,
    profileAltitudeDeg: input.profileAltitudeDeg,
  })

  const panelProjectedRunM = Math.max(Math.abs(panelSouthProjection) * input.panelRunM, 0.01)
  const rowPitchM = input.rowSpacingM + panelProjectedRunM

  const rows = Array.from({ length: input.rowsCount }, (_, rowIndex) => {
    const baseX = rowIndex * rowPitchM
    const topX = baseX + (panelLeansLeft ? panelProjectedRunM : -panelProjectedRunM)

    return {
      base: { x: baseX, y: 0 },
      top: { x: topX, y: input.panelTopHeightM },
    }
  })

  let maxPercent = 0

  rows.forEach((targetRow, targetIndex) => {
    const occluderIndex = sunRight ? targetIndex + 1 : targetIndex - 1
    const occluderRow = rows[occluderIndex]
    if (!occluderRow) {
      return
    }

    const intersection = intersectRayWithSegment(occluderRow.top, rayDirection, targetRow.base, targetRow.top)
    if (!intersection) {
      return
    }

    const shadedPercent = clamp(intersection.segmentT * 100, 0, 100)
    if (shadedPercent > maxPercent) {
      maxPercent = shadedPercent
    }
  })

  return maxPercent
}
