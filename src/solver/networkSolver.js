// Network solver: Required Duty mode.
//
// The user specifies, at every outlet, the flow it needs and the residual
// pressure it must retain. The solver works BACKWARDS from each outlet
// toward the pump, accumulating the pipe/fitting losses that must be
// overcome, to find the pressure the pump must produce at the calculated
// total flow. That requirement is then checked against the pump curve.
//
// Flow is always a design input (the sum of outlet demands) - it is never
// invented from whatever pressure the pump happens to have spare. See
// computeEdgeFlows() below.
//
// Pipeline:
//   buildGraph        -> adjacency list from nodes/edges
//   buildTree         -> BFS from the pump; detects loops & disconnected
//                        nodes instead of silently ignoring them
//   computeEdgeFlows  -> post-order leaf-to-root flow continuity
//   computeRequiredPressures -> post-order backward required-pressure pass
//   checkPumpDuty     -> compare requirement against the pump curve
//   solveAtScale      -> the above, with every outlet flow multiplied by
//                        `scale` (0..1] - the unit of work reused both for
//                        the scale=1 solve and for the achievable-duty
//                        bisection below
//   solveRequiredDuty -> solveAtScale(1) plus bisection for an achievable
//                        duty estimate when the full requested duty fails,
//                        plus an NPSH estimate

import { GRAVITY, headToPressure, STANDARD_ATMOSPHERE_PA } from './fluidProps.js';
import { solvePipeSegment, velocity, minorLoss } from './pipeHydraulics.js';
import { interpolatePumpCurve } from './pumpCurve.js';

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

export function buildGraph(nodes, edges) {
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map(nodes.map((n) => [n.id, []]));
  for (const edge of edges) {
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) continue;
    adjacency.get(edge.from).push({ edgeId: edge.id, neighborId: edge.to });
    adjacency.get(edge.to).push({ edgeId: edge.id, neighborId: edge.from });
  }
  const edgesById = new Map(edges.map((e) => [e.id, e]));
  return { nodesById, edgesById, adjacency };
}

/**
 * BFS out from the pump node, building a rooted tree. An edge that would
 * revisit an already-visited node (other than back to its own parent) is a
 * loop and is reported, not followed. Any node never reached is reported
 * as disconnected.
 */
export function buildTree(graph, pumpNodeId) {
  const warnings = [];
  const childrenByNode = new Map(); // nodeId -> [{ edgeId, childId }]
  const parentOf = new Map(); // nodeId -> { edgeId, parentId }
  const visited = new Set();

  if (!graph.nodesById.has(pumpNodeId)) {
    return { childrenByNode, parentOf, visited, warnings };
  }

  const queue = [pumpNodeId];
  visited.add(pumpNodeId);
  const seenEdges = new Set();

  while (queue.length) {
    const current = queue.shift();
    const neighbors = graph.adjacency.get(current) || [];
    for (const { edgeId, neighborId } of neighbors) {
      if (seenEdges.has(edgeId)) continue;
      seenEdges.add(edgeId);
      if (visited.has(neighborId)) {
        // Revisiting a node through a different edge than the tree edge
        // that reached it: this is a cycle in the piping network.
        warnings.push({
          type: 'LOOP_DETECTED',
          edgeId,
          nodeId: neighborId,
          message: `Loop detected: edge ${edgeId} closes a cycle back to node ${neighborId}. Loops are not solved - remove one connection to make this a tree.`,
        });
        continue;
      }
      visited.add(neighborId);
      parentOf.set(neighborId, { edgeId, parentId: current });
      if (!childrenByNode.has(current)) childrenByNode.set(current, []);
      childrenByNode.get(current).push({ edgeId, childId: neighborId });
      queue.push(neighborId);
    }
  }

  for (const nodeId of graph.nodesById.keys()) {
    if (!visited.has(nodeId)) {
      warnings.push({
        type: 'DISCONNECTED_NODE',
        nodeId,
        message: `Node ${nodeId} is not connected to the pump and was excluded from the solve.`,
      });
    }
  }

  return { childrenByNode, parentOf, visited, warnings };
}

// ---------------------------------------------------------------------------
// Flow continuity (post-order, leaves -> root)
// ---------------------------------------------------------------------------

/**
 * Every pipe/fitting carries exactly the sum of the required flows of the
 * outlets downstream of it. Returns { edgeFlows: Map<edgeId, m3/s>,
 * nodeThroughFlow: Map<nodeId, m3/s>, warnings }.
 */
