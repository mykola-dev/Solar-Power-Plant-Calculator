import type { FieldShadingResult } from '../types'

export type Vec3 = {
  x: number
  y: number
  z: number
}

type FieldShadingInput = {
  rowsCount: number
  panelsPerRow: number
  rowSpacingM: number
  panelRunM: number
  panelTopHeightM: number
  panelWidthAcrossRowM: number
  panelAzimuthDeg: number
  solarAzimuthDeg: number
  solarAltitudeDeg: number
  groundTiltDeg?: number
  groundTiltAzimuthDeg?: number
  sunAboveHorizon: boolean
  frontSideIrradiance: boolean
}

const DEG_TO_RAD = Math.PI / 180

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const normalize = (value: Vec3): Vec3 => {
  const length = Math.hypot(value.x, value.y, value.z)
  if (length < 1e-9) {
    return { x: 0, y: 0, z: 0 }
  }

  return {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
  }
}

export const compassDirectionENU = (azimuthDeg: number): Vec3 => {
  const azimuthRad = azimuthDeg * DEG_TO_RAD
  return {
    x: Math.sin(azimuthRad),
    y: Math.cos(azimuthRad),
    z: 0,
  }
}

export const sunVectorToSkyENU = (solarAzimuthDeg: number, solarAltitudeDeg: number): Vec3 => {
  const azimuthRad = solarAzimuthDeg * DEG_TO_RAD
  const altitudeRad = solarAltitudeDeg * DEG_TO_RAD
  const horizontal = Math.cos(altitudeRad)

  return normalize({
    x: horizontal * Math.sin(azimuthRad),
    y: horizontal * Math.cos(azimuthRad),
    z: Math.sin(altitudeRad),
  })
}

export const enuToThree = (value: Vec3): [number, number, number] => [value.x, value.z, -value.y]

export const getPanelWidthAcrossRowMeters = (lengthMm: number, widthMm: number, orientation: 'portrait' | 'landscape') =>
  (orientation === 'portrait' ? widthMm : lengthMm) / 1000

/**
 * Inter-row shading using the **profile angle method** — the standard approach
 * in solar engineering.
 *
 * The 3D problem is reduced to a 2D cross-section perpendicular to the row axis:
 *   1. Compute the *profile angle* — the sun's apparent altitude when projected
 *      onto the plane perpendicular to the row axis.
 *   2. In this 2D view, each row is a line segment from its base (ground level)
 *      to its top (elevated edge). The shading cast by one row onto the next is
 *      determined by tracing a ray from the occluding row's top edge at the
 *      profile angle and finding where it intersects the target row's segment.
 *   3. All panels within a row receive the same shading fraction (uniform along
 *      the row axis).
 *
 * This correctly handles diagonal sun angles that caused the previous 3D
 * ray-tracing approach to overshoot panel bounds.
 */
