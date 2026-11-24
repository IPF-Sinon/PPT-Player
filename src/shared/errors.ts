import type { AppErrorCode, AppErrorPayload } from './types'

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly detail?: string

  constructor(code: AppErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.detail = detail
  }

  toPayload(): AppErrorPayload {
    const payload: AppErrorPayload = { code: this.code, message: this.message }
    if (this.detail !== undefined) payload.detail = this.detail
    return payload
  }
}

export function toPayload(err: unknown): AppErrorPayload {
  if (err instanceof AppError) return err.toPayload()
  if (err instanceof Error) {
    return { code: 'EINTERNAL', message: err.message }
  }
  return { code: 'EINTERNAL', message: String(err) }
}
