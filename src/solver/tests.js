// Plain-Node test suite for the hydraulic solver. No browser, no test
// framework - just assertions. Run with `npm test` or
// `node src/solver/tests.js`.

import assert from 'node:assert/strict';
import { getFluidPreset } from './fluidProps.js';
import { solvePipeSegment } from './pipeHydraulics.js';
import { generateSimplifiedCurve } from './pumpCurve.js';
import { solveRequiredDuty } from './networkSolver.js';

const water = getFluidPreset('water-20c');

let passCount = 0;
function test(name, fn) {
  try {
    fn();
    passCount++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('Hydraulic solver test suite\n');

// ---------------------------------------------------------------------------
// 1. Single-outlet required duty
// ---------------------------------------------------------------------------

test('single-outlet required duty matches manual pipe-loss calculation', () => {
  const pipeData = {
    diameterM: 0.1,
    lengthM: 50,
    roughnessM: 0.00015,
    kValues: [0.5],
    deltaZM: 5,
  };
  const outletDuty = { requiredFlowM3s: 0.02, requiredPressurePa: 200000 };

  const nodes = [
    { id: 'pump1', type: 'pump', data: { curve: [{ flow: 0, pressure: 1000000 }, { flow: 1, pressure: 1000000 }] } },
    { id: 'outlet1', type: 'outlet', data: outletDuty },
  ];
  const edges = [{ id: 'e1', from: 'pump1', to: 'outlet1', data: pipeData }];

  const result = solveRequiredDuty(nodes, edges, water);
  assert.equal(result.ok, true);

  const expectedSeg = solvePipeSegment({
    flowM3s: outletDuty.requiredFlowM3s,
    density: water.density,
    viscosity: water.viscosity,
    ...pipeData,
  });
  const expectedRequired = outletDuty.requiredPressurePa + expectedSeg.totalLossPa;

  assert.ok(
    Math.abs(result.requiredDischargePressurePa - expectedRequired) < 1e-6,
    `expected ${expectedRequired}, got ${result.requiredDischargePressurePa}`
  );
  assert.ok(Math.abs(result.totalFlowM3s - outletDuty.requiredFlowM3s) < 1e-12);
  // Outlet's own required flow/pressure must be untouched (never overwritten).
  assert.equal(outletDuty.requiredFlowM3s, 0.02);
  assert.equal(outletDuty.requiredPressurePa, 200000);
});

// ---------------------------------------------------------------------------
// 2. Branch flow conservation
// ---------------------------------------------------------------------------

test('branch flow conservation: every pipe carries the sum of downstream demand', () => {
  const pipeData = { diameterM: 0.08, lengthM: 20, roughnessM: 0.00015, kValues: [], deltaZM: 0 };
  const qA = 0.01;
  const qB = 0.015;

  const nodes = [
    { id: 'pump1', type: 'pump', data: { curve: [{ flow: 0, pressure: 1000000 }, { flow: 1, pressure: 1000000 }] } },
    { id: 'junction1', type: 'junction', data: {} },
    { id: 'outletA', type: 'outlet', data: { requiredFlowM3s: qA, requiredPressurePa: 150000 } },
    { id: 'outletB', type: 'outlet', data: { requiredFlowM3s: qB, requiredPressurePa: 180000 } },
  ];
  const edges = [
    { id: 'e-main', from: 'pump1', to: 'junction1', data: pipeData },
    { id: 'e-a', from: 'junction1', to: 'outletA', data: pipeData },
    { id: 'e-b', from: 'junction1', to: 'outletB', data: pipeData },
  ];

  const result = solveRequiredDuty(nodes, edges, water);
  assert.equal(result.ok, true);
  assert.ok(Math.abs(result.edgeFlows.get('e-main') - (qA + qB)) < 1e-12);
  assert.ok(Math.abs(result.edgeFlows.get('e-a') - qA) < 1e-12);
  assert.ok(Math.abs(result.edgeFlows.get('e-b') - qB) < 1e-12);
  assert.ok(Math.abs(result.totalFlowM3s - (qA + qB)) < 1e-12);

  // The junction must be sized for whichever branch needs more pressure,
  // i.e. required pressure at the pump reflects the max of the two branches.
  assert.ok(result.requiredDischargePressurePa >= 180000);
});

// ---------------------------------------------------------------------------
// 3. Pressure margin PASS / FAIL against the pump curve
// ---------------------------------------------------------------------------

function simpleNetwork(curve) {
  const pipeData = { diameterM: 0.1, lengthM: 50, roughnessM: 0.00015, kValues: [0.5], deltaZM: 5 };
  const nodes = [
    { id: 'pump1', type: 'pump', data: { curve } },
    { id: 'outlet1', type: 'outlet', data: { requiredFlowM3s: 0.02, requiredPressurePa: 200000 } },
  ];
  const edges = [{ id: 'e1', from: 'pump1', to: 'outlet1', data: pipeData }];
  return { nodes, edges };
}

test('pump duty PASSes when the curve comfortably exceeds the requirement', () => {
  const { nodes, edges } = simpleNetwork([
    { flow: 0, pressure: 800000 },
    { flow: 1, pressure: 800000 },
  ]);
  const result = solveRequiredDuty(nodes, edges, water);
  assert.equal(result.pass, true);
  assert.ok(result.marginPa > 0);
  assert.equal(result.achievableDuty, undefined);
});

test('pump duty FAILs when the curve cannot meet the requirement, and reports an achievable duty', () => {
  const { nodes, edges } = simpleNetwork([
    { flow: 0, pressure: 150000 },
    { flow: 1, pressure: 50000 },
  ]);
  const result = solveRequiredDuty(nodes, edges, water);
  assert.equal(result.pass, false);
  assert.ok(result.marginPa < 0);
  assert.ok(result.achievableDuty, 'expected an achievable-duty estimate');
  assert.ok(result.achievableDuty.totalFlowM3s < 0.02, 'achievable flow should be less than the requested flow');
  assert.ok(result.achievableDuty.totalFlowM3s > 0);
});

// ---------------------------------------------------------------------------
// 4. Loop detection
// ---------------------------------------------------------------------------

test('a closed loop is detected and warned about, not silently solved', () => {
  const pipeData = { diameterM: 0.1, lengthM: 10, roughnessM: 0.00015, kValues: [], deltaZM: 0 };
  const nodes = [
    { id: 'pump1', type: 'pump', data: { curve: [{ flow: 0, pressure: 1000000 }, { flow: 1, pressure: 1000000 }] } },
    { id: 'j1', type: 'junction', data: {} },
    { id: 'j2', type: 'junction', data: {} },
    { id: 'outlet1', type: 'outlet', data: { requiredFlowM3s: 0.01, requiredPressurePa: 100000 } },
  ];
  const edges = [
    { id: 'e1', from: 'pump1', to: 'j1', data: pipeData },
    { id: 'e2', from: 'j1', to: 'j2', data: pipeData },
    { id: 'e3', from: 'j2', to: 'pump1', data: pipeData }, // closes the loop
    { id: 'e4', from: 'j2', to: 'outlet1', data: pipeData },
  ];

  const result = solveRequiredDuty(nodes, edges, water);
  assert.equal(result.ok, true, 'a loop should be warned about, not crash the solver');
  const loopWarnings = result.warnings.filter((w) => w.type === 'LOOP_DETECTED');
  assert.ok(loopWarnings.length >= 1, 'expected a LOOP_DETECTED warning');
});

test('a disconnected node is reported', () => {
  const pipeData = { diameterM: 0.1, lengthM: 10, roughnessM: 0.00015, kValues: [], deltaZM: 0 };
  const nodes = [
    { id: 'pump1', type: 'pump', data: { curve: [{ flow: 0, pressure: 1000000 }, { flow: 1, pressure: 1000000 }] } },
    { id: 'outlet1', type: 'outlet', data: { requiredFlowM3s: 0.01, requiredPressurePa: 100000 } },
    { id: 'strayOutlet', type: 'outlet', data: { requiredFlowM3s: 0.01, requiredPressurePa: 100000 } },
  ];
  const edges = [{ id: 'e1', from: 'pump1', to: 'outlet1', data: pipeData }];

  const result = solveRequiredDuty(nodes, edges, water);
  const disconnected = result.warnings.filter((w) => w.type === 'DISCONNECTED_NODE');
  assert.ok(disconnected.some((w) => w.nodeId === 'strayOutlet'));
});

test('missing pump produces MISSING_PUMP warning instead of crashing', () => {
  const result = solveRequiredDuty(
    [{ id: 'outlet1', type: 'outlet', data: { requiredFlowM3s: 0.01, requiredPressurePa: 100000 } }],
    [],
    water
  );
  assert.equal(result.ok, false);
  assert.ok(result.warnings.some((w) => w.type === 'MISSING_PUMP'));
});

test('missing outlet duty is flagged, not silently treated as satisfied', () => {
  const pipeData = { diameterM: 0.1, lengthM: 10, roughnessM: 0.00015, kValues: [], deltaZM: 0 };
  const nodes = [
    { id: 'pump1', type: 'pump', data: { curve: [{ flow: 0, pressure: 1000000 }, { flow: 1, pressure: 1000000 }] } },
    { id: 'outlet1', type: 'outlet', data: {} }, // no duty specified
  ];
  const edges = [{ id: 'e1', from: 'pump1', to: 'outlet1', data: pipeData }];
  const result = solveRequiredDuty(nodes, edges, water);
  assert.ok(result.warnings.some((w) => w.type === 'MISSING_OUTLET_DUTY'));
});

// ---------------------------------------------------------------------------
// 5. Pump curve out-of-range never extrapolates silently
// ---------------------------------------------------------------------------

test('pump curve refuses to extrapolate unless explicitly allowed', () => {
  const pipeData = { diameterM: 0.1, lengthM: 10, roughnessM: 0.00015, kValues: [], deltaZM: 0 };
  const nodes = [
    {
      id: 'pump1',
      type: 'pump',
      data: { curve: [{ flow: 0.001, pressure: 500000 }, { flow: 0.005, pressure: 400000 }] },
    },
    { id: 'outlet1', type: 'outlet', data: { requiredFlowM3s: 0.05, requiredPressurePa: 100000 } },
  ];
  const edges = [{ id: 'e1', from: 'pump1', to: 'outlet1', data: pipeData }];
  const result = solveRequiredDuty(nodes, edges, water);
  assert.ok(result.warnings.some((w) => w.type === 'PUMP_CURVE_OUT_OF_RANGE'));
  assert.equal(result.pass, false);
});

// ---------------------------------------------------------------------------
// 6. Simplified pump curve generation passes through its anchor points
// ---------------------------------------------------------------------------

test('generateSimplifiedCurve passes through its three anchor points', () => {
  const { points, error } = generateSimplifiedCurve({
    shutoffPressure: 600000,
    dutyFlow: 0.02,
    dutyPressure: 400000,
    maxFlow: 0.04,
    maxFlowPressure: 100000,
    samples: 20,
  });
  assert.equal(error, undefined);
  assert.ok(Math.abs(points[0].pressure - 600000) < 1e-6);
  const dutyPoint = points.find((p) => Math.abs(p.flow - 0.02) < 1e-9);
  assert.ok(dutyPoint, 'expected a sample exactly at the duty flow');
  assert.ok(Math.abs(dutyPoint.pressure - 400000) < 1);
  const lastPoint = points[points.length - 1];
  assert.ok(Math.abs(lastPoint.pressure - 100000) < 1);
});

console.log(`\n${passCount} test(s) passed.`);
if (process.exitCode) {
  console.error('\nSome tests FAILED.');
} else {
  console.log('All tests passed.');
}
