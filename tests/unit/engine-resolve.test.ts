import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveLibreOffice } from '../../src/main/convert/engine-resolve'

function fakeEngineRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lo-root-'))
  const program = join(root, 'program')
  mkdirSync(program, { recursive: true })
  writeFileSync(join(program, 'soffice.com'), '')
  return root
}

describe('resolveLibreOffice', () => {
  it('prefers the bundled engine', async () => {
    const root = fakeEngineRoot()
    const status = await resolveLibreOffice({ bundledRoots: [root], platform: 'win32', pathVar: '' })
    expect(status.available).toBe(true)
    expect(status.origin).toBe('bundled')
    expect(status.path).toBe(join(root, 'program', 'soffice.com'))
  })

  it('finds a versioned sub-directory inside the engine root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lo-root-'))
    const program = join(root, 'LibreOffice', 'program')
    mkdirSync(program, { recursive: true })
    writeFileSync(join(program, 'soffice.com'), '')
    const status = await resolveLibreOffice({ bundledRoots: [root], platform: 'win32', pathVar: '' })
    expect(status.available).toBe(true)
    expect(status.path).toContain('LibreOffice')
  })

  it('honours an explicit override', async () => {
    const root = fakeEngineRoot()
    const status = await resolveLibreOffice({
      loPathOverride: root,
      bundledRoots: [],
      platform: 'win32',
      pathVar: ''
    })
    expect(status.origin).toBe('custom')
    expect(status.available).toBe(true)
  })

  it('ignores an unusable override', async () => {
    const root = fakeEngineRoot()
    const status = await resolveLibreOffice({
      loPathOverride: join(tmpdir(), 'nope-does-not-exist'),
      bundledRoots: [root],
      platform: 'win32',
      pathVar: ''
    })
    expect(status.origin).toBe('bundled')
  })

  it('falls back to the registry', async () => {
    const root = fakeEngineRoot()
    const status = await resolveLibreOffice({
      bundledRoots: [],
      platform: 'win32',
      pathVar: '',
      runCommand: (file, args) => {
        if (file !== 'reg') return null
        if (args[1]?.includes('WOW6432Node')) return null
        return 'HKEY_LOCAL_MACHINE\\SOFTWARE\\LibreOffice\\UNO\\InstallPath\n    (Default)    REG_SZ    ' + join(root, 'program') + '\n'
      }
    })
    expect(status.origin).toBe('installed')
    expect(status.available).toBe(true)
  })

  it('falls back to PATH', async () => {
    const root = fakeEngineRoot()
    const status = await resolveLibreOffice({
      bundledRoots: [],
      platform: 'win32',
      pathVar: ['C:\\Windows', join(root, 'program')].join(';'),
      runCommand: () => null
    })
    expect(status.origin).toBe('path')
  })

  it('reports unavailable when nothing is found', async () => {
    const status = await resolveLibreOffice({ bundledRoots: [], platform: 'win32', pathVar: '', runCommand: () => null })
    expect(status.available).toBe(false)
    expect(status.origin).toBe('none')
  })
})