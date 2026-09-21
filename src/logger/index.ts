export interface Logger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return '';
  return ' ' + JSON.stringify(meta);
}

export function createLogger(level: string = 'info'): Logger {
  const levels: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  const minLevel = levels[level] ?? 1;

  return {
    info: (message: string, meta?: Record<string, unknown>): void => {
      if (minLevel <= 1)
        console.log(`[INFO] ${new Date().toISOString()} ${message}${formatMeta(meta)}`);
    },
    warn: (message: string, meta?: Record<string, unknown>): void => {
      if (minLevel <= 2)
        console.log(`[WARN] ${new Date().toISOString()} ${message}${formatMeta(meta)}`);
    },
    error: (message: string, meta?: Record<string, unknown>): void => {
      if (minLevel <= 3)
        console.log(`[ERROR] ${new Date().toISOString()} ${message}${formatMeta(meta)}`);
    },
    debug: (message: string, meta?: Record<string, unknown>): void => {
      if (minLevel <= 0)
        console.log(`[DEBUG] ${new Date().toISOString()} ${message}${formatMeta(meta)}`);
    },
  };
}
