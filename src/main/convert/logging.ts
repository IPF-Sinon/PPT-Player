/**
 * Logger used by the conversion modules.
 *
 * These modules stay Electron-free so they can be unit tested without an app
 * instance. The sink is injected once at startup, which is what makes soffice
 * output and conversion timings land in the real log file instead of vanishing
 * into a console stub that production never sees.
 */

export interface Logger {
  info(message: string, ...rest: unknown[]): void
  warn(message: string, ...rest: unknown[]): void
  error(message: string, ...rest: unknown[]): void
  debug(message: string, ...rest: unknown[]): void
}

const consoleSink: Logger = {
  info: (message, ...rest) => console.log('[info]', message, ...rest),
  warn: (message, ...rest) => console.warn('[warn]', message, ...rest),
  error: (message, ...rest) => console.error('[error]', message, ...rest),
  debug: (message, ...rest) => {
    if (process.env.PPT_PLAYER_DEBUG) console.debug('[debug]', message, ...rest)
  }
}

let sink: Logger = consoleSink

/** Point the conversion modules at the application logger. */
export function setLogSink(next: Logger): void {
  sink = next
}

/** Restore the console sink, used by tests. */
export function resetLogSink(): void {
  sink = consoleSink
}

export const consoleLogger: Logger = {
  info: (message, ...rest) => sink.info(message, ...rest),
  warn: (message, ...rest) => sink.warn(message, ...rest),
  error: (message, ...rest) => sink.error(message, ...rest),
  debug: (message, ...rest) => sink.debug(message, ...rest)
}
