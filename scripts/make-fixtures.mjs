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

/**
 * Deck whose cover block exits on click.
 *
 * The block sits over the answer and must vanish for good once revealed; this is the
 * pattern that exposed the exit-rebound bug, so the fixture keeps it.
 */
async function buildExit() {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  const slide = pptx.addSlide()
  slide.background = { color: 'FFFFFF' }
  slide.addText('问题：本诗的手法？', { x: 0.6, y: 0.5, w: 8.8, h: 0.7, fontSize: 24, bold: true })
  slide.addText('答案：以动衬静', { x: 1.0, y: 2.0, w: 7, h: 0.9, fontSize: 20 })
  slide.addShape('rect', { x: 0.8, y: 1.85, w: 7.4, h: 1.2, fill: { color: 'E8EEF9' } })

  const buffer = await pptx.write({ outputType: 'nodebuffer' })
  const files = unzipSync(new Uint8Array(buffer))
  const key = 'ppt/slides/slide1.xml'
  const xml = strFromU8(files[key])

  const idOf = (needle) => {
    const at = xml.indexOf(needle)
    if (at < 0) throw new Error('shape not found: ' + needle)
    const ids = [...xml.slice(0, at).matchAll(/<p:cNvPr id="(\d+)"/g)]
    return ids[ids.length - 1][1]
  }
  const coverId = idOf('E8EEF9')

  const exitPar =
    '<p:par><p:cTn id="5" presetID="1" presetClass="exit" fill="hold" nodeType="clickEffect">' +
    '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
    '<p:par><p:cTn id="6" presetID="10" presetClass="exit" fill="hold" nodeType="withEffect">' +
    '<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' +
    '<p:set><p:cBhvr><p:cTn id="7" dur="1" fill="hold">' +
    '<p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>' +
    '<p:tgtEl><p:spTgt spid="' + coverId + '"/></p:tgtEl>' +
    '<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>' +
    '</p:cBhvr><p:to><p:strVal val="hidden"/></p:to></p:set>' +
    '<p:animEffect transition="out" filter="fade"><p:cBhvr><p:cTn id="8" dur="400"/>' +
    '<p:tgtEl><p:spTgt spid="' + coverId + '"/></p:tgtEl></p:cBhvr></p:animEffect>' +
    '</p:childTnLst></p:cTn></p:par>' +
    '</p:childTnLst></p:cTn></p:par>'

  const timing =
    '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" nodeType="tmRoot"><p:childTnLst>' +
    '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq">' +
    '<p:childTnLst>' + exitPar + '</p:childTnLst></p:cTn></p:seq>' +
    '</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'

  files[key] = strToU8(xml.replace('</p:sld>', timing + '</p:sld>'))
  writeFileSync(join(outDir, 'deck-exit.pptx'), Buffer.from(zipSync(files)))
}

/**
 * Minimal Word document.
 *
 * Hand-built rather than generated: it exists so the engine probe can prove Writer
 * was not pruned away, and one paragraph of text is enough for that.
 */
function buildDocx() {
  const files = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body>' +
        // One paragraph on an explicitly sized page: the fixture exists to prove the
        // Writer library converts at all, and a page count that depends on how much
        // text happens to fit is a test that fails for the wrong reason.
        '<w:p><w:r><w:t>课堂讲义：用于验证 Writer 转换。</w:t></w:r></w:p>' +
        // An explicit page size and margins, because an empty sectPr leaves Writer to
        // its own defaults and the resulting page count is not something to depend on.
        '<w:sectPr>' +
        '<w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>' +
        '</w:sectPr>' +
        '</w:body></w:document>'
    )
  }
  writeFileSync(join(outDir, 'smoke.docx'), Buffer.from(zipSync(files)))
}

/**
 * Minimal spreadsheet.
 *
 * Two cells is enough to make Calc the only thing that can produce a PDF from it.
 */
function buildXlsx() {
  const files = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="成绩" sheetId="1" r:id="rId1"/></sheets></workbook>'
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>'
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetData>' +
        '<row r="1"><c r="A1" t="inlineStr"><is><t>姓名</t></is></c><c r="B1" t="inlineStr"><is><t>分数</t></is></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr"><is><t>张三</t></is></c><c r="B2"><v>95</v></c></row>' +
        '</sheetData></worksheet>'
    )
  }
  writeFileSync(join(outDir, 'smoke.xlsx'), Buffer.from(zipSync(files)))
}

/**
 * A Word document that exercises every feature the native renderer must draw.
 *
 * The minimal smoke.docx above exists to prove Writer converts at all. This one is
 * the renderer's fixture: it has a heading, styled runs, a numbered list, a bulleted
 * list, a table with a horizontal and a vertical merge, an embedded picture and an
 * explicit page break, so a parser regression shows up as a failing assertion rather
 * than as a document that quietly looks slightly wrong.
 */
