'use strict'

/**
 * 验收报告 PDF（C-3.10 / AC-A18 / AC-A19 / AC-A20）。
 *
 * AC-A18 要求内容含「验收项、现场照片、各级审核意见与签名」—— 四样都要有，
 * 少一样这份报告在纠纷时就撑不起来：验收项证明「查了什么」，
 * 照片证明「当时什么样」，审核意见证明「谁在什么条件下放行的」，
 * 签名证明「业主确实确认过」。
 *
 * ── AC-A19：生成失败不阻断验收 ──
 * PDF 是**归档产物**，不是验收成立的条件。因此生成的调用方（acceptance.service）
 * 把它放在事务外并捕获异常：失败只把 `report_pdf_status` 置为 failed 并记下原因，
 * 前端据 `report_pdf_status` 展示重试入口。反过来做（生成失败就回滚验收）
 * 会让一个排版问题变成「业主确认了但系统说没通过」。
 */

const fs = require('node:fs')
const crypto = require('node:crypto')
const PDFDocument = require('pdfkit')

const config = require('../../config')
const datetime = require('../utils/datetime')
const logger = require('../utils/logger')
const storage = require('../storage')
const acceptanceModel = require('../models/acceptance.model')
const projectModel = require('../models/project.model')
const projectStageModel = require('../models/projectStage.model')

/** A4 页边距与可用宽度 */
const MARGIN = 50
const CONTENT_WIDTH = 595.28 - MARGIN * 2

/**
 * 检查 PDF 字体是否可用。与 watermark 同样的理由：
 * 字体缺失时渲染出来会是一堆方块或空白，而报告看起来「生成成功」。
 *
 * @throws {Error} 字体文件不存在
 */
function checkFontAvailable(fontPath = config.acceptancePdf.fontPath) {
  if (fontPath && !fs.existsSync(fontPath)) {
    throw new Error(
      `PDF 字体文件不存在：${fontPath}。` +
        '缺少中文字体时 pdfkit 会渲染出方块或空白，报告看似生成成功实则不可用。' +
        '请安装中文字体或设置 PDF_FONT_PATH / PDF_FONT_NAME。'
    )
  }
  return true
}

/**
 * 生成并归档验收报告。
 *
 * @param {number} acceptanceId
 * @returns {Promise<{url: string, sizeBytes: number}>}
 */
async function generate(acceptanceId) {
  checkFontAvailable()

  const acceptance = await acceptanceModel.findById(acceptanceId)
  if (!acceptance) throw new Error(`验收单 ${acceptanceId} 不存在`)

  // AC-A19：开始生成时先标记 pending，避免前端在生成期间看到一个过期的 failed
  await acceptanceModel.updatePdfState(acceptanceId, { status: 'pending', url: null, error: null })

  try {
    const [items, flow, project, stage] = await Promise.all([
      acceptanceModel.listItems(acceptanceId),
      acceptanceModel.listFlow(acceptanceId),
      projectModel.findByIdUnscoped(acceptance.project_id),
      acceptance.project_stage_id ? projectStageModel.findById(acceptance.project_stage_id) : null,
    ])

    const photos = parseJson(acceptance.photos) || []
    const photosWithWatermark = photos.map((p) => p.watermarkUrl || p.url).filter(Boolean)

    const buffer = await render({
      acceptance,
      items,
      flow,
      project,
      stage,
      photoUrls: photosWithWatermark,
      signatureUrl: acceptance.signature_url,
    })

    // saveGenerated 而非 save：这份 PDF 是服务端渲染出来的，不是用户上传的，
    // 不该受「上传类型白名单」约束（见 storage/index.js 的说明）
    const saved = await storage.saveGenerated(buffer, { category: 'acceptance-reports', ext: 'pdf' })
    await acceptanceModel.updatePdfState(acceptanceId, { status: 'success', url: saved.url, error: null })

    logger.info('验收报告已生成', { acceptanceId, sizeBytes: saved.sizeBytes })
    return saved
  } catch (err) {
    // 把失败原因截断后入库：完整堆栈进日志，库里只留一句能给人看的
    const reason = String(err.message || '未知错误').slice(0, 500)
    await acceptanceModel.updatePdfState(acceptanceId, { status: 'failed', url: null, error: reason })
    throw err
  }
}

