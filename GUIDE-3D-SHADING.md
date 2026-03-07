# 3D Shading Guide

This project now uses a split model for shading:

- **Visualization:** interactive 3D scene using `@react-three/fiber` + `@react-three/drei`
- **Accuracy:** analytical 3D line-of-sight shading in `src/utils/solar3d.ts`

## Why this split

Rendered shadows are useful for exploration but can be noisy for precise percentages.
The app therefore computes the final field shading metric from analytical geometry.

## Input model

- `panelsPerRow` controls module count in each row.
- `rowsCount` controls row count.
- Total panels are derived: `totalPanels = panelsPerRow * rowsCount`.

## Field shading metric

`calculateFieldShading` returns:

- `fieldShadingPercent`: mean shaded area over all rows
- `rowShadingFractions`: per-row shaded fractions, used for scene tinting

The algorithm samples panel surfaces in 3D and checks if each sample point has a clear line of sight to the sun.

## 3D preview

`src/components/FieldScene3D.tsx` renders:

- ground plane
- panel rows in 3D
- directional sun light using `SunCalc` azimuth/altitude
- orbit camera controls

The scene is intentionally lightweight and oriented for quick interaction.

## Tests

Unit tests for the analytical model are in:

- `src/utils/solar3d.test.ts`

Run tests:

```bash
npm run test
```

Run production build validation:

```bash
npm run build
```
