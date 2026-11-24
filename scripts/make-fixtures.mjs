import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import PptxGenJS from 'pptxgenjs'

const outDir = join(process.cwd(), 'tests', 'fixtures')
mkdirSync(outDir, { recursive: true })

const deckTitle = '诗评类古诗词鉴赏题解题方法'

async function build16x9() {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  pptx.title = deckTitle

  const title = pptx.addSlide()
  title.background = { color: 'FFFFFF' }
  title.addText('湛江市第二十中学', { x: 1.0, y: 0.7, w: 8, h: 0.6, fontSize: 30, bold: true, color: '111111' })
  title.addText('Zhanjiang No. 20 Middle School', { x: 1.0, y: 1.25, w: 8, h: 0.4, fontSize: 16, color: '333333' })
  title.addText('高三语文一轮复习 · 古代诗歌阅读专题', { x: 1.0, y: 1.85, w: 8.5, h: 0.5, fontSize: 20, color: '2F5597' })
  title.addText(deckTitle, { x: 1.0, y: 2.7, w: 9, h: 0.9, fontSize: 36, bold: true, color: '2F5597' })
  title.addText('2026.11', { x: 6.2, y: 4.1, w: 2.5, h: 0.5, fontSize: 20, bold: true, color: '2F5597' })

  const second = pptx.addSlide()
  second.background = { color: 'F7F9FC' }
  second.addText('学情分析', { x: 0.6, y: 0.5, w: 6, h: 0.5, fontSize: 24, bold: true, color: '1F3864' })
  second.addText(
    [
      { text: '诗歌鉴赏得分率偏低，主要失分在「手法 + 效果 + 情感」三要素', options: { bullet: true } },
      { text: '审题不清：分不清「赏析」与「评价」的答题要求', options: { bullet: true } },
      { text: '术语堆砌：能写出术语，但缺少与诗句的对应分析', options: { bullet: true } }
    ],
    { x: 0.8, y: 1.3, w: 8, h: 2.4, fontSize: 16, color: '222222' }
  )

  const third = pptx.addSlide()
  third.background = { color: 'FFFFFF' }
  third.addText('答题范式', { x: 0.6, y: 0.5, w: 6, h: 0.5, fontSize: 24, bold: true, color: '1F3864' })
  third.addShape('rect', { x: 0.8, y: 1.3, w: 8.2, h: 1.1, fill: { color: 'E8EEF9' }, line: { color: 'B4C6E7' } })
  third.addText('手法 + 诗句分析 + 表达效果 + 思想情感', { x: 1.0, y: 1.6, w: 7.8, h: 0.5, fontSize: 18, color: '1F3864' })
  third.addText('例：本诗运用以动衬静的手法，以「鸟鸣」反衬山居之静，突出了诗人闲适恬淡的心境。', {
    x: 0.8,
    y: 2.8,
    w: 8.2,
    h: 1.2,
    fontSize: 15,
    color: '333333'
  })

  await pptx.writeFile({ fileName: join(outDir, 'deck-16x9.pptx') })
}

async function build4x3() {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_4x3'
  const s1 = pptx.addSlide()
  s1.background = { color: 'FFFFFF' }
  s1.addText('四比三版式', { x: 0.5, y: 0.4, w: 8, h: 0.6, fontSize: 28, bold: true, color: '111111' })
  s1.addText('用于验证页面尺寸混排时不被拉伸。', { x: 0.5, y: 1.2, w: 8, h: 0.6, fontSize: 16, color: '444444' })
  const s2 = pptx.addSlide()
  s2.background = { color: 'F2F2F2' }
  s2.addText('第二页', { x: 0.5, y: 0.4, w: 8, h: 0.6, fontSize: 24, color: '111111' })
  await pptx.writeFile({ fileName: join(outDir, 'deck-4x3.pptx') })
}

async function buildSmoke() {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  const s1 = pptx.addSlide()
  s1.addText('引擎冒烟测试', { x: 0.8, y: 1.0, w: 8, h: 0.8, fontSize: 32, bold: true, color: '111111' })
  s1.addText('smoke', { x: 0.8, y: 2.0, w: 4, h: 0.6, fontSize: 20, color: '444444' })
  await pptx.writeFile({ fileName: join(outDir, 'smoke.pptx') })
}

await build16x9()
await build4x3()
await buildSmoke()

// A hand-built minimal ODP so the smoke gate covers the OpenDocument path
// without needing LibreOffice at fixture-creation time.
const odpDir = join(outDir, 'odp-src')
mkdirSync(odpDir, { recursive: true })
const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  office:version="1.3">
  <office:body>
    <office:presentation>
      <draw:page draw:name="page1">
        <draw:frame svg:width="20cm" svg:height="3cm" svg:x="2cm" svg:y="3cm">
          <draw:text-box><text:p>ODP 冒烟测试</text:p></draw:text-box>
        </draw:frame>
      </draw:page>
      <draw:page draw:name="page2">
        <draw:frame svg:width="20cm" svg:height="3cm" svg:x="2cm" svg:y="3cm">
          <draw:text-box><text:p>第二页</text:p></draw:text-box>
        </draw:frame>
      </draw:page>
    </office:presentation>
  </office:body>
</office:document-content>`
const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.presentation"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`
const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3">
  <office:styles/>
</office:document-styles>`

writeFileSync(join(odpDir, 'content.xml'), contentXml, 'utf8')
writeFileSync(join(odpDir, 'styles.xml'), stylesXml, 'utf8')
writeFileSync(join(odpDir, 'META-INF'), '', 'utf8')

const { zipSync, strToU8 } = await import('fflate')
const odfZip = zipSync(
  {
    mimetype: strToU8('application/vnd.oasis.opendocument.presentation'),
    'content.xml': strToU8(contentXml),
    'styles.xml': strToU8(stylesXml),
    'META-INF/manifest.xml': strToU8(manifestXml)
  },
  { level: 0, mtime: new Date(0) }
)
writeFileSync(join(outDir, 'smoke.odp'), Buffer.from(odfZip))
console.log('[make-fixtures] wrote tests/fixtures/{deck-16x9,deck-4x3,smoke}.pptx and smoke.odp')
