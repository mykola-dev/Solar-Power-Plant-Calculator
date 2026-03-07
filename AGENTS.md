# AGENTS.md

## Project overview

Solar Tilt & Yield Calculator — a React single-page app for planning ground-mounted solar panel fields. Users adjust panel tilt, row spacing, ground slope, and orientation to see real-time 3D visualization, inter-row shading analysis, and estimated energy yield.

## Build, lint, test commands

```bash
# Development server
npm run dev

# Full build (type-check + bundle)
npm run build          # runs: tsc -b && vite build

# Lint
npm run lint           # runs: eslint .

# Type-check only (no emit)
npx tsc --noEmit

# Run all tests
npm test               # runs: vitest run

# Run a single test file
npx vitest run src/utils/solar3d.test.ts

# Run a single test by name
npx vitest run -t "shading is zero when sun is behind panels"
```

## Tech stack

- React 19, TypeScript 5.9, Vite 7, Vitest 4
- Mantine v8 (dark theme forced)
- @react-three/fiber + drei (3D visualization)
- suncalc (solar position calculations)
- ESLint with typescript-eslint, react-hooks, react-refresh

## TypeScript config

Strict mode is enabled with these additional checks:

- `noUnusedLocals: true` — no unused variables
- `noUnusedParameters: true` — no unused function parameters
- `verbatimModuleSyntax: true` — requires `import type` for type-only imports
- `noFallthroughCasesInSwitch: true`
- `erasableSyntaxOnly: true`

## Code style

### Formatting

- 2-space indentation
- Single quotes for strings
- Semicolons required
- Trailing commas in multi-line structures

### Functions

- Arrow functions for everything (no `function` keyword)
- `const` over `let`, never `var`
- No default exports except `App.tsx`

### Types

- Use `type` over `interface` (the codebase uses `type` exclusively)
- `import type { Foo }` for type-only imports (enforced by `verbatimModuleSyntax`)
- All shared types live in `src/types.ts`

### Naming

- `camelCase` for variables, functions, and file names
- `PascalCase` for types and React components
- `UPPER_SNAKE_CASE` for module-level constants (e.g. `DEG_TO_RAD`)

### Imports

```typescript
// Type-only imports MUST use `import type`
import type { CalculatorState } from '../types'

// Value imports are normal
import { calculateFieldShading } from './solar3d'
```

### Error handling

- No try/catch in calculation code — errors propagate
- API calls (e.g. Open-Meteo in `yieldEstimator.ts`) use try/catch with console.error

## Architecture notes

### Source of truth

The **math code** (`src/utils/`) is the source of truth. The 3D scene (`FieldScene3D.tsx`) is visualization only. If they disagree, fix the math, not the scene.

### Coordinate system

- **ENU** (East-North-Up): East=+X, North=+Y, Up=+Z
- ENU to Three.js mapping: `[enu.x, enu.z, -enu.y]`
- `compassDirectionENU(0)` = North, `compassDirectionENU(180)` = South

### Facing direction convention

- Panel azimuth slider: -180 to +180
- 0 = South (default), +90 = West, -90 = East, +/-180 = North
- Ground tilt azimuth: compass convention (0 = North, 180 = South)

### Row spacing model

```
rowPitchM   — anchor-to-anchor distance between rows (internal)
rowSpacingM — projected gap between panels = max(0, rowPitchM - panelRunM) (user-facing)
```

`withSpacingConstraint()` enforces `rowSpacingM >= 0` and expands `rowPitchM` if tilt changes would cause negative spacing.

### Shading model

Uses the **profile angle method** (2D cross-section, standard solar engineering approach). The 2D coordinate system: +x = away from sun, row 0 at x=0 (frontmost row). Shading is calculated per-row as a fraction of the panel run that is occluded by the adjacent row closer to the sun.

### 3D scene requirements

- Shadows on panels **must be visible** — `receiveShadow` must remain on panel meshes
- Dark theme only, no max-width constraint on the layout
- Scene height is 460px (set in CSS)

## Key files

```
src/App.tsx                    — Main app: all state, sliders, metric cards
src/types.ts                   — All shared types
src/components/FieldScene3D.tsx — 3D scene with shadows
src/components/SideView.tsx     — 2D side-view SVG diagram
src/utils/solar3d.ts            — Shading calculations (profile angle method)
src/utils/solar3d.test.ts       — 16 shading tests
src/utils/solarMath.ts          — Solar metrics, recommended tilt
src/utils/yieldEstimator.ts     — Monthly yield, Open-Meteo API
src/utils/constants.ts          — Month/time options, Kharkiv defaults
src/data/panelPresets.ts        — 6 panel presets
```

## Testing guidelines

- Tests use Vitest with `describe`/`it` blocks
- Shading tests verify edge cases: sun behind panels, side sun, spacing effects, ground tilt direction, row attribution, multi-row equality
- Always run `npm test` and `npm run build` after changes to verify nothing breaks
- When fixing bugs, add regression tests before marking as complete

## UI notes

- All slider/input controls use the existing `SliderControl` component pattern in `App.tsx`
- Portrait/Landscape orientation tabs are in the Panel & Time column
- No wasted space — the layout fills the full viewport width