export function computeEdgeFlows(tree, graph, scale = 1) {
  const warnings = [];
  const edgeFlows = new Map();
  const nodeThroughFlow = new Map();

  // Post-order via iterative traversal.
  const order = [];
  const stack = [];
  for (const nodeId of tree.visited) {
    if (!tree.parentOf.has(nodeId)) stack.push(nodeId); // roots (the pump)
  }
  const pushed = new Set();
  const dfsStack = [...stack];
  while (dfsStack.length) {
    const nodeId = dfsStack.pop();
    if (pushed.has(nodeId)) continue;
    pushed.add(nodeId);
    order.push(nodeId);
    const children = tree.childrenByNode.get(nodeId) || [];
    for (const { childId } of children) dfsStack.push(childId);
  }
  order.reverse(); // leaves first

  for (const nodeId of order) {
    const node = graph.nodesById.get(nodeId);
    let flow = 0;

    if (node.type === 'outlet') {
      const req = node.data?.requiredFlowM3s;
      if (req === undefined || req === null || node.data?.requiredPressurePa === undefined || node.data?.requiredPressurePa === null) {
        warnings.push({
          type: 'MISSING_OUTLET_DUTY',
          nodeId,
          message: `Outlet ${node.label || nodeId} is missing a required flow and/or residual pressure. It was treated as zero demand.`,
        });
      } else {
        flow += req * scale;
      }
    }

    const children = tree.childrenByNode.get(nodeId) || [];
    for (const { edgeId, childId } of children) {
      const childFlow = nodeThroughFlow.get(childId) || 0;
      edgeFlows.set(edgeId, childFlow);
      flow += childFlow;
    }

    nodeThroughFlow.set(nodeId, flow);
  }

  return { edgeFlows, nodeThroughFlow, warnings };
}

// ---------------------------------------------------------------------------
// Node device losses (valves) and required-pressure backward pass
// ---------------------------------------------------------------------------

/** Pressure drop (Pa) imposed by a valve node itself, or 0 for other types. */
function nodeDeviceLoss(node, flowM3s, fluid) {
  if (node.type !== 'valve') return { lossPa: 0, warnings: [] };
  const warnings = [];
  const { diameterM, kValue = 0, valveType, reverseInstalled } = node.data || {};

  if (valveType === 'check' && reverseInstalled) {
    warnings.push({
      type: 'CHECK_VALVE_REVERSED',
      nodeId: node.id,
      message: `Check valve ${node.label || node.id} is flagged as installed backwards and blocks forward flow.`,
    });
    return { lossPa: Infinity, warnings };
  }

  if (!diameterM || diameterM <= 0) {
    return { lossPa: 0, warnings };
  }
  const v = velocity(flowM3s, diameterM);
  const lossPa = minorLoss(kValue, v, fluid.density);
  return { lossPa, warnings };
}

/**
 * Backward pass: for every node, the minimum pressure that must be present
 * at that node's inlet to satisfy its own duty (if it is an outlet) and
 * everything downstream of it. At a junction with multiple branches, the
 * pump must be sized for the most demanding branch, so we take the max.
 */
export function computeRequiredPressures(tree, graph, edgeFlows, fluid) {
  const warnings = [];
  const requiredAtNode = new Map();

  // Post-order (leaves first) - reuse the same ordering approach as flows.
  const order = [];
  const roots = [...tree.visited].filter((id) => !tree.parentOf.has(id));
  const dfsStack = [...roots];
  const pushed = new Set();
  while (dfsStack.length) {
    const nodeId = dfsStack.pop();
    if (pushed.has(nodeId)) continue;
    pushed.add(nodeId);
    order.push(nodeId);
    const children = tree.childrenByNode.get(nodeId) || [];
    for (const { childId } of children) dfsStack.push(childId);
  }
  order.reverse();

  for (const nodeId of order) {
    const node = graph.nodesById.get(nodeId);
    const children = tree.childrenByNode.get(nodeId) || [];

    let required = -Infinity;
    let hasRequirement = false;

    if (node.type === 'outlet' && node.data?.requiredPressurePa !== undefined && node.data?.requiredPressurePa !== null) {
      required = Math.max(required, node.data.requiredPressurePa);
      hasRequirement = true;
    }

    for (const { edgeId, childId } of children) {
      const childRequired = requiredAtNode.get(childId);
      if (childRequired === undefined || !Number.isFinite(childRequired)) continue;
      const edge = graph.edgesById.get(edgeId);
      const flow = edgeFlows.get(edgeId) || 0;
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
      const requiredAtThisNodeViaChild = childRequired + seg.totalLossPa;
      required = Math.max(required, requiredAtThisNodeViaChild);
      hasRequirement = true;
    }

    if (!hasRequirement) {
      requiredAtNode.set(nodeId, undefined);
      continue;
    }

    const nodeFlow = children.reduce((sum, { edgeId }) => sum + (edgeFlows.get(edgeId) || 0), 0) +
      (node.type === 'outlet' ? node.data?.requiredFlowM3s || 0 : 0);
    const device = nodeDeviceLoss(node, nodeFlow, fluid);
    warnings.push(...device.warnings);
    required += device.lossPa;

    requiredAtNode.set(nodeId, required);
  }

  return { requiredAtNode, warnings };
}

