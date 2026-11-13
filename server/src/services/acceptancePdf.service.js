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
const { buildAcceptanceReportNo } = require('../utils/acceptanceReportNo')
const { collectRoundSignatures } = require('../utils/acceptanceSignatures')
const projectModel = require('../models/project.model')
const projectStageModel = require('../models/projectStage.model')
const projectMemberModel = require('../models/projectMember.model')

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
    const [items, flow, project, stage, supervisorCount] = await Promise.all([
      acceptanceModel.listItems(acceptanceId),
      acceptanceModel.listFlow(acceptanceId),
      projectModel.findByIdUnscoped(acceptance.project_id),
      acceptance.project_stage_id ? projectStageModel.findById(acceptance.project_stage_id) : null,
      projectMemberModel.countByRole(acceptance.project_id, 'supervisor'),
    ])

    const photos = parseJson(acceptance.photos) || []
    const photosWithWatermark = photos.map((p) => p.watermarkUrl || p.url).filter(Boolean)

    // 旧报告在迁移里回填了旧编号，继续沿用；新报告用日期 + 项目 + 验收单的新格式。
    // 重试生成时编号保持不变（日期取通过时间）。
    const reportNo = acceptance.report_no || buildAcceptanceReportNo(acceptance)

    const buffer = await render({
      acceptance,
      items,
      flow,
      project,
      stage,
      photoUrls: photosWithWatermark,
      hasSupervisor: supervisorCount > 0,
      reportNo,
    })

    // 走**私有存储**：报告含现场照片、三方签名与金额，绝不能被 express.static
    // 直接公开访问。下载只通过 2 小时签名的 `/acceptances/:id/report.pdf`。
    // 历史数据里 report_pdf_private = 0 的旧报告仍按公开 URL 读取，见 controller。
    const saved = await storage.savePrivate(buffer, { category: 'acceptance-reports', ext: 'pdf' })
    await acceptanceModel.updatePdfState(acceptanceId, {
      status: 'success',
      url: null,
      key: saved.key,
      private: true,
      error: null,
      reportNo,
    })

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

  const [items, flow, project, stage, supervisorCount] = await Promise.all([
    acceptanceModel.listItems(acceptanceId),
    acceptanceModel.listFlow(acceptanceId),
    projectModel.findByIdUnscoped(acceptance.project_id),
    acceptance.project_stage_id ? projectStageModel.findById(acceptance.project_stage_id) : null,
    projectMemberModel.countByRole(acceptance.project_id, 'supervisor'),
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
      operator: row.real_name || row.nickname || `用户${row.operator_id}`,
      reason: row.reason,
      operatedAt: row.operated_at,
      // 服务商签署的 PDF 里也要保留工长 / 监理的手写签名。
      // 私有 key 优先：冻结文档可能在几天后重新渲染，不能把 2 小时就失效的
      // 签名 URL 写进快照。
      signatureUrl: row.signature_key ? null : row.signature_url || null,
      signatureKey: row.signature_key || null,
    })),
    photos: photoUrls,
  }

  const snapshotHash = sha256(stableStringify(snapshot))
  const signaturePage = await renderSigningDocument({
    ...snapshot,
    acceptance,
    project,
    stage,
    items,
    flow: snapshot.flow,
    photoUrls,
    hasSupervisor: supervisorCount > 0,
  })
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
function renderSigningDocument({
  documentId,
  generatedAt,
  round,
  acceptance,
  project,
  stage,
  items,
  flow,
  photoUrls,
  hasSupervisor,
}) {
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

      // 工长 / 监理在提交与审核时已经完成手写签名；把它们冻结进签署前的
      // 文档，最终服务商签署的 PDF 才会同时包含三方签署记录。
      const signatures = collectRoundSignatures(flow, {
        round,
        hasSupervisor,
        providerMode: true,
        providerSigned: false,
        status: 'pending_owner',
      })
      doc.moveDown(0.8)
      sectionTitle(doc, '工长 / 监理签署')
      renderSignatureBlock(doc, signatures.foreman)
      renderSignatureBlock(doc, signatures.supervisor)

      // 服务商在最后一页的固定坐标放置业主签名；显式换页，避免业主签署区
      // 被前面的内容挤到半页，导致签名坐标落错位置。
      doc.addPage()
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
  // 报告是「验收通过」的归档物：草稿/流转中/待整改的单子绝不能生成写着
  // 「验收结论：通过」的 PDF，否则任何项目成员都能伪造一份可转发的通过报告。
  if (acceptance.status !== 'passed') {
    throw new Error('验收单尚未通过，不能生成验收报告')
  }
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
function render({ acceptance, items, flow, project, stage, photoUrls, hasSupervisor, reportNo }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true })
    const chunks = []

    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    try {
      // 第三个参数是 TTC 集合内的 postscript 名，不是字体族名（见 config 的说明）
      doc.registerFont('cn', config.acceptancePdf.fontPath, config.acceptancePdf.fontName)
      doc.font('cn')

      const finalRound = Math.max(
        1,
        Number(acceptance.resubmit_count || 0) + 1,
        ...flow.map((entry) => Number(entry.round) || 0)
      )
      const signatures = collectRoundSignatures(flow, {
        round: finalRound,
        hasSupervisor,
        providerMode:
          acceptance.signature_mode === 'provider' || acceptance.esign_status === 'signed',
        providerSigned: acceptance.esign_status === 'signed',
        ownerFallback:
          acceptance.signature_url || acceptance.signature_key
            ? {
                signatureUrl: acceptance.signature_key ? null : acceptance.signature_url,
                signatureKey: acceptance.signature_key || null,
                signedAt: acceptance.finished_at,
              }
            : null,
        status: acceptance.status,
      })

      const addPage = () => {
        doc.addPage()
        drawRunningHeader(doc, reportNo)
      }

      // ── 封面 ──
      drawCover(doc, { acceptance, project, stage, signatures, reportNo, items, photoUrls })

      // ── 正文 ──
      doc.addPage()
      drawRunningHeader(doc, reportNo)

      ensureSpace(doc, 260, addPage)
      drawSectionTitle(doc, '01', '项目信息', addPage)
      drawInfoGrid(doc, [
        ['项目名称', project ? project.name : '—'],
        ['验收对象', stage ? `阶段 · ${stage.name}` : '工序验收'],
        ['项目地址', project ? project.address : '—'],
        ['验收结论', '通过'],
        ['首次提交', acceptance.submitted_at || '—'],
        ['通过时间', acceptance.finished_at || '—'],
        ['整改重提', `${Number(acceptance.resubmit_count || 0)} 次`],
        ['验收轮次', `第 ${finalRound} 轮`],
      ])
      if (acceptance.description) drawDescription(doc, acceptance.description, addPage)

      ensureSpace(doc, 130, addPage)
      drawSectionTitle(doc, '02', `验收项（共 ${items.length} 项）`, addPage)
      drawItemsTable(doc, items, addPage)

      ensureSpace(doc, 240, addPage)
      drawSectionTitle(doc, '03', `现场照片（共 ${photoUrls.length} 张）`, addPage)
      drawPhotoGrid(doc, photoUrls, addPage)

      ensureSpace(doc, 140, addPage)
      drawSectionTitle(doc, '04', '审核与流转', addPage)
      drawFlowTimeline(doc, flow, addPage)

      ensureSpace(doc, 210, addPage)
      drawSectionTitle(doc, '05', `签署区（第 ${finalRound} 轮）`, addPage)
      drawSignatureCards(doc, signatures, addPage)

      // 签署说明：让单独的签署页有完整语义，而不是三张卡片后大片留白
      ensureSpace(doc, 120, addPage)
      const explainY = doc.y
      doc.roundedRect(MARGIN, explainY, CONTENT_WIDTH, 96, 8).fill(COLORS.soft)
      doc.fillColor(COLORS.ink).fontSize(10).text('签署说明', MARGIN + 16, explainY + 14)
      doc
        .fillColor(COLORS.muted)
        .fontSize(8)
        .text(
          '工长对施工完成度与自检结果负责；监理对现场质量审核结论负责；主业主对验收确认及后续付款负责。' +
            '三方签名按轮次归档，整改重提不会覆盖上一轮签署记录。',
          MARGIN + 16,
          explainY + 34,
          { width: CONTENT_WIDTH - 32, lineGap: 4 }
        )
      doc.y = explainY + 106

      const disclaimer =
        '以上手写签名仅作为项目内部验收确认记录，不具备《电子签名法》意义上的可靠电子签名效力。'
      ensureSpace(doc, 48, addPage)
      const noteY = doc.y
      doc.roundedRect(MARGIN, noteY, CONTENT_WIDTH, 36, 6).fill(COLORS.brandSoft)
      doc.fillColor(COLORS.brandDark).fontSize(8).text(disclaimer, MARGIN + 12, noteY + 13, {
        width: CONTENT_WIDTH - 24,
        align: 'center',
      })
      doc.y = noteY + 46

      drawFooters(doc)
      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}

