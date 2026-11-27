// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { evaluateStep, initiallyHidden, parseTriggers } from '../../src/renderer/src/lib/pptx/animations'
import { parseXml } from '../../src/renderer/src/lib/pptx/xml'

const NS = 'xmlns:p="urn:p"'
const SLIDE = { width: 960, height: 540 }

/** One interactive sequence: clicking triggerId reveals targetId. */
function interactiveSeq(triggerId: string, targetId: string): string {
  return (
    '<p:seq><p:cTn id="20" nodeType="interactiveSeq">' +
    '<p:stCondLst><p:cond evt="onClick" delay="0">' +
    '<p:tgtEl><p:spTgt spid="' + triggerId + '"/></p:tgtEl></p:cond></p:stCondLst>' +
    '<p:childTnLst>' +
    '<p:par><p:cTn id="21" presetID="1" presetClass="entr" nodeType="clickEffect">' +
    '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
    '<p:set><p:cBhvr><p:cTn id="22" dur="1" fill="hold"/>' +
    '<p:tgtEl><p:spTgt spid="' + targetId + '"/></p:tgtEl>' +
    '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>' +
    '</p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>' +
    '</p:childTnLst></p:cTn></p:par>' +
    '</p:childTnLst></p:cTn></p:seq>'
  )
}

function timingWrap(inner: string): Element {
  const xml =
    '<p:timing ' + NS + '><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst>' +
    '<p:seq><p:cTn id="2" nodeType="mainSeq"><p:childTnLst></p:childTnLst></p:cTn></p:seq>' +
    inner +
    '</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'
  const doc = parseXml(xml)
  if (!doc) throw new Error('fixture did not parse')
  return doc.documentElement
}

describe('trigger evaluation', () => {
  const triggers = parseTriggers(timingWrap(interactiveSeq('101', '201') + interactiveSeq('102', '202')), SLIDE)

  it('hides trigger-revealed answers before any click', () => {
    // Without this the answer would already be on screen, defeating the interaction.
    expect(initiallyHidden([], triggers)).toEqual(new Set(['201', '202']))
    const state = evaluateStep([], 0, { triggers })
    expect(state.visible.size).toBe(0)
  })

  it('reveals only the answer belonging to the clicked button', () => {
    const state = evaluateStep([], 0, { triggers, triggerProgress: { '101': 1 } })
    expect(state.visible).toEqual(new Set(['201']))
    // The other button's answer must stay hidden.
    expect(state.visible.has('202')).toBe(false)
  })

  it('reveals both when both buttons were pressed', () => {
    const state = evaluateStep([], 0, { triggers, triggerProgress: { '101': 1, '102': 1 } })
    expect(state.visible).toEqual(new Set(['201', '202']))
  })

  it('reports the entering effect for the trigger that just ran', () => {
    const state = evaluateStep([], 0, { triggers, triggerProgress: { '101': 1 } })
    expect(Array.from(state.entering.keys())).toEqual(['201'])
  })

  it('clamps trigger progress beyond the track length', () => {
    const state = evaluateStep([], 0, { triggers, triggerProgress: { '101': 99 } })
    expect(state.visible).toEqual(new Set(['201']))
  })

  it('advances the main sequence independently of triggers', () => {
    const state = evaluateStep([], 0, { triggers, triggerProgress: { '101': 1 } })
    // A trigger click must not advance the slide's own click sequence.
    expect(state.visible.size).toBe(1)
  })
})
