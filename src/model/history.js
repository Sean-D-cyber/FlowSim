// A small undo/redo history stack for the network model (nodes + edges).
// Plain data in, plain data out - no React dependency, so it's easy to
// unit-test and reuse from App.jsx's state management.

const MAX_HISTORY = 100;

export function createHistory(initialState) {
  return {
    past: [],
    present: initialState,
    future: [],
  };
}

/** Push a new present state, clearing redo history. Trims to MAX_HISTORY. */
export function pushHistory(history, newState) {
  const past = [...history.past, history.present].slice(-MAX_HISTORY);
  return { past, present: newState, future: [] };
}

export function undo(history) {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  const past = history.past.slice(0, -1);
  const future = [history.present, ...history.future];
  return { past, present: previous, future };
}

export function redo(history) {
  if (history.future.length === 0) return history;
  const next = history.future[0];
  const future = history.future.slice(1);
  const past = [...history.past, history.present];
  return { past, present: next, future };
}

export function canUndo(history) {
  return history.past.length > 0;
}

export function canRedo(history) {
  return history.future.length > 0;
}