// ─────────────────────────────────────────────────────────────
// PDF 版式：封面 / 分节 / 表格 / 照片 / 时间线 / 签署卡片
// ─────────────────────────────────────────────────────────────

const COLORS = {
  brand: '#EB5C20',
  brandDark: '#B8430F',
  brandSoft: '#FFF3EC',
  ink: '#1F2937',
  muted: '#6B7280',
  line: '#E5E7EB',
  soft: '#F9FAFB',
  success: '#00B42A',
  successSoft: '#E8F8ED',
  danger: '#F53F3F',
  dangerSoft: '#FEECEC',
}

/** 正文页的顶部页眉；封面不调用 */
function drawRunningHeader(doc, reportNo) {
  const y = 28
  doc.fillColor(COLORS.muted).fontSize(8).text('柏总管 · 验收报告', MARGIN, y)
  doc
    .fillColor(COLORS.muted)
    .fontSize(8)
    .text(reportNo || '', MARGIN, y, { width: CONTENT_WIDTH, align: 'right' })
  doc.moveTo(MARGIN, 42).lineTo(MARGIN + CONTENT_WIDTH, 42).lineWidth(0.5).strokeColor(COLORS.line).stroke()
  doc.fillColor(COLORS.ink)
  doc.y = 62
}

/** 封面：品牌色块 + 白色信息卡 + 四个统计格 */
function drawCover(doc, { acceptance, project, stage, signatures, reportNo, items, photoUrls }) {
  const page = doc.page
  const required = [signatures.foreman, signatures.supervisor, signatures.owner].filter(
    (item) => item && item.required
  )
  const signed = required.filter((item) => item.signed).length

  doc.rect(0, 0, page.width, page.height).fill('#FFFFFF')
  doc.rect(0, 0, page.width, 250).fill(COLORS.brand)

  // 右上角的柔光圆
  doc.save()
  doc.fillOpacity(0.08)
  doc.circle(page.width - 70, 40, 130).fill('#FFFFFF')
  doc.circle(page.width - 10, 215, 70).fill('#FFFFFF')
  doc.restore()
  doc.fillOpacity(1)

  doc.fillColor('#FFFFFF').fontSize(17).text('柏总管', MARGIN, 42)
  doc.fillColor('#FFFFFF').fillOpacity(0.85).fontSize(9).text('装修工程管理 · 验收报告', MARGIN, 66)
  doc.fillOpacity(1)
  doc.fillColor('#FFFFFF').fontSize(30).text('验收报告', MARGIN, 118)
  doc.fillColor('#FFFFFF').fillOpacity(0.75).fontSize(9).text('ACCEPTANCE REPORT', MARGIN, 158)
  doc.fillOpacity(1)

  const cardX = 40
  const cardY = 205
  const cardW = page.width - 80
  const cardH = 300

  doc.roundedRect(cardX + 2, cardY + 4, cardW, cardH, 14).fill('#F3F4F6')
  doc.roundedRect(cardX, cardY, cardW, cardH, 14).fill('#FFFFFF')

  doc.fillColor(COLORS.muted).fontSize(8).text('验收项目', cardX + 24, cardY + 24)
  doc
    .fillColor(COLORS.ink)
    .fontSize(20)
    .text(project ? project.name : '—', cardX + 24, cardY + 40, { width: cardW - 190 })
  doc
    .fillColor(COLORS.muted)
    .fontSize(9)
    .text(
      `${stage ? stage.name : '工序验收'}　|　${acceptance.type === 'item' ? '工序验收' : '阶段验收'}`,
      cardX + 24,
      cardY + 70,
      { width: cardW - 190 }
    )
  drawPill(doc, cardX + cardW - 122, cardY + 26, 94, 26, '验收通过', COLORS.successSoft, COLORS.success)

  doc
    .moveTo(cardX + 24, cardY + 100)
    .lineTo(cardX + cardW - 24, cardY + 100)
    .lineWidth(1)
    .strokeColor(COLORS.line)
    .stroke()

  drawMeta(doc, cardX + 24, cardY + 116, '报告编号', reportNo)
  drawMeta(doc, cardX + 24, cardY + 150, '生成时间', datetime.format())
  drawMeta(doc, cardX + 260, cardY + 116, '首次提交', acceptance.submitted_at || '—')
  drawMeta(doc, cardX + 260, cardY + 150, '通过时间', acceptance.finished_at || '—')

  const statsY = cardY + 198
  const stats = [
    ['验收项', String(items.length), '项'],
    ['现场照片', String(photoUrls.length), '张'],
    ['签署完成', `${signed}/${required.length}`, '方'],
    ['整改重提', String(Number(acceptance.resubmit_count || 0)), '次'],
  ]
  const statW = (cardW - 48 - 30) / 4
  stats.forEach(([label, value, unit], index) => {
    const x = cardX + 24 + index * (statW + 10)
    doc.roundedRect(x, statsY, statW, 64, 8).fill(COLORS.brandSoft)
    doc.fillColor(COLORS.muted).fontSize(8).text(label, x + 10, statsY + 10)
    doc.fillColor(COLORS.ink).fontSize(18).text(value, x + 10, statsY + 24)
    const valueWidth = doc.widthOfString(value)
    doc
      .fillColor(COLORS.muted)
      .fontSize(8)
      .text(unit, x + 14 + valueWidth, statsY + 34)
  })

  doc
    .fillColor(COLORS.muted)
    .fontSize(9)
    .text(
      '本报告由柏总管系统自动生成；验收项、现场照片、流转意见与三方签名共同构成本次验收记录。',
      MARGIN,
      page.height - 92,
      { width: CONTENT_WIDTH, align: 'center' }
    )
}

