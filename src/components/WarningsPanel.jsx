import React from 'react';

const SEVERITY_BY_TYPE = {
  MISSING_PUMP: 'error',
  MISSING_OUTLET_DUTY: 'error',
  LOOP_DETECTED: 'error',
  DISCONNECTED_NODE: 'error',
  CHECK_VALVE_REVERSED: 'error',
  DUTY_UNACHIEVABLE: 'error',
  PUMP_CURVE_OUT_OF_RANGE: 'warning',
  PUMP_CURVE_EXTRAPOLATED: 'warning',
  NPSH_MARGIN_LOW: 'warning',
  NOT_IMPLEMENTED: 'info',
};

export default function WarningsPanel({ warnings, dutyPass }) {
  const items = warnings || [];
  if (items.length === 0 && dutyPass !== false) {
    return (
      <div className="warnings-panel warnings-empty">
        <span className="warning-icon">✓</span> No warnings - network solves cleanly.
      </div>
    );
  }
  return (
    <div className="warnings-panel">
      <div className="warnings-header">Warnings ({items.length})</div>
      <ul className="warnings-list">
        {dutyPass === false && (
          <li className="warning-item severity-error">
            <span className="warning-icon">✕</span>
            Pump duty FAILS: available pressure is below the required duty pressure at the demanded flow.
          </li>
        )}
        {items.map((w, i) => (
          <li key={i} className={`warning-item severity-${SEVERITY_BY_TYPE[w.type] || 'info'}`}>
            <span className="warning-icon">
              {SEVERITY_BY_TYPE[w.type] === 'error' ? '✕' : SEVERITY_BY_TYPE[w.type] === 'warning' ? '⚠' : 'ℹ'}
            </span>
            <span className="warning-type">{w.type}</span>
            <span className="warning-message">{w.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
