// Capture console logs
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;

window.__consoleLogs = [];
const MAX_CONSOLE_LOGS = 1000; // Limit to prevent memory issues

console.log = function(...args) {
  window.__consoleLogs.push({ type: 'log', args });
  // Keep only last MAX_CONSOLE_LOGS entries
  if (window.__consoleLogs.length > MAX_CONSOLE_LOGS) {
    window.__consoleLogs = window.__consoleLogs.slice(-MAX_CONSOLE_LOGS);
  }
  originalLog.apply(console, args);
};

console.error = function(...args) {
  window.__consoleLogs.push({ type: 'error', args });
  if (window.__consoleLogs.length > MAX_CONSOLE_LOGS) {
    window.__consoleLogs = window.__consoleLogs.slice(-MAX_CONSOLE_LOGS);
  }
  originalError.apply(console, args);
};

console.warn = function(...args) {
  window.__consoleLogs.push({ type: 'warn', args });
  if (window.__consoleLogs.length > MAX_CONSOLE_LOGS) {
    window.__consoleLogs = window.__consoleLogs.slice(-MAX_CONSOLE_LOGS);
  }
  originalWarn.apply(console, args);
};

console.info = function(...args) {
  window.__consoleLogs.push({ type: 'info', args });
  if (window.__consoleLogs.length > MAX_CONSOLE_LOGS) {
    window.__consoleLogs = window.__consoleLogs.slice(-MAX_CONSOLE_LOGS);
  }
  originalInfo.apply(console, args);
};