function drawMeta(doc, x, y, label, value) {
  doc.fillColor(COLORS.muted).fontSize(8).text(label, x, y, { width: 150 })
  doc
    .fillColor(COLORS.ink)
    .fontSize(10)
    .text(String(value || '—'), x, y + 12, { width: 180, height: 16, ellipsis: true })
}

/** 分节标题：编号 + 标题 + 细分隔线 */
function drawSectionTitle(doc, index, title, addPage) {
  ensureSpace(doc, 54, addPage)
  const y = doc.y
  doc.fillColor(COLORS.brand).fontSize(9).text(index, MARGIN, y + 3)
  doc.fillColor(COLORS.ink).fontSize(14).text(title, MARGIN + 26, y)
  doc
    .moveTo(MARGIN, y + 24)
    .lineTo(MARGIN + CONTENT_WIDTH, y + 24)
    .lineWidth(0.8)
    .strokeColor(COLORS.line)
    .stroke()
  doc.fillColor(COLORS.ink)
  doc.y = y + 36
}

function ensureSpace(doc, height, addPage) {
  if (doc.y + height > doc.page.height - 58) addPage()
}

function drawPill(doc, x, y, width, height, text, background, foreground) {
  doc.roundedRect(x, y, width, height, height / 2).fill(background)
  doc
    .fillColor(foreground)
    .fontSize(8)
    .text(text, x, y + (height - 9) / 2, { width, align: 'center' })
}

