import { Box, Text } from '@mantine/core'
import type { SolarMetrics } from '../types'
import { getProjectedSunRay } from '../utils/solarMath'

type SideViewProps = {
  rowsCount: number
  rowSpacingM: number
  metrics: SolarMetrics
  panelAzimuthDeg: number
  groundTiltDeg: number
}

type Point = { x: number; y: number }

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x

const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })

const intersectRayWithSegment = (rayOrigin: Point, rayDirection: Point, segA: Point, segB: Point) => {
  const segDirection = subtract(segB, segA)
  const denominator = cross(rayDirection, segDirection)

  if (Math.abs(denominator) < 1e-6) {
    return null
  }

  const delta = subtract(segA, rayOrigin)
  const rayT = cross(delta, segDirection) / denominator
  const segmentT = cross(delta, rayDirection) / denominator

  if (rayT < 0 || segmentT < 0 || segmentT > 1) {
    return null
  }

  return {
    x: rayOrigin.x + rayDirection.x * rayT,
    y: rayOrigin.y + rayDirection.y * rayT,
    rayT,
    segmentT,
  }
}

export function SideView({ rowsCount, rowSpacingM, metrics, panelAzimuthDeg, groundTiltDeg }: SideViewProps) {
  const width = 860
  const height = 360
  const baseGroundY = 300
  const safeLeft = 130
  const safeRight = 130
  const safeTop = 42
  const usableWidth = width - safeLeft - safeRight
  const usableHeight = baseGroundY - safeTop

  const { panelLeansLeft, sunRight, panelSouthProjection, rayDirection } = getProjectedSunRay({
    panelAzimuthDeg,
    solarAzimuthDeg: metrics.solarAzimuthDeg,
    profileAltitudeDeg: metrics.profileAltitudeDeg,
  })
  const rayDirectionScreen = {
    x: rayDirection.x,
    y: -rayDirection.y,
  }

  const panelProjectedRunM = Math.max(Math.abs(panelSouthProjection) * metrics.panelRunM, 0.05)
  const rowPitchM = rowSpacingM + panelProjectedRunM
  const rowsSpanWithWidthM = rowPitchM * Math.max(rowsCount - 1, 0)
  const totalHorizontalSpanM = Math.max(rowsSpanWithWidthM + panelProjectedRunM, 2.8)
  const scaleByWidth = usableWidth / totalHorizontalSpanM
  const targetTopHeightPx = height * 0.5
  const scaleByTargetHeight = targetTopHeightPx / Math.max(metrics.panelTopHeightM, 0.4)
  const scaleByHeight = usableHeight / Math.max(metrics.panelTopHeightM, 0.4)
  const scale = Math.min(scaleByWidth, scaleByHeight, scaleByTargetHeight)
  const rowsSpanPx = rowsSpanWithWidthM * scale
  const panelProjectedRunPx = Math.max(panelProjectedRunM * scale, 6)
  const topHeightPx = Math.min(Math.max(metrics.panelTopHeightM * scale, 14), targetTopHeightPx)
  const groundSlope = Math.tan((groundTiltDeg * Math.PI) / 180)
  const incomingRayLength = 260
  const totalSpanPx = rowsSpanPx + panelProjectedRunPx
  const centeredStartX = (width - totalSpanPx) / 2
  const firstBaseX = centeredStartX + (panelLeansLeft ? panelProjectedRunPx : 0)

  const groundYAt = (x: number) => baseGroundY - (x - width / 2) * groundSlope

  const rowGeometries = Array.from({ length: rowsCount }, (_, rowIndex) => {
    const x = firstBaseX + rowIndex * rowPitchM * scale
    const groundY = groundYAt(x)
    const panelTopX = x + (panelLeansLeft ? -panelProjectedRunPx : panelProjectedRunPx)
    const panelTopY = groundY - topHeightPx

    return {
      rowIndex,
      x,
      base: { x, y: groundY },
      top: { x: panelTopX, y: panelTopY },
      panelTopX,
      panelTopY,
      incomingRayStart: {
        x: panelTopX - rayDirectionScreen.x * incomingRayLength,
        y: panelTopY - rayDirectionScreen.y * incomingRayLength,
      },
    }
  })

  const minBaseX = rowGeometries.length > 0 ? Math.min(...rowGeometries.map((row) => row.base.x)) : safeLeft
  const maxBaseX = rowGeometries.length > 0 ? Math.max(...rowGeometries.map((row) => row.base.x)) : width - safeRight
  const groundLineStart = {
    x: safeLeft / 2,
    y: groundYAt(safeLeft / 2),
  }
  const groundLineEnd = {
    x: width - safeRight / 2,
    y: groundYAt(width - safeRight / 2),
  }

  const intersectRayWithGround = (origin: Point, direction: Point) => {
    const groundA: Point = { x: minBaseX - 380, y: groundYAt(minBaseX - 380) }
    const groundB: Point = { x: maxBaseX + 380, y: groundYAt(maxBaseX + 380) }
    const hit = intersectRayWithSegment(origin, direction, groundA, groundB)
    if (!hit) {
      return null
    }
    return { x: hit.x, y: hit.y, rayT: hit.rayT }
  }

  const darkerRaySegments = rowGeometries
    .map((targetRow, targetIndex) => {
      const hitOnPanel = rowGeometries
        .map((candidateRow, candidateIndex) => {
          if (candidateIndex === targetIndex) {
            return null
          }

          const hit = intersectRayWithSegment(targetRow.top, rayDirectionScreen, candidateRow.base, candidateRow.top)
          if (!hit || hit.rayT < 1e-4) {
            return null
          }

          return {
            x: hit.x,
            y: hit.y,
            rayT: hit.rayT,
          }
        })
        .filter((value): value is { x: number; y: number; rayT: number } => value !== null)
        .sort((a, b) => a.rayT - b.rayT)[0] ?? null

      const hitOnGround = intersectRayWithGround(targetRow.top, rayDirectionScreen)

      const panelDistance = hitOnPanel ? hitOnPanel.rayT : Number.POSITIVE_INFINITY
      const groundDistance = hitOnGround ? hitOnGround.rayT : Number.POSITIVE_INFINITY

      if (!Number.isFinite(panelDistance) && !Number.isFinite(groundDistance)) {
        return null
      }

      if (panelDistance <= groundDistance && hitOnPanel) {
        return {
          rowIndex: targetRow.rowIndex,
          from: targetRow.top,
          to: { x: hitOnPanel.x, y: hitOnPanel.y },
        }
      }

      if (hitOnGround) {
        return {
          rowIndex: targetRow.rowIndex,
          from: targetRow.top,
          to: { x: hitOnGround.x, y: hitOnGround.y },
        }
      }

      return null
    })
    .filter((value): value is { rowIndex: number; from: Point; to: Point } => value !== null)

  const panelShadows = rowGeometries
    .map((targetRow, targetIndex) => {
      const occluderIndex = sunRight ? targetIndex + 1 : targetIndex - 1
      const occluderRow = rowGeometries[occluderIndex]

      if (!occluderRow) {
        return null
      }

      const hit = intersectRayWithSegment(occluderRow.top, rayDirectionScreen, targetRow.base, targetRow.top)
      if (!hit) {
        return null
      }

      return {
        rowIndex: targetRow.rowIndex,
        from: targetRow.base,
        to: { x: hit.x, y: hit.y },
      }
    })
    .filter((value): value is { rowIndex: number; from: Point; to: Point } => value !== null)

  return (
    <Box>
      <Text size="sm" c="dimmed" mb={8}>
        Side-view preview: panel tilt, sunlight rays, and row shadow behavior
      </Text>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Solar panel side view">
        <defs>
          <linearGradient id="skyGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1f2942" />
            <stop offset="100%" stopColor="#101724" />
          </linearGradient>
          <linearGradient id="groundGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2f3a2f" />
            <stop offset="100%" stopColor="#1c271f" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width={width} height={height} fill="url(#skyGradient)" rx="14" />
        <polygon
          points={`${groundLineStart.x},${groundLineStart.y} ${groundLineEnd.x},${groundLineEnd.y} ${width},${height} 0,${height}`}
          fill="url(#groundGradient)"
        />

        <line
          x1={groundLineStart.x}
          y1={groundLineStart.y}
          x2={groundLineEnd.x}
          y2={groundLineEnd.y}
          stroke="#8ca37f"
          strokeWidth="2"
        />
        <text x={safeLeft / 2} y={groundLineStart.y + 20} fill="#a5b8d3" fontSize="12">
          N
        </text>
        <text x={width - safeRight / 2 - 10} y={groundLineEnd.y + 20} fill="#a5b8d3" fontSize="12">
          S
        </text>

        {rowGeometries.map(({ x, base, panelTopX, panelTopY }, rowIndex) => {
          return (
            <g key={`row-${rowIndex}`}>
              <line x1={x} y1={base.y} x2={panelTopX} y2={panelTopY} stroke="#80b7ff" strokeWidth="7" strokeLinecap="round" />
              <circle cx={x} cy={base.y} r="3.5" fill="#dae4f5" />
            </g>
          )
        })}

        {metrics.sunAboveHorizon ? (
          <>
            {rowGeometries.map(({ incomingRayStart, top, rowIndex }) => (
              <g key={`ray-${rowIndex}`}>
                <line
                  x1={incomingRayStart.x}
                  y1={incomingRayStart.y}
                  x2={top.x}
                  y2={top.y}
                  stroke="#ffd66f"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeDasharray="7 6"
                  strokeOpacity={0.8}
                />
              </g>
            ))}
            {darkerRaySegments.map((segment) => (
              <line
                key={`ray-dark-${segment.rowIndex}`}
                x1={segment.from.x}
                y1={segment.from.y}
                x2={segment.to.x}
                y2={segment.to.y}
                stroke="#ffd66f"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeDasharray="7 6"
                strokeOpacity={0.4}
              />
            ))}
            {panelShadows.map((shadow) => (
              <line
                key={`panel-shadow-${shadow.rowIndex}`}
                x1={shadow.from.x}
                y1={shadow.from.y}
                x2={shadow.to.x}
                y2={shadow.to.y}
                stroke="#0f141f"
                strokeOpacity="0.8"
                strokeWidth="7"
                strokeLinecap="round"
              />
            ))}
          </>
        ) : (
          <text x={width / 2} y={58} textAnchor="middle" fill="#d5dde8" fontSize="14">
            Sun is below horizon at selected time
          </text>
        )}

        <text x={18} y={24} fill="#d7deea" fontSize="13">
          Altitude: {metrics.solarAltitudeDeg.toFixed(1)}°
        </text>
        <text x={18} y={44} fill="#d7deea" fontSize="13">
          Ground shadow: {Number.isFinite(metrics.shadowLengthM) ? `${metrics.shadowLengthM.toFixed(2)} m` : 'long'}
        </text>
      </svg>
    </Box>
  )
}
