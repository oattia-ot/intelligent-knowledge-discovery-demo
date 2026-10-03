/**
 * Tiny ANSI color helper for the Node-side terminal logs (ng serve /
 * proxy.conf.mjs / probe-server.mjs). No dependency — just raw escape
 * codes, disabled automatically when stdout isn't a TTY (e.g. piped to a
 * log file) or when NO_COLOR is set, per https://no-color.org/.
 *
 * Rule of thumb used across these scripts: HTTP 200 (or any 2xx) is
 * green, everything else (4xx/5xx, connection errors, timeouts) is red.
 */

const supportsColor =
  !process.env['NO_COLOR'] &&
  !!process.stdout &&
  !!process.stdout.isTTY;

const codes = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
  bold: '\x1b[1m'
};

function wrap(code, text) {
  return supportsColor ? `${code}${text}${codes.reset}` : String(text);
}

export const green = (text) => wrap(codes.green, text);
export const red = (text) => wrap(codes.red, text);
export const yellow = (text) => wrap(codes.yellow, text);
export const gray = (text) => wrap(codes.gray, text);
export const bold = (text) => wrap(codes.bold, text);

/** Color a whole line green for a 2xx status, red for anything else. */
export function colorByStatus(statusCode, text) {
  const ok = typeof statusCode === 'number' && statusCode >= 200 && statusCode < 300;
  return ok ? green(text) : red(text);
}
