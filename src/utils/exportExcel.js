// Excel (.xlsx) report export via SheetJS. Same rule as the PDF exporter:
// only ever reads from a real solveRequiredDuty() result.

import * as XLSX from 'xlsx';
import { flowFromSI, pressureFromSI } from '../solver/fluidProps.js';
import { solvePipeSegment } from '../solver/pipeHydraulics.js';

const FLOW_UNIT = 'L/min';
const PRESSURE_UNIT = 'bar';

export function exportExcelReport({ nodes, edges, solveResult, fluid, fluidLabel, projectName = 'hydraulic-network' }) {
  const wb = XLSX.utils.book_new();

  if (!solveResult || !solveResult.ok) {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Solve result', 'NOT AVAILABLE'],
      ['Reason', 'The network could not be solved (missing pump or invalid topology).'],
      [],
      ['Warnings'],
      ...(solveResult?.warnings || []).map((w) => [w.type, w.message]),
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Summary');
    XLSX.writeFile(wb, sanitizeFilename(projectName) + '.xlsx');
    return;
  }

  const summaryRows = [
    ['Fluid', fluidLabel],
    ['Total demanded flow', flowFromSI(solveResult.totalFlowM3s, FLOW_UNIT), FLOW_UNIT],
    [
      'Required discharge pressure',
      solveResult.requiredDischargePressurePa !== undefined ? pressureFromSI(solveResult.requiredDischargePressurePa, PRESSURE_UNIT) : 'N/A',
      PRESSURE_UNIT,
    ],
    [
      'Available discharge pressure',
      solveResult.availableDischargePressurePa !== undefined ? pressureFromSI(solveResult.availableDischargePressurePa, PRESSURE_UNIT) : 'out of curve range',
      PRESSURE_UNIT,
    ],
    ['Duty check', solveResult.pass ? 'PASS' : 'FAIL'],
  ];
  if (solveResult.achievableDuty) {
    summaryRows.push([
      'Estimated achievable duty flow',
      flowFromSI(solveResult.achievableDuty.totalFlowM3s, FLOW_UNIT),
      FLOW_UNIT,
    ]);
  }
  if (solveResult.npsh) {
    summaryRows.push(['NPSH available', solveResult.npsh.npshAvailableM, 'm']);
    summaryRows.push(['NPSH required', solveResult.npsh.npshRequiredM, 'm']);
    summaryRows.push(['NPSH margin', solveResult.npsh.marginM, 'm']);
  }
  const summarySheet = XLSX.utils.aoa_to_sheet([['Metric', 'Value', 'Unit'], ...summaryRows]);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  const outletRows = nodes
    .filter((n) => n.type === 'outlet')
    .map((n) => [
      n.label,
      n.data.requiredFlowM3s !== undefined ? flowFromSI(n.data.requiredFlowM3s, FLOW_UNIT) : '',
      n.data.requiredPressurePa !== undefined ? pressureFromSI(n.data.requiredPressurePa, PRESSURE_UNIT) : '',
    ]);
  const outletSheet = XLSX.utils.aoa_to_sheet([
    ['Outlet', `Required flow (${FLOW_UNIT})`, `Required pressure (${PRESSURE_UNIT})`],
    ...outletRows,
  ]);
  XLSX.utils.book_append_sheet(wb, outletSheet, 'Outlets');

  const pipeRows = edges
    .map((edge) => {
      const flow = solveResult.edgeFlows?.get(edge.id);
      if (flow === undefined) return null;
      const seg = solvePipeSegment({
        flowM3s: flow,
        diameterM: edge.data.diameterM,
        lengthM: edge.data.lengthM,
        roughnessM: edge.data.roughnessM,
        density: fluid.density,
        viscosity: fluid.viscosity,
        kValues: edge.data.kValues || [],
        deltaZM: edge.data.deltaZM || 0,
      });
      return [
        edge.id,
        edge.from,
        edge.to,
        flowFromSI(flow, FLOW_UNIT),
        seg.velocity,
        seg.reynolds,
        seg.regime,
        pressureFromSI(seg.frictionLossPa, PRESSURE_UNIT),
        pressureFromSI(seg.minorLossPa, PRESSURE_UNIT),
        pressureFromSI(seg.elevationPa, PRESSURE_UNIT),
        pressureFromSI(seg.totalLossPa, PRESSURE_UNIT),
      ];
    })
    .filter(Boolean);
  const pipeSheet = XLSX.utils.aoa_to_sheet([
    [
      'Pipe',
      'From',
      'To',
      `Flow (${FLOW_UNIT})`,
      'Velocity (m/s)',
      'Reynolds',
      'Regime',
      `Friction loss (${PRESSURE_UNIT})`,
      `Minor loss (${PRESSURE_UNIT})`,
      `Elevation loss (${PRESSURE_UNIT})`,
      `Total loss (${PRESSURE_UNIT})`,
    ],
    ...pipeRows,
  ]);
  XLSX.utils.book_append_sheet(wb, pipeSheet, 'Pipes');

  const warningsSheet = XLSX.utils.aoa_to_sheet([
    ['Type', 'Message'],
    ...(solveResult.warnings || []).map((w) => [w.type, w.message]),
  ]);
  XLSX.utils.book_append_sheet(wb, warningsSheet, 'Warnings');

  XLSX.writeFile(wb, sanitizeFilename(projectName) + '.xlsx');
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9-_]+/gi, '_');
}
