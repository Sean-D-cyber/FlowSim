import React from 'react';
import { TOOLBAR_PALETTE } from '../constants/toolbar.js';

export default function Toolbar({
  mode,
  onModeChange,
  onAddNode,
  connectMode,
  onToggleConnectMode,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onSave,
  onLoad,
  onExportPdf,
  onExportExcel,
  onDeleteSelected,
  hasSelection,
}) {
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <span className="toolbar-label">Add</span>
        {TOOLBAR_PALETTE.map((item) => (
          <button
            key={item.type}
            className="toolbar-btn"
            title={`Add ${item.label}`}
            onClick={() => onAddNode(item.type)}
          >
            <span className="toolbar-icon" aria-hidden="true">{item.icon}</span>
            {item.label}
          </button>
        ))}
        <button
          className={`toolbar-btn ${connectMode ? 'active' : ''}`}
          title="Connect two components with a pipe"
          onClick={onToggleConnectMode}
        >
          <span className="toolbar-icon" aria-hidden="true">⤳</span>
          Connect
        </button>
        <button className="toolbar-btn" title="Delete selected" onClick={onDeleteSelected} disabled={!hasSelection}>
          <span className="toolbar-icon" aria-hidden="true">🗑</span>
          Delete
        </button>
      </div>

      <div className="toolbar-group">
        <label className="toolbar-label" htmlFor="mode-select">Mode</label>
        <select id="mode-select" value={mode} onChange={(e) => onModeChange(e.target.value)} className="toolbar-select">
          <option value="required-duty">Required Duty</option>
          <option value="free-system">Free System</option>
        </select>
      </div>

      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={onUndo} disabled={!canUndo} title="Undo">↶ Undo</button>
        <button className="toolbar-btn" onClick={onRedo} disabled={!canRedo} title="Redo">↷ Redo</button>
      </div>

      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={onSave} title="Save network to a JSON file">💾 Save</button>
        <button className="toolbar-btn" onClick={onLoad} title="Load network from a JSON file">📂 Load</button>
        <button className="toolbar-btn" onClick={onExportPdf} title="Export PDF report">📄 PDF</button>
        <button className="toolbar-btn" onClick={onExportExcel} title="Export Excel report">📊 Excel</button>
      </div>
    </div>
  );
}