function drawInfoGrid(doc, rows) {
  const gap = 10
  const cellW = (CONTENT_WIDTH - gap) / 2
  let y = doc.y
  for (let i = 0; i < rows.length; i += 2) {
    drawField(doc, MARGIN, y, cellW, rows[i][0], rows[i][1])
    if (rows[i + 1]) drawField(doc, MARGIN + cellW + gap, y, cellW, rows[i + 1][0], rows[i + 1][1])
    y += 52
  }
  doc.y = y
}

function drawField(doc, x, y, width, label, value) {
  doc.roundedRect(x, y, width, 44, 6).fill(COLORS.soft)
  doc.fillColor(COLORS.muted).fontSize(8).text(label, x + 12, y + 8, { width: width - 24 })
  doc
    .fillColor(COLORS.ink)
    .fontSize(10)
    .text(String(value === null || value === undefined ? '—' : value), x + 12, y + 21, {
      width: width - 24,
      height: 16,
      ellipsis: true,
    })
}

function drawDescription(doc, text, addPage) {
  const innerWidth = CONTENT_WIDTH - 24
  doc.fontSize(9)
  const textHeight = doc.heightOfString(String(text), { width: innerWidth })
  const boxHeight = Math.max(52, textHeight + 34)
  ensureSpace(doc, boxHeight + 12, addPage)
  const y = doc.y
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, boxHeight, 8).fill('#FFFFFF')
  doc
    .roundedRect(MARGIN, y, CONTENT_WIDTH, boxHeight, 8)
    .lineWidth(0.6)
    .strokeColor(COLORS.line)
    .stroke()
  doc.fillColor(COLORS.muted).fontSize(8).text('验收说明', MARGIN + 12, y + 12)
  doc.fillColor(COLORS.ink).fontSize(9).text(String(text), MARGIN + 12, y + 26, {
    width: innerWidth,
    height: boxHeight - 32,
    ellipsis: true,
  })
  doc.y = y + boxHeight + 12
}

