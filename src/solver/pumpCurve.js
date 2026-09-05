// Pump curve representation, interpolation, CSV parsing, and simplified
// curve generation.
//
// A pump curve is an array of points sorted ascending by flow:
//   [{ flow: m3/s, pressure: Pa }, ...]
//
// Never extrapolate silently. interpolatePumpCurve() returns an
// OUT_OF_RANGE error object when asked for a flow outside the curve's
// domain, unless the caller explicitly passes allowExtrapolation: true.

import { flowToSI, pressureToSI } from './fluidProps.js';

/** Sort a curve ascending by flow and drop any duplicate-flow points. */
export function normalizeCurve(points) {
  const sorted = [...points].sort((a, b) => a.flow - b.flow);
  const deduped = [];
  for (const p of sorted) {
    if (deduped.length && deduped[deduped.length - 1].flow === p.flow) {
      deduped[deduped.length - 1] = p; // last one wins
    } else {
      deduped.push(p);
    }
  }
  return deduped;
}

/**
 * Linear interpolation of pump discharge pressure (Pa) at a given flow
 * (m3/s). Points must be pre-sorted ascending by flow (use
 * normalizeCurve first if unsure).
 *
 * Returns { pressure } on success, or { error: 'OUT_OF_RANGE', min, max }
 * when flowM3s falls outside the curve and allowExtrapolation is falsy.
 * With allowExtrapolation: true, extrapolates linearly using the nearest
 * end segment (and the result carries `extrapolated: true` so the UI can
 * flag it).
 */
export function interpolatePumpCurve(points, flowM3s, allowExtrapolation = false) {
  if (!points || points.length < 2) {
    return { error: 'INSUFFICIENT_POINTS' };
  }
  const curve = normalizeCurve(points);
  const min = curve[0].flow;
  const max = curve[curve.length - 1].flow;

  if (flowM3s < min || flowM3s > max) {
    if (!allowExtrapolation) {
      return { error: 'OUT_OF_RANGE', min, max };
    }
    const seg = flowM3s < min ? [curve[0], curve[1]] : [curve[curve.length - 2], curve[curve.length - 1]];
    const pressure = lerpSegment(seg[0], seg[1], flowM3s);
    return { pressure, extrapolated: true };
  }

  // Find the bracketing segment.
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (flowM3s >= a.flow && flowM3s <= b.flow) {
      return { pressure: lerpSegment(a, b, flowM3s) };
    }
  }
  // Should not happen given the range check above, but guard anyway.
  return { error: 'OUT_OF_RANGE', min, max };
}

function lerpSegment(a, b, flowM3s) {
  if (b.flow === a.flow) return a.pressure;
  const t = (flowM3s - a.flow) / (b.flow - a.flow);
  return a.pressure + t * (b.pressure - a.pressure);
}

/**
 * Parse a pump curve CSV. Accepts a header row with column names matching
 * (case-insensitively) one of the flow/pressure aliases below, or no
 * header at all (assumes column 0 = flow, column 1 = pressure/head).
 *
 * `flowUnit`/`pressureUnit` (or `headUnit` + density) describe the units
 * used in the file; values are converted to SI (m3/s, Pa) on the way in.
 * If the file provides head (m) instead of pressure, pass headUnit +
 * density instead of pressureUnit.
 */
export function parsePumpCurveCSV(csvText, { flowUnit = 'm3/h', pressureUnit = 'bar', density } = {}) {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { error: 'EMPTY_FILE' };

  let startIndex = 0;
  const firstCells = lines[0].split(/[,;\t]/).map((c) => c.trim().toLowerCase());
  const looksLikeHeader = firstCells.some((c) => /flow|pressure|head/.test(c));
  let flowCol = 0;
  let pressureCol = 1;
  let isHead = false;
  if (looksLikeHeader) {
    startIndex = 1;
    flowCol = firstCells.findIndex((c) => c.includes('flow'));
    let pCol = firstCells.findIndex((c) => c.includes('pressure'));
    if (pCol === -1) {
      pCol = firstCells.findIndex((c) => c.includes('head'));
      isHead = pCol !== -1;
    }
    if (flowCol === -1) flowCol = 0;
    if (pCol === -1) pCol = 1;
    pressureCol = pCol;
  }

  const points = [];
  for (let i = startIndex; i < lines.length; i++) {
    const cells = lines[i].split(/[,;\t]/).map((c) => c.trim());
    if (cells.length < 2) continue;
    const rawFlow = parseFloat(cells[flowCol]);
    const rawPressure = parseFloat(cells[pressureCol]);
    if (Number.isNaN(rawFlow) || Number.isNaN(rawPressure)) continue;
    const flow = flowToSI(rawFlow, flowUnit);
    let pressure;
    if (isHead) {
      if (!density) return { error: 'DENSITY_REQUIRED_FOR_HEAD' };
      pressure = rawPressure * density * 9.80665;
    } else {
      pressure = pressureToSI(rawPressure, pressureUnit);
    }
    points.push({ flow, pressure });
  }

  if (points.length < 2) return { error: 'INSUFFICIENT_POINTS' };
  return { points: normalizeCurve(points) };
}

/**
 * Generate a simplified quadratic pump curve from three characteristic
 * points: shutoff (flow=0), rated duty point, and a max-flow point.
 * Fits pressure = a*Q^2 + b*Q + c through the three points, then samples
 * it so the result behaves like any other curve for interpolation.
 *
 * All inputs SI. Returns { points } or { error }.
 */
export function generateSimplifiedCurve({
  shutoffPressure,
  dutyFlow,
  dutyPressure,
  maxFlow,
  maxFlowPressure = 0,
  samples = 12,
}) {
  if (!(maxFlow > dutyFlow && dutyFlow > 0)) {
    return { error: 'INVALID_CURVE_POINTS' };
  }
  // Solve for a, b, c in p(Q) = a*Q^2 + b*Q + c using the three points
  // (0, shutoff), (dutyFlow, dutyPressure), (maxFlow, maxFlowPressure).
  const c = shutoffPressure;
  // p1 = a*Q1^2 + b*Q1 + c
  // p2 = a*Q2^2 + b*Q2 + c
  const q1 = dutyFlow;
  const q2 = maxFlow;
  const p1 = dutyPressure - c;
  const p2 = maxFlowPressure - c;
  // Solve 2x2 linear system:
  // a*q1^2 + b*q1 = p1
  // a*q2^2 + b*q2 = p2
  const det = q1 * q1 * q2 - q2 * q2 * q1;
  if (det === 0) return { error: 'DEGENERATE_CURVE' };
  const a = (p1 * q2 - p2 * q1) / det;
  const b = (p2 * q1 * q1 - p1 * q2 * q2) / det;

  const points = [];
  for (let i = 0; i <= samples; i++) {
    const q = (maxFlow * i) / samples;
    points.push({ flow: q, pressure: a * q * q + b * q + c });
  }
  return { points };
}