function buildDocxRich() {
  // A 1x1 PNG: enough to prove the image relationship resolves to a served URL.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document' +
    ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
    ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<w:body>' +
    // Heading 1, centred, through the built-in style.
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr>' +
    '<w:r><w:t>诗评类古诗词鉴赏题解题方法</w:t></w:r></w:p>' +
    // Body paragraph with mixed runs: bold, italic, a colour, an underline and a
    // superscript, which is what a real handout is made of.
    '<w:p><w:pPr><w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/>' +
    '<w:ind w:firstLine="480"/><w:jc w:val="both"/></w:pPr>' +
    '<w:r><w:rPr><w:b/></w:rPr><w:t>手法 + 诗句分析</w:t></w:r>' +
    '<w:r><w:rPr><w:i/></w:rPr><w:t> + 表达效果</w:t></w:r>' +
    '<w:r><w:rPr><w:color w:val="C00000"/></w:rPr><w:t> + 思想情感</w:t></w:r>' +
    '<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t> + 答题范式</w:t></w:r>' +
    '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>1</w:t></w:r>' +
    '</w:p>' +
    // A numbered list: two items, so the second must be numbered 2.
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
    '<w:r><w:t>先定位手法，再回原文找对应诗句</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
    '<w:r><w:t>最后落到情感，避免只堆术语</w:t></w:r></w:p>' +
    // A bulleted list, which uses a different abstract numbering.
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>' +
    '<w:r><w:t>以动衬静</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>' +
    '<w:r><w:t>虚实相生</w:t></w:r></w:p>' +
    // A table: three columns, a header row shaded, a horizontal merge on the second
    // row and a vertical merge in the third column.
    '<w:tbl>' +
    '<w:tblPr>' +
    '<w:tblW w:w="8296" w:type="dxa"/>' +
    '<w:tblBorders>' +
    '<w:top w:val="single" w:sz="8" w:color="8EAADB"/>' +
    '<w:left w:val="single" w:sz="8" w:color="8EAADB"/>' +
    '<w:bottom w:val="single" w:sz="8" w:color="8EAADB"/>' +
    '<w:right w:val="single" w:sz="8" w:color="8EAADB"/>' +
    '<w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/>' +
    '<w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/>' +
    '</w:tblBorders>' +
    '</w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="2765"/><w:gridCol w:w="2765"/><w:gridCol w:w="2766"/></w:tblGrid>' +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="DEEAF6"/></w:tcPr>' +
    '<w:p><w:r><w:t>题型</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="DEEAF6"/></w:tcPr>' +
    '<w:p><w:r><w:t>设问方式</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="DEEAF6"/></w:tcPr>' +
    '<w:p><w:r><w:t>分值</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>' +
    '<w:p><w:r><w:t>合并两列的题干</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>' +
    '<w:p><w:r><w:t>纵向合并</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>第一行</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>' +
    '<w:tc><w:p><w:r><w:t>第二行</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>8</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    '</w:tbl>' +
    // An inline picture, sized by wp:extent.
    '<w:p><w:r><w:drawing>' +
    '<wp:inline>' +
    '<wp:extent cx="914400" cy="914400"/>' +
    '<wp:docPr id="1" name="示例图片"/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:blipFill><a:blip r:embed="rIdImage"/></pic:blipFill></pic:pic>' +
    '</a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r></w:p>' +
    // An explicit page break, which is what makes the document two pages.
    '<w:p><w:r><w:br w:type="page"/></w:r><w:r><w:t>第二页的正文</w:t></w:r></w:p>' +
    '<w:sectPr>' +
    '<w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>' +
    '</w:sectPr>' +
    '</w:body></w:document>'

  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/>' +
    '<w:sz w:val="24"/><w:szCs w:val="24"/>' +
    '</w:rPr></w:rPrDefault></w:docDefaults>' +
    // Heading1 is based on Normal, so its size is inherited unless it states one.
    '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/>' +
    '<w:pPr><w:spacing w:after="120"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
    '<w:basedOn w:val="Normal"/>' +
    '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>' +
    '<w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="1F3864"/></w:rPr></w:style>' +
    '</w:styles>'

  const numberingXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">' +
    '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
    '<w:suff w:val="space"/>' +
    '<w:pPr><w:ind w:left="840" w:hanging="420"/></w:pPr>' +
    '</w:lvl></w:abstractNum>' +
    '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0">' +
    '<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="\uF0B7"/>' +
    '<w:pPr><w:ind w:left="840" w:hanging="420"/></w:pPr>' +
    '</w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
    '</w:numbering>'

  const documentRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' +
    '</Relationships>'

  const files = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(stylesXml),
    'word/numbering.xml': strToU8(numberingXml),
    'word/_rels/document.xml.rels': strToU8(documentRels),
    'word/media/image1.png': new Uint8Array(png)
  }
  writeFileSync(join(outDir, 'deck-docx.docx'), Buffer.from(zipSync(files)))
}


