import React, { useEffect, useRef, useState } from 'react';
import { flowToSI, flowFromSI, pressureToSI, pressureFromSI } from '../solver/fluidProps.js';
import { parsePumpCurveCSV, generateSimplifiedCurve, normalizeCurve } from '../solver/pumpCurve.js';

const FLOW_DISPLAY_UNIT = 'm3/h';
const PRESSURE_DISPLAY_UNIT = 'bar';

let rowIdCounter = 0;
function nextRowId() {
  rowIdCounter += 1;
  return rowIdCounter;
}

function curveToRows(curve) {
  return (curve || []).map((p) => ({
    id: nextRowId(),
    flow: String(flowFromSI(p.flow, FLOW_DISPLAY_UNIT)),
    pressure: String(pressureFromSI(p.pressure, PRESSURE_DISPLAY_UNIT)),
  }));
}

/**
 * Editable table of pump curve points. Rows are kept as local draft state
 * (not derived straight from the `curve` prop) so a freshly-added blank
 * row survives being typed into - if rows were re-derived from `curve` on
 * every render, a still-incomplete row would be filtered out of the saved
 * curve and immediately vanish from the table. Local drafts only get
 * resynced from `curve` when it changes for a reason other than our own
 * last commit (e.g. a CSV import, a generated curve, or a loaded project).
 */
