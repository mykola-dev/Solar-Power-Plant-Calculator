import { describe, expect, it } from 'vitest'
import { buildFieldLayout, calculateFieldShading, compassDirectionENU, sunVectorToSkyENU } from './solar3d'
import type { RowAlignment, RowConfig } from '../types'

const createRows = ({
  rowConfigs = [
    { orientation: 'portrait', panelsCount: 4 },
    { orientation: 'portrait', panelsCount: 4 },
  ],
  tiltDeg = 39.8,
  rowSpacingM = 0,
  panelGapM = 0,
  rowAlignment = 'center',
}: {
  rowConfigs?: RowConfig[]
  tiltDeg?: number
  rowSpacingM?: number
  panelGapM?: number
  rowAlignment?: RowAlignment
} = {}) =>
  buildFieldLayout({
    rowConfigs,
    panelLengthMm: 1562.05,
    panelWidthMm: 1000,
    tiltDeg,
    rowSpacingM,
    panelGapM,
    rowAlignment,
  }).rows

const baseInput = {
  rows: createRows(),
  rowHeightStepM: 0,
  panelAzimuthDeg: 180,
  solarAzimuthDeg: 180,
  solarAltitudeDeg: 20,
  sunAboveHorizon: true,
  frontSideIrradiance: true,
} as const

describe('calculateFieldShading', () => {
  it('returns zero when there is a single row', () => {
    const result = calculateFieldShading({ ...baseInput, rows: createRows({ rowConfigs: [{ orientation: 'portrait', panelsCount: 4 }] }) })
    expect(result.fieldShadingPercent).toBe(0)
  })

  it('returns 100% shading when sun is below horizon', () => {
    const result = calculateFieldShading({ ...baseInput, sunAboveHorizon: false })
    expect(result.fieldShadingPercent).toBe(100)
    expect(result.maxPanelShadingPercent).toBe(100)
  })

  it('returns zero when front side is not irradiated', () => {
    const result = calculateFieldShading({ ...baseInput, frontSideIrradiance: false })
    expect(result.fieldShadingPercent).toBe(0)
  })

  it('produces meaningful shading for low frontal sun with tight spacing', () => {
    const result = calculateFieldShading(baseInput)
    expect(result.maxPanelShadingPercent).toBeGreaterThan(15)
  })

  it('reduces shading when row spacing grows', () => {
    const compact = calculateFieldShading(baseInput)
    const wide = calculateFieldShading({ ...baseInput, rows: createRows({ rowSpacingM: 4.5 }) })
    expect(wide.fieldShadingPercent).toBeLessThan(compact.fieldShadingPercent)
  })

  it('reduces shading when each back row is elevated', () => {
    const flat = calculateFieldShading(baseInput)
    const elevated = calculateFieldShading({ ...baseInput, rowHeightStepM: 0.35 })
    expect(elevated.fieldShadingPercent).toBeLessThan(flat.fieldShadingPercent)
    expect(elevated.maxPanelShadingPercent).toBeLessThan(flat.maxPanelShadingPercent)
  })

  it('reduces shading when sun comes strongly from the side', () => {
    const frontal = calculateFieldShading(baseInput)
    const side = calculateFieldShading({ ...baseInput, solarAzimuthDeg: 110 })
    expect(side.maxPanelShadingPercent).toBeLessThan(frontal.maxPanelShadingPercent)
  })

  it('applies ground tilt to shading geometry', () => {
    const flat = calculateFieldShading({ ...baseInput, groundTiltDeg: 0 })
    const tilted = calculateFieldShading({ ...baseInput, groundTiltDeg: 8 })
    expect(Math.abs(tilted.maxPanelShadingPercent - flat.maxPanelShadingPercent)).toBeGreaterThan(0.1)
  })

  it('attributes shading to the back row, not the front row', () => {
    const result = calculateFieldShading(baseInput)
    expect(result.rowShadingFractions[0]).toBe(0)
    expect(result.rowShadingFractions[1]).toBeGreaterThan(0.15)
  })

  it('applies row height step between every adjacent pair', () => {
    const rows = createRows({
      rowConfigs: [
        { orientation: 'portrait', panelsCount: 4 },
        { orientation: 'portrait', panelsCount: 4 },
        { orientation: 'portrait', panelsCount: 4 },
        { orientation: 'portrait', panelsCount: 4 },
      ],
    })
    const flat = calculateFieldShading({ ...baseInput, rows })
    const stepped = calculateFieldShading({ ...baseInput, rows, rowHeightStepM: 0.15 })
    expect(stepped.rowShadingFractions[1]).toBeLessThan(flat.rowShadingFractions[1])
    expect(stepped.rowShadingFractions[2]).toBeCloseTo(stepped.rowShadingFractions[1], 6)
    expect(stepped.rowShadingFractions[3]).toBeCloseTo(stepped.rowShadingFractions[1], 6)
  })

  it('left alignment changes overlap for mixed row lengths', () => {
    const center = calculateFieldShading({
      ...baseInput,
      rows: createRows({
        rowConfigs: [
          { orientation: 'portrait', panelsCount: 6 },
          { orientation: 'portrait', panelsCount: 3 },
        ],
        rowSpacingM: 1.6,
        rowAlignment: 'center',
      }),
      solarAzimuthDeg: 205,
      solarAltitudeDeg: 14,
    })
    const left = calculateFieldShading({
      ...baseInput,
      rows: createRows({
        rowConfigs: [
          { orientation: 'portrait', panelsCount: 6 },
          { orientation: 'portrait', panelsCount: 3 },
        ],
        rowSpacingM: 1.6,
        rowAlignment: 'left',
      }),
      solarAzimuthDeg: 205,
      solarAltitudeDeg: 14,
    })
    expect(left.fieldShadingPercent).not.toBeCloseTo(center.fieldShadingPercent, 6)
  })

  it('mixed row orientation affects shading geometry', () => {
    const allPortrait = calculateFieldShading({
      ...baseInput,
      rows: createRows({
        rowConfigs: [
          { orientation: 'portrait', panelsCount: 4 },
          { orientation: 'portrait', panelsCount: 4 },
        ],
      }),
    })
    const mixed = calculateFieldShading({
      ...baseInput,
      rows: createRows({
        rowConfigs: [
          { orientation: 'landscape', panelsCount: 4 },
          { orientation: 'portrait', panelsCount: 4 },
        ],
      }),
    })
    expect(mixed.maxPanelShadingPercent).not.toBeCloseTo(allPortrait.maxPanelShadingPercent, 6)
  })
})

describe('solar compass basis', () => {
  it('maps cardinal directions in ENU correctly', () => {
    expect(compassDirectionENU(90).x).toBeCloseTo(1, 6)
    expect(compassDirectionENU(90).y).toBeCloseTo(0, 6)
    expect(compassDirectionENU(270).x).toBeCloseTo(-1, 6)
    expect(compassDirectionENU(270).y).toBeCloseTo(0, 6)
  })

  it('builds sun vector that points south at azimuth 180', () => {
    const sun = sunVectorToSkyENU(180, 20)
    expect(sun.y).toBeLessThan(0)
    expect(sun.z).toBeGreaterThan(0)
  })
})