/**
 * A workbook with two sheets, a merged title and a formatted number.
 *
 * Built by hand, the way the docx fixture is, because there is no spreadsheet library
 * available here and adding one would be a dependency for a fixture. It is built the
 * way a producer writes one rather than the way the reader imagines it: strings go
 * through sharedStrings with the type attribute set, the dimension is declared, the
 * merge is in its own mergeCells element, and there are two worksheets so the tab bar
 * has something to switch between.
 *
 * 成绩 / A1:C1 merged title / header row / two students / a blank row / a total row.
 */
function buildSheetXlsx() {
  const sharedStrings = ['期中成绩', '姓名', '语文', '数学', '张三', '李四', '平均分']
  const stringTable = sharedStrings.map((text) => '<si><t>' + text + '</t></si>').join('')

  const sheet1 = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<dimension ref="A1:C6"/>',
    '<cols>',
    // Column A is wider, because names are longer than numbers.
    '<col min="1" max="1" width="14.5" customWidth="1"/>',
    '<col min="2" max="3" width="9" customWidth="1"/>',
    '</cols>',
    '<sheetData>',
    '<row r="1"><c r="A1" t="s"><v>0</v></c></row>',
    '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c></row>',
    '<row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3"><v>95</v></c><c r="C3"><v>88.5</v></c></row>',
    '<row r="4"><c r="A4" t="s"><v>5</v></c><c r="B4"><v>72</v></c><c r="C4"><v>91</v></c></row>',
    // A row the writer left entirely blank, which must not appear in the window.
    '<row r="5"/>',
    '<row r="6"><c r="A6" t="s"><v>6</v></c><c r="B6"><v>83.5</v></c><c r="C6"><v>89.75</v></c></row>',
    '</sheetData>',
    // The title spans all three columns, which is the merge the view must draw.
    '<mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells>',
    '</worksheet>'
  ].join('')

  const sheet2 = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<dimension ref="A1:B2"/>',
    '<sheetData>',
    '<row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1" t="s"><v>2</v></c></row>',
    '<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>66</v></c></row>',
    '</sheetData>',
    '</worksheet>'
  ].join('')

  const files = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' +
        '<sheet name="成绩" sheetId="1" r:id="rId1"/>' +
        '<sheet name="备注" sheetId="2" r:id="rId2"/>' +
        '</sheets></workbook>'
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
        '</Relationships>'
    ),
    'xl/sharedStrings.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' +
        sharedStrings.length +
        '" uniqueCount="' +
        sharedStrings.length +
        '">' +
        stringTable +
        '</sst>'
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet1),
    'xl/worksheets/sheet2.xml': strToU8(sheet2)
  }
  writeFileSync(join(outDir, 'deck-sheet.xlsx'), Buffer.from(zipSync(files)))
}

/**
 * The same table saved the way a Chinese-locale Excel saves a CSV: GBK, not UTF-8.
 *
 * The bytes are written literally rather than through a TextEncoder because the point
 * of the fixture is that the file is NOT valid UTF-8. Reading it as UTF-8 is exactly
 * the bug the fallback exists to prevent, so a fixture that happened to be valid
 * UTF-8 would test nothing.
 */
function buildSheetCsvGbk() {
  // 姓名,分数 / 张三,95 / 李四,88.5, in GBK.
  const bytes = [
    0xd0, 0xd5, 0xc3, 0xfb, 0x2c, 0xb7, 0xd6, 0xca, 0xfd, 0x0d, 0x0a, 0xd5, 0xc5, 0xc8, 0xfd,
    0x2c, 0x39, 0x35, 0x0d, 0x0a, 0xc0, 0xee, 0xcb, 0xc4, 0x2c, 0x38, 0x38, 0x2e, 0x35, 0x0d, 0x0a
  ]
  writeFileSync(join(outDir, 'deck-sheet-gbk.csv'), Buffer.from(bytes))
}

/** A UTF-8 CSV with a quoted field, so the parser's quoting path has a real file. */
function buildSheetCsvUtf8() {
  const text = [
    '姓名,评语,分数',
    '张三,"进步明显, 继续保持",95',
    '李四,基础扎实,88.5',
    ''
  ].join('\r\n')
  writeFileSync(join(outDir, 'deck-sheet.csv'), Buffer.from(text, 'utf8'))
}

await build16x9()
await build4x3()
await buildSmokePptx()
await buildAnimated()
await buildTriggers()
await buildExit()
buildSmokeOdp()
buildDocx()
buildDocxRich()
buildXlsx()
buildSheetXlsx()
buildSheetCsvGbk()
buildSheetCsvUtf8()

console.log(
  '[make-fixtures] wrote deck-16x9, deck-4x3, smoke, deck-animated, deck-triggers, deck-exit, ' +
    'smoke.odp, smoke.docx, deck-docx.docx, smoke.xlsx, deck-sheet.xlsx, deck-sheet-gbk.csv, deck-sheet.csv'
)