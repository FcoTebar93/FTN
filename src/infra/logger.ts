export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

interface CreateLoggerOptions {
  useJson?: boolean;
}

function jsonLine(level: LogLevel, msg: string, fields?: Record<string, unknown>): string {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  });
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const useJson = options.useJson ?? false;

  const write = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    const line = useJson
      ? jsonLine(level, msg, fields)
      : `[${level.toUpperCase()}] ${msg}${
          fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : ""
        }`;
    process.stdout.write(`${line}\n`);
  };

  return {
    debug: (msg, fields) => write("debug", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
  };
}