function drawItemsTable(doc, items, addPage) {
  if (!items.length) {
    drawEmptyCard(doc, '本次验收未配置验收项清单。', addPage)
    return
  }

  const cols = { seq: 28, name: 250, result: 58 }
  const remarkWidth = CONTENT_WIDTH - cols.seq - cols.name - cols.result

  const drawHeader = (y) => {
    doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 24, 4).fill('#F3F4F6')
    doc.fillColor(COLORS.muted).fontSize(8)
    doc.text('序号', MARGIN + 10, y + 7, { width: cols.seq })
    doc.text('验收项', MARGIN + cols.seq + 10, y + 7, { width: cols.name - 10 })
    doc.text('结果', MARGIN + cols.seq + cols.name + 10, y + 7, { width: cols.result - 8 })
    doc.text('备注', MARGIN + cols.seq + cols.name + cols.result + 10, y + 7, {
      width: remarkWidth - 12,
    })
    doc.y = y + 24
  }

  drawHeader(doc.y)

  items.forEach((item, index) => {
    doc.fontSize(9)
    const nameHeight = doc.heightOfString(String(item.name || ''), { width: cols.name - 10 })
    doc.fontSize(8)
    const remarkHeight = doc.heightOfString(String(item.remark || ''), { width: remarkWidth - 12 })
    const rowHeight = Math.max(32, Math.max(nameHeight, remarkHeight) + 16)

    if (doc.y + rowHeight > doc.page.height - 58) {
      addPage()
      drawHeader(doc.y)
    }

    const rowY = doc.y
    if (index % 2 === 1) doc.rect(MARGIN, rowY, CONTENT_WIDTH, rowHeight).fill('#FAFAFA')

    doc
      .fillColor(COLORS.muted)
      .fontSize(9)
      .text(String(item.seq === null || item.seq === undefined ? index + 1 : item.seq), MARGIN + 10, rowY + 9, {
        width: cols.seq - 4,
      })
    doc.fillColor(COLORS.ink).fontSize(9).text(String(item.name || '—'), MARGIN + cols.seq + 10, rowY + 9, {
      width: cols.name - 10,
    })
    drawResultPill(doc, MARGIN + cols.seq + cols.name + 10, rowY + 7, item.result)
    doc
      .fillColor(COLORS.muted)
      .fontSize(8)
      .text(item.remark || '—', MARGIN + cols.seq + cols.name + cols.result + 10, rowY + 9, {
        width: remarkWidth - 12,
      })
    doc
      .moveTo(MARGIN, rowY + rowHeight)
      .lineTo(MARGIN + CONTENT_WIDTH, rowY + rowHeight)
      .lineWidth(0.5)
      .strokeColor(COLORS.line)
      .stroke()
    doc.y = rowY + rowHeight
  })

  doc.y += 10
}

