// Argument parsing for bin/quickdo. Pure: no I/O, no process access, so it is unit-testable.
// `quickdo "text" [--today] [--port N]` captures; the first bare word that is a known command
// selects that command instead.

export const COMMANDS = new Set([
  'capture',
  'status',
  'sync',
  'open',
  'doctor',
  'install',
  'uninstall',
  'help',
]);

export const DEFAULT_PORT = 7777;

/**
 * @param {string[]} argv arguments after the program name
 * @returns {{ command: string, text: string, today: boolean, port: number | null, error?: string }}
 */
export function parseArgs(argv) {
  const words = [];
  let today = false;
  let port = null;
  let error;
  let literal = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--today' || a === '-t') {
      today = true;
    } else if (a === '--port' || a === '-p') {
      const v = argv[++i];
      port = toPort(v);
      if (port === null) error = `invalid --port: ${v ?? '(missing)'}`;
    } else if (a.startsWith('--port=')) {
      port = toPort(a.slice('--port='.length));
      if (port === null) error = `invalid --port: ${a.slice('--port='.length)}`;
    } else if (a === '--help' || a === '-h') {
      return { command: 'help', text: '', today, port };
    } else if (a === '--') {
      literal = true;
      words.push(...argv.slice(i + 1));
      break;
    } else {
      words.push(a);
    }
  }
  let command = 'capture';
  if (!literal && words.length > 0 && COMMANDS.has(words[0])) {
    command = words.shift();
  }
  const text = words.join(' ').trim();
  const out = { command, text, today, port };
  if (error) out.error = error;
  return out;
}

/** @param {string | undefined} v */
export function toPort(v) {
  if (v === undefined || v === '') return null;
  if (!/^\d{1,5}$/.test(v)) return null;
  const n = Number(v);
  return n > 0 && n < 65536 ? n : null;
}

/**
 * Port precedence: --port, then QUICKDO_PORT, then config.json, then 7777.
 * @param {number | null} flagPort
 * @param {Record<string, string | undefined>} env
 * @param {{ port?: unknown } | null} config
 */
export function resolvePort(flagPort, env, config) {
  if (flagPort) return flagPort;
  const fromEnv = toPort(env.QUICKDO_PORT);
  if (fromEnv) return fromEnv;
  if (config && typeof config.port === 'number' && config.port > 0 && config.port < 65536) {
    return config.port;
  }
  return DEFAULT_PORT;
}

export const HELP = `quickdo — keyboard-first todo capture from the terminal

usage:
  quickdo "text" [--today]     capture a todo (quick syntax: !today @9 ~30m #project +tag)
  quickdo status               sync status of the running server
  quickdo sync                 force a sync cycle now
  quickdo open                 open the app in the browser
  quickdo doctor               check node/git/gh, launchd, port, data repo, config, secrets
  quickdo install              install the launchd agent (bin/install-launchd.sh)
  quickdo uninstall            remove the launchd agent (bin/uninstall-launchd.sh)
  quickdo help                 this text

options:
  --today, -t                  put the captured item on Today instead of Backlog
  --port N, -p N               server port (also QUICKDO_PORT or ~/.config/quickdo/config.json)
`;
