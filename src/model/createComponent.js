// Factories for network nodes and edges. Keeping default data shapes here
// means the solver, PropertiesPanel, and persistence layer all agree on
// what fields a given node/edge type carries.

import { DEFAULT_K_VALUES, PIPE_ROUGHNESS_M } from '../constants/kValues.js';
import { STANDARD_ATMOSPHERE_PA } from '../solver/fluidProps.js';

let idCounter = 0;
function nextId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

const DEFAULT_DATA_BY_TYPE = {
  pump: () => ({
    curve: [],
    curveSource: 'manual', // 'manual' | 'csv' | 'simplified'
    allowExtrapolation: false,
    suction: {
      atmosphericPressurePa: STANDARD_ATMOSPHERE_PA,
      staticHeadM: 0,
      frictionLossPa: 0,
      npshRequiredM: undefined,
      vaporPressurePa: undefined,
    },
  }),
  tank: () => ({
    elevationM: 0,
    pressurePa: STANDARD_ATMOSPHERE_PA,
  }),
  junction: () => ({}),
  valve: () => ({
    valveType: 'gate',
    kValue: DEFAULT_K_VALUES['gate-valve-open'],
    diameterM: 0.05,
    reverseInstalled: false,
    reliefSetPressurePa: undefined,
  }),
  outlet: () => ({
    requiredFlowM3s: undefined,
    requiredPressurePa: undefined,
  }),
};

export function createNode(type, position = { x: 0, y: 0 }, overrides = {}) {
  const factory = DEFAULT_DATA_BY_TYPE[type];
  if (!factory) throw new Error(`Unknown node type: ${type}`);
  return {
    id: overrides.id || nextId(type),
    type,
    label: overrides.label || defaultLabel(type),
    position: { ...position },
    data: { ...factory(), ...(overrides.data || {}) },
  };
}

function defaultLabel(type) {
  switch (type) {
    case 'pump':
      return 'Pump';
    case 'tank':
      return 'Tank';
    case 'junction':
      return 'Junction';
    case 'valve':
      return 'Valve';
    case 'outlet':
      return 'Outlet';
    default:
      return type;
  }
}

export function createEdge(fromId, toId, overrides = {}) {
  return {
    id: overrides.id || nextId('pipe'),
    from: fromId,
    to: toId,
    data: {
      diameterM: 0.05,
      lengthM: 10,
      material: 'steel-commercial',
      roughnessM: PIPE_ROUGHNESS_M['steel-commercial'],
      kValues: [],
      deltaZM: 0,
      ...(overrides.data || {}),
    },
  };
}
