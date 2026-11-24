import { describe, expect, it } from 'vitest'
import { isInside } from '../../src/main/ipc/protocol-path'

describe('isInside', () => {
  it('accepts a direct child', () => {
    expect(isInside('/a/b', '/a/b/c.pdf')).toBe(true)
  })

  it('accepts the root itself', () => {
    expect(isInside('/a/b', '/a/b')).toBe(true)
  })

  it('rejects a sibling with a shared prefix', () => {
    expect(isInside('/a/b', '/a/bc/x')).toBe(false)
  })

  it('rejects traversal', () => {
    expect(isInside('/a/b', '/a/b/../etc/passwd')).toBe(false)
    expect(isInside('/a/b', '/etc/passwd')).toBe(false)
  })
})
