import { test, expect } from '@playwright/test'

/**
 * End-to-end coverage for the Tauri shell.
 *
 * The Electron suite could launch the app through Playwright's _electron fixture and
 * poke window.api directly. Tauri has no equivalent: the app is a native binary and
 * the webview is not remotely debuggable by default.
 *
 * Rather than delete the coverage silently, this file records what it was and what is
 * needed to get it back, so the gap is visible in the repo instead of remembered.
 *
 * TO RESTORE:
 *   1. Build with the devtools feature: tauri build --debug --features devtools
 *      (or run `tauri dev` and set TAURI_DEV_HOST).
 *   2. Launch the binary with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
 *      --remote-debugging-port=9222
 *   3. Connect with chromium.connectOverCDP('http://127.0.0.1:9222') and use the
 *      first page as the window.
 *
 * COVERAGE THAT EXISTED BEFORE THE MIGRATION (708 lines, 42 tests):
 *   playback.spec.ts   - preview opens a deck from argv, thumbnail rail lists every
 *                        slide, thumbnail click moves the stage, playback goes
 *                        fullscreen, keyboard paging, toolbar paging, slide fills the
 *                        screen, toolbar translucency, annotations survive a tool
 *                        switch, undo removes a stroke, whiteboard opens and closes on
 *                        Escape, leaving playback returns to preview, window title
 *   native.spec.ts     - native PPTX engine: index, one click reveals one answer,
 *                        stepping back, leaving playback, tab bar shows the engine,
 *                        switching to compatible mode
 *   advanced.spec.ts   - path animations, triggers, transitions
 *   layout.spec.ts     - the geometry assertions that caught the v0.4.1 collapse:
 *                        workspace height, footer on screen, start button reachable,
 *                        slide at least 480x270, badges on one line, one top bar,
 *                        no duplicate close button, rail width, first thumbnail drawn
 *
 * The layout assertions are the ones most worth restoring first: they are what caught
 * the collapse where a flex child was added to a fixed three-row grid.
 */

test.describe('tauri shell', () => {
  test.skip('placeholder: CDP harness not wired yet', () => {
    // Deliberately skipped rather than passing silently: a green suite that covers
    // nothing is worse than an honest skip.
    expect(true).toBe(true)
  })
})
