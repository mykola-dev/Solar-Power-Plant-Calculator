import type { FieldLayout, FieldShadingResult, Orientation, RowAlignment, RowConfig, RowLayout } from '../types'

export type Vec3 = {
  x: number
  y: number
  z: number
}

type FieldShadingInput = {
  rows: RowLayout[]
  rowHeightStepM?: number
  panelAzimuthDeg: number
  solarAzimuthDeg: number
  solarAltitudeDeg: number
  groundTiltDeg?: number
  groundTiltAzimuthDeg?: number
  sunAboveHorizon: boolean
  frontSideIrradiance: boolean
}

type Segment2D = {
  start: number
  end: number
}

type Point2D = {
  x: number
  y: number
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

export const getPanelWidthAcrossRowMeters = (lengthMm: number, widthMm: number, orientation: Orientation) =>
  (orientation === 'portrait' ? widthMm : lengthMm) / 1000

export const getPanelLengthInViewMeters = (lengthMm: number, widthMm: number, orientation: Orientation) =>
  (orientation === 'portrait' ? lengthMm : widthMm) / 1000

const overlapLength = (a: Segment2D, b: Segment2D) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))

export const normalizeRowConfigs = (rowConfigs: RowConfig[], rowsCount: number, fallback: RowConfig): RowConfig[] => {
  const safeRowsCount = Math.max(1, Math.round(rowsCount))
  const normalized: RowConfig[] = []

  for (let rowIndex = 0; rowIndex < safeRowsCount; rowIndex += 1) {
    const source = rowConfigs[rowIndex] ?? rowConfigs[rowConfigs.length - 1] ?? fallback
    normalized.push({
      orientation: source.orientation === 'landscape' ? 'landscape' : 'portrait',
      panelsCount: clamp(Math.round(source.panelsCount), 1, 100),
    })
  }

  return normalized
}

export const buildFieldLayout = ({
  rowConfigs,
  panelLengthMm,
  panelWidthMm,
  tiltDeg,
  rowSpacingM,
  panelGapM,
  rowAlignment,
}: {
  rowConfigs: RowConfig[]
  panelLengthMm: number
  panelWidthMm: number
  tiltDeg: number
  rowSpacingM: number
  panelGapM: number
  rowAlignment: RowAlignment
}): FieldLayout => {
  const tiltRad = tiltDeg * DEG_TO_RAD
  const safeGapM = Math.max(panelGapM, 0)
  const safeSpacingM = Math.max(rowSpacingM, 0)

  const rows = rowConfigs.map<RowLayout>((rowConfig, rowIndex) => {
    const panelLengthM = getPanelLengthInViewMeters(panelLengthMm, panelWidthMm, rowConfig.orientation)
    const panelRunM = panelLengthM * Math.cos(tiltRad)
    const panelTopHeightM = panelLengthM * Math.sin(tiltRad)
    const panelWidthAcrossRowM = getPanelWidthAcrossRowMeters(panelLengthMm, panelWidthMm, rowConfig.orientation)
    const rowLengthM = rowConfig.panelsCount * panelWidthAcrossRowM + Math.max(rowConfig.panelsCount - 1, 0) * safeGapM

    return {
      rowIndex,
      orientation: rowConfig.orientation,
      panelsCount: rowConfig.panelsCount,
      panelLengthM,
      panelRunM,
      panelTopHeightM,
      panelWidthAcrossRowM,
      panelGapM: safeGapM,
      rowLengthM,
      baseOffsetM: 0,
      leftEdgeOffsetM: 0,
    }
  })

  const fieldWidthM = rows.reduce((max, row) => Math.max(max, row.rowLengthM), 0)
  let nextOffsetM = 0

  rows.forEach((row) => {
    row.baseOffsetM = nextOffsetM
    nextOffsetM += row.panelRunM + safeSpacingM

    if (rowAlignment === 'left') {
      row.leftEdgeOffsetM = 0
    } else if (rowAlignment === 'right') {
      row.leftEdgeOffsetM = fieldWidthM - row.rowLengthM
    } else {
      row.leftEdgeOffsetM = (fieldWidthM - row.rowLengthM) / 2
    }
  })

  const fieldDepthM = rows.length > 0 ? rows[rows.length - 1].baseOffsetM + rows[rows.length - 1].panelRunM : 0

  return {
    rows,
    fieldWidthM,
    fieldDepthM,
  }
}

