/**
 * Single-line JSON logging to stdout: {ts, level, msg, ...extra}.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Logger = (level: LogLevel, msg: string, extra?: Record<string, unknown>) => void;

export function createLogger(write: (line: string) => void = defaultWrite): Logger {
  return (level, msg, extra) => {
    const rec: Record<string, unknown> = { ts: new Date().toISOString(), level, msg, ...extra };
    write(`${JSON.stringify(rec)}\n`);
  };
}

function defaultWrite(line: string): void {
  process.stdout.write(line);
}

/** A logger that drops everything (tests). */
export const silentLogger: Logger = () => {};
