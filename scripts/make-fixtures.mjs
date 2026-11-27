import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import PptxGenJS from 'pptxgenjs'

const outDir = join(process.cwd(), 'tests', 'fixtures')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const deckTitle = '诗评类古诗词鉴赏题解题方法'

/** 16:9 deck with Chinese text, used for preview and playback screenshots. */
async function build16x9() {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  pptx.title = deckTitle

  const cover = pptx.addSlide()
  cover.background = { color: 'FFFFFF' }
  cover.addText('湛江市第二十中学', { x: 1.0, y: 0.7, w: 8, h: 0.6, fontSize: 28, bold: true, color: '111111' })
  cover.addText('Zhanjiang No. 20 Middle School', { x: 1.0, y: 1.22, w: 8, h: 0.4, fontSize: 14, color: '444444' })
  cover.addText('高三语文一轮复习 · 古代诗歌阅读专题', { x: 1.0, y: 1.8, w: 8.5, h: 0.5, fontSize: 18, color: '2F5597' })
  cover.addText(deckTitle, { x: 1.0, y: 2.7, w: 9, h: 0.9, fontSize: 34, bold: true, color: '2F5597' })
  cover.addText('2026.11', { x: 6.4, y: 4.1, w: 2.5, h: 0.5, fontSize: 18, bold: true, color: '2F5597' })

  const analysis = pptx.addSlide()
  analysis.background = { color: 'F7F9FC' }
  analysis.addText('学情分析', { x: 0.6, y: 0.5, w: 6, h: 0.5, fontSize: 24, bold: true, color: '1F3864' })
  analysis.addText(
    [
      { text: '得分率偏低，主要失分在「手法 + 效果 + 情感」三要素', options: { bullet: true } },
      { text: '审题不清：分不清「赏析」与「评价」的答题要求', options: { bullet: true } },
      { text: '术语堆砌：能写出术语，但缺少与诗句的对应分析', options: { bullet: true } }
    ],
    { x: 0.8, y: 1.3, w: 8, h: 2.4, fontSize: 16, color: '222222' }
  )

  const method = pptx.addSlide()
  method.background = { color: 'FFFFFF' }
  method.addText('答题范式', { x: 0.6, y: 0.5, w: 6, h: 0.5, fontSize: 24, bold: true, color: '1F3864' })
  method.addShape('rect', { x: 0.8, y: 1.3, w: 8.2, h: 1.1, fill: { color: 'E8EEF9' }, line: { color: 'B4C6E7' } })
  method.addText('手法 + 诗句分析 + 表达效果 + 思想情感', { x: 1.0, y: 1.6, w: 7.8, h: 0.5, fontSize: 18, color: '1F3864' })
  method.addText('例：本诗运用以动衬静的手法，以「鸟鸣」反衬山居之静，突出诗人闲适恬淡的心境。', {
    x: 0.8,
    y: 2.8,
    w: 8.2,
    h: 1.2,
    fontSize: 15,
    color: '333333'
  })

  await pptx.writeFile({ fileName: join(outDir, 'deck-16x9.pptx') })
}

/** 4:3 deck used to verify that mixed aspect ratios are not stretched. */
async function build4x3() {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_4x3'
  const first = pptx.addSlide()
  first.background = { color: 'FFFFFF' }
  first.addText('四比三版式', { x: 0.5, y: 0.4, w: 8, h: 0.6, fontSize: 28, bold: true, color: '111111' })
  first.addText('用于验证页面尺寸混排时不被拉伸。', { x: 0.5, y: 1.2, w: 8, h: 0.6, fontSize: 16, color: '444444' })
  const second = pptx.addSlide()
  second.background = { color: 'F2F2F2' }
  second.addText('第二页', { x: 0.5, y: 0.4, w: 8, h: 0.6, fontSize: 24, color: '111111' })
  await pptx.writeFile({ fileName: join(outDir, 'deck-4x3.pptx') })
}

/** Single-slide deck used by the engine smoke gate. */
async function buildSmokePptx() {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  const slide = pptx.addSlide()
  slide.addText('引擎冒烟测试', { x: 0.8, y: 1.0, w: 8, h: 0.8, fontSize: 32, bold: true, color: '111111' })
  slide.addText('smoke', { x: 0.8, y: 2.0, w: 4, h: 0.6, fontSize: 20, color: '444444' })
  await pptx.writeFile({ fileName: join(outDir, 'smoke.pptx') })
}

