/** Electron-free logger so conversion modules stay unit-testable. */

export interface Logger {
  info(message: string, ...rest: unknown[]): void
  warn(message: string, ...rest: unknown[]): void
  error(message: string, ...rest: unknown[]): void
  debug(message: string, ...rest: unknown[]): void
}

export const consoleLogger: Logger = {
  info: (message, ...rest) => console.log('[info]', message, ...rest),
  warn: (message, ...rest) => console.warn('[warn]', message, ...rest),
  error: (message, ...rest) => console.error('[error]', message, ...rest),
  debug: (message, ...rest) => {
    if (process.env.PPT_PLAYER_DEBUG) console.debug('[debug]', message, ...rest)
  }
}
