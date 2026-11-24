/** All user visible Chinese copy lives here. */
export const zh = {
  appName: 'PPT 放映器',
  windowTitle: (file: string) => `${file} - PPT 放映器`,

  open: {
    title: '打开演示文稿',
    dropHint: '把 PPT / PPTX / ODP / PDF 拖到这里',
    chooseFile: '选择文件',
    recent: '最近打开',
    noRecent: '暂无最近文件',
    unsupportedType: '不支持的文件类型',
    emptyFile: '文件是空的',
    tooLarge: '文件超过 200 MB，无法打开',
    notPresentation: '这不是演示文稿文件'
  },

  preview: {
    slides: '幻灯片',
    fitWindow: '适合窗口',
    startShow: '开始放映',
    startFromHere: '从当前页放映',
    page: (n: number, total: number) => `${n} / ${total}`,
    info: '演示文稿信息',
    format: '格式',
    container: '容器',
    pages: '页数',
    pageSize: '页面尺寸',
    encrypted: '加密',
    engine: '转换引擎',
    convertTime: '转换耗时',
    cachePath: '缓存位置',
    reconvert: '重新转换',
    clearCache: '清理缓存',
    converting: '正在转换…',
    stageProbe: '正在识别格式',
    stageConvert: '正在转换',
    stageParse: '正在解析页面',
    stageDone: '完成',
    cancel: '取消',
    cancelled: '已取消转换',
    mixedAspect: '包含不同比例的页面',
    cached: '已缓存'
  },

  playback: {
    prev: '上一页',
    next: '下一页',
    pointer: '指针',
    pen: '画笔',
    eraser: '橡皮',
    magnifier: '放大镜',
    blackout: '黑屏',
    overview: '幻灯片总览',
    board: '白板',
    endShow: '结束放映',
    endOfDeck: '已经是最后一页',
    startOfDeck: '已经是第一页',
    shortcuts: '快捷键',
    helpTitle: '放映快捷键',
    helpRows: [
      ['→ / ↓ / 空格 / PageDown', '下一页'],
      ['← / ↑ / PageUp', '上一页'],
      ['Home / End', '第一页 / 最后一页'],
      ['数字 + Enter', '跳到指定页'],
      ['B / .', '黑屏'],
      ['W', '白屏'],
      ['D', '白板（可在空白画布上批注）'],
      ['O', '幻灯片总览'],
      ['L', '放大镜'],
      ['E', '橡皮'],
      ['Esc', '结束放映 / 关闭白板'],
      ['?', '显示本帮助']
    ] as Array<[string, string]>
  },

  engine: {
    status: '引擎',
    bundled: '内置引擎',
    installed: '本机 LibreOffice',
    path: 'PATH 中的 LibreOffice',
    custom: '自定义路径',
    com: '本机 PowerPoint',
    none: '未找到引擎',
    errorTitle: '转换引擎不可用',
    errorBody: '内置的 LibreOffice 引擎缺失或被安全软件隔离。',
    expectedPath: '期望路径',
    openLog: '打开日志',
    chooseLoPath: '指定 LibreOffice 路径',
    recheck: '重新检测'
  },

  common: {
    ok: '确定',
    cancel: '取消',
    close: '关闭',
    settings: '设置',
    help: '帮助',
    retry: '重试',
    openLog: '打开日志',
    revealCache: '打开缓存目录'
  }
} as const