function drawResultPill(doc, x, y, result) {
  if (result === 'pass') drawPill(doc, x, y, 42, 18, '通过', COLORS.successSoft, COLORS.success)
  else if (result === 'fail') drawPill(doc, x, y, 46, 18, '不通过', COLORS.dangerSoft, COLORS.danger)
  else drawPill(doc, x, y, 42, 18, '未填', COLORS.soft, COLORS.muted)
}

function drawEmptyCard(doc, text, addPage) {
  ensureSpace(doc, 56, addPage)
  const y = doc.y
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 44, 6).fill(COLORS.soft)
  doc.fillColor(COLORS.muted).fontSize(9).text(text, MARGIN + 14, y + 16, {
    width: CONTENT_WIDTH - 28,
    align: 'center',
  })
  doc.y = y + 54
}

function drawPhotoGrid(doc, urls, addPage) {
  if (!urls.length) {
    drawEmptyCard(doc, '本次验收未上传现场照片。', addPage)
    return
  }

  const gap = 12
  const cardWidth = (CONTENT_WIDTH - gap) / 2
  const imageHeight = 140
  const cardHeight = imageHeight + 28

  for (let i = 0; i < urls.length; i += 2) {
    ensureSpace(doc, cardHeight + 12, addPage)
    const y = doc.y
    for (let j = 0; j < 2 && i + j < urls.length; j += 1) {
      drawPhotoCard(doc, urls[i + j], MARGIN + j * (cardWidth + gap), y, cardWidth, imageHeight, i + j + 1)
    }
    doc.y = y + cardHeight + 12
  }
}

function drawPhotoCard(doc, url, x, y, width, height, index) {
  doc.roundedRect(x, y, width, height + 28, 8).fill('#F9FAFB')
  const buffer = storageBufferSync(url)
  if (buffer) {
    doc.save()
    doc.roundedRect(x + 6, y + 6, width - 12, height - 6, 6).clip()
    doc.image(buffer, x + 6, y + 6, {
      cover: [width - 12, height - 6],
      align: 'center',
      valign: 'center',
    })
    doc.restore()
  } else {
    doc
      .roundedRect(x + 6, y + 6, width - 12, height - 6, 6)
      .lineWidth(0.8)
      .strokeColor(COLORS.line)
      .stroke()
    doc
      .fillColor(COLORS.muted)
      .fontSize(8)
      .text('照片加载失败', x + 6, y + height / 2 - 4, { width: width - 12, align: 'center' })
  }
  doc.fillColor(COLORS.muted).fontSize(8).text(`现场照片 ${index}`, x + 10, y + height + 9)
}