const rotatePoint = (point: Point2D, angleRad: number): Point2D => ({
  x: point.x * Math.cos(angleRad) - point.y * Math.sin(angleRad),
  y: point.x * Math.sin(angleRad) + point.y * Math.cos(angleRad),
})

const cross2D = (a: Point2D, b: Point2D) => a.x * b.y - a.y * b.x

type RowCrossSection = {
  base: Point2D
  top: Point2D
  lateral: Segment2D
}

const buildCrossSectionRows = (
  rows: RowLayout[],
  panelAzimuthDeg: number,
  groundTiltDeg: number,
  groundTiltAzimuthDeg: number,
  rowHeightStepM: number,
) => {
  const panelSouthProjection = Math.cos((panelAzimuthDeg - 180) * DEG_TO_RAD)
  const panelLeansLeft = panelSouthProjection >= 0
  const groundTiltAlongFaceRad = groundTiltDeg * DEG_TO_RAD * Math.cos((groundTiltAzimuthDeg - panelAzimuthDeg) * DEG_TO_RAD)

  return rows.map<RowCrossSection>((row, rowIndex) => {
    const projectedPanelRunM = Math.max(Math.abs(panelSouthProjection) * row.panelRunM, 0.01)
    const heightOffsetM = rowIndex * rowHeightStepM
    const baseFlat: Point2D = { x: row.baseOffsetM, y: 0 }
    const topFlat: Point2D = {
      x: row.baseOffsetM + (panelLeansLeft ? projectedPanelRunM : -projectedPanelRunM),
      y: row.panelTopHeightM,
    }
    const baseRotated = rotatePoint(baseFlat, groundTiltAlongFaceRad)
    const topRotated = rotatePoint(topFlat, groundTiltAlongFaceRad)

    return {
      base: { x: baseRotated.x, y: baseRotated.y + heightOffsetM },
      top: { x: topRotated.x, y: topRotated.y + heightOffsetM },
      lateral: {
        start: row.leftEdgeOffsetM,
        end: row.leftEdgeOffsetM + row.rowLengthM,
      },
    }
  })
}

/**
 * Inter-row shading with mixed row geometry.
 * Cross-section math handles height/run, lateral overlap handles row-length alignment,
 * and diagonal sun shifts the shadow along the row width.
 */