/**
 * 生成签署前的“验收确认书”PDF。
 *
 * 与 legacy 报告的区别：
 *   - 这是**冻结文档**，生成后内容不可再变，服务商对这份字节签名；
 *   - 严格检查照片与字体，缺一张照片就失败，不能在法律文件里留下“照片加载失败”；
 *   - 返回内容快照与哈希，供回调时比对服务商证据里的 originalHash。
 */
async function buildForSign(acceptanceId) {
  checkFontAvailable()

  const acceptance = await acceptanceModel.findById(acceptanceId)
  if (!acceptance) throw new Error(`验收单 ${acceptanceId} 不存在`)

  const [items, flow, project, stage] = await Promise.all([
    acceptanceModel.listItems(acceptanceId),
    acceptanceModel.listFlow(acceptanceId),
    projectModel.findByIdUnscoped(acceptance.project_id),
    acceptance.project_stage_id ? projectStageModel.findById(acceptance.project_stage_id) : null,
  ])

  const photos = parseJson(acceptance.photos) || []
  const photoUrls = photos.map((p) => p.watermarkUrl || p.url).filter(Boolean)
  assertImagesReadable(photoUrls)

  const round = Number(acceptance.resubmit_count || 0) + 1
  const documentId = `AC-${acceptance.id}-R${round}`
  const generatedAt = datetime.format()

  const snapshot = {
    version: 1,
    documentId,
    acceptanceId: acceptance.id,
    projectId: acceptance.project_id,
    round,
    generatedAt,
    project: project ? { id: project.id, name: project.name, address: project.address } : null,
    stage: stage ? { id: stage.id, name: stage.name, progress: stage.progress } : null,
    acceptance: {
      type: acceptance.type,
      description: acceptance.description,
      submittedAt: acceptance.submitted_at,
      resubmitCount: acceptance.resubmit_count,
    },
    items: items.map((row) => ({ id: row.id, seq: row.seq, name: row.name, result: row.result, remark: row.remark })),
    flow: flow.map((row) => ({
      id: row.id,
      round: row.round,
      step: row.step,
      action: row.action,
      operator: row.nickname || `用户${row.operator_id}`,
      reason: row.reason,
      operatedAt: row.operated_at,
    })),
    photos: photoUrls,
  }

  const snapshotHash = sha256(stableStringify(snapshot))
  const signaturePage = await renderSigningDocument({ ...snapshot, acceptance, project, stage, items, flow: snapshot.flow, photoUrls })
  const buffer = signaturePage.buffer

  if (buffer.length > config.esign.maxDocumentMb * 1024 * 1024) {
    throw new Error(`签署文件 ${(buffer.length / 1024 / 1024).toFixed(1)}MB，超过服务商上限 ${config.esign.maxDocumentMb}MB`)
  }

  const saved = await storage.savePrivate(buffer, { category: 'esign-documents', ext: 'pdf' })
  return {
    buffer,
    key: saved.key,
    sizeBytes: saved.sizeBytes,
    hash: sha256(buffer),
    snapshot,
    snapshotHash,
    signaturePage: signaturePage.pageCount,
  }
}

/**
 * 归档服务商回传的已签 PDF 与证据报告。
 *
 * 只写私有存储；acceptance.report_pdf_key 指向已签 PDF，report_pdf_source='signed'。
 */
async function archiveSigned(acceptanceId, task, { signedPdf, evidencePdf, evidenceJson }) {
  if (!Buffer.isBuffer(signedPdf) || signedPdf.length === 0) {
    throw new Error('服务商未返回已签 PDF')
  }

  const signed = await storage.savePrivate(signedPdf, { category: 'esign-signed', ext: 'pdf' })
  let evidence = null
  let evidenceBytes = null
  if (Buffer.isBuffer(evidencePdf) && evidencePdf.length > 0) {
    evidenceBytes = evidencePdf
    evidence = await storage.savePrivate(evidenceBytes, { category: 'esign-evidence', ext: 'pdf' })
  } else if (evidenceJson !== undefined && evidenceJson !== null) {
    evidenceBytes = Buffer.isBuffer(evidenceJson) ? evidenceJson : Buffer.from(JSON.stringify(evidenceJson))
    evidence = await storage.savePrivate(evidenceBytes, { category: 'esign-evidence', ext: 'json' })
  }

  const signedHash = sha256(signedPdf)

  return {
    signedKey: signed.key,
    signedHash,
    evidenceKey: evidence ? evidence.key : null,
    evidenceHash: evidenceBytes ? sha256(evidenceBytes) : null,
  }
}

