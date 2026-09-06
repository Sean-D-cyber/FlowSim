import React, { useRef, useState, useCallback } from 'react';
import { CANVAS_GRID_SIZE } from '../constants/toolbar.js';

const NODE_W = 96;
const NODE_H = 56;

const NODE_GLYPH = {
  pump: '⚙',
  tank: '▭',
  junction: '✚',
  valve: '⧓',
  outlet: '↦',
};

function nodeStatusClass(nodeId, warnings) {
  if (!warnings) return '';
  const hit = warnings.find((w) => w.nodeId === nodeId);
  if (!hit) return '';
  if (hit.type === 'LOOP_DETECTED' || hit.type === 'DISCONNECTED_NODE' || hit.type === 'CHECK_VALVE_REVERSED') {
    return 'node-error';
  }
  return 'node-warning';
}

/**
 * SVG-based P&ID canvas: drag/pan/zoom, node dragging, and click-to-connect
 * pipe drawing. Node-to-node connections are centre-to-centre with a
 * simple L-shaped orthogonal route (see README "Known simplifications").
 */
export default function Canvas({
  nodes,
  edges,
  selectedId,
  onSelect,
  onNodeDrag,
  onNodeDragEnd,
  connectMode,
  pendingConnectFrom,
  onConnectClick,
  edgeFlows,
  warnings,
}) {
  const svgRef = useRef(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [panning, setPanning] = useState(null);
  const [dragging, setDragging] = useState(null);

  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  const screenToWorld = useCallback(
    (clientX, clientY) => {
      const rect = svgRef.current.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
    },
    [view]
  );

  function handleWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setView((v) => ({ ...v, k: Math.min(3, Math.max(0.3, v.k * factor)) }));
  }

  function handleBackgroundPointerDown(e) {
    if (e.target !== svgRef.current) return;
    setPanning({ startX: e.clientX, startY: e.clientY, origX: view.x, origY: view.y });
    onSelect(null);
  }

  function handlePointerMove(e) {
    if (panning) {
      const dx = e.clientX - panning.startX;
      const dy = e.clientY - panning.startY;
      setView((v) => ({ ...v, x: panning.origX + dx, y: panning.origY + dy }));
    } else if (dragging) {
      const world = screenToWorld(e.clientX, e.clientY);
      const pos = {
        x: snap(world.x - dragging.offsetX),
        y: snap(world.y - dragging.offsetY),
      };
      onNodeDrag(dragging.id, pos);
    }
  }

  function handlePointerUp() {
    if (panning) setPanning(null);
    if (dragging) {
      onNodeDragEnd();
      setDragging(null);
    }
  }

  function snap(v) {
    return Math.round(v / CANVAS_GRID_SIZE) * CANVAS_GRID_SIZE;
  }

  function handleNodePointerDown(e, node) {
    e.stopPropagation();
    if (connectMode) {
      onConnectClick(node.id);
      return;
    }
    const world = screenToWorld(e.clientX, e.clientY);
    setDragging({ id: node.id, offsetX: world.x - node.position.x, offsetY: world.y - node.position.y });
    onSelect(node.id, 'node');
  }

  function handleEdgeClick(e, edge) {
    e.stopPropagation();
    onSelect(edge.id, 'edge');
  }

  return (
    <svg
      ref={svgRef}
      className={`canvas-svg ${connectMode ? 'connect-mode' : ''}`}
      onWheel={handleWheel}
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <defs>
        <pattern id="grid" width={CANVAS_GRID_SIZE} height={CANVAS_GRID_SIZE} patternUnits="userSpaceOnUse">
          <path d={`M ${CANVAS_GRID_SIZE} 0 L 0 0 0 ${CANVAS_GRID_SIZE}`} className="grid-line" />
        </pattern>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head" />
        </marker>
      </defs>
      <rect x="-5000" y="-5000" width="10000" height="10000" fill="url(#grid)" />
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        {edges.map((edge) => {
          const from = nodesById.get(edge.from);
          const to = nodesById.get(edge.to);
          if (!from || !to) return null;
          const midX = (from.position.x + to.position.x) / 2;
          const path = `M ${from.position.x} ${from.position.y} L ${midX} ${from.position.y} L ${midX} ${to.position.y} L ${to.position.x} ${to.position.y}`;
          const flow = edgeFlows?.get(edge.id);
          const selected = selectedId === edge.id;
          return (
            <g key={edge.id} onPointerDown={(e) => handleEdgeClick(e, edge)} className="edge-group">
              <path d={path} className={`edge-path ${selected ? 'selected' : ''}`} markerEnd="url(#arrow)" />
              {flow !== undefined && (
                <text x={midX} y={(from.position.y + to.position.y) / 2 - 6} className="edge-flow-label">
                  {(flow * 1000).toFixed(2)} L/s
                </text>
              )}
            </g>
          );
        })}

        {nodes.map((node) => {
          const selected = selectedId === node.id;
          const pending = pendingConnectFrom === node.id;
          const statusClass = nodeStatusClass(node.id, warnings);
          return (
            <g
              key={node.id}
              transform={`translate(${node.position.x - NODE_W / 2} ${node.position.y - NODE_H / 2})`}
              onPointerDown={(e) => handleNodePointerDown(e, node)}
              className="node-group"
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={node.type === 'junction' ? NODE_H / 2 : 8}
                className={`node-shape node-${node.type} ${selected ? 'selected' : ''} ${pending ? 'pending' : ''} ${statusClass}`}
              />
              <text x={NODE_W / 2} y={NODE_H / 2 - 6} textAnchor="middle" className="node-glyph">
                {NODE_GLYPH[node.type] || '?'}
              </text>
              <text x={NODE_W / 2} y={NODE_H / 2 + 16} textAnchor="middle" className="node-label">
                {node.label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
