# Solar Tilt and Efficiency Calculator

Dark-theme frontend calculator for solar panel layout and monthly energy estimation.

## Features

- Panel presets from popular brands with auto-filled electrical and size parameters.
- Custom panel mode for manual voltage/current/size input.
- Inputs for panel count, rows, spacing, tilt, orientation, azimuth, location, month, and time.
- Side-view SVG visualization showing tilted rows, sun position, light ray, and shadow.
- Hybrid slider behavior: instant visual preview and heavy recalculation on mouse release.
- Approximate monthly output in kWh using Open-Meteo irradiance data with fallback model.

## Stack

- React + Vite + TypeScript
- Mantine UI
- SunCalc for solar geometry
- Open-Meteo archive API for weather-based irradiance

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Progress Tracking

Project phase and task tracking is maintained in `PROGRESS.md`.
