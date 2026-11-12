'use strict'

/**
 * 对账结算单 PDF（C-4.8 / AC-L24）。
 *
 * AC-L24：「对账确认后生成的结算单 PDF 内容与页面数据一致，双方均可下载」。
 *
 * ── 「与页面数据一致」怎么保证 ──
 * 一是**同一份数据源**：PDF 里的明细直接来自 `reconciliation_detail` 与 `ledger`，
 * 与对账详情接口读的是同样的表，不另算一遍。
 * 二是**金额口径一致**：全部走 `utils/money.js`，与页面同一个函数。
 *
 * ── 与验收报告 PDF 的关系 ──
 * 两者共用同一套基础设施（pdfkit + 中文字体 + `storage.saveGenerated` + 签名 URL），
 * 但**各写一份渲染函数**而不是抽一个通用模板引擎：两者的版式差异很大
 * （验收报告要贴照片与签名，结算单是纯表格与合计），
 * 硬抽公共层只会得到一个满是 if 的模板。
 *
 * 字体那条坑（pdfkit 对 `.ttc` 要 postscript 名）见 CLAUDE.md 第 43 条，
 * 这里复用的是同一份配置。
 */

const fs = require('node:fs')
const PDFDocument = require('pdfkit')

const config = require('../../config')
const datetime = require('../utils/datetime')
const money = require('../utils/money')
const logger = require('../utils/logger')
const storage = require('../storage')
const reconciliationModel = require('../models/reconciliation.model')
const projectModel = require('../models/project.model')
const projectStageModel = require('../models/projectStage.model')
const paymentNodeModel = require('../models/paymentNode.model')

const MARGIN = 50
const CONTENT_WIDTH = 595.28 - MARGIN * 2

const CATEGORY_LABELS = { material: '材料费', labor: '人工费', transport: '运输费', other: '其他' }

/**
 * 检查中文字体是否可用。
 *
 * 与验收报告同一条原则：字体缺失时 pdfkit 渲染出的是方块或空白，
 * 文件「生成成功」但内容不可读 —— 归档凭证如果读不了，等于没有归档。
 */
function checkFontAvailable(fontPath = config.acceptancePdf.fontPath) {
  if (fontPath && !fs.existsSync(fontPath)) {
    throw new Error(
      `PDF 字体文件不存在：${fontPath}。` +
        '缺少中文字体时 pdfkit 会渲染出方块或空白，结算单看似生成成功实则不可读。' +
        '请安装中文字体或设置 PDF_FONT_PATH / PDF_FONT_NAME。'
    )
  }
  return true
}

/**
 * 生成结算单并归档。
 *
 * @param {number} reconciliationId
 * @returns {Promise<{url: string, sizeBytes: number}>}
 */
async function generate(reconciliationId) {
  checkFontAvailable()

  const reconciliation = await reconciliationModel.findById(reconciliationId)
  if (!reconciliation) throw new Error(`对账单 ${reconciliationId} 不存在`)

  const [details, project] = await Promise.all([
    reconciliationModel.listDetails(reconciliationId),
    projectModel.findByIdUnscoped(reconciliation.project_id),
  ])

  // 阶段结算单多两组内容：阶段名与「应收（付款节点）」
  const isStage = reconciliation.scope_type === 'stage'
  const [stage, paymentNodes] = isStage
    ? await Promise.all([
        projectStageModel.findById(reconciliation.project_stage_id),
        paymentNodeModel.listByStage(reconciliation.project_id, reconciliation.project_stage_id),
      ])
    : [null, []]

  const buffer = await render({ reconciliation, details, project, stage, paymentNodes })

  // 私有存储：结算单含金额明细，只允许经 2 小时签名 URL 下载（AC-L24）。
  // 历史数据里的公开 URL 保持不变，下载入口会按 settlement_pdf_private 分支读取。
  const saved = await storage.savePrivate(buffer, { category: 'settlements', ext: 'pdf' })

  await reconciliationModel.updatePdf(reconciliationId, {
    url: null,
    key: saved.key,
    private: true,
    generatedAt: datetime.format(),
  })

  logger.info('结算单已生成', { reconciliationId, sizeBytes: saved.sizeBytes })
  return saved
}

