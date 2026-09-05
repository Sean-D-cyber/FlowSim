import React, { useState } from 'react';
import PumpCurveEditor from './PumpCurveEditor.jsx';
import { DEFAULT_K_VALUES, FITTING_LABELS, PIPE_ROUGHNESS_M, PIPE_MATERIAL_LABELS } from '../constants/kValues.js';
import { NOMINAL_PIPE_SIZES } from '../constants/pipeSizes.js';
import { VALVE_TYPES } from '../constants/toolbar.js';
import {
  flowToSI,
  flowFromSI,
  pressureToSI,
  pressureFromSI,
  lengthToSI,
  lengthFromSI,
  FLUID_PRESETS,
} from '../solver/fluidProps.js';
import { solvePipeSegment } from '../solver/pipeHydraulics.js';

const FLOW_UNIT = 'L/min';
const PRESSURE_UNIT = 'bar';
const LENGTH_UNIT = 'm';

// Round to avoid floating-point display artifacts (e.g. 0.045 * 1000
// rendering as 0.045000000000000005) when converting SI m to mm for display.
function toMm(valueM) {
  return valueM ? Math.round(valueM * 1e7) / 1e4 : '';
}

function NumberField({ label, value, unit, onChange, step = 'any', ...rest }) {
  return (
    <label className="field">
      <span>{label}{unit ? ` (${unit})` : ''}</span>
      <input type="number" step={step} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} {...rest} />
    </label>
  );
}

export default function PropertiesPanel({
  selection,
  nodesById,
  edgesById,
  onUpdateNode,
  onUpdateEdge,
  solveResult,
  fluid,
  fluidPresetId,
  onFluidChange,
  onLabelChange,
}) {
  const [expanded, setExpanded] = useState(false);

  if (!selection) {
    return (
      <div className={`properties-panel ${expanded ? 'expanded' : ''}`}>
        <div className="sheet-handle" onClick={() => setExpanded((v) => !v)} />
        <div className="properties-empty">
          <p>Select a component or pipe to view and edit its properties.</p>
          <FluidSection fluidPresetId={fluidPresetId} onFluidChange={onFluidChange} fluid={fluid} />
        </div>
      </div>
    );
  }

  const content =
    selection.kind === 'node'
      ? renderNode(nodesById.get(selection.id), onUpdateNode, solveResult, fluid, onLabelChange)
      : renderEdge(edgesById.get(selection.id), onUpdateEdge, solveResult, fluid);

  return (
    <div className={`properties-panel ${expanded ? 'expanded' : ''}`}>
      <div className="sheet-handle" onClick={() => setExpanded((v) => !v)} />
      <div className="properties-content">{content}</div>
    </div>
  );
}

