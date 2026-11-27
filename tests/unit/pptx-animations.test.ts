// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { evaluateStep, initiallyHidden, parseAnimations } from '../../src/renderer/src/lib/pptx/animations'
import { parseXml } from '../../src/renderer/src/lib/pptx/xml'

const NS = 'xmlns:p="urn:p"'

/**
 * One click group, shaped the way PowerPoint actually writes it.
 *
 * A clickEffect par wraps a withEffect par, which holds a p:set and a p:animEffect,
 * each carrying its own cBhvr and tgtEl. Parsing this by nesting depth instead of by
 * nodeType silently produces zero steps, so the fixture keeps the real shape.
 */
function clickReveal(shapeId: string, presetId = '10', dur = 500): string {
  return (
    '<p:par><p:cTn id="5" presetID="1" presetClass="entr" fill="hold" nodeType="clickEffect">' +
    '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
    '<p:par><p:cTn id="6" presetID="' + presetId + '" presetClass="entr" fill="hold" nodeType="withEffect">' +
    '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
    '<p:set><p:cBhvr><p:cTn id="7" dur="1" fill="hold">' +
    '<p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>' +
    '<p:tgtEl><p:spTgt spid="' + shapeId + '"/></p:tgtEl>' +
    '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>' +
    '</p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>' +
    '<p:animEffect transition="in" filter="fade"><p:cBhvr>' +
    '<p:cTn id="8" dur="' + dur + '"/>' +
    '<p:tgtEl><p:spTgt spid="' + shapeId + '"/></p:tgtEl>' +
    '</p:cBhvr></p:animEffect>' +
    '</p:childTnLst></p:cTn></p:par>' +
    '</p:childTnLst></p:cTn></p:par>'
  )
}

/** A click that hides a shape again. */
function clickHide(shapeId: string): string {
  return clickReveal(shapeId).replace(/presetClass="entr"/g, 'presetClass="exit"')
}

function timingXml(inner: string): Element {
  const xml =
    '<p:timing ' + NS + '><p:tnLst><p:par>' +
    '<p:cTn id="1" dur="indefinite" nodeType="tmRoot"><p:childTnLst>' +
    '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq">' +
    '<p:childTnLst>' + inner + '</p:childTnLst>' +
    '</p:cTn></p:seq>' +
    '</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'
  const doc = parseXml(xml)
  if (!doc) throw new Error('fixture did not parse')
  return doc.documentElement
}

describe('parseAnimations', () => {
  it('reads one click group as one step', () => {
    const steps = parseAnimations(timingXml(clickReveal('7')))
    expect(steps).toHaveLength(1)
    expect(steps[0].effects).toHaveLength(1)
    expect(steps[0].effects[0].targetId).toBe('7')
    expect(steps[0].effects[0].kind).toBe('enter')
  })

  it('keeps click groups in order, so step N reveals shape N', () => {
    const steps = parseAnimations(timingXml(clickReveal('3') + clickReveal('4') + clickReveal('5')))
    expect(steps.map((s) => s.effects[0].targetId)).toEqual(['3', '4', '5'])
    expect(steps.map((s) => s.index)).toEqual([1, 2, 3])
  })

  it('does not count the inner withEffect par as its own step', () => {
    // Three clicks must stay three steps even though each nests a withEffect.
    const steps = parseAnimations(timingXml(clickReveal('a') + clickReveal('b') + clickReveal('c')))
    expect(steps).toHaveLength(3)
  })

  it('maps preset ids onto visual presets', () => {
    expect(parseAnimations(timingXml(clickReveal('1', '10')))[0].effects[0].preset).toBe('fade')
    expect(parseAnimations(timingXml(clickReveal('1', '2')))[0].effects[0].preset).toBe('fly')
    expect(parseAnimations(timingXml(clickReveal('1', '22')))[0].effects[0].preset).toBe('wipe')
  })

  it('reads the duration the deck declared', () => {
    expect(parseAnimations(timingXml(clickReveal('1', '10', 750)))[0].effects[0].duration).toBe(750)
  })

  it('classifies exit effects', () => {
    const steps = parseAnimations(timingXml(clickHide('9')))
    expect(steps[0].effects[0].kind).toBe('exit')
  })

  it('returns nothing for a slide with no timing', () => {
    expect(parseAnimations(null)).toEqual([])
  })

  it('returns nothing when the timing tree has no main sequence', () => {
    const doc = parseXml('<p:timing ' + NS + '><p:tnLst/></p:timing>')
    expect(parseAnimations(doc!.documentElement)).toEqual([])
  })
})

describe('evaluateStep', () => {
  // The core teaching behaviour: a question shows, answers appear on clicks.
  const steps = parseAnimations(timingXml(clickReveal('q') + clickReveal('a1') + clickReveal('a2')))

  it('hides every click-revealed shape before the first click', () => {
    expect(evaluateStep(steps, 0).visible.size).toBe(0)
    expect(initiallyHidden(steps)).toEqual(new Set(['q', 'a1', 'a2']))
  })

  it('reveals exactly one more shape per step', () => {
    expect(evaluateStep(steps, 1).visible).toEqual(new Set(['q']))
    expect(evaluateStep(steps, 2).visible).toEqual(new Set(['q', 'a1']))
    expect(evaluateStep(steps, 3).visible).toEqual(new Set(['q', 'a1', 'a2']))
  })

  it('reports only the effect belonging to the step just reached', () => {
    expect(Array.from(evaluateStep(steps, 2).entering.keys())).toEqual(['a1'])
  })

  it('is absolute, so stepping backwards is exact', () => {
    expect(evaluateStep(steps, 3).visible.size).toBe(3)
    expect(evaluateStep(steps, 1).visible).toEqual(new Set(['q']))
    expect(evaluateStep(steps, 0).visible.size).toBe(0)
  })

  it('clamps a step beyond the timeline to the finished slide', () => {
    const state = evaluateStep(steps, 99)
    expect(state.visible).toEqual(new Set(['q', 'a1', 'a2']))
    // Past the end nothing is newly entering, only the last step's own effect.
    expect(state.entering.size).toBeLessThanOrEqual(1)
  })

  it('hides nothing when asked for the finished slide in the preview', () => {
    const state = evaluateStep(steps, 0, { showAll: true })
    expect(state.visible.size).toBe(0)
    expect(state.entering.size).toBe(0)
  })

  it('keeps a shape visible after an exit, then hides it again on rewind', () => {
    const exitSteps = parseAnimations(timingXml(clickReveal('x') + clickHide('x')))
    expect(evaluateStep(exitSteps, 1).visible).toEqual(new Set(['x']))
    expect(evaluateStep(exitSteps, 2).visible).toEqual(new Set())
  })
})