export default function PumpCurveEditor({ curve, onChange, allowExtrapolation, onAllowExtrapolationChange, density }) {
  const fileInputRef = useRef(null);
  const [csvError, setCsvError] = useState(null);
  const [simplified, setSimplified] = useState({ shutoff: '', dutyFlow: '', dutyPressure: '', maxFlow: '', maxFlowPressure: '0' });
  const [rows, setRows] = useState(() => curveToRows(curve));
  const lastEmittedRef = useRef(JSON.stringify(curve || []));

  useEffect(() => {
    const incoming = JSON.stringify(curve || []);
    if (incoming !== lastEmittedRef.current) {
      setRows(curveToRows(curve));
      lastEmittedRef.current = incoming;
    }
    // Only resync when the curve changed for a reason other than our own
    // commitRows() call below (which already updates lastEmittedRef).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curve]);

  function commitRows(newRows) {
    setRows(newRows);
    const points = newRows
      .filter((r) => r.flow !== '' && r.pressure !== '' && !Number.isNaN(Number(r.flow)) && !Number.isNaN(Number(r.pressure)))
      .map((r) => ({ flow: flowToSI(Number(r.flow), FLOW_DISPLAY_UNIT), pressure: pressureToSI(Number(r.pressure), PRESSURE_DISPLAY_UNIT) }));
    const normalized = normalizeCurve(points);
    lastEmittedRef.current = JSON.stringify(normalized);
    onChange(normalized);
  }

  function updateRow(id, field, value) {
    commitRows(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function addRow() {
    commitRows([...rows, { id: nextRowId(), flow: '', pressure: '' }]);
  }

  function removeRow(id) {
    commitRows(rows.filter((r) => r.id !== id));
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const result = parsePumpCurveCSV(String(reader.result), { flowUnit: FLOW_DISPLAY_UNIT, pressureUnit: PRESSURE_DISPLAY_UNIT });
      if (result.error) {
        setCsvError(`Could not parse CSV: ${result.error}`);
        return;
      }
      commitRows(curveToRows(result.points));
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function handleGenerateSimplified() {
    const result = generateSimplifiedCurve({
      shutoffPressure: pressureToSI(Number(simplified.shutoff), PRESSURE_DISPLAY_UNIT),
      dutyFlow: flowToSI(Number(simplified.dutyFlow), FLOW_DISPLAY_UNIT),
      dutyPressure: pressureToSI(Number(simplified.dutyPressure), PRESSURE_DISPLAY_UNIT),
      maxFlow: flowToSI(Number(simplified.maxFlow), FLOW_DISPLAY_UNIT),
      maxFlowPressure: pressureToSI(Number(simplified.maxFlowPressure || 0), PRESSURE_DISPLAY_UNIT),
    });
    if (result.error) {
      setCsvError(`Could not generate curve: ${result.error}`);
      return;
    }
    commitRows(curveToRows(result.points));
  }

  const chartPath = buildChartPath(rows);

  return (
    <div className="pump-curve-editor">
      <div className="pump-curve-chart-wrap">
        {chartPath ? (
          <svg viewBox="0 0 200 100" className="pump-curve-chart">
            <path d={chartPath} className="pump-curve-line" />
          </svg>
        ) : (
          <div className="pump-curve-empty">No curve points yet - add rows, upload a CSV, or generate a simplified curve.</div>
        )}
      </div>

      <table className="pump-curve-table">
        <thead>
          <tr>
            <th>Flow ({FLOW_DISPLAY_UNIT})</th>
            <th>Pressure ({PRESSURE_DISPLAY_UNIT})</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><input type="number" value={r.flow} onChange={(e) => updateRow(r.id, 'flow', e.target.value)} /></td>
              <td><input type="number" value={r.pressure} onChange={(e) => updateRow(r.id, 'pressure', e.target.value)} /></td>
              <td><button className="icon-btn" onClick={() => removeRow(r.id)} title="Remove point">✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="small-btn" onClick={addRow}>+ Add point</button>

      <div className="pump-curve-section">
        <label className="checkbox-label">
          <input type="checkbox" checked={!!allowExtrapolation} onChange={(e) => onAllowExtrapolationChange(e.target.checked)} />
          Allow extrapolation beyond curve range
        </label>
      </div>

      <details className="pump-curve-section">
        <summary>Import CSV</summary>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFile} />
        <p className="hint">Columns: flow ({FLOW_DISPLAY_UNIT}), pressure ({PRESSURE_DISPLAY_UNIT}). Header row optional.</p>
      </details>

      <details className="pump-curve-section">
        <summary>Generate simplified curve</summary>
        <div className="simplified-form">
          <label>Shutoff pressure ({PRESSURE_DISPLAY_UNIT})<input type="number" value={simplified.shutoff} onChange={(e) => setSimplified({ ...simplified, shutoff: e.target.value })} /></label>
          <label>Duty flow ({FLOW_DISPLAY_UNIT})<input type="number" value={simplified.dutyFlow} onChange={(e) => setSimplified({ ...simplified, dutyFlow: e.target.value })} /></label>
          <label>Duty pressure ({PRESSURE_DISPLAY_UNIT})<input type="number" value={simplified.dutyPressure} onChange={(e) => setSimplified({ ...simplified, dutyPressure: e.target.value })} /></label>
          <label>Max flow ({FLOW_DISPLAY_UNIT})<input type="number" value={simplified.maxFlow} onChange={(e) => setSimplified({ ...simplified, maxFlow: e.target.value })} /></label>
          <label>Pressure at max flow ({PRESSURE_DISPLAY_UNIT})<input type="number" value={simplified.maxFlowPressure} onChange={(e) => setSimplified({ ...simplified, maxFlowPressure: e.target.value })} /></label>
          <button className="small-btn" onClick={handleGenerateSimplified}>Generate</button>
        </div>
      </details>

      {csvError && <p className="error-text">{csvError}</p>}
    </div>
  );
}

function buildChartPath(rows) {
  const pts = rows
    .map((r) => ({ flow: Number(r.flow), pressure: Number(r.pressure) }))
    .filter((p) => !Number.isNaN(p.flow) && !Number.isNaN(p.pressure))
    .sort((a, b) => a.flow - b.flow);
  if (pts.length < 2) return null;
  const maxFlow = Math.max(...pts.map((p) => p.flow), 1e-9);
  const maxPressure = Math.max(...pts.map((p) => p.pressure), 1e-9);
  const minPressure = Math.min(...pts.map((p) => p.pressure), 0);
  const range = maxPressure - minPressure || 1;
  const coords = pts.map((p) => {
    const x = (p.flow / maxFlow) * 190 + 5;
    const y = 95 - ((p.pressure - minPressure) / range) * 90;
    return `${x},${y}`;
  });
  return `M ${coords.join(' L ')}`;
}