function assertImagesReadable(urls) {
  for (const url of urls) {
    if (!storageBufferSync(url)) {
      throw new Error(`签署文件中的图片读取失败：${url}`)
    }
  }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`
}

/**
 * 渲染签署确认书。
 *
 * 复用 legacy 的版式工具，但标题、声明与签署区不同；不嵌入业主签名图，
 * 签名由服务商在 PDF 上完成。
 */
function renderSigningDocument({ documentId, generatedAt, acceptance, project, stage, items, flow, photoUrls }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true })
    const chunks = []

    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pageCount: pageCount || 1 }))
    doc.on('error', reject)
    let pageCount = 1

    try {
      doc.registerFont('cn', config.acceptancePdf.fontPath, config.acceptancePdf.fontName)
      doc.font('cn')

      doc.fontSize(20).text('验收确认书', { align: 'center' })
      doc.moveDown(0.3)
      doc
        .fontSize(9)
        .fillColor('#888888')
        .text(`文件编号：${documentId}　生成时间：${generatedAt}`, { align: 'center' })
      doc.fillColor('#000000').moveDown(1.2)

      sectionTitle(doc, '项目信息')
      kv(doc, '项目名称', project ? project.name : '—')
      kv(doc, '项目地址', project ? project.address : '—')
      kv(doc, '验收对象', stage ? `阶段：${stage.name}` : '—')
      if (acceptance.description) kv(doc, '验收说明', acceptance.description)

      doc.moveDown(0.8)
      sectionTitle(doc, `验收项（共 ${items.length} 项）`)
      if (items.length === 0) {
        doc.fontSize(10).text('本次验收未配置验收项清单。')
      } else {
        for (const item of items) {
          const mark = item.result === 'pass' ? '☑' : item.result === 'fail' ? '☒' : '☐'
          doc.fontSize(10).text(`${mark}  ${item.seq}. ${item.name}`, { width: CONTENT_WIDTH })
          if (item.remark) {
            doc.fontSize(9).fillColor('#666666').text(`　　备注：${item.remark}`, { width: CONTENT_WIDTH })
            doc.fillColor('#000000')
          }
        }
      }

      doc.moveDown(0.8)
      sectionTitle(doc, `现场照片（共 ${photoUrls.length} 张）`)
      if (photoUrls.length === 0) {
        doc.fontSize(10).text('本次验收未上传现场照片。')
      } else {
        renderImages(doc, photoUrls, '照片加载失败')
      }

      doc.moveDown(0.8)
      sectionTitle(doc, '审核与流转记录')
      if (flow.length === 0) {
        doc.fontSize(10).text('暂无流转记录。')
      } else {
        for (const entry of flow) {
          const actionLabel = { submit: '提交', approve: '通过', reject: '驳回' }[entry.action] || entry.action
          const stepLabel = { self_check: '自检', supervisor: '监理审核', owner: '业主确认' }[entry.step] || entry.step
          doc
            .fontSize(10)
            .text(`${entry.operated_at}　${stepLabel}　${entry.operator || '用户'}　${actionLabel}`, {
              width: CONTENT_WIDTH,
            })
          if (entry.reason) {
            doc.fontSize(9).fillColor('#666666').text(`　　意见：${entry.reason}`, { width: CONTENT_WIDTH })
            doc.fillColor('#000000')
          }
        }
      }

      doc.moveDown(1)
      sectionTitle(doc, '验收确认与电子签名')
      doc
        .fontSize(10)
        .text(
          '本人已阅读并确认以上验收内容，同意以电子签名方式签署本验收确认书。' +
            '本文件由电子签服务商对上述内容进行数字签名并加盖可信时间戳。',
          { width: CONTENT_WIDTH }
        )
      doc.moveDown(0.5)
      doc.fontSize(11).text('【业主签署】', { width: CONTENT_WIDTH })

      const range = doc.bufferedPageRange()
      pageCount = range.count
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i)
        doc
          .fontSize(8)
          .fillColor('#999999')
          .text(
            `第 ${i - range.start + 1} / ${range.count} 页　本文件由工程宝生成并交由电子签服务商签署`,
            MARGIN,
            doc.page.height - MARGIN / 2,
            { align: 'center', width: CONTENT_WIDTH }
          )
      }

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}


async function retry(acceptanceId) {
  const acceptance = await acceptanceModel.findById(acceptanceId)
  if (!acceptance) throw new Error(`验收单 ${acceptanceId} 不存在`)
  if (acceptance.report_pdf_status === 'success') {
    throw new Error('验收报告已生成，无需重试')
  }
  return generate(acceptanceId)
}

/**
 * 渲染 PDF。
 *
 * 用 Promise 包住 pdfkit 的流式 API —— 它本身是事件式的，
 * 而调用方（HTTP 请求）需要的是一个结果。
 */
function render({ acceptance, items, flow, project, stage, photoUrls, signatureUrl }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true })
    const chunks = []

    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    try {
      // ── 标题 ──
      // 第三个参数是 TTC 集合内的 postscript 名，不是字体族名（见 config 的说明）
      doc.registerFont('cn', config.acceptancePdf.fontPath, config.acceptancePdf.fontName)
      doc.font('cn')

      doc.fontSize(20).text('验收报告', { align: 'center' })
      doc.moveDown(0.3)
      doc
        .fontSize(9)
        .fillColor('#888888')
        .text(`报告编号：AC-${String(acceptance.id).padStart(6, '0')}　生成时间：${datetime.format()}`, {
          align: 'center',
        })
      doc.fillColor('#000000').moveDown(1.2)

      // ── 项目信息 ──
      sectionTitle(doc, '项目信息')
      kv(doc, '项目名称', project ? project.name : '—')
      kv(doc, '项目地址', project ? project.address : '—')
      kv(doc, '验收对象', stage ? `阶段：${stage.name}` : '—')
      kv(doc, '验收结论', '通过')
      if (acceptance.submitted_at) kv(doc, '首次提交', acceptance.submitted_at)
      if (acceptance.finished_at) kv(doc, '通过时间', acceptance.finished_at)
      if (acceptance.resubmit_count > 0) kv(doc, '整改重提次数', String(acceptance.resubmit_count))
      if (acceptance.description) kv(doc, '验收说明', acceptance.description)

      // ── 验收项 ──
      doc.moveDown(0.8)
      sectionTitle(doc, `验收项（共 ${items.length} 项）`)
      if (items.length === 0) {
        doc.fontSize(10).text('本次验收未配置验收项清单。')
      } else {
        for (const item of items) {
          const mark = item.result === 'pass' ? '☑' : item.result === 'fail' ? '☒' : '☐'
          doc.fontSize(10).text(`${mark}  ${item.seq}. ${item.name}`, { width: CONTENT_WIDTH })
          if (item.remark) {
            doc.fontSize(9).fillColor('#666666').text(`　　备注：${item.remark}`, { width: CONTENT_WIDTH })
            doc.fillColor('#000000')
          }
        }
      }

      // ── 现场照片 ──
      doc.moveDown(0.8)
      sectionTitle(doc, `现场照片（共 ${photoUrls.length} 张）`)
      if (photoUrls.length === 0) {
        doc.fontSize(10).text('本次验收未上传现场照片。')
      } else {
        renderImages(doc, photoUrls, '照片加载失败，该图片已损坏或不存在')
      }

      // ── 各级审核意见 ──
      doc.moveDown(0.8)
      sectionTitle(doc, '审核与流转记录')
      if (flow.length === 0) {
        doc.fontSize(10).text('暂无流转记录。')
      } else {
        let lastRound = null
        for (const entry of flow) {
          if (entry.round !== lastRound) {
            lastRound = entry.round
            doc.moveDown(0.3)
            doc.fontSize(11).fillColor('#333333').text(`第 ${entry.round} 轮`)
            doc.fillColor('#000000')
          }
          const actionLabel = { submit: '提交', approve: '通过', reject: '驳回' }[entry.action] || entry.action
          const stepLabel = { self_check: '自检', supervisor: '监理审核', owner: '业主确认' }[entry.step] || entry.step
          doc
            .fontSize(10)
            .text(`${entry.operated_at}　${stepLabel}　${entry.operator || '用户' + entry.operator_id}　${actionLabel}`, {
              width: CONTENT_WIDTH,
            })
          if (entry.reason) {
            doc.fontSize(9).fillColor('#666666').text(`　　意见：${entry.reason}`, { width: CONTENT_WIDTH })
            doc.fillColor('#000000')
          }
        }
      }

      // ── 业主签名 ──
      doc.moveDown(0.8)
      sectionTitle(doc, '业主电子签名')
      if (signatureUrl) {
        renderImages(doc, [signatureUrl], '签名图片加载失败', { maxHeight: 140 })
      } else {
        doc.fontSize(10).text('本次验收未采集电子签名。')
      }

      // ── 页脚页码 ──
      // bufferPages 让 pdfkit 把页对象留到最后再输出，这样才知道总页数
      const range = doc.bufferedPageRange()
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i)
        doc
          .fontSize(8)
          .fillColor('#999999')
          .text(
            `第 ${i - range.start + 1} / ${range.count} 页　本报告由工程宝自动生成`,
            MARGIN,
            doc.page.height - MARGIN / 2,
            { align: 'center', width: CONTENT_WIDTH }
          )
      }

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}

function sectionTitle(doc, text) {
  doc.fontSize(13).fillColor('#1a1a1a').text(text, { width: CONTENT_WIDTH })
  // 标题下的分隔线，让版式有层次
  const y = doc.y + 2
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).lineWidth(0.5).strokeColor('#cccccc').stroke()
  doc.fillColor('#000000').moveDown(0.5)
}

function kv(doc, label, value) {
  doc.fontSize(10).text(`${label}：${value}`, { width: CONTENT_WIDTH })
}

/**
 * 排版一组图片。
 *
 * pdfkit 的文本会自动换行与分页，**图片不会** —— 超出页面高度时会画到纸外面，
 * 内容静默丢失。因此这里自己跟踪 y 坐标，装不下就手动加页。
 */
function renderImages(doc, urls, failHint, { maxHeight = 200, gap = 10 } = {}) {
  const maxWidth = CONTENT_WIDTH / 2 - gap / 2

  for (let i = 0; i < urls.length; i += 2) {
    const row = [urls[i], urls[i + 1]].filter(Boolean)
    const rowHeight = maxHeight

    if (doc.y + rowHeight > doc.page.height - MARGIN - 20) {
      doc.addPage()
    }

    const top = doc.y
    for (const [index, url] of row.entries()) {
      try {
        const buffer = storageBufferSync(url)
        if (!buffer) throw new Error('文件不存在')
        doc.image(buffer, MARGIN + index * (maxWidth + gap), top, {
          fit: [maxWidth, maxHeight],
          align: 'center',
        })
      } catch (err) {
        // 单张图读不到不该让整份报告生成失败 —— 报告的价值在于其余内容
        doc.fontSize(9).fillColor('#cc0000').text(failHint, MARGIN + index * (maxWidth + gap), top, {
          width: maxWidth,
        })
        doc.fillColor('#000000')
        logger.warn('验收报告中的图片读取失败', { url, message: err.message })
      }
    }

    doc.y = top + rowHeight + gap
  }
}

/**
 * 同步读取图片与 URL。
 *
 * 名字里的 Sync 是刻意的：pdfkit 的 doc.image 需要 Buffer 而不是 Promise，
 * 而整份报告是在一个同步的渲染流程里拼出来的。图片总量有限（验收照片 + 签名），
 * 同步读文件的开销可以接受。
 */
function storageBufferSync(url) {
  const key = storage.extractKey(url)
  const path = require('node:path').join(config.upload.dir, key)
  if (!fs.existsSync(path)) return null
  return fs.readFileSync(path)
}

function parseJson(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

module.exports = {
  generate,
  retry,
  render,
  checkFontAvailable,
  buildForSign,
  archiveSigned,
  stableStringify,
  sha256,
}
