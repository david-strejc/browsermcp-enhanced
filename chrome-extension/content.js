// Capture console logs
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;

window.__consoleLogs = [];

console.log = function(...args) {
  window.__consoleLogs.push({ type: 'log', args });
  originalLog.apply(console, args);
};

console.error = function(...args) {
  window.__consoleLogs.push({ type: 'error', args });
  originalError.apply(console, args);
};

console.warn = function(...args) {
  window.__consoleLogs.push({ type: 'warn', args });
  originalWarn.apply(console, args);
};

console.info = function(...args) {
  window.__consoleLogs.push({ type: 'info', args });
  originalInfo.apply(console, args);
};