function drawFlowTimeline(doc, flow, addPage) {
  if (!flow.length) {
    drawEmptyCard(doc, '暂无流转记录。', addPage)
    return
  }

  let lastRound = null
  flow.forEach((entry, index) => {
    ensureSpace(doc, entry.reason ? 66 : 44, addPage)

    if (entry.round !== lastRound) {
      lastRound = entry.round
      if (index > 0) doc.y += 4
      const pillY = doc.y
      drawPill(doc, MARGIN, pillY, 54, 18, `第 ${entry.round} 轮`, COLORS.brandSoft, COLORS.brandDark)
      doc.y = pillY + 26
    }

    const top = doc.y
    const dotColor =
      entry.action === 'reject'
        ? COLORS.danger
        : entry.action === 'approve'
          ? COLORS.success
          : COLORS.brand
    doc.circle(MARGIN + 5, top + 7, 3.5).fill(dotColor)
    if (index < flow.length - 1) {
      doc
        .moveTo(MARGIN + 5, top + 13)
        .lineTo(MARGIN + 5, top + (entry.reason ? 52 : 32))
        .lineWidth(1)
        .strokeColor(COLORS.line)
        .stroke()
    }

    const actionLabel =
      { submit: '提交', approve: '通过', reject: '驳回' }[entry.action] || entry.action
    const stepLabel =
      { self_check: '工长自检', supervisor: '监理审核', owner: '业主确认' }[entry.step] || entry.step

    doc.fillColor(COLORS.ink).fontSize(10).text(`${stepLabel} · ${actionLabel}`, MARGIN + 20, top)
    doc
      .fillColor(COLORS.muted)
      .fontSize(8)
      .text(
        `${entry.real_name || entry.nickname || `用户${entry.operator_id}`}　${entry.operated_at || ''}`,
        MARGIN + 20,
        top + 14
      )

    if (entry.reason) {
      const boxY = top + 28
      doc.roundedRect(MARGIN + 20, boxY, CONTENT_WIDTH - 20, 22, 4).fill('#F9FAFB')
      doc.fillColor(COLORS.muted).fontSize(8).text(`意见：${entry.reason}`, MARGIN + 26, boxY + 7, {
        width: CONTENT_WIDTH - 32,
        height: 10,
        ellipsis: true,
      })
      doc.y = boxY + 30
    } else {
      doc.y = top + 32
    }
  })
  doc.y += 8
}

function drawSignatureCards(doc, signatures, addPage) {
  const list = [signatures.foreman, signatures.supervisor, signatures.owner].filter(Boolean)
  const gap = 10
  const cardWidth = (CONTENT_WIDTH - gap * 2) / 3
  const cardHeight = 136

  ensureSpace(doc, cardHeight + 12, addPage)
  const top = doc.y

  list.forEach((signature, index) => {
    const x = MARGIN + index * (cardWidth + gap)
    doc.roundedRect(x, top, cardWidth, cardHeight, 8).fill('#FAFAFA')
    doc
      .roundedRect(x, top, cardWidth, cardHeight, 8)
      .lineWidth(0.6)
      .strokeColor(COLORS.line)
      .stroke()

    doc.fillColor(COLORS.ink).fontSize(9).text(`${signature.roleLabel}签名`, x + 12, top + 10)
    const stateColor = signature.signed
      ? COLORS.success
      : signature.state === 'skipped'
        ? COLORS.muted
        : COLORS.danger
    doc.fillColor(stateColor).fontSize(8).text(signature.stateLabel, x + 12, top + 25)

    const imageX = x + 12
    const imageY = top + 42
    const imageWidth = cardWidth - 24
    const imageHeight = 50

    const signatureImage = signatureBuffer(signature)
    if (signatureImage) {
      doc.image(signatureImage, imageX, imageY, {
        fit: [imageWidth, imageHeight],
        align: 'center',
        valign: 'center',
      })
    } else if (signature.signatureUrl || signature.signatureKey) {
      // 有签名记录但图片读不出来：显式提示，避免看起来像「没签」
      doc
        .fillColor(COLORS.muted)
        .fontSize(8)
        .text('签名图片加载失败', imageX, imageY + 18, { width: imageWidth, align: 'center' })
    } else if (signature.state === 'provider') {
      doc
        .fillColor(COLORS.muted)
        .fontSize(8)
        .text('服务商电子签', imageX, imageY + 18, { width: imageWidth, align: 'center' })
    } else {
      doc.dash(2, { space: 2 })
      doc
        .roundedRect(imageX, imageY, imageWidth, imageHeight, 4)
        .lineWidth(0.6)
        .strokeColor(COLORS.line)
        .stroke()
      doc.undash()
      doc
        .fillColor(COLORS.muted)
        .fontSize(8)
        .text(signature.state === 'skipped' ? '未配置监理' : '未采集', imageX, imageY + 18, {
          width: imageWidth,
          align: 'center',
        })
    }

    doc
      .fillColor(COLORS.muted)
      .fontSize(7)
      .text(
        [signature.operator, signature.signedAt].filter(Boolean).join('　') || '—',
        x + 12,
        top + 102,
        { width: cardWidth - 24, height: 24, ellipsis: true }
      )
  })

  doc.y = top + cardHeight + 12
}

