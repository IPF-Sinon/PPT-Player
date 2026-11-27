// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { easeProgress, linePathFrom, ooxmlPathToSvgD } from '../../src/renderer/src/lib/pptx/motion-path'
import { parseAnimations, parseTriggers } from '../../src/renderer/src/lib/pptx/animations'
import { parseTransition } from '../../src/renderer/src/lib/pptx/transition'
import { parseXml } from '../../src/renderer/src/lib/pptx/xml'

const NS = 'xmlns:p="urn:p" xmlns:mc="urn:mc" xmlns:p14="urn:p14"'
const SLIDE = { width: 960, height: 540 }

describe('ooxmlPathToSvgD', () => {
  // Coordinates in OOXML are fractions of the slide box, and the trailing E is an
  // end marker rather than a drawing command.
  it('scales normalised coordinates into slide pixels', () => {
    expect(ooxmlPathToSvgD('M 0 0 L 0.5 0.25 E', 960, 540)).toBe('M 0 0 L 480 135')
  })

  it('treats the trailing E as a terminator', () => {
    const d = ooxmlPathToSvgD('M 0 0 L 1 0 E', 100, 100)
    expect(d).not.toContain('E')
    expect(d).toBe('M 0 0 L 100 0')
  })

  it('keeps bezier control points', () => {
    const d = ooxmlPathToSvgD('M 0 0 C 0.25 0.5 0.75 0.5 1 0', 100, 100)
    expect(d).toBe('M 0 0 C 25 50 75 50 100 0')
  })

  it('expands a repeated argument set into separate segments', () => {
    expect(ooxmlPathToSvgD('M 0 0 L 0.5 0 1 0', 100, 100)).toBe('M 0 0 L 50 0 L 100 0')
  })

  it('closes a path', () => {
    expect(ooxmlPathToSvgD('M 0 0 L 1 0 L 1 1 Z', 100, 100)).toBe('M 0 0 L 100 0 L 100 100 Z')
  })

  it('returns null for an empty or unreadable path', () => {
    expect(ooxmlPathToSvgD(null, 100, 100)).toBeNull()
    expect(ooxmlPathToSvgD('   ', 100, 100)).toBeNull()
    expect(ooxmlPathToSvgD('X 1 2', 100, 100)).toBeNull()
  })
})

describe('linePathFrom', () => {
  it('builds a line from explicit from and to points', () => {
    expect(linePathFrom({ x: 0, y: 0 }, { x: 1, y: 0.5 }, null, 100, 100)).toBe('M 0 0 L 100 50')
  })

  it('derives the end from a by offset', () => {
    expect(linePathFrom({ x: 0.2, y: 0.2 }, null, { x: 0.5, y: 0 }, 100, 100)).toBe('M 20 20 L 70 20')
  })

  it('returns null when nothing is declared', () => {
    expect(linePathFrom(null, null, null, 100, 100)).toBeNull()
  })
})

describe('easeProgress', () => {
  it('is linear when no acceleration is declared', () => {
    expect(easeProgress(0.5)).toBeCloseTo(0.5, 5)
  })

  it('stays within 0..1 and hits both ends', () => {
    expect(easeProgress(0, 0.3, 0.3)).toBe(0)
    expect(easeProgress(1, 0.3, 0.3)).toBeCloseTo(1, 5)
  })

  it('is slower at the start than linear when accelerating', () => {
    expect(easeProgress(0.1, 0.4, 0)).toBeLessThan(0.1)
  })

  it('clamps out-of-range progress', () => {
    expect(easeProgress(-1)).toBe(0)
    expect(easeProgress(2)).toBe(1)
  })
})

/** A p:animMotion behaviour inside a click par, as PowerPoint writes it. */
function motionPar(shapeId: string, path: string, dur = 2000): string {
  return (
    '<p:par><p:cTn id="5" presetID="0" presetClass="path" fill="hold" nodeType="clickEffect">' +
    '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
    '<p:par><p:cTn id="6" presetID="0" presetClass="path" fill="hold" nodeType="withEffect">' +
    '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
    '<p:animMotion origin="layout" path="' + path + '" pathEditMode="relative" rAng="0" ptsTypes="">' +
    '<p:cBhvr><p:cTn id="7" dur="' + dur + '" fill="hold"/>' +
    '<p:tgtEl><p:spTgt spid="' + shapeId + '"/></p:tgtEl>' +
    '<p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst>' +
    '</p:cBhvr></p:animMotion>' +
    '</p:childTnLst></p:cTn></p:par>' +
    '</p:childTnLst></p:cTn></p:par>'
  )
}

function timingWrap(inner: string, seqType = 'mainSeq'): Element {
  const xml =
    '<p:timing ' + NS + '><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst>' +
    '<p:seq concurrent="1"><p:cTn id="2" nodeType="' + seqType + '"><p:childTnLst>' +
    inner +
    '</p:childTnLst></p:cTn></p:seq>' +
    '</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'
  const doc = parseXml(xml)
  if (!doc) throw new Error('fixture did not parse')
  return doc.documentElement
}

