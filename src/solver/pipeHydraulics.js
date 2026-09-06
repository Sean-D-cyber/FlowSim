// Single-pipe hydraulics: velocity, Reynolds number, friction factor,
// Darcy-Weisbach friction loss, K-value minor losses, and elevation head.
//
// All inputs/outputs are SI (metres, m3/s, kg/m3, Pa.s, Pa) unless noted.

import { GRAVITY } from './fluidProps.js';

/** Cross-sectional area of a circular pipe (m2) from internal diameter (m). */
export function pipeArea(diameterM) {
  if (diameterM <= 0) throw new Error('Pipe diameter must be positive');
  return (Math.PI / 4) * diameterM * diameterM;
}

/** Mean velocity (m/s) from volumetric flow (m3/s) and internal diameter (m). */
export function velocity(flowM3s, diameterM) {
  return flowM3s / pipeArea(diameterM);
}

/** Reynolds number (dimensionless). */
export function reynoldsNumber(velocityMs, diameterM, density, viscosity) {
  if (viscosity <= 0) throw new Error('Viscosity must be positive');
  return (density * Math.abs(velocityMs) * diameterM) / viscosity;
}

const LAMINAR_LIMIT = 2300;
const TURBULENT_LIMIT = 4000;

/**
 * Darcy friction factor.
 *  - Re <= 2300: laminar, f = 64/Re (exact).
 *  - Re >= 2300: turbulent/transitional, Haaland approximation to
 *    Colebrook-White (explicit, no iteration needed):
 *      1/sqrt(f) = -1.8 * log10( (roughness/(3.7*D))^1.11 + 6.9/Re )
 *
 * Between 2300 and 4000 is the "transitional" zone; true behaviour is
 * indeterminate, so we apply Haaland there too and flag it via the
 * returned `regime` field for the caller to surface as a warning if wanted.
 */
export function frictionFactor(reynolds, roughnessM, diameterM) {
  if (reynolds <= 0) {
    return { f: 0, regime: 'no-flow' };
  }
  if (reynolds <= LAMINAR_LIMIT) {
    return { f: 64 / reynolds, regime: 'laminar' };
  }
  const relRoughness = roughnessM / diameterM;
  const haaland =
    -1.8 * Math.log10(Math.pow(relRoughness / 3.7, 1.11) + 6.9 / reynolds);
  const f = Math.pow(1 / haaland, 2);
  const regime = reynolds < TURBULENT_LIMIT ? 'transitional' : 'turbulent';
  return { f, regime };
}

/** Darcy-Weisbach friction pressure drop (Pa) along a pipe run. */
export function darcyWeisbachLoss(f, lengthM, diameterM, velocityMs, density) {
  return f * (lengthM / diameterM) * (density * velocityMs * velocityMs) / 2;
}

/** Minor loss (Pa) from a fitting's K-value (velocity head coefficient). */
export function minorLoss(kValue, velocityMs, density) {
  return kValue * (density * velocityMs * velocityMs) / 2;
}

/** Sum of K-values -> single equivalent minor loss (Pa). */
export function totalMinorLoss(kValues, velocityMs, density) {
  const kSum = (kValues || []).reduce((sum, k) => sum + (k || 0), 0);
  return minorLoss(kSum, velocityMs, density);
}

/**
 * Elevation pressure change (Pa) for a rise of deltaZ metres (positive =
 * flowing upward, i.e. the pump must overcome this much extra pressure).
 */
export function elevationPressure(deltaZM, density, g = GRAVITY) {
  return density * g * deltaZM;
}

/**
 * Full pipe segment pressure drop (Pa), combining friction, minor losses,
 * and elevation change. `flowM3s` is the flow currently carried by this
 * segment (set by the network solver's flow-continuity pass, never solved
 * independently here).
 *
 * Returns a breakdown so the UI can show where losses come from.
 */
export function solvePipeSegment({
  flowM3s,
  diameterM,
  lengthM,
  roughnessM,
  density,
  viscosity,
  kValues = [],
  deltaZM = 0,
  g = GRAVITY,
}) {
  const v = velocity(flowM3s, diameterM);
  const re = reynoldsNumber(v, diameterM, density, viscosity);
  const { f, regime } = frictionFactor(re, roughnessM, diameterM);
  const frictionLossPa = darcyWeisbachLoss(f, lengthM, diameterM, v, density);
  const minorLossPa = totalMinorLoss(kValues, v, density);
  const elevationPa = elevationPressure(deltaZM, density, g);
  const totalLossPa = frictionLossPa + minorLossPa + elevationPa;
  return {
    velocity: v,
    reynolds: re,
    frictionFactor: f,
    regime,
    frictionLossPa,
    minorLossPa,
    elevationPa,
    totalLossPa,
  };
}