export const calculateFieldShading = (input: FieldShadingInput): FieldShadingResult => {
  const safeRows = input.rows
  const totalPanels = safeRows.reduce((sum, row) => sum + row.panelsCount, 0)

  if (!input.sunAboveHorizon) {
    return {
      fieldShadingPercent: 100,
      maxPanelShadingPercent: 100,
      rowShadingFractions: Array.from({ length: safeRows.length }, () => 1),
      panelShadingFractions: Array.from({ length: totalPanels }, () => 1),
    }
  }

  if (safeRows.length < 2 || !input.frontSideIrradiance) {
    return {
      fieldShadingPercent: 0,
      maxPanelShadingPercent: 0,
      rowShadingFractions: Array.from({ length: safeRows.length }, () => 0),
      panelShadingFractions: Array.from({ length: totalPanels }, () => 0),
    }
  }

  const rowHeightStepM = Math.max(input.rowHeightStepM ?? 0, 0)
  const groundTiltDeg = input.groundTiltDeg ?? 0
  const groundTiltAzimuthDeg = input.groundTiltAzimuthDeg ?? 0
  const rows2D = buildCrossSectionRows(safeRows, input.panelAzimuthDeg, groundTiltDeg, groundTiltAzimuthDeg, rowHeightStepM)

  const sunAltRad = input.solarAltitudeDeg * DEG_TO_RAD
  const azimuthOffsetRad = (input.solarAzimuthDeg - input.panelAzimuthDeg) * DEG_TO_RAD
  const cosAzOff = Math.cos(azimuthOffsetRad)
  const profileAngleRad = Math.atan(Math.tan(sunAltRad) / Math.max(Math.abs(cosAzOff), 0.01))
  const profileAngleClamped = Math.max(profileAngleRad, 0.005)
  const panelAxisOffsetRad = (input.solarAzimuthDeg - input.panelAzimuthDeg - 90) * DEG_TO_RAD
  const lateralShiftPerDepth = Math.tan(panelAxisOffsetRad)
  const sunSouthProjection = Math.cos((input.solarAzimuthDeg - 180) * DEG_TO_RAD)
  const sunFromFront = sunSouthProjection >= 0
  const rayDx = sunFromFront ? 1 : -1
  const rayDy = -Math.tan(profileAngleClamped)
  const rayLen = Math.hypot(rayDx, rayDy)
  const rayDir: Point2D = { x: rayDx / rayLen, y: rayDy / rayLen }

  const rowShadingFractions: number[] = []
  const panelShadingFractions: number[] = []
  let weightedShadeSum = 0

  for (let targetIdx = 0; targetIdx < safeRows.length; targetIdx += 1) {
    const occluderIdx = sunFromFront ? targetIdx - 1 : targetIdx + 1
    let rowFraction = 0

    if (occluderIdx >= 0 && occluderIdx < safeRows.length) {
      const occluder = rows2D[occluderIdx]
      const target = rows2D[targetIdx]
      const segDir: Point2D = { x: target.top.x - target.base.x, y: target.top.y - target.base.y }
      const delta: Point2D = { x: target.base.x - occluder.top.x, y: target.base.y - occluder.top.y }
      const denom = cross2D(rayDir, segDir)

      if (Math.abs(denom) > 1e-9) {
        const rayT = cross2D(delta, segDir) / denom
        const segT = cross2D(delta, rayDir) / denom

        if (rayT > 0 && segT > 0 && segT <= 1) {
          const crossSectionFraction = clamp(segT, 0, 1)
          const shadowShiftM = lateralShiftPerDepth * (target.base.x - occluder.top.x)
          const shiftedShadow: Segment2D = {
            start: occluder.lateral.start + shadowShiftM,
            end: occluder.lateral.end + shadowShiftM,
          }
          const overlapM = overlapLength(shiftedShadow, target.lateral)
          const overlapFraction = target.lateral.end > target.lateral.start ? overlapM / (target.lateral.end - target.lateral.start) : 0
          rowFraction = clamp(crossSectionFraction * overlapFraction, 0, 1)
        } else if (rayT > 0 && segT > 1) {
          const shadowShiftM = lateralShiftPerDepth * (target.base.x - occluder.top.x)
          const shiftedShadow: Segment2D = {
            start: occluder.lateral.start + shadowShiftM,
            end: occluder.lateral.end + shadowShiftM,
          }
          const overlapM = overlapLength(shiftedShadow, target.lateral)
          const overlapFraction = target.lateral.end > target.lateral.start ? overlapM / (target.lateral.end - target.lateral.start) : 0
          rowFraction = clamp(overlapFraction, 0, 1)
        }
      }
    }

    rowShadingFractions.push(rowFraction)
    weightedShadeSum += rowFraction * safeRows[targetIdx].panelsCount
    for (let panelIndex = 0; panelIndex < safeRows[targetIdx].panelsCount; panelIndex += 1) {
      panelShadingFractions.push(rowFraction)
    }
  }

  const maxPanelFraction = panelShadingFractions.reduce((max, value) => Math.max(max, value), 0)
  const fieldFraction = totalPanels > 0 ? weightedShadeSum / totalPanels : 0

  return {
    fieldShadingPercent: clamp(fieldFraction * 100, 0, 100),
    maxPanelShadingPercent: clamp(maxPanelFraction * 100, 0, 100),
    rowShadingFractions,
    panelShadingFractions,
  }
}