// ---------------------------------------------------------------------------
// Pump duty
// ---------------------------------------------------------------------------

function suctionPressure(pump, fluid) {
  const suction = pump.data?.suction || {};
  const atm = suction.atmosphericPressurePa ?? STANDARD_ATMOSPHERE_PA;
  const staticHeadM = suction.staticHeadM || 0;
  const frictionLossPa = suction.frictionLossPa || 0;
  return atm + headToPressure(staticHeadM, fluid.density) - frictionLossPa;
}

/**
 * Solve the network once at a given demand scale (1 = full requested
 * duty). Returns a full result object; solveRequiredDuty() calls this at
 * scale=1 and, if it fails, again at intermediate scales during bisection.
 */
export function solveAtScale(nodes, edges, fluid, scale = 1, options = {}) {
  const warnings = [];
  const pumpNode = nodes.find((n) => n.type === 'pump');
  if (!pumpNode) {
    return {
      ok: false,
      warnings: [{ type: 'MISSING_PUMP', message: 'No pump node found in the network.' }],
    };
  }

  const graph = buildGraph(nodes, edges);
  const tree = buildTree(graph, pumpNode.id);
  warnings.push(...tree.warnings);

  const outlets = nodes.filter((n) => n.type === 'outlet' && tree.visited.has(n.id));
  if (outlets.length === 0) {
    warnings.push({ type: 'MISSING_OUTLET_DUTY', message: 'No outlet with a defined duty is connected to the pump.' });
  }

  const { edgeFlows, nodeThroughFlow, warnings: flowWarnings } = computeEdgeFlows(tree, graph, scale);
  warnings.push(...flowWarnings);

  const { requiredAtNode, warnings: pressureWarnings } = computeRequiredPressures(tree, graph, edgeFlows, fluid);
  warnings.push(...pressureWarnings);

  const totalFlow = outlets.reduce((sum, o) => sum + (o.data?.requiredFlowM3s || 0), 0) * scale;

  // computeRequiredPressures already folded the pump's own downstream
  // branches (and any device loss on the pump node itself, if it had one)
  // into requiredAtNode for the pump - that IS the discharge pressure the
  // pump must produce. Do not re-derive it from the children here.
  const requiredDischargePressureRaw = requiredAtNode.get(pumpNode.id);
  const hasRequirement = requiredDischargePressureRaw !== undefined && Number.isFinite(requiredDischargePressureRaw);
  const requiredDischargePressure = hasRequirement ? requiredDischargePressureRaw : -Infinity;

  const suctionPa = suctionPressure(pumpNode, fluid);
  const curveResult = interpolatePumpCurve(
    pumpNode.data?.curve || [],
    totalFlow,
    !!pumpNode.data?.allowExtrapolation
  );

  let availableDischargePressure;
  let pumpRisePa;
  if (curveResult.error) {
    warnings.push({
      type: 'PUMP_CURVE_OUT_OF_RANGE',
      message:
        curveResult.error === 'OUT_OF_RANGE'
          ? `Total demanded flow is outside the pump curve's defined range (${curveResult.min}-${curveResult.max} m3/s).`
          : `Pump curve error: ${curveResult.error}`,
    });
    availableDischargePressure = undefined;
    pumpRisePa = undefined;
  } else {
    pumpRisePa = curveResult.pressure;
    availableDischargePressure = suctionPa + pumpRisePa;
    if (curveResult.extrapolated) {
      warnings.push({
        type: 'PUMP_CURVE_EXTRAPOLATED',
        message: 'Pump duty point required extrapolating beyond the supplied curve data.',
      });
    }
  }

  const marginPa =
    availableDischargePressure !== undefined && hasRequirement
      ? availableDischargePressure - requiredDischargePressure
      : undefined;
  const pass = marginPa !== undefined ? marginPa >= 0 : false;

  return {
    ok: true,
    scale,
    totalFlowM3s: totalFlow,
    requiredDischargePressurePa: hasRequirement ? requiredDischargePressure : undefined,
    availableDischargePressurePa: availableDischargePressure,
    pumpRisePa,
    suctionPressurePa: suctionPa,
    marginPa,
    pass,
    edgeFlows,
    nodeThroughFlow,
    requiredAtNode,
    tree,
    graph,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Bisection for "estimated achievable duty" when the requested duty fails
// ---------------------------------------------------------------------------

function marginAtScale(nodes, edges, fluid, scale) {
  const result = solveAtScale(nodes, edges, fluid, scale);
  return { result, margin: result.marginPa };
}

/**
 * When the pump cannot meet the full requested duty, estimate the flow
 * scale (0..1] at which it could - i.e. where the pump curve and the
 * required-pressure curve cross - via bisection. Returns undefined if no
 * crossing exists in (0, 1].
 */
export function findAchievableDuty(nodes, edges, fluid, { tolerance = 1e-4, maxIterations = 60 } = {}) {
  const hi = 1;
  const { result: hiResult, margin: hiMargin } = marginAtScale(nodes, edges, fluid, hi);
  if (hiMargin === undefined) return undefined;
  if (hiMargin >= 0) return { scale: 1, result: hiResult }; // already passes

  const loScale = 1e-6;
  const { result: loResult, margin: loMargin } = marginAtScale(nodes, edges, fluid, loScale);
  if (loMargin === undefined || loMargin < 0) {
    // Even a near-zero flow can't be satisfied (e.g. elevation alone beats
    // the pump's shutoff pressure) - no achievable duty.
    return { scale: 0, result: loResult, unachievable: true };
  }

  let lo = loScale;
  let loM = loMargin;
  let hiS = hi;
  let hiM = hiMargin;
  let bestResult = loResult;

  for (let i = 0; i < maxIterations; i++) {
    const mid = (lo + hiS) / 2;
    const { result: midResult, margin: midMargin } = marginAtScale(nodes, edges, fluid, mid);
    if (midMargin === undefined) break;
    if (Math.abs(midMargin) < tolerance || hiS - lo < 1e-6) {
      bestResult = midResult;
      lo = mid;
      hiS = mid;
      break;
    }
    if (midMargin >= 0) {
      lo = mid;
      loM = midMargin;
      bestResult = midResult;
    } else {
      hiS = mid;
      hiM = midMargin;
    }
  }

  return { scale: lo, result: bestResult };
}

// ---------------------------------------------------------------------------
// NPSH estimate
// ---------------------------------------------------------------------------

export function estimateNPSH(pumpNode, fluid, marginWarnings = []) {
  const suction = pumpNode.data?.suction || {};
  const npshRequiredM = suction.npshRequiredM;
  if (npshRequiredM === undefined || npshRequiredM === null) return undefined;

  const vaporPressurePa = suction.vaporPressurePa ?? fluid.vaporPressure ?? 0;
  const suctionPa = suctionPressure(pumpNode, fluid);
  const npshAvailablePa = suctionPa - vaporPressurePa;
  const npshAvailableM = npshAvailablePa / (fluid.density * GRAVITY);
  const marginM = npshAvailableM - npshRequiredM;
  if (marginM < 0) {
    marginWarnings.push({
      type: 'NPSH_MARGIN_LOW',
      message: `NPSH available (${npshAvailableM.toFixed(2)} m) is below NPSH required (${npshRequiredM.toFixed(2)} m).`,
    });
  }
  return { npshAvailableM, npshRequiredM, marginM };
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

/**
 * Solve a network in Required Duty mode. This is the only function most
 * callers need. See module doc comment for the pipeline.
 */
export function solveRequiredDuty(nodes, edges, fluid, options = {}) {
  const base = solveAtScale(nodes, edges, fluid, 1, options);
  if (!base.ok) return base;

  const warnings = [...base.warnings];

  const pumpNode = nodes.find((n) => n.type === 'pump');
  const npsh = pumpNode ? estimateNPSH(pumpNode, fluid, warnings) : undefined;

  let achievableDuty;
  if (base.pass === false && base.marginPa !== undefined) {
    const achieved = findAchievableDuty(nodes, edges, fluid);
    if (achieved) {
      if (achieved.unachievable) {
        warnings.push({
          type: 'DUTY_UNACHIEVABLE',
          message: 'No achievable flow satisfies this network - static/elevation losses alone exceed the pump shutoff pressure.',
        });
      }
      achievableDuty = {
        scale: achieved.scale,
        totalFlowM3s: achieved.result.totalFlowM3s,
        pressurePa: achieved.result.availableDischargePressurePa,
      };
    }
  }

  return { ...base, warnings, npsh, achievableDuty };
}