describe('parseAnimations with motion', () => {
  it('reads a path animation as a motion effect', () => {
    const steps = parseAnimations(timingWrap(motionPar('7', 'M 0 0 L 0.5 0.5 E')), SLIDE)
    expect(steps).toHaveLength(1)
    const effect = steps[0].effects[0]
    expect(effect.kind).toBe('motion')
    expect(effect.preset).toBe('path')
    // The path is already in slide pixels, not normalised.
    expect(effect.motion?.d).toBe('M 0 0 L 480 270')
  })

  it('defaults a path duration to 2000ms when none is declared', () => {
    const steps = parseAnimations(timingWrap(motionPar('7', 'M 0 0 L 1 0 E', -1)), SLIDE)
    expect(steps[0].effects[0].duration).toBe(2000)
  })

  it('keeps the declared duration', () => {
    const steps = parseAnimations(timingWrap(motionPar('7', 'M 0 0 L 1 0 E', 3000)), SLIDE)
    expect(steps[0].effects[0].duration).toBe(3000)
  })

  it('does not confuse a path with an enter effect', () => {
    const steps = parseAnimations(timingWrap(motionPar('7', 'M 0 0 L 0.5 0 E')), SLIDE)
    // A path moves the shape without changing whether it is visible.
    expect(steps[0].effects.some((e) => e.kind === 'enter')).toBe(false)
  })
})

describe('parseTriggers', () => {
  /** An interactive sequence bound to a button shape. */
  function interactiveSeq(triggerId: string, targetId: string): string {
    return (
      '<p:seq concurrent="1"><p:cTn id="20" nodeType="interactiveSeq" restart="whenNotActive">' +
      '<p:stCondLst><p:cond evt="onClick" delay="0">' +
      '<p:tgtEl><p:spTgt spid="' + triggerId + '"/></p:tgtEl>' +
      '</p:cond></p:stCondLst>' +
      '<p:childTnLst>' +
      '<p:par><p:cTn id="21" presetID="1" presetClass="entr" nodeType="clickEffect">' +
      '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
      '<p:par><p:cTn id="22" presetID="10" presetClass="entr" nodeType="withEffect">' +
      '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
      '<p:set><p:cBhvr><p:cTn id="23" dur="1" fill="hold"/>' +
      '<p:tgtEl><p:spTgt spid="' + targetId + '"/></p:tgtEl>' +
      '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>' +
      '</p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>' +
      '</p:childTnLst></p:cTn></p:par>' +
      '</p:childTnLst></p:cTn></p:par>' +
      '</p:childTnLst></p:cTn></p:seq>'
    )
  }

  it('maps a button shape to its own track', () => {
    const timing = timingWrap(interactiveSeq('101', '201'))
    const triggers = parseTriggers(timing, SLIDE)
    expect(Object.keys(triggers)).toEqual(['101'])
    expect(triggers['101'].steps).toHaveLength(1)
    expect(triggers['101'].steps[0].effects[0].targetId).toBe('201')
    expect(triggers['101'].steps[0].effects[0].kind).toBe('enter')
  })

  it('keeps two buttons independent', () => {
    const timing = timingWrap(interactiveSeq('101', '201') + interactiveSeq('102', '202'))
    const triggers = parseTriggers(timing, SLIDE)
    expect(Object.keys(triggers).sort()).toEqual(['101', '102'])
    // Each button must reveal only its own answer, never the other one.
    expect(triggers['101'].steps[0].effects[0].targetId).toBe('201')
    expect(triggers['102'].steps[0].effects[0].targetId).toBe('202')
  })

  it('ignores a main sequence', () => {
    const timing = timingWrap(motionPar('7', 'M 0 0 L 1 0 E'))
    expect(parseTriggers(timing, SLIDE)).toEqual({})
  })
})

describe('parseTransition', () => {
  it('reads a plain fade with its speed', () => {
    const doc = parseXml('<p:sld ' + NS + '><p:transition spd="slow"><p:fade/></p:transition></p:sld>')
    const tr = parseTransition(doc!.documentElement)
    expect(tr?.type).toBe('fade')
    expect(tr?.duration).toBe(700)
  })

  it('reads the p14 millisecond duration from AlternateContent', () => {
    const doc = parseXml(
      '<p:sld ' + NS + '>' +
        '<mc:AlternateContent><mc:Choice Requires="p14">' +
        '<p:transition spd="med" p14:dur="1250"><p:push dir="l"/></p:transition>' +
        '</mc:Choice></mc:AlternateContent></p:sld>'
    )
    const tr = parseTransition(doc!.documentElement)
    expect(tr?.type).toBe('push')
    expect(tr?.direction).toBe('left')
    expect(tr?.duration).toBe(1250)
  })

  it('reads a wipe direction', () => {
    const doc = parseXml('<p:sld ' + NS + '><p:transition spd="fast"><p:wipe dir="u"/></p:transition></p:sld>')
    const tr = parseTransition(doc!.documentElement)
    expect(tr?.type).toBe('wipe')
    expect(tr?.direction).toBe('up')
    expect(tr?.duration).toBe(250)
  })

  it('treats a cut as no transition at all', () => {
    const doc = parseXml('<p:sld ' + NS + '><p:transition><p:cut/></p:transition></p:sld>')
    expect(parseTransition(doc!.documentElement)).toBeUndefined()
  })

  it('returns undefined when the slide declares none', () => {
    const doc = parseXml('<p:sld ' + NS + '><p:cSld/></p:sld>')
    expect(parseTransition(doc!.documentElement)).toBeUndefined()
  })
})
