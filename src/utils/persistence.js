// Save/load the network model to/from JSON, plus a localStorage autosave
// so a page refresh doesn't lose work in progress.

const AUTOSAVE_KEY = 'hydraulic-piping-designer:autosave';
const FILE_VERSION = 1;

export function serializeProject({ nodes, edges, fluid, fluidPresetId, mode }) {
  return JSON.stringify(
    { version: FILE_VERSION, nodes, edges, fluid, fluidPresetId, mode },
    null,
    2
  );
}

export function deserializeProject(json) {
  const data = JSON.parse(json);
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error('Invalid project file: missing nodes/edges arrays.');
  }
  return data;
}

export function autosave(state) {
  try {
    window.localStorage.setItem(AUTOSAVE_KEY, serializeProject(state));
  } catch (err) {
    // Autosave is best-effort (private browsing, quota, etc.) - never throw.
    console.warn('Autosave failed:', err);
  }
}

export function loadAutosave() {
  try {
    const raw = window.localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return deserializeProject(raw);
  } catch (err) {
    console.warn('Could not read autosave:', err);
    return null;
  }
}

/** Trigger a browser download of the project as a .json file. */
export function downloadProject(state, filename = 'hydraulic-network.json') {
  const blob = new Blob([serializeProject(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Open a file picker and resolve with the parsed project, or reject. */
export function pickAndLoadProject() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('No file selected'));
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(deserializeProject(String(reader.result)));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    };
    input.click();
  });
}