/** Minimal but valid ODP so the smoke gate also covers the OpenDocument path. */
function buildSmokeOdp() {
  const contentXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<office:document-content',
    '  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
    '  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
    '  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
    '  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
    '  office:version="1.3">',
    '  <office:body>',
    '    <office:presentation>',
    '      <draw:page draw:name="page1">',
    '        <draw:frame svg:width="20cm" svg:height="3cm" svg:x="2cm" svg:y="3cm">',
    '          <draw:text-box><text:p>ODP 冒烟测试</text:p></draw:text-box>',
    '        </draw:frame>',
    '      </draw:page>',
    '      <draw:page draw:name="page2">',
    '        <draw:frame svg:width="20cm" svg:height="3cm" svg:x="2cm" svg:y="3cm">',
    '          <draw:text-box><text:p>第二页</text:p></draw:text-box>',
    '        </draw:frame>',
    '      </draw:page>',
    '    </office:presentation>',
    '  </office:body>',
    '</office:document-content>'
  ].join('\n')

  const stylesXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3">',
    '  <office:styles/>',
    '</office:document-styles>'
  ].join('\n')

  const manifestXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">',
    '  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.presentation"/>',
    '  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>',
    '  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>',
    '</manifest:manifest>'
  ].join('\n')

  // The ODF spec requires "mimetype" to be the first entry, stored uncompressed.
  const zip = zipSync(
    {
      mimetype: strToU8('application/vnd.oasis.opendocument.presentation'),
      'content.xml': strToU8(contentXml),
      'styles.xml': strToU8(stylesXml),
      'META-INF/manifest.xml': strToU8(manifestXml)
    },
    { level: 0, mtime: new Date('2026-01-01T00:00:00Z') }
  )
  writeFileSync(join(outDir, 'smoke.odp'), Buffer.from(zip))
}

/**
 * Deck with click animations, built by post-processing a generated file.
 *
 * pptxgenjs cannot author animations, so the slide XML gets a p:timing tree injected
 * afterwards. The shape shape mirrors a real PowerPoint export, which is what the
 * animation parser is written against.
 */
async function buildAnimated() {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  const slide = pptx.addSlide()
  slide.background = { color: 'FFFFFF' }
  slide.addText('问题：本诗运用了什么手法？', {
    x: 0.8, y: 0.6, w: 8.4, h: 0.9, fontSize: 26, bold: true, color: '1F3864'
  })
  // The text is what the animation targets are located by, so the values are not
  // captured; only the generated XML matters.
  slide.addText('答案一：以动衬静', { x: 1.2, y: 2.0, w: 7, h: 0.8, fontSize: 20, color: '333333' })
  slide.addText('答案二：借景抒情', { x: 1.2, y: 3.0, w: 7, h: 0.8, fontSize: 20, color: '333333' })
  slide.addText('答案三：虚实结合', { x: 1.2, y: 4.0, w: 7, h: 0.8, fontSize: 20, color: '333333' })

  const buffer = await pptx.write({ outputType: 'nodebuffer' })
  const files = unzipSync(new Uint8Array(buffer))
  const slideKey = 'ppt/slides/slide1.xml'
  const xml = strFromU8(files[slideKey])

  // Shape ids come from the generated file, so the animation targets the real ones.
  const idOf = (needle) => {
    const at = xml.indexOf(needle)
    if (at < 0) throw new Error('shape not found: ' + needle)
    const before = xml.slice(0, at)
    const ids = [...before.matchAll(/<p:cNvPr id="(\d+)"/g)]
    return ids[ids.length - 1][1]
  }

  const reveal = (id) =>
    '<p:par><p:cTn id="5" presetID="1" presetClass="entr" fill="hold" nodeType="clickEffect">' +
    '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
    '<p:par><p:cTn id="6" presetID="10" presetClass="entr" fill="hold" nodeType="withEffect">' +
    '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
    '<p:set><p:cBhvr><p:cTn id="7" dur="1" fill="hold">' +
    '<p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>' +
    '<p:tgtEl><p:spTgt spid="' + id + '"/></p:tgtEl>' +
    '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>' +
    '</p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>' +
    '<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="8" dur="400"/>' +
    '<p:tgtEl><p:spTgt spid="' + id + '"/></p:tgtEl></p:cBhvr></p:animEffect>' +
    '</p:childTnLst></p:cTn></p:par>' +
    '</p:childTnLst></p:cTn></p:par>'

  const timing =
    '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" nodeType="tmRoot"><p:childTnLst>' +
    '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq">' +
    '<p:childTnLst>' +
    reveal(idOf('答案一')) + reveal(idOf('答案二')) + reveal(idOf('答案三')) +
    '</p:childTnLst></p:cTn></p:seq>' +
    '</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'

  // p:timing must follow p:cSld and precede p:extLst in the schema order.
  const withTiming = xml.replace('</p:sld>', timing + '</p:sld>')
  files[slideKey] = strToU8(withTiming)
  writeFileSync(join(outDir, 'deck-animated.pptx'), Buffer.from(zipSync(files)))
}

