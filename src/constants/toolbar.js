// Palette of component types the Toolbar offers for dropping onto the
// Canvas. `type` matches the node.type used throughout the model/solver;
// `icon` is a plain glyph so no icon library dependency is needed.

export const TOOLBAR_PALETTE = [
  { type: 'pump', label: 'Pump', icon: '⚙' },
  { type: 'tank', label: 'Tank', icon: '▭' },
  { type: 'junction', label: 'Junction / Tee', icon: '✚' },
  { type: 'valve', label: 'Valve', icon: '⧓' },
  { type: 'outlet', label: 'Outlet', icon: '↦' },
];

export const VALVE_TYPES = [
  { id: 'gate', label: 'Gate valve' },
  { id: 'globe', label: 'Globe valve' },
  { id: 'ball', label: 'Ball valve' },
  { id: 'butterfly', label: 'Butterfly valve' },
  { id: 'check', label: 'Check valve' },
  { id: 'relief', label: 'Relief valve' },
];

export const CANVAS_GRID_SIZE = 20;