export const calculateFieldShading = (input: FieldShadingInput): FieldShadingResult => {
  const safeRowsCount = Math.max(input.rowsCount, 0)
  const safePanelsPerRow = Math.max(input.panelsPerRow, 0)

  // Sun below horizon → all panels fully shaded (no direct sunlight)
  if (!input.sunAboveHorizon) {
    return {
      fieldShadingPercent: 100,
      maxPanelShadingPercent: 100,
      rowShadingFractions: Array.from({ length: safeRowsCount }, () => 1),
      panelShadingFractions: Array.from({ length: safeRowsCount * safePanelsPerRow }, () => 1),
    }
  }

  if (
    safeRowsCount < 2 ||
    safePanelsPerRow < 1 ||
    input.panelRunM <= 0 ||
    input.panelTopHeightM <= 0 ||
    input.panelWidthAcrossRowM <= 0 ||
    !input.frontSideIrradiance
  ) {
    return {
      fieldShadingPercent: 0,
      maxPanelShadingPercent: 0,
      rowShadingFractions: Array.from({ length: safeRowsCount }, () => 0),
      panelShadingFractions: Array.from({ length: safeRowsCount * safePanelsPerRow }, () => 0),
    }
  }

  // ----- Profile angle computation -----
  // The profile angle is the sun's apparent altitude projected onto the plane
  // perpendicular to the row axis.  For panel azimuth A and sun azimuth S:
  //   azimuthOffset = S − A
  //   profileAngle  = atan( tan(sunAlt) / |cos(azimuthOffset)| )
  // When the sun is nearly parallel to the rows (|cos(azOff)| → 0) the profile
  // angle approaches 90° and there is no inter-row shadow — which is correct.
  const sunAltRad = input.solarAltitudeDeg * DEG_TO_RAD
  const azimuthOffsetRad = (input.solarAzimuthDeg - input.panelAzimuthDeg) * DEG_TO_RAD
  const cosAzOff = Math.cos(azimuthOffsetRad)
  // Clamp denominator to avoid division by zero when sun is nearly along the rows
  const profileAngleRad = Math.atan(Math.tan(sunAltRad) / Math.max(Math.abs(cosAzOff), 0.01))

  // ----- 2D cross-section geometry -----
  // Convention matches solarMath.ts:
  //   x-axis = horizontal axis in the cross-section
  //   y-axis = vertical (up)
  //   Rows are spaced along x-axis at intervals of rowPitchM.
  //
  // panelSouthProjection projects the panel run onto the "south" axis to
  // determine how the panel leans in the cross-section.
  // For panelAz=180 (south-facing), panelSouthProjection=cos(0)=1, panel leans left.
  const panelSouthProjection = Math.cos((input.panelAzimuthDeg - 180) * DEG_TO_RAD)
  const panelLeansLeft = panelSouthProjection >= 0
  const projectedPanelRunM = Math.max(Math.abs(panelSouthProjection) * input.panelRunM, 0.01)
  const rowPitchM = input.rowSpacingM + projectedPanelRunM

  // Apply ground tilt: project the tilt onto the cross-section plane.
  // groundTiltAlongFaceRad is positive when the ground slopes down toward the
  // panel face direction (e.g., south for south-facing panels).
  //
  // UI convention: positive groundTiltDeg means "surface falls toward
  // groundTiltAzimuthDeg." In the 2D cross-section we need ground sloping
  // down toward north (+x) to LOWER northern points → clockwise rotation
  // (negative angle). cos(groundTiltAzDeg - panelAzDeg) is +1 when tilt
  // direction matches face direction (south), −1 when opposite (north).
  //
  // The sign is embedded in cos(groundTiltAzDeg - panelAzDeg):
  //   same direction → +1 → positive angle → CW rotation → lowers back rows
  //   opposite → -1 → negative angle → CCW rotation → raises back rows
  const groundTiltDeg = input.groundTiltDeg ?? 0
  const groundTiltAzDeg = input.groundTiltAzimuthDeg ?? 0
  const groundTiltAlongFaceRad = groundTiltDeg * DEG_TO_RAD *
    Math.cos((groundTiltAzDeg - input.panelAzimuthDeg) * DEG_TO_RAD)

  type Point2D = { x: number; y: number }

  const rotatePoint = (p: Point2D, angleRad: number): Point2D => ({
    x: p.x * Math.cos(angleRad) - p.y * Math.sin(angleRad),
    y: p.x * Math.sin(angleRad) + p.y * Math.cos(angleRad),
  })

  // Build row positions in 2D cross-section.
  // Row i: base at (i * rowPitchM, 0), top displaced by panel geometry.
  // Panel leans left (toward -x) when facing south — the back edge (base) is at ground level,
  // the top edge (front, south) is elevated and displaced backward.
  const rows2D: { base: Point2D; top: Point2D }[] = []
  for (let i = 0; i < safeRowsCount; i += 1) {
    const baseFlat: Point2D = { x: i * rowPitchM, y: 0 }
    const topFlat: Point2D = {
      x: i * rowPitchM + (panelLeansLeft ? projectedPanelRunM : -projectedPanelRunM),
      y: input.panelTopHeightM,
    }
    rows2D.push({
      base: rotatePoint(baseFlat, groundTiltAlongFaceRad),
      top: rotatePoint(topFlat, groundTiltAlongFaceRad),
    })
  }

  // ----- Sun direction in 2D cross-section -----
  // Cross-section layout: row 0 at x=0, row 1 at x=rowPitchM, etc.
  // For south-facing panels: +x = NORTH, row 0 is southernmost (closest to sun).
  //
  // sunSouthProjection: positive when sun is from the south half.
  // When positive, the sun illuminates from the -x side (toward row 0).
  //   → The FRONT row (row 0) casts shadow onto the BACK row (row 1).
  //   → Occluder for targetIdx is targetIdx - 1 (lower index = closer to sun).
  //   → Shadow ray goes in +x direction (away from the sun, toward higher indices).
  const sunSouthProjection = Math.cos((input.solarAzimuthDeg - 180) * DEG_TO_RAD)
  const sunFromLeft = sunSouthProjection >= 0 // sun illuminates from -x side

  // Shadow ray direction: from occluder top, going AWAY from the sun (downward at the profile angle).
  // Sun from left (-x) → shadow extends to the right (+x), so rayDx = +1.
  // Sun from right (+x) → shadow extends to the left (-x), so rayDx = -1.
  const profileAngleClamped = Math.max(profileAngleRad, 0.005)
  const rayDx = sunFromLeft ? 1 : -1
  const rayDy = -Math.tan(profileAngleClamped)
  const rayLen = Math.hypot(rayDx, rayDy)
  const rayDir: Point2D = { x: rayDx / rayLen, y: rayDy / rayLen }

  // ----- Compute shading for each row -----
  const cross2D = (a: Point2D, b: Point2D) => a.x * b.y - a.y * b.x

  const rowShadingFractions: number[] = []
  const panelShadingFractions: number[] = []

  for (let targetIdx = 0; targetIdx < safeRowsCount; targetIdx += 1) {
    // Occluder: the adjacent row on the sun's side (between the sun and the target).
    // Sun from left (-x): occluder is at lower index (targetIdx - 1).
    // Sun from right (+x): occluder is at higher index (targetIdx + 1).
    const occluderIdx = sunFromLeft ? targetIdx - 1 : targetIdx + 1

    let rowFraction = 0

    if (occluderIdx >= 0 && occluderIdx < safeRowsCount) {
      const occluder = rows2D[occluderIdx]
      const target = rows2D[targetIdx]

      // Trace ray from occluder's top edge in rayDir.
      // Find intersection with target panel segment (base → top).
      const segDir: Point2D = { x: target.top.x - target.base.x, y: target.top.y - target.base.y }
      const delta: Point2D = { x: target.base.x - occluder.top.x, y: target.base.y - occluder.top.y }
      const denom = cross2D(rayDir, segDir)

      if (Math.abs(denom) > 1e-9) {
        const rayT = cross2D(delta, segDir) / denom
        const segT = cross2D(delta, rayDir) / denom

        // rayT > 0 = forward along ray; segT ∈ [0,1] = within panel segment.
        // segT=0 at base, segT=1 at top.
        // Shadow covers base to intersection point.
        if (rayT > 0 && segT > 0 && segT <= 1) {
          rowFraction = clamp(segT, 0, 1)
        } else if (rayT > 0 && segT > 1) {
          // Shadow covers the entire panel
          rowFraction = 1
        }
      }
    }

    rowShadingFractions.push(rowFraction)
    for (let p = 0; p < safePanelsPerRow; p += 1) {
      panelShadingFractions.push(rowFraction)
    }
  }

  const maxPanelFraction = panelShadingFractions.reduce((max, value) => Math.max(max, value), 0)
  const fieldFraction = rowShadingFractions.reduce((sum, value) => sum + value, 0) / Math.max(rowShadingFractions.length, 1)

  return {
    fieldShadingPercent: clamp(fieldFraction * 100, 0, 100),
    maxPanelShadingPercent: clamp(maxPanelFraction * 100, 0, 100),
    rowShadingFractions,
    panelShadingFractions,
  }
}
