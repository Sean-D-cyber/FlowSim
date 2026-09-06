# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Hydraulic Piping Designer - a React/Vite web app that models pump piping
networks (P&ID-style) and solves them in **Required Duty** mode: the user
specifies what each outlet needs (flow + residual pressure), and the app
solves *backwards* through the network for the pressure the pump must
produce, then checks that against the pump curve. Flow is always a design
input, never an output invented from spare pump pressure.

## Commands

```bash
npm install       # install deps (react, jspdf, xlsx, vite)
npm run dev        # start dev server
npm run build       # production build to dist/
npm run preview     # preview the production build
npm test          # node src/solver/tests.js - solver test suite, no browser needed
```

Run `npm test` after touching anything under `src/solver/` - it encodes the
spec's worked examples (single-outlet required duty, branch flow
conservation, pressure margin PASS/FAIL, loop detection) and is the fastest
way to catch a regression in the hydraulics.

## Architecture

```
src/
  solver/         Pure calculation functions - no React, no DOM, no UI state.
                   fluidProps.js      constants + unit conversions (SI internally)
                   pipeHydraulics.js  velocity, Reynolds, friction factor
                                     (laminar 64/Re, turbulent/transitional Haaland),
                                     Darcy-Weisbach, K-value minor losses, elevation
                   pumpCurve.js       linear interpolation (refuses to extrapolate
                                     unless allowExtrapolation is set), CSV parsing,
                                     simplified-curve generation
                   networkSolver.js   graph builder -> tree builder (detects loops/
                                     disconnected nodes) -> flow continuity pass ->
                                     backward required-pressure pass -> pump duty
                                     check -> bisection for "estimated achievable
                                     duty" when duty fails -> NPSH estimate
                   tests.js           plain-Node assertions against the spec examples
  model/          Node/edge factories (createComponent.js), undo/redo history stack
  constants/      Toolbar palette, default K-values, nominal pipe size table
  components/     React UI only - Toolbar, Canvas (SVG P&ID + drag/pan/zoom/connect),
                   PropertiesPanel (inputs vs results, mobile bottom sheet),
                   PumpCurveEditor, WarningsPanel
  utils/          persistence.js (autosave/save/load JSON), exportReport.js (PDF via
                   jsPDF), exportExcel.js (XLSX via SheetJS) - both read only from
                   the last solver result, never placeholder data
  App.jsx         Owns all state, calls solveRequiredDuty(), passes results down as
                   plain data. Contains no hydraulics itself.
```

## Non-negotiable invariants

These come directly from the product spec - do not relax them when adding
features or refactoring:

1. **Outlet required flow and required residual pressure are inputs.** They
   are never overwritten by calculated values anywhere in the codebase.
2. **Flow is never derived from "spare" pump pressure.** In Required Duty
   mode, every pipe/fitting carries exactly the sum of required flows of the
   outlets downstream of it - see `computeEdgeFlows` in `networkSolver.js`.
   If you ever see a code path where flow is solved *from* available pump
   pressure rather than from outlet demand, that's a bug against the spec.
3. **Never extrapolate a pump curve silently.** `interpolatePumpCurve`
   returns `{ error: 'OUT_OF_RANGE' }` outside the curve unless the pump's
   `allowExtrapolation` flag is explicitly set by the user.
4. **Don't fake results on unsupported topology.** A closed loop, a
   disconnected component, a missing pump, or a missing outlet duty must
   produce a warning (see the `warnings` array threaded through
   `solveAtScale`/`solveRequiredDuty`), not a silently wrong number. This
   also applies to "Free System" mode (pump/system curve intersection),
   which is intentionally unimplemented - `App.jsx` shows a `NOT_IMPLEMENTED`
   warning instead of guessing at a natural operating point.
5. **Inputs and calculated results are visually and structurally separate**
   in `PropertiesPanel.jsx` (`INPUT` vs `RESULTS (CALCULATED)` sections) -
   keep that split when editing panels.
6. **PDF/Excel export must only read from a real solver result.** If
   `solveResult.ok` is false, the reports say so explicitly rather than
   emitting blank/placeholder numbers.

## Known simplifications (intentional, documented in README.md)

- Solver supports branching **tree** networks only; loops are detected and
  warned about, not solved.
- Relief valve open/closed status is computed from inlet pressure at the
  solved duty, but flow diverted through an open relief valve is not
  iteratively re-solved back through the network.
- Suction-side/NPSH inputs live on the pump's own "Suction side" properties
  block rather than being auto-linked to a Tank node placed on the canvas.
- Check valve reverse-installation is a manual flag, not derived from
  routing geometry.
- Node-to-node connections are centre-to-centre with simple L-shaped
  orthogonal routing rather than discrete multi-port connection points.

If you fix or remove one of these, update README.md's "Known
simplifications" section in the same change.

## Environment note

This project was originally authored in a sandbox with no network access,
so `npm install` was never run there. Correctness was instead verified via
`node src/solver/tests.js` (solver logic, no deps needed) and an esbuild
bundle pass over the whole app with `react`/`react-dom`/`xlsx`/`jspdf`
marked external (catches syntax errors and broken imports without needing
the deps installed). Do a normal `npm install && npm run dev` check after
any structural change, especially to `App.jsx` or `Canvas.jsx`.
