/**
 * Random-access byte source.
 *
 * Format detection used to load whole files into a Buffer. That is both wasteful
 * (a 150 MB deck was fully read just to look at its header) and wrong: anything
 * over 64 MB was truncated to its first 8 MB, so the ZIP end-of-central-directory
 * record near the tail was never seen and valid decks were rejected as corrupt.
 *
 * Everything below reads only the exact ranges it needs, so detection cost is
 * independent of file size.
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs'

export interface ByteSource {
  readonly size: number
  /** Read up to `length` bytes at `offset`. Returns fewer only at end of file. */
  read(offset: number, length: number): Buffer
}

/** In-memory source, used by unit tests and by callers that already hold bytes. */
export function bufferSource(buf: Buffer): ByteSource {
  return {
    size: buf.length,
    read(offset: number, length: number): Buffer {
      if (offset < 0 || offset >= buf.length || length <= 0) return Buffer.alloc(0)
      return buf.subarray(offset, Math.min(buf.length, offset + length))
    }
  }
}

export interface FileByteSource extends ByteSource {
  close(): void
}

/**
 * Synchronous file-backed source.
 *
 * Reads are intentionally synchronous: probing happens once per open, touches a
 * few kilobytes, and finishes in well under a millisecond, so an async version
 * would only add an await boundary to every caller.
 */
export function fileSource(path: string): FileByteSource {
  const fd = openSync(path, 'r')
  const { size } = statSync(path)
  let closed = false

  return {
    size,
    read(offset: number, length: number): Buffer {
      if (closed) throw new Error('byte source is closed')
      if (offset < 0 || length <= 0 || offset >= size) return Buffer.alloc(0)
      const want = Math.min(length, size - offset)
      const buf = Buffer.allocUnsafe(want)
      let read = 0
      while (read < want) {
        const n = readSync(fd, buf, read, want - read, offset + read)
        if (n <= 0) break
        read += n
      }
      return read === want ? buf : buf.subarray(0, read)
    },
    close(): void {
      if (closed) return
      closed = true
      closeSync(fd)
    }
  }
}
