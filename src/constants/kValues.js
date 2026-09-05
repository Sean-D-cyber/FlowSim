// Default K-values (velocity-head loss coefficients) for common fittings.
// Users can override any of these per-fitting; these are just sane
// starting points drawn from standard hydraulics references (Crane TP-410
// style values), not from any single vendor's catalogue.

export const DEFAULT_K_VALUES = {
  'elbow-90-standard': 0.9,
  'elbow-90-long-radius': 0.6,
  'elbow-45': 0.4,
  'tee-through-run': 0.6,
  'tee-branch': 1.8,
  'gate-valve-open': 0.2,
  'globe-valve-open': 10,
  'ball-valve-open': 0.05,
  'check-valve-swing': 2.5,
  'check-valve-lift': 6,
  'butterfly-valve-open': 0.9,
  'entrance-sharp': 0.5,
  'entrance-rounded': 0.2,
  'exit': 1.0,
  'strainer': 2.0,
  'reducer-gradual': 0.15,
};

export const FITTING_LABELS = {
  'elbow-90-standard': "90° Elbow (standard)",
  'elbow-90-long-radius': "90° Elbow (long radius)",
  'elbow-45': "45° Elbow",
  'tee-through-run': 'Tee (through run)',
  'tee-branch': 'Tee (branch flow)',
  'gate-valve-open': 'Gate valve (open)',
  'globe-valve-open': 'Globe valve (open)',
  'ball-valve-open': 'Ball valve (open)',
  'check-valve-swing': 'Check valve (swing)',
  'check-valve-lift': 'Check valve (lift)',
  'butterfly-valve-open': 'Butterfly valve (open)',
  'entrance-sharp': 'Pipe entrance (sharp edged)',
  'entrance-rounded': 'Pipe entrance (rounded)',
  exit: 'Pipe exit',
  strainer: 'Strainer / basket',
  'reducer-gradual': 'Gradual reducer',
};

// Typical absolute pipe roughness values (metres) by material.
export const PIPE_ROUGHNESS_M = {
  'steel-commercial': 0.000045,
  'steel-galvanized': 0.00015,
  'stainless-steel': 0.000015,
  'pvc-plastic': 0.0000015,
  'copper': 0.0000015,
  'cast-iron': 0.00026,
  'concrete': 0.0003,
};

export const PIPE_MATERIAL_LABELS = {
  'steel-commercial': 'Commercial steel',
  'steel-galvanized': 'Galvanized steel',
  'stainless-steel': 'Stainless steel',
  'pvc-plastic': 'PVC / plastic',
  copper: 'Copper',
  'cast-iron': 'Cast iron',
  concrete: 'Concrete',
};