function render({ reconciliation, details, project, stage, paymentNodes }) {
  const isStage = reconciliation.scope_type === 'stage'
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true })
    const chunks = []

    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    try {
      doc.registerFont('cn', config.acceptancePdf.fontPath, config.acceptancePdf.fontName)
      doc.font('cn')

      doc.fontSize(20).text(isStage ? '阶段结算单' : '对账结算单', { align: 'center' })
      doc.moveDown(0.3)
      doc
        .fontSize(9)
        .fillColor('#888888')
        .text(
          `单据编号：${isStage ? 'SS' : 'ST'}-${String(reconciliation.id).padStart(6, '0')}　生成时间：${datetime.format()}`,
          {
          align: 'center',
        })
      doc.fillColor('#000000').moveDown(1.2)

      // ── 项目与周期 ──
      sectionTitle(doc, '基本信息')
      kv(doc, '项目名称', project ? project.name : '—')
      kv(doc, '项目地址', project ? project.address : '—')
      if (isStage) {
        kv(doc, '结算阶段', stage ? stage.name : '—')
        kv(doc, '阶段应收', `${reconciliation.total_amount} 元`)
      } else {
        kv(doc, '对账周期', `${reconciliation.period_start} 至 ${reconciliation.period_end}`)
      }
      kv(doc, '合同总额', `${project ? project.contract_amount : '—'} 元`)
      kv(doc, '状态', '已确认')

      if (isStage) {
        // AC-S02：应收金额必须能逐项对应到付款节点，不能只给一个合计数
        doc.moveDown(0.8)
        sectionTitle(doc, `本阶段应收（付款节点，共 ${paymentNodes.length} 个）`)
        if (paymentNodes.length === 0) {
          doc.fontSize(10).text('本阶段没有关联的付款节点。')
        } else {
          renderReceivableTable(doc, paymentNodes)
        }
      }

      // ── 明细 ──
      doc.moveDown(0.8)
      sectionTitle(doc, `${isStage ? '阶段' : '本期'}收支明细（共 ${details.length} 条）`)

      if (details.length === 0) {
        doc.fontSize(10).text('本周期无收支记录。')
      } else {
        renderTable(doc, details)
      }

      // ── 合计 ──
      doc.moveDown(0.8)
      sectionTitle(doc, '合计')
      const totals = computeTotals(details)

      if (isStage) {
        kv(doc, '本阶段应收', `${reconciliation.total_amount} 元`)
        kv(doc, '已收合计', `${totals.income} 元`)
        kv(doc, '支出合计', `${totals.expense} 元`)
        kv(doc, '阶段结余（已收 − 支出）', `${money.subtract(totals.income, totals.expense)} 元`)
      } else {
        kv(doc, '收入合计', `${totals.income} 元`)
        kv(doc, '支出合计', `${totals.expense} 元`)
        // 结余 = 收入 − 支出，与页面用同一个 money.subtract
        kv(doc, '本期结余', `${money.subtract(totals.income, totals.expense)} 元`)
      }

      // 与对账单表头存的金额比对一次：不一致说明有数据在确认后被改动过，
      // 那本身就是需要被发现的异常（AC-L20 的锁定就是为了防止这件事）
      const mismatch = money.compare(totals.income, reconciliation.income_amount) !== 0
      if (mismatch) {
        doc.moveDown(0.3)
        doc
          .fontSize(9)
          .fillColor('#cc0000')
          .text(
            `注意：明细重算的金额（${totals.income}）与确认时记录的金额（${reconciliation.income_amount}）不一致，请联系管理员核查。`
          )
        doc.fillColor('#000000')
      }

      // ── 签署信息 ──
      doc.moveDown(0.8)
      sectionTitle(doc, '确认信息')
      kv(doc, '提交人', reconciliation.submitted_by ? `用户 #${reconciliation.submitted_by}` : '—')
      kv(doc, '提交时间', reconciliation.submitted_at || '—')
      kv(doc, '确认人', reconciliation.confirmed_by ? `用户 #${reconciliation.confirmed_by}` : '—')
      kv(doc, '确认时间', reconciliation.confirmed_at || '—')
      if (reconciliation.remark) kv(doc, '备注', reconciliation.remark)

      doc.moveDown(1)
      doc
        .fontSize(8)
        .fillColor('#888888')
        .text(
          '本结算单由系统自动生成。所有款项均通过线下转账完成，系统不涉及任何资金划转。',
          { width: CONTENT_WIDTH }
        )

      // ── 页脚页码 ──
      const range = doc.bufferedPageRange()
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i)
        doc
          .fontSize(8)
          .fillColor('#999999')
          .text(
            `第 ${i - range.start + 1} / ${range.count} 页　工程宝 · ${isStage ? '阶段结算单' : '对账结算单'}`,
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

/** 应收表格：付款节点、状态、金额 */
function renderReceivableTable(doc, nodes) {
  const columns = [
    { title: '节点', width: 220 },
    { title: '状态', width: 110 },
    { title: '金额(元)', width: CONTENT_WIDTH - 330, align: 'right' },
  ]

  let x = MARGIN
  const headerY = doc.y
  doc.fontSize(9).fillColor('#333333')
  for (const col of columns) {
    doc.text(col.title, x, headerY, { width: col.width, align: col.align || 'left' })
    x += col.width
  }

  const lineY = headerY + 14
  doc.moveTo(MARGIN, lineY).lineTo(MARGIN + CONTENT_WIDTH, lineY).lineWidth(0.5).strokeColor('#cccccc').stroke()
  doc.y = lineY + 4
  doc.fillColor('#000000')

  const labels = { not_started: '未开始', unlocked: '已解锁', paid: '已付款', confirmed: '已确认' }
  for (const node of nodes) {
    const y = doc.y
    if (y > doc.page.height - MARGIN - 60) doc.addPage()
    const rowY = doc.y
    doc.fontSize(9)
    doc.text(node.name, MARGIN, rowY, { width: 220 })
    doc.text(labels[node.status] || node.status, MARGIN + 220, rowY, { width: 110 })
    doc.text(node.amount, MARGIN + 330, rowY, { width: CONTENT_WIDTH - 330, align: 'right' })
    doc.y = rowY + 15
  }
  doc.moveDown(0.3)
}

/** 明细表格。四列：日期、类型/分类、金额、备注 */
function renderTable(doc, details) {
  const columns = [
    { title: '日期', width: 80 },
    { title: '类型', width: 90 },
    { title: '金额(元)', width: 90, align: 'right' },
    { title: '备注', width: CONTENT_WIDTH - 260 },
  ]

  // 表头
  let x = MARGIN
  const headerY = doc.y
  doc.fontSize(9).fillColor('#333333')
  for (const col of columns) {
    doc.text(col.title, x, headerY, { width: col.width, align: col.align || 'left' })
    x += col.width
  }

  const lineY = headerY + 14
  doc.moveTo(MARGIN, lineY).lineTo(MARGIN + CONTENT_WIDTH, lineY).lineWidth(0.5).strokeColor('#cccccc').stroke()
  doc.y = lineY + 4
  doc.fillColor('#000000')

  for (const row of details) {
    // 手动分页：表格内容超出页面时 pdfkit 的 text 会自动换行但不会自动续页版面，
    // 不管的话后续行会画到纸外面
    if (doc.y > doc.page.height - MARGIN - 40) {
      doc.addPage()
      doc.y = MARGIN
    }

    const rowY = doc.y
    const label = row.type === 'income' ? '收入' : CATEGORY_LABELS[row.category] || '支出'
    // 红冲记录标出来：不标的话，一条正数金额挂在明细里看不出它是冲销
    const typeText = row.is_reversal === 1 || row.reversal_of_id ? `${label}（红冲）` : label

    const cells = [
      row.occurred_at,
      typeText,
      // 红冲金额前加负号**只用于展示**：库里存的是同号正数（AC-L03 不允许负数）
      row.is_reversal === 1 || row.reversal_of_id ? `-${row.amount}` : row.amount,
      row.ledger_remark || '',
    ]

    x = MARGIN
    doc.fontSize(9)
    for (const [index, col] of columns.entries()) {
      doc.text(String(cells[index] ?? ''), x, rowY, { width: col.width, align: col.align || 'left', lineBreak: false })
      x += col.width
    }
    doc.y = rowY + 16
  }

  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_WIDTH, doc.y).lineWidth(0.5).strokeColor('#cccccc').stroke()
}

/**
 * 由明细重算合计。
 *
 * 红冲取负 —— 与 `ledger.model` 的所有汇总查询同一口径（CLAUDE.md 第 48 条）。
 * 这里用 money 工具而不是 SQL SUM，是为了让「PDF 上的合计」与
 * 「对账页面的合计」走同一段计算代码，两处对不上时才不会互相怀疑。
 */
function computeTotals(details) {
  const signed = (row) => (row.is_reversal === 1 ? money.multiply(row.amount, '-1') : row.amount)

  return {
    income: money.sum(details.filter((r) => r.type === 'income').map(signed)),
    expense: money.sum(details.filter((r) => r.type === 'expense').map(signed)),
  }
}

function sectionTitle(doc, text) {
  doc.fontSize(13).fillColor('#1a1a1a').text(text, { width: CONTENT_WIDTH })
  const y = doc.y + 2
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).lineWidth(0.5).strokeColor('#cccccc').stroke()
  doc.fillColor('#000000').moveDown(0.5)
}

function kv(doc, label, value) {
  doc.fontSize(10).text(`${label}：${value}`, { width: CONTENT_WIDTH })
}

module.exports = { generate, render, computeTotals, checkFontAvailable }
