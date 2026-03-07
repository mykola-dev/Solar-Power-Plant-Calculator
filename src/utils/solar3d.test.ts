import { describe, expect, it } from 'vitest'
import { calculateFieldShading, compassDirectionENU, sunVectorToSkyENU } from './solar3d'

const baseInput = {
  rowsCount: 2,
  panelsPerRow: 4,
  rowSpacingM: 0,
  panelRunM: 1.2,
  panelTopHeightM: 1,
  panelWidthAcrossRowM: 1,
  panelAzimuthDeg: 180,
  solarAzimuthDeg: 180,
  solarAltitudeDeg: 20,
  sunAboveHorizon: true,
  frontSideIrradiance: true,
} as const

describe('calculateFieldShading', () => {
  it('returns zero when there is a single row', () => {
    const result = calculateFieldShading({ ...baseInput, rowsCount: 1 })
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
    const wide = calculateFieldShading({ ...baseInput, rowSpacingM: 4.5 })
    expect(wide.fieldShadingPercent).toBeLessThan(compact.fieldShadingPercent)
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

  it('keeps meaningful winter shading with small south ground tilt', () => {
    const result = calculateFieldShading({
      ...baseInput,
      panelRunM: 1.3017758813770872,
      panelTopHeightM: 0.9809584877378386,
      solarAzimuthDeg: 187.11,
      solarAltitudeDeg: 16.46,
      groundTiltDeg: 4,
      groundTiltAzimuthDeg: 0,
    })
    expect(result.maxPanelShadingPercent).toBeGreaterThan(10)
  })

  it('detects shading with diagonal sun when rows are close (strip model)', () => {
    // With tight spacing and a diagonal sun, the strip model should detect
    // shading even though the shadow falls laterally beyond the row width.
    const result = calculateFieldShading({
      ...baseInput,
      rowSpacingM: 0,
      panelRunM: 1.2,
      panelTopHeightM: 1.0,
      panelWidthAcrossRowM: 1.0,
      panelsPerRow: 2,
      solarAzimuthDeg: 200,
      solarAltitudeDeg: 15,
    })
    expect(result.maxPanelShadingPercent).toBeGreaterThan(0)
  })

  it('shows 23% shading when calculated with corrected physical gap', () => {
    // With 2.278m panel at 22° tilt, topHeight ≈ 0.853m, at sun alt 9.6°,
    // shadow extends ~5m. Row spacing is 2.7m (gap from Top0 to Base1).
    // The profile angle is ~11.6°. Solving the intersection yields ~23.25%
    const DEG = Math.PI / 180
    const panelRunM = 2.278 * Math.cos(22 * DEG)
    const panelTopHeightM = 2.278 * Math.sin(22 * DEG)
    const result = calculateFieldShading({
      ...baseInput,
      rowSpacingM: 2.7,
      panelRunM,
      panelTopHeightM,
      panelWidthAcrossRowM: 1.134,
      solarAzimuthDeg: 214.5,
      solarAltitudeDeg: 9.6,
    })
    expect(result.maxPanelShadingPercent).toBeCloseTo(23.25, 1)
  })

  it('attributes shading to the back row (farther from sun), not the front row', () => {
    // Sun from south (az=180) shades the north (back) row.
    // Row 0 = south (closest to sun), Row 1 = north (shaded by Row 0).
    const result = calculateFieldShading(baseInput)
    expect(result.rowShadingFractions[0]).toBe(0) // front row: no shading
    expect(result.rowShadingFractions[1]).toBeGreaterThan(0.15) // back row: shaded
  })

  it('produces correct magnitude for base case (~69.6% at 20° frontal sun, spacing=0)', () => {
    // Profile angle = 20° (frontal), row pitch = panelRunM = 1.2m, spacing = 0
    // Because Top0 is directly above Base1 when spacing=0, the ray intersects the panel directly.
    // Analytically segT ≈ 0.696
    const result = calculateFieldShading(baseInput)
    expect(result.maxPanelShadingPercent).toBeCloseTo(69.6, 1)
  })

  it('shades all back rows equally in a multi-row field', () => {
    // With 4 rows, rows 1-3 should all be equally shaded (by their respective front neighbor).
    // Row 0 (frontmost) should have no shading.
    const result = calculateFieldShading({ ...baseInput, rowsCount: 4 })
    expect(result.rowShadingFractions[0]).toBe(0)
    expect(result.rowShadingFractions[1]).toBeGreaterThan(0)
    expect(result.rowShadingFractions[2]).toBeCloseTo(result.rowShadingFractions[1], 6)
    expect(result.rowShadingFractions[3]).toBeCloseTo(result.rowShadingFractions[1], 6)
  })

  it('north-facing ground tilt toward sun direction increases shading', () => {
    // Ground tilt toward north (azimuth=0) slopes surface down northward,
    // lowering back rows → occluder top is relatively higher → more shading.
    const flat = calculateFieldShading({ ...baseInput })
    const northTilt = calculateFieldShading({
      ...baseInput,
      groundTiltDeg: 4,
      groundTiltAzimuthDeg: 0, // north
    })
    expect(northTilt.maxPanelShadingPercent).toBeGreaterThan(flat.maxPanelShadingPercent)
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