function FluidSection({ fluidPresetId, onFluidChange, fluid }) {
  return (
    <div className="panel-section">
      <h4>Fluid</h4>
      <label className="field">
        <span>Preset</span>
        <select value={fluidPresetId} onChange={(e) => onFluidChange({ presetId: e.target.value })}>
          {FLUID_PRESETS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </label>
      <NumberField label="Density" unit="kg/m3" value={fluid.density} onChange={(v) => onFluidChange({ density: v })} />
      <NumberField label="Viscosity" unit="Pa.s" value={fluid.viscosity} onChange={(v) => onFluidChange({ viscosity: v })} />
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="panel-section">
      <h4>{title}</h4>
      {children}
    </div>
  );
}

function renderNode(node, onUpdateNode, solveResult, fluid, onLabelChange) {
  if (!node) return null;
  const patch = (data) => onUpdateNode(node.id, { data: { ...node.data, ...data } });

  const header = (
    <div className="panel-header">
      <input className="label-input" value={node.label} onChange={(e) => onLabelChange(node.id, e.target.value)} />
      <span className="type-badge">{node.type}</span>
    </div>
  );

  if (node.type === 'outlet') {
    return (
      <>
        {header}
        <Section title="INPUT">
          <NumberField
            label="Required flow"
            unit={FLOW_UNIT}
            value={node.data.requiredFlowM3s !== undefined ? flowFromSI(node.data.requiredFlowM3s, FLOW_UNIT) : ''}
            onChange={(v) => patch({ requiredFlowM3s: v === undefined ? undefined : flowToSI(v, FLOW_UNIT) })}
          />
          <NumberField
            label="Required residual pressure"
            unit={PRESSURE_UNIT}
            value={node.data.requiredPressurePa !== undefined ? pressureFromSI(node.data.requiredPressurePa, PRESSURE_UNIT) : ''}
            onChange={(v) => patch({ requiredPressurePa: v === undefined ? undefined : pressureToSI(v, PRESSURE_UNIT) })}
          />
        </Section>
      </>
    );
  }

  if (node.type === 'pump') {
    const suction = node.data.suction || {};
    const patchSuction = (s) => patch({ suction: { ...suction, ...s } });
    const r = solveResult?.ok ? solveResult : null;
    return (
      <>
        {header}
        <Section title="INPUT — Pump curve">
          <PumpCurveEditor
            curve={node.data.curve}
            onChange={(curve) => patch({ curve })}
            allowExtrapolation={node.data.allowExtrapolation}
            onAllowExtrapolationChange={(v) => patch({ allowExtrapolation: v })}
            density={fluid.density}
          />
        </Section>
        <Section title="INPUT — Suction side">
          <NumberField
            label="Static suction head (+flooded / -lift)"
            unit={LENGTH_UNIT}
            value={suction.staticHeadM}
            onChange={(v) => patchSuction({ staticHeadM: v })}
          />
          <NumberField
            label="Suction line friction loss"
            unit={PRESSURE_UNIT}
            value={suction.frictionLossPa !== undefined ? pressureFromSI(suction.frictionLossPa, PRESSURE_UNIT) : 0}
            onChange={(v) => patchSuction({ frictionLossPa: v === undefined ? 0 : pressureToSI(v, PRESSURE_UNIT) })}
          />
          <NumberField
            label="NPSH required"
            unit={LENGTH_UNIT}
            value={suction.npshRequiredM}
            onChange={(v) => patchSuction({ npshRequiredM: v })}
          />
        </Section>
        {r && (
          <Section title="RESULTS (CALCULATED)">
            <ResultRow label="Total demanded flow" value={`${flowFromSI(r.totalFlowM3s, FLOW_UNIT).toFixed(1)} ${FLOW_UNIT}`} />
            <ResultRow
              label="Required discharge pressure"
              value={r.requiredDischargePressurePa !== undefined ? `${pressureFromSI(r.requiredDischargePressurePa, PRESSURE_UNIT).toFixed(2)} ${PRESSURE_UNIT}` : '—'}
            />
            <ResultRow
              label="Available discharge pressure"
              value={r.availableDischargePressurePa !== undefined ? `${pressureFromSI(r.availableDischargePressurePa, PRESSURE_UNIT).toFixed(2)} ${PRESSURE_UNIT}` : 'out of curve range'}
            />
            <ResultRow
              label="Margin"
              value={r.marginPa !== undefined ? `${pressureFromSI(r.marginPa, PRESSURE_UNIT).toFixed(2)} ${PRESSURE_UNIT}` : '—'}
              className={r.pass ? 'result-pass' : 'result-fail'}
            />
            <ResultRow label="Duty check" value={r.pass ? 'PASS' : 'FAIL'} className={r.pass ? 'result-pass' : 'result-fail'} />
            {r.achievableDuty && (
              <ResultRow
                label="Estimated achievable duty"
                value={`${flowFromSI(r.achievableDuty.totalFlowM3s, FLOW_UNIT).toFixed(1)} ${FLOW_UNIT} @ ${pressureFromSI(r.achievableDuty.pressurePa || 0, PRESSURE_UNIT).toFixed(2)} ${PRESSURE_UNIT}`}
              />
            )}
            {r.npsh && (
              <>
                <ResultRow label="NPSH available" value={`${r.npsh.npshAvailableM.toFixed(2)} m`} />
                <ResultRow label="NPSH margin" value={`${r.npsh.marginM.toFixed(2)} m`} className={r.npsh.marginM >= 0 ? 'result-pass' : 'result-fail'} />
              </>
            )}
          </Section>
        )}
      </>
    );
  }

  if (node.type === 'valve') {
    const flow = solveResult?.ok ? solveResult.nodeThroughFlow?.get(node.id) : undefined;
    return (
      <>
        {header}
        <Section title="INPUT">
          <label className="field">
            <span>Valve type</span>
            <select
              value={node.data.valveType}
              onChange={(e) => {
                const valveType = e.target.value;
                const kKey = `${valveType}-valve-open`;
                patch({ valveType, kValue: DEFAULT_K_VALUES[kKey] ?? node.data.kValue });
              }}
            >
              {VALVE_TYPES.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </label>
          <NumberField label="K-value" value={node.data.kValue} onChange={(v) => patch({ kValue: v })} />
          <NumberField label="Bore diameter" unit="mm" value={toMm(node.data.diameterM)} onChange={(v) => patch({ diameterM: v ? v / 1000 : undefined })} />
          {node.data.valveType === 'check' && (
            <label className="checkbox-label">
              <input type="checkbox" checked={!!node.data.reverseInstalled} onChange={(e) => patch({ reverseInstalled: e.target.checked })} />
              Installed backwards (blocks forward flow)
            </label>
          )}
          {node.data.valveType === 'relief' && (
            <NumberField
              label="Relief set pressure"
              unit={PRESSURE_UNIT}
              value={node.data.reliefSetPressurePa !== undefined ? pressureFromSI(node.data.reliefSetPressurePa, PRESSURE_UNIT) : ''}
              onChange={(v) => patch({ reliefSetPressurePa: v === undefined ? undefined : pressureToSI(v, PRESSURE_UNIT) })}
            />
          )}
        </Section>
        {flow !== undefined && (
          <Section title="RESULTS (CALCULATED)">
            <ResultRow label="Flow through valve" value={`${flowFromSI(flow, FLOW_UNIT).toFixed(1)} ${FLOW_UNIT}`} />
          </Section>
        )}
      </>
    );
  }

  if (node.type === 'tank') {
    return (
      <>
        {header}
        <Section title="INPUT">
          <NumberField label="Elevation" unit={LENGTH_UNIT} value={node.data.elevationM} onChange={(v) => patch({ elevationM: v })} />
          <NumberField
            label="Surface pressure"
            unit={PRESSURE_UNIT}
            value={node.data.pressurePa !== undefined ? pressureFromSI(node.data.pressurePa, PRESSURE_UNIT) : ''}
            onChange={(v) => patch({ pressurePa: v === undefined ? undefined : pressureToSI(v, PRESSURE_UNIT) })}
          />
        </Section>
        <p className="hint">Tank suction reference is manual on the pump's own Suction side inputs (see README known simplifications).</p>
      </>
    );
  }

  // junction
  return (
    <>
      {header}
      <p className="hint">Junctions split or combine flow; there are no editable properties.</p>
    </>
  );
}

function renderEdge(edge, onUpdateEdge, solveResult, fluid) {
  if (!edge) return null;
  const patch = (data) => onUpdateEdge(edge.id, { data: { ...edge.data, ...data } });
  const flow = solveResult?.ok ? solveResult.edgeFlows?.get(edge.id) : undefined;

  const seg =
    flow !== undefined
      ? solvePipeSegment({
          flowM3s: flow,
          diameterM: edge.data.diameterM,
          lengthM: edge.data.lengthM,
          roughnessM: edge.data.roughnessM,
          density: fluid.density,
          viscosity: fluid.viscosity,
          kValues: edge.data.kValues || [],
          deltaZM: edge.data.deltaZM || 0,
        })
      : null;

  function addFitting(key) {
    patch({ kValues: [...(edge.data.kValues || []), DEFAULT_K_VALUES[key]] });
  }
  function removeFitting(i) {
    patch({ kValues: edge.data.kValues.filter((_, idx) => idx !== i) });
  }

  return (
    <>
      <div className="panel-header">
        <span className="label-input readonly">Pipe</span>
        <span className="type-badge">pipe</span>
      </div>
      <Section title="INPUT">
        <label className="field">
          <span>Nominal size</span>
          <select
            onChange={(e) => {
              const row = NOMINAL_PIPE_SIZES.find((r) => r.nps === e.target.value);
              if (row) patch({ diameterM: row.idMm / 1000 });
            }}
            defaultValue=""
          >
            <option value="" disabled>Pick a nominal size…</option>
            {NOMINAL_PIPE_SIZES.map((r) => (
              <option key={r.nps} value={r.nps}>{r.nps} (ID {r.idMm} mm)</option>
            ))}
          </select>
        </label>
        <NumberField label="Internal diameter" unit="mm" value={toMm(edge.data.diameterM)} onChange={(v) => patch({ diameterM: v ? v / 1000 : undefined })} />
        <NumberField label="Length" unit={LENGTH_UNIT} value={lengthFromSI(edge.data.lengthM || 0, LENGTH_UNIT)} onChange={(v) => patch({ lengthM: v === undefined ? 0 : lengthToSI(v, LENGTH_UNIT) })} />
        <NumberField label="Elevation change (+rise/-fall)" unit={LENGTH_UNIT} value={edge.data.deltaZM || 0} onChange={(v) => patch({ deltaZM: v ?? 0 })} />
        <label className="field">
          <span>Material</span>
          <select
            value={edge.data.material}
            onChange={(e) => patch({ material: e.target.value, roughnessM: PIPE_ROUGHNESS_M[e.target.value] })}
          >
            {Object.keys(PIPE_ROUGHNESS_M).map((m) => (
              <option key={m} value={m}>{PIPE_MATERIAL_LABELS[m]}</option>
            ))}
          </select>
        </label>
        <NumberField label="Roughness (override)" unit="mm" value={toMm(edge.data.roughnessM)} onChange={(v) => patch({ roughnessM: v ? v / 1000 : 0 })} />

        <div className="fittings-editor">
          <span>Fittings</span>
          <ul className="fittings-list">
            {(edge.data.kValues || []).map((k, i) => (
              <li key={i}>K = {k.toFixed(2)} <button className="icon-btn" onClick={() => removeFitting(i)}>✕</button></li>
            ))}
          </ul>
          <select onChange={(e) => e.target.value && addFitting(e.target.value)} defaultValue="">
            <option value="" disabled>+ Add fitting…</option>
            {Object.keys(DEFAULT_K_VALUES).map((key) => (
              <option key={key} value={key}>{FITTING_LABELS[key]} (K={DEFAULT_K_VALUES[key]})</option>
            ))}
          </select>
        </div>
      </Section>

      {seg && (
        <Section title="RESULTS (CALCULATED)">
          <ResultRow label="Flow" value={`${flowFromSI(flow, FLOW_UNIT).toFixed(1)} ${FLOW_UNIT}`} />
          <ResultRow label="Velocity" value={`${seg.velocity.toFixed(2)} m/s`} />
          <ResultRow label="Reynolds number" value={`${Math.round(seg.reynolds).toLocaleString()} (${seg.regime})`} />
          <ResultRow label="Friction loss" value={`${pressureFromSI(seg.frictionLossPa, PRESSURE_UNIT).toFixed(3)} ${PRESSURE_UNIT}`} />
          <ResultRow label="Minor (fitting) loss" value={`${pressureFromSI(seg.minorLossPa, PRESSURE_UNIT).toFixed(3)} ${PRESSURE_UNIT}`} />
          <ResultRow label="Elevation loss" value={`${pressureFromSI(seg.elevationPa, PRESSURE_UNIT).toFixed(3)} ${PRESSURE_UNIT}`} />
          <ResultRow label="Total loss" value={`${pressureFromSI(seg.totalLossPa, PRESSURE_UNIT).toFixed(3)} ${PRESSURE_UNIT}`} />
        </Section>
      )}
    </>
  );
}

function ResultRow({ label, value, className }) {
  return (
    <div className={`result-row ${className || ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
