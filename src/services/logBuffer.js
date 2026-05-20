// Buffer circulaire de logs système (stdout/stderr interceptés)
const MAX_LINES = 500;

let buffer = [];
let idCounter = 0;
const subscribers = new Set();

function pushLine(level, args) {
  const msg = args
    .map(a => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack || a.message;
      try { return JSON.stringify(a); } catch { return String(a); }
    })
    .join(' ');

  const line = {
    id: ++idCounter,
    ts: new Date().toISOString(),
    level,
    msg,
  };

  buffer.push(line);
  if (buffer.length > MAX_LINES) {
    buffer = buffer.slice(buffer.length - MAX_LINES);
  }

  for (const fn of subscribers) {
    try { fn(line); } catch { /* ignorer les erreurs d'abonnés */ }
  }
}

export function initLogBuffer() {
  const origLog   = console.log.bind(console);
  const origWarn  = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args) => {
    origLog(...args);
    pushLine('log', args);
  };

  console.warn = (...args) => {
    origWarn(...args);
    pushLine('warn', args);
  };

  console.error = (...args) => {
    origError(...args);
    pushLine('error', args);
  };
}

export function getLogBuffer() {
  return buffer;
}

export function subscribeToLogs(fn) {
  subscribers.add(fn);
}

export function unsubscribeFromLogs(fn) {
  subscribers.delete(fn);
}