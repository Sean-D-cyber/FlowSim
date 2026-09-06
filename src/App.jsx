import React, { useEffect, useMemo, useRef, useState } from 'react';
import Toolbar from './components/Toolbar.jsx';
import Canvas from './components/Canvas.jsx';
import PropertiesPanel from './components/PropertiesPanel.jsx';
import WarningsPanel from './components/WarningsPanel.jsx';
import { createNode, createEdge } from './model/createComponent.js';
import { createHistory, pushHistory, undo as undoHistory, redo as redoHistory, canUndo, canRedo } from './model/history.js';
import { solveRequiredDuty } from './solver/networkSolver.js';
import { getFluidPreset, FLUID_PRESETS } from './solver/fluidProps.js';
import { autosave, loadAutosave, downloadProject, pickAndLoadProject } from './utils/persistence.js';
import { exportPdfReport } from './utils/exportReport.js';
import { exportExcelReport } from './utils/exportExcel.js';

const DEFAULT_FLUID_PRESET_ID = 'water-20c';

export default function App() {
  const [history, setHistory] = useState(() => createHistory({ nodes: [], edges: [] }));
  const [mode, setMode] = useState('required-duty');
  const [fluidPresetId, setFluidPresetId] = useState(DEFAULT_FLUID_PRESET_ID);
  const [fluid, setFluid] = useState(() => getFluidPreset(DEFAULT_FLUID_PRESET_ID));
  const [selection, setSelection] = useState(null); // { kind: 'node'|'edge', id }
  const [connectMode, setConnectMode] = useState(false);
  const [pendingConnectFrom, setPendingConnectFrom] = useState(null);

  const dragStartRef = useRef(null);
  const loadedAutosaveRef = useRef(false);

  const present = history.present;

  // Load any autosaved project once, on mount.
  useEffect(() => {
    if (loadedAutosaveRef.current) return;
    loadedAutosaveRef.current = true;
    const auto = loadAutosave();
    if (auto) {
      setHistory(createHistory({ nodes: auto.nodes, edges: auto.edges }));
      if (auto.fluid) setFluid(auto.fluid);
      if (auto.fluidPresetId) setFluidPresetId(auto.fluidPresetId);
      if (auto.mode) setMode(auto.mode);
    }
  }, []);

  // Autosave on every change.
  useEffect(() => {
    autosave({ nodes: present.nodes, edges: present.edges, fluid, fluidPresetId, mode });
  }, [present, fluid, fluidPresetId, mode]);

  function commitPresent(updater) {
    setHistory((h) => pushHistory(h, updater(h.present)));
  }

  function handleAddNode(type) {
    const position = { x: 200 + present.nodes.length * 40, y: 150 + (present.nodes.length % 4) * 60 };
    const node = createNode(type, position);
    commitPresent((p) => ({ ...p, nodes: [...p.nodes, node] }));
    setSelection({ kind: 'node', id: node.id });
  }

  function handleUpdateNode(id, patch) {
    commitPresent((p) => ({
      ...p,
      nodes: p.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }));
  }

  function handleUpdateEdge(id, patch) {
    commitPresent((p) => ({
      ...p,
      edges: p.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  }

  function handleLabelChange(id, label) {
    handleUpdateNode(id, { label });
  }

  function handleNodeDrag(id, pos) {
    setHistory((h) => {
      if (!dragStartRef.current) dragStartRef.current = h.present;
      return {
        ...h,
        present: {
          ...h.present,
          nodes: h.present.nodes.map((n) => (n.id === id ? { ...n, position: pos } : n)),
        },
      };
    });
  }

  function handleNodeDragEnd() {
    if (!dragStartRef.current) return;
    const before = dragStartRef.current;
    dragStartRef.current = null;
    setHistory((h) => ({ past: [...h.past, before].slice(-100), present: h.present, future: [] }));
  }

  function handleConnectClick(nodeId) {
    if (!pendingConnectFrom) {
      setPendingConnectFrom(nodeId);
      return;
    }
    if (pendingConnectFrom === nodeId) {
      setPendingConnectFrom(null);
      return;
    }
    const edge = createEdge(pendingConnectFrom, nodeId);
    commitPresent((p) => ({ ...p, edges: [...p.edges, edge] }));
    setPendingConnectFrom(null);
    setConnectMode(false);
    setSelection({ kind: 'edge', id: edge.id });
  }

  function handleToggleConnectMode() {
    setConnectMode((v) => !v);
    setPendingConnectFrom(null);
  }

  function handleDeleteSelected() {
    if (!selection) return;
    commitPresent((p) => {
      if (selection.kind === 'node') {
        return {
          nodes: p.nodes.filter((n) => n.id !== selection.id),
          edges: p.edges.filter((e) => e.from !== selection.id && e.to !== selection.id),
        };
      }
      return { ...p, edges: p.edges.filter((e) => e.id !== selection.id) };
    });
    setSelection(null);
  }

  function handleFluidChange(patch) {
    if (patch.presetId) {
      setFluidPresetId(patch.presetId);
      setFluid(getFluidPreset(patch.presetId));
      return;
    }
    setFluid((f) => ({ ...f, ...patch }));
  }

  function handleSave() {
    downloadProject({ nodes: present.nodes, edges: present.edges, fluid, fluidPresetId, mode });
  }

  async function handleLoad() {
    try {
      const data = await pickAndLoadProject();
      setHistory(createHistory({ nodes: data.nodes, edges: data.edges }));
      if (data.fluid) setFluid(data.fluid);
      if (data.fluidPresetId) setFluidPresetId(data.fluidPresetId);
      if (data.mode) setMode(data.mode);
      setSelection(null);
    } catch (err) {
      if (err?.message !== 'No file selected') {
        // eslint-disable-next-line no-alert
        alert(`Could not load project: ${err.message}`);
      }
    }
  }

  const fluidLabel = FLUID_PRESETS.find((f) => f.id === fluidPresetId)?.label || 'Custom fluid';

  function handleExportPdf() {
    exportPdfReport({ edges: present.edges, solveResult, fluid, fluidLabel });
  }

  function handleExportExcel() {
    exportExcelReport({ nodes: present.nodes, edges: present.edges, solveResult, fluid, fluidLabel });
  }

  const solveResult = useMemo(() => {
    if (mode === 'free-system') {
      return {
        ok: false,
        warnings: [
          {
            type: 'NOT_IMPLEMENTED',
            message:
              'Free System mode (finding the natural operating point where the pump curve meets the system curve) is not implemented yet. Switch to Required Duty mode, where you specify the flow/pressure each outlet needs and the app checks the pump against that duty.',
          },
        ],
      };
    }
    return solveRequiredDuty(present.nodes, present.edges, fluid);
  }, [present.nodes, present.edges, fluid, mode]);

  const nodesById = useMemo(() => new Map(present.nodes.map((n) => [n.id, n])), [present.nodes]);
  const edgesById = useMemo(() => new Map(present.edges.map((e) => [e.id, e])), [present.edges]);

  return (
    <div className="app-shell">
      <Toolbar
        mode={mode}
        onModeChange={setMode}
        onAddNode={handleAddNode}
        connectMode={connectMode}
        onToggleConnectMode={handleToggleConnectMode}
        onUndo={() => setHistory(undoHistory)}
        onRedo={() => setHistory(redoHistory)}
        canUndo={canUndo(history)}
        canRedo={canRedo(history)}
        onSave={handleSave}
        onLoad={handleLoad}
        onExportPdf={handleExportPdf}
        onExportExcel={handleExportExcel}
        onDeleteSelected={handleDeleteSelected}
        hasSelection={!!selection}
      />

      <div className="app-body">
        <div className="canvas-column">
          <Canvas
            nodes={present.nodes}
            edges={present.edges}
            selectedId={selection?.id}
            onSelect={(id, kind) => setSelection(id ? { id, kind } : null)}
            onNodeDrag={handleNodeDrag}
            onNodeDragEnd={handleNodeDragEnd}
            connectMode={connectMode}
            pendingConnectFrom={pendingConnectFrom}
            onConnectClick={handleConnectClick}
            edgeFlows={solveResult.ok ? solveResult.edgeFlows : undefined}
            warnings={solveResult.warnings}
          />
          <WarningsPanel warnings={solveResult.warnings} dutyPass={solveResult.ok ? solveResult.pass : undefined} />
        </div>

        <PropertiesPanel
          selection={selection}
          nodesById={nodesById}
          edgesById={edgesById}
          onUpdateNode={handleUpdateNode}
          onUpdateEdge={handleUpdateEdge}
          onLabelChange={handleLabelChange}
          solveResult={solveResult}
          fluid={fluid}
          fluidPresetId={fluidPresetId}
          onFluidChange={handleFluidChange}
        />
      </div>
    </div>
  );
}
