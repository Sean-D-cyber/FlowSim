// PDF report export. Reads only from a real solveRequiredDuty() result -
// never invents placeholder numbers. If the solve failed structurally
// (solveResult.ok === false), the report says so explicitly instead of
// printing blanks.

import { jsPDF } from 'jspdf';
import { flowFromSI, pressureFromSI } from '../solver/fluidProps.js';
import { solvePipeSegment } from '../solver/pipeHydraulics.js';

const FLOW_UNIT = 'L/min';
const PRESSURE_UNIT = 'bar';

export function exportPdfReport({ edges, solveResult, fluid, fluidLabel, projectName = 'Hydraulic Piping Design' }) {
  const doc = new jsPDF();
  let y = 15;
  const line = (text, size = 11, gap = 7) => {
    doc.setFontSize(size);
    doc.text(String(text), 14, y);
    y += gap;
  };

  line(projectName, 16, 10);
  line(`Generated ${new Date().toLocaleString()}`, 9, 8);
  line(`Fluid: ${fluidLabel}`, 10, 8);
  y += 2;

  if (!solveResult || !solveResult.ok) {
    line('SOLVE RESULT: NOT AVAILABLE', 13, 8);
    line(
      (solveResult?.warnings || []).map((w) => `- ${w.type}: ${w.message}`).join('\n') ||
        'The network could not be solved (missing pump or invalid topology). No results to report.',
      10,
      6
    );
    doc.save(sanitizeFilename(projectName) + '.pdf');
    return;
  }

  line('Pump Duty Summary', 13, 8);
  line(`Total demanded flow: ${flowFromSI(solveResult.totalFlowM3s, FLOW_UNIT).toFixed(1)} ${FLOW_UNIT}`);
  line(
    `Required discharge pressure: ${solveResult.requiredDischargePressurePa !== undefined ? pressureFromSI(solveResult.requiredDischargePressurePa, PRESSURE_UNIT).toFixed(2) + ' ' + PRESSURE_UNIT : 'N/A'}`
  );
  line(
    `Available discharge pressure: ${solveResult.availableDischargePressurePa !== undefined ? pressureFromSI(solveResult.availableDischargePressurePa, PRESSURE_UNIT).toFixed(2) + ' ' + PRESSURE_UNIT : 'out of pump curve range'}`
  );
  line(`Duty check: ${solveResult.pass ? 'PASS' : 'FAIL'}`);
  if (solveResult.achievableDuty) {
    line(
      `Estimated achievable duty: ${flowFromSI(solveResult.achievableDuty.totalFlowM3s, FLOW_UNIT).toFixed(1)} ${FLOW_UNIT} @ ${pressureFromSI(solveResult.achievableDuty.pressurePa || 0, PRESSURE_UNIT).toFixed(2)} ${PRESSURE_UNIT}`
    );
  }
  if (solveResult.npsh) {
    line(`NPSH available: ${solveResult.npsh.npshAvailableM.toFixed(2)} m, required: ${solveResult.npsh.npshRequiredM.toFixed(2)} m, margin: ${solveResult.npsh.marginM.toFixed(2)} m`);
  }
  y += 2;

  line('Warnings', 13, 8);
  if (!solveResult.warnings || solveResult.warnings.length === 0) {
    line('None.');
  } else {
    for (const w of solveResult.warnings) {
      if (y > 270) {
        doc.addPage();
        y = 15;
      }
      line(`[${w.type}] ${w.message}`, 9, 6);
    }
  }
  y += 4;

  line('Pipe Segments', 13, 8);
  doc.setFontSize(9);
  const headers = ['Pipe', 'Flow (L/min)', 'Vel (m/s)', 'Reynolds', 'Total loss (bar)'];
  doc.text(headers.join('   |   '), 14, y);
  y += 6;
  for (const edge of edges) {
    if (y > 270) {
      doc.addPage();
      y = 15;
    }
    const flow = solveResult.edgeFlows?.get(edge.id);
    if (flow === undefined) continue;
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
    doc.text(
      `${edge.id}   |   ${flowFromSI(flow, FLOW_UNIT).toFixed(1)}   |   ${seg.velocity.toFixed(2)}   |   ${Math.round(seg.reynolds)}   |   ${pressureFromSI(seg.totalLossPa, PRESSURE_UNIT).toFixed(3)}`,
      14,
      y
    );
    y += 6;
  }

  doc.save(sanitizeFilename(projectName) + '.pdf');
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9-_]+/gi, '_');
}
