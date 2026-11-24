declare module 'cfb' {
  interface CFBContainer {
    FileIndex?: unknown[]
  }
  interface CFBUtils {
    cfb_new(opts?: Record<string, unknown>): CFBContainer
    cfb_add(cfb: CFBContainer, name: string, content: Uint8Array, opts?: Record<string, unknown>): unknown
  }
  const CFB: {
    utils: CFBUtils
    write(cfb: CFBContainer, opts?: Record<string, unknown>): Uint8Array
    read(data: unknown, opts?: Record<string, unknown>): CFBContainer
    find(cfb: CFBContainer, name: string): unknown
  }
  export default CFB
}