/**
 * Deck with click-triggered answers.
 *
 * Two buttons, each revealing its own answer through an interactiveSeq. This is the
 * "click the button for the matching explanation" pattern, and the fixture exists so
 * the e2e suite can prove a trigger reveals only its own target.
 */
async function buildTriggers() {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  const slide = pptx.addSlide()
  slide.background = { color: 'FFFFFF' }
  slide.addText('问题：本诗运用了什么手法？', {
    x: 0.6, y: 0.5, w: 8.8, h: 0.8, fontSize: 24, bold: true, color: '1F3864'
  })
  slide.addShape('roundRect', {
    x: 0.8, y: 1.7, w: 2.6, h: 0.8, fill: { color: '4472C4' }, line: { color: '2F528F' }
  })
  slide.addText('按钮 A', { x: 0.8, y: 1.7, w: 2.6, h: 0.8, fontSize: 16, color: 'FFFFFF', align: 'center', valign: 'middle' })
  slide.addShape('roundRect', {
    x: 0.8, y: 2.8, w: 2.6, h: 0.8, fill: { color: 'ED7D31' }, line: { color: 'C55A11' }
  })
  slide.addText('按钮 B', { x: 0.8, y: 2.8, w: 2.6, h: 0.8, fontSize: 16, color: 'FFFFFF', align: 'center', valign: 'middle' })
  slide.addText('解析 A：以动衬静，以鸟鸣反衬山居之静。', {
    x: 3.9, y: 1.7, w: 5.4, h: 0.8, fontSize: 15, color: '333333'
  })
  slide.addText('解析 B：借景抒情，以秋色寄托羁旅之愁。', {
    x: 3.9, y: 2.8, w: 5.4, h: 0.8, fontSize: 15, color: '333333'
  })

  const buffer = await pptx.write({ outputType: 'nodebuffer' })
  const files = unzipSync(new Uint8Array(buffer))
  const slideKey = 'ppt/slides/slide1.xml'
  const xml = strFromU8(files[slideKey])

  /** Find the shape id that owns the given text. */
  const idOf = (needle) => {
    const at = xml.indexOf(needle)
    if (at < 0) throw new Error('shape not found: ' + needle)
    const ids = [...xml.slice(0, at).matchAll(/<p:cNvPr id="(\d+)"/g)]
    return ids[ids.length - 1][1]
  }

  /** One interactive sequence: clicking triggerId reveals targetId. */
  const interactive = (triggerId, targetId, seqId) =>
    '<p:seq concurrent="1" nextAc="seek">' +
    '<p:cTn id="' + seqId + '" nodeType="interactiveSeq" restart="whenNotActive">' +
    '<p:stCondLst><p:cond evt="onClick" delay="0">' +
    '<p:tgtEl><p:spTgt spid="' + triggerId + '"/></p:tgtEl></p:cond></p:stCondLst>' +
    '<p:childTnLst>' +
    '<p:par><p:cTn id="' + (seqId + 1) + '" presetID="1" presetClass="entr" fill="hold" nodeType="clickEffect">' +
    '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
    '<p:par><p:cTn id="' + (seqId + 2) + '" presetID="10" presetClass="entr" fill="hold" nodeType="withEffect">' +
    '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
    '<p:set><p:cBhvr><p:cTn id="' + (seqId + 3) + '" dur="1" fill="hold">' +
    '<p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>' +
    '<p:tgtEl><p:spTgt spid="' + targetId + '"/></p:tgtEl>' +
    '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>' +
    '</p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>' +
    '<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="' + (seqId + 4) + '" dur="400"/>' +
    '<p:tgtEl><p:spTgt spid="' + targetId + '"/></p:tgtEl></p:cBhvr></p:animEffect>' +
    '</p:childTnLst></p:cTn></p:par>' +
    '</p:childTnLst></p:cTn></p:par>' +
    '</p:childTnLst></p:cTn></p:seq>'

  const timing =
    '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" nodeType="tmRoot"><p:childTnLst>' +
    '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq">' +
    '<p:childTnLst></p:childTnLst></p:cTn></p:seq>' +
    interactive(idOf('按钮 A'), idOf('解析 A'), 30) +
    interactive(idOf('按钮 B'), idOf('解析 B'), 50) +
    '</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'

  files[slideKey] = strToU8(xml.replace('</p:sld>', timing + '</p:sld>'))
  writeFileSync(join(outDir, 'deck-triggers.pptx'), Buffer.from(zipSync(files)))
}

await build16x9()
await build4x3()
await buildSmokePptx()
await buildAnimated()
await buildTriggers()
buildSmokeOdp()

console.log('[make-fixtures] wrote deck-16x9, deck-4x3, smoke, deck-animated, deck-triggers, smoke.odp')