function drawFooters(doc) {
  const range = doc.bufferedPageRange()
  // 封面不画页脚；正文页码从 1 开始
  for (let i = range.start + 1; i < range.start + range.count; i += 1) {
    doc.switchToPage(i)
    const page = doc.page
    // 页脚画在底部页边距内。PDFKit 的 text 在 y 超过「页高 - 下边距」时会
    // 自动加一页，导致每页页脚变成一张空白页；临时把下边距设为 0 避开这个行为。
    const bottomMargin = page.margins.bottom
    page.margins.bottom = 0

    const y = page.height - 40
    doc
      .moveTo(MARGIN, y)
      .lineTo(MARGIN + CONTENT_WIDTH, y)
      .lineWidth(0.5)
      .strokeColor(COLORS.line)
      .stroke()
    doc.fillColor(COLORS.muted).fontSize(7).text('柏总管 · 工程宝', MARGIN, y + 8)
    doc
      .fillColor(COLORS.muted)
      .fontSize(7)
      .text(`第 ${i - range.start} / ${range.count - 1} 页`, MARGIN, y + 8, {
        width: CONTENT_WIDTH,
        align: 'right',
      })

    page.margins.bottom = bottomMargin
  }
}

/**
 * 渲染一方的签署区块。
 *
 * 图片可能把内容顶到页底，pdfkit 的 text 不会自动换页，
 * 因此先判断剩余空间再决定是否换页；签名图本身由 renderImages 处理分页。
 */
function renderSignatureBlock(doc, signature) {
  if (!signature) return

  if (doc.y > doc.page.height - 170) doc.addPage()

  doc.moveDown(0.4)
  doc
    .fontSize(11)
    .fillColor('#1a1a1a')
    .text(`${signature.roleLabel}签名：${signature.stateLabel}`, { width: CONTENT_WIDTH })

  if (signature.operator || signature.signedAt) {
    doc
      .fontSize(9)
      .fillColor('#666666')
      .text([signature.operator, signature.signedAt].filter(Boolean).join('　'), {
        width: CONTENT_WIDTH,
      })
    doc.fillColor('#000000')
  }

  const signatureImage = signatureBuffer(signature)
  if (signatureImage) {
    if (doc.y > doc.page.height - 120) doc.addPage()
    doc.image(signatureImage, { fit: [CONTENT_WIDTH, 80] })
    doc.moveDown(0.5)
  } else if (signature.signatureUrl || signature.signatureKey) {
    doc
      .fontSize(9)
      .fillColor('#666666')
      .text('签名图片加载失败')
    doc.fillColor('#000000')
  } else if (signature.state === 'provider') {
    doc
      .fontSize(9)
      .fillColor('#666666')
      .text('业主已通过电子签服务商完成签署，签名与证据见已签确认书。', {
        width: CONTENT_WIDTH,
      })
    doc.fillColor('#000000')
  }
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
 * 取签名图片的字节。
 *
 * 新数据在私有存储里（signatureKey），历史数据是公开上传目录里的 URL。
 * 两种都要支持 —— 迁移 036 之前的单据只有 URL。
 */
function signatureBuffer(signature) {
  if (!signature) return null
  if (signature.signatureKey) {
    try {
      return storage.readPrivateSync(signature.signatureKey)
    } catch (err) {
      logger.warn('读取私有签名图片失败', { key: signature.signatureKey, message: err.message })
      return null
    }
  }
  if (signature.signatureUrl) return storageBufferSync(signature.signatureUrl)
  return null
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
