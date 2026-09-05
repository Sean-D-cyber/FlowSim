// Fluid property presets and unit conversions.
//
// All solver internals work in SI units:
//   length      -> metres (m)
//   flow        -> cubic metres per second (m3/s)
//   pressure    -> pascals (Pa)
//   density     -> kilograms per cubic metre (kg/m3)
//   dynamic viscosity -> pascal-seconds (Pa.s)
//
// UI components convert to/from display units (L/min, bar, psi, mm, etc.)
// using the helpers below. Never let a display unit leak into the solver.

export const GRAVITY = 9.80665; // m/s^2
export const STANDARD_ATMOSPHERE_PA = 101325; // Pa

// Common fluid presets at ~20 C unless noted. Users may override density/
// viscosity directly; these are convenience starting points only.
export const FLUID_PRESETS = [
  {
    id: 'water-20c',
    label: 'Water (20 C)',
    density: 998.2, // kg/m3
    viscosity: 0.001002, // Pa.s
    vaporPressure: 2339, // Pa
  },
  {
    id: 'water-60c',
    label: 'Water (60 C)',
    density: 983.2,
    viscosity: 0.000467,
    vaporPressure: 19940,
  },
  {
    id: 'water-90c',
    label: 'Water (90 C)',
    density: 965.3,
    viscosity: 0.000315,
    vaporPressure: 70140,
  },
  {
    id: 'light-oil',
    label: 'Light hydraulic oil (20 C)',
    density: 870,
    viscosity: 0.032,
    vaporPressure: 100,
  },
  {
    id: 'seawater-20c',
    label: 'Seawater (20 C)',
    density: 1025,
    viscosity: 0.00108,
    vaporPressure: 2280,
  },
];

export function getFluidPreset(id) {
  return FLUID_PRESETS.find((f) => f.id === id) || FLUID_PRESETS[0];
}

// ---------------------------------------------------------------------------
// Flow conversions (internal: m3/s)
// ---------------------------------------------------------------------------

const FLOW_TO_M3S = {
  'm3/s': 1,
  'm3/h': 1 / 3600,
  'L/min': 1 / 60000,
  'L/s': 1 / 1000,
  gpm: 6.30902e-5, // US gallons per minute
};

export const FLOW_UNITS = Object.keys(FLOW_TO_M3S);

export function flowToSI(value, unit) {
  const factor = FLOW_TO_M3S[unit];
  if (factor === undefined) throw new Error(`Unknown flow unit: ${unit}`);
  return value * factor;
}

export function flowFromSI(valueM3s, unit) {
  const factor = FLOW_TO_M3S[unit];
  if (factor === undefined) throw new Error(`Unknown flow unit: ${unit}`);
  return valueM3s / factor;
}

// ---------------------------------------------------------------------------
// Pressure conversions (internal: Pa)
// ---------------------------------------------------------------------------

const PRESSURE_TO_PA = {
  Pa: 1,
  kPa: 1000,
  bar: 100000,
  psi: 6894.757293168,
  mH2O: 9806.65, // metres of water head, using standard gravity & ~1000 kg/m3
};

export const PRESSURE_UNITS = Object.keys(PRESSURE_TO_PA);

export function pressureToSI(value, unit) {
  const factor = PRESSURE_TO_PA[unit];
  if (factor === undefined) throw new Error(`Unknown pressure unit: ${unit}`);
  return value * factor;
}

export function pressureFromSI(valuePa, unit) {
  const factor = PRESSURE_TO_PA[unit];
  if (factor === undefined) throw new Error(`Unknown pressure unit: ${unit}`);
  return valuePa / factor;
}

// Convert a pressure (Pa) to head (m) for a given fluid density, and back.
export function pressureToHead(pa, density, g = GRAVITY) {
  return pa / (density * g);
}

export function headToPressure(headM, density, g = GRAVITY) {
  return headM * density * g;
}

// ---------------------------------------------------------------------------
// Length conversions (internal: m)
// ---------------------------------------------------------------------------

const LENGTH_TO_M = {
  m: 1,
  mm: 0.001,
  ft: 0.3048,
  in: 0.0254,
};

export const LENGTH_UNITS = Object.keys(LENGTH_TO_M);

export function lengthToSI(value, unit) {
  const factor = LENGTH_TO_M[unit];
  if (factor === undefined) throw new Error(`Unknown length unit: ${unit}`);
  return value * factor;
}

export function lengthFromSI(valueM, unit) {
  const factor = LENGTH_TO_M[unit];
  if (factor === undefined) throw new Error(`Unknown length unit: ${unit}`);
  return valueM / factor;
}
