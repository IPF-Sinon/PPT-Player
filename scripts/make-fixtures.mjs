import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
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

await build16x9()
await build4x3()
await buildSmokePptx()
buildSmokeOdp()

console.log('[make-fixtures] wrote deck-16x9.pptx, deck-4x3.pptx, smoke.pptx, smoke.odp')
