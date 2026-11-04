'use strict'

/**
 * 项目竣工总报告 PDF。
 *
 * 与单张验收报告的分工：
 *   - 验收报告证明「某一个阶段/工序经过了谁、按什么结论验收」；
 *   - 竣工总报告汇总「整个项目到最后是什么状态」，不替代任何一张验收报告。
 * 因此它不嵌签名原图，只列验收单号、通过时间与签名方式；
 * 真正有法律/确认效力的是各验收单归档的报告与签名。
 */

const PDFDocument = require('pdfkit')

const config = require('../../config')
const money = require('../utils/money')
const { checkFontAvailable } = require('./acceptancePdf.service')

const MARGIN = 46
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const ROW_HEIGHT = 20
const BRAND = '#EB5C20'

function render(snapshot) {
  checkFontAvailable()

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      bufferPages: true,
      info: { Title: '项目竣工总报告', Author: '柏总管' },
    })
    const chunks = []

    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    try {
      doc.registerFont('cn', config.acceptancePdf.fontPath, config.acceptancePdf.fontName)
      doc.font('cn')

      renderCover(doc, snapshot)
      doc.addPage()

      sectionTitle(doc, '一、项目概况')
      kv(doc, '项目名称', snapshot.project.name)
      kv(doc, '项目编号', `#${snapshot.project.id}`)
      kv(doc, '所属租户', snapshot.project.tenantName || '—')
      kv(doc, '项目地址', snapshot.project.address || '—')
      kv(doc, '项目状态', snapshot.project.statusLabel)
      kv(doc, '合同金额', `¥ ${money.format(snapshot.finance.contractAmount)}`)
      kv(doc, '开工日期', snapshot.project.startDate || '—')
      kv(doc, '计划竣工', snapshot.project.planEndDate || '—')
      kv(doc, '实际竣工', snapshot.project.actualEndDate || '—')
      kv(doc, '总体进度', `${snapshot.project.progress}%`)
      kv(doc, '阶段 / 工序', `${snapshot.summary.stageCount} 个阶段 / ${snapshot.summary.itemCount} 个工序`)
      kv(doc, '已验收阶段', `${snapshot.summary.acceptedStageCount} / ${snapshot.summary.stageCount}`)

      sectionTitle(doc, '二、参建成员')
      if (snapshot.members.length === 0) {
        emptyLine(doc, '暂无已确认的项目成员')
      } else {
        table(
          doc,
          ['角色', '姓名', '身份', '加入时间'],
          snapshot.members.map((m) => [m.roleLabel, m.name, m.identityLabel, m.joinedAt]),
          [78, 150, 100, 165]
        )
      }

      sectionTitle(doc, '三、阶段验收汇总')
      if (snapshot.stages.length === 0) {
        emptyLine(doc, '项目尚未生成施工阶段')
      } else {
        table(
          doc,
          ['#', '阶段', '完成度', '门禁', '验收状态', '验收时间'],
          snapshot.stages.map((s) => [
            String(s.seq),
            s.name,
            `${s.progress}%`,
            s.gateLabel,
            s.acceptanceLabel,
            s.acceptedAt || '—',
          ]),
          [28, 145, 58, 70, 92, 110]
        )
      }

      sectionTitle(doc, '四、验收记录')
      if (snapshot.acceptances.length === 0) {
        emptyLine(doc, '暂无已通过的验收记录')
      } else {
        table(
          doc,
          ['验收单', '类型', '对象', '轮次', '通过时间', '签名'],
          snapshot.acceptances.map((a) => [
            a.no,
            a.typeLabel,
            a.targetLabel,
            `第 ${a.round} 轮`,
            a.finishedAt || '—',
            a.signatureLabel,
          ]),
          [76, 52, 150, 54, 105, 66]
        )
      }

      // 账务汇总 + 节点表放得下时尽量同页，避免标题孤零零留在页尾
      ensureSpace(doc, 220)
      sectionTitle(doc, '五、付款节点与账务汇总')
      kv(doc, '合同金额', `¥ ${money.format(snapshot.finance.contractAmount)}`)
      kv(doc, '已收款', `¥ ${money.format(snapshot.finance.income)}`)
      kv(doc, '已支出', `¥ ${money.format(snapshot.finance.expense)}`)
      kv(doc, '待收款', `¥ ${money.format(snapshot.finance.pending)}`)
      kv(doc, '当前余额', `¥ ${money.format(snapshot.finance.balance)}`)

      if (snapshot.paymentNodes.length > 0) {
        doc.moveDown(0.4)
        table(
          doc,
          ['#', '付款节点', '金额', '状态', '解锁时间'],
          snapshot.paymentNodes.map((n) => [
            String(n.seq),
            n.name,
            `¥ ${money.format(n.amount)}`,
            n.statusLabel,
            n.unlockedAt || '—',
          ]),
          [28, 180, 100, 80, 115]
        )
      }

      ensureSpace(doc, 140)
      sectionTitle(doc, '六、竣工验收结论')
      conclusion(doc, snapshot)
      doc.moveDown(0.8)
      doc
        .fontSize(8.5)
        .fillColor('#8b8179')
        .text(
          '本报告由系统根据项目、阶段、验收与账务数据自动汇总生成。各阶段验收结论、签名与照片以对应的验收报告为准；' +
            '本报告不替代任何一张验收报告，也不构成新的验收确认。',
          { width: CONTENT_WIDTH, lineGap: 2 }
        )

      addFooters(doc)
      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}

function renderCover(doc, snapshot) {
  doc.rect(0, 0, PAGE_WIDTH, 228).fill(BRAND)
  doc.fillColor('#ffffff').fontSize(11).text('柏总管 · 工程竣工归档', MARGIN, 54)
  doc.fontSize(28).text('项目竣工总报告', MARGIN, 84)
  doc.fontSize(15).text(snapshot.project.name, MARGIN, 132, { width: CONTENT_WIDTH })

  doc.fillColor('#241c17')
  doc.y = 270
  kv(doc, '报告编号', snapshot.reportNo)
  kv(doc, '项目状态', snapshot.project.statusLabel)
  kv(doc, '所属租户', snapshot.project.tenantName || '—')
  kv(doc, '生成时间', snapshot.generatedAt)
  kv(doc, '已验收阶段', `${snapshot.summary.acceptedStageCount} / ${snapshot.summary.stageCount}`)
  kv(doc, '已通过验收', `${snapshot.summary.passedAcceptanceCount} 张`)

  doc
    .fontSize(9)
    .fillColor('#8b8179')
    .text(
      '本报告仅汇总项目当前归档数据。项目状态、验收与账务数据发生变化后，可重新生成。',
      MARGIN,
      PAGE_HEIGHT - 120,
      { width: CONTENT_WIDTH, lineGap: 3 }
    )
}

function conclusion(doc, snapshot) {
  const pending = snapshot.summary.pendingStageNames
  if (snapshot.summary.stageCount === 0) {
    paragraph(doc, '项目当前没有施工阶段，无法形成阶段验收结论，请先补齐项目结构。')
    return
  }

  if (pending.length === 0) {
    paragraph(
      doc,
      `本项目共 ${snapshot.summary.stageCount} 个阶段，均已通过验收；` +
        `实际竣工日期为 ${snapshot.project.actualEndDate || '未登记'}。`
    )
  } else {
    paragraph(
      doc,
      `项目已标记为「${snapshot.project.statusLabel}」，但仍有 ${pending.length} 个阶段未完成阶段验收：` +
        `${pending.join('、')}。本报告如实反映当前状态，未验收部分不应视为已验收。`
    )
  }

  paragraph(
    doc,
    `截至本报告生成时，项目共归档 ${snapshot.summary.passedAcceptanceCount} 张已通过验收单，` +
      `其中手写签名 ${snapshot.summary.legacySignatureCount} 张、可靠电子签 ${snapshot.summary.esignCount} 张。`
  )
}

function paragraph(doc, text) {
  ensureSpace(doc, 44)
  doc.fontSize(10).fillColor('#241c17').text(text, MARGIN, doc.y, {
    width: CONTENT_WIDTH,
    lineGap: 4,
  })
  doc.moveDown(0.4)
}

function sectionTitle(doc, text) {
  ensureSpace(doc, 44)
  const y = doc.y + 6
  doc.fontSize(13).fillColor(BRAND).text(text, MARGIN, y)
  const lineY = doc.y + 3
  doc
    .moveTo(MARGIN, lineY)
    .lineTo(PAGE_WIDTH - MARGIN, lineY)
    .strokeColor('#F0E3D9')
    .lineWidth(1)
    .stroke()
  doc.y = lineY + 8
}

function kv(doc, label, value) {
  ensureSpace(doc, 18)
  const startY = doc.y
  doc.fontSize(9).fillColor('#8b8179').text(label, MARGIN, startY, { width: 100 })
  doc
    .fillColor('#241c17')
    .text(String(value ?? '—'), MARGIN + 100, startY, { width: CONTENT_WIDTH - 100 })
  doc.y = Math.max(doc.y, startY + 14) + 3
}

function emptyLine(doc, text) {
  ensureSpace(doc, 22)
  doc.fontSize(9.5).fillColor('#a79c92').text(text, MARGIN, doc.y, { width: CONTENT_WIDTH })
  doc.moveDown(0.5)
}

/**
 * 固定行高表格。单元格超宽时截断，不换行 ——
 * 换行会让行高动态变化，分页位置变得不可预测；报告里的字段都已控制在可读长度内。
 */
function table(doc, headers, rows, widths) {
  const bottom = PAGE_HEIGHT - doc.page.margins.bottom - 22

  const drawHeader = () => {
    const y = doc.y
    doc.rect(MARGIN, y, CONTENT_WIDTH, ROW_HEIGHT).fill('#F7F1EC')
    doc.fillColor('#6d6259').fontSize(8.5)
    let x = MARGIN
    headers.forEach((header, index) => {
      doc.text(header, x + 6, y + 6, {
        width: widths[index] - 12,
        height: 12,
        lineBreak: false,
        ellipsis: true,
      })
      x += widths[index]
    })
    doc.fillColor('#241c17')
    doc.y = y + ROW_HEIGHT
  }

  ensureSpace(doc, ROW_HEIGHT * 2)
  drawHeader()

  rows.forEach((row, rowIndex) => {
    if (doc.y + ROW_HEIGHT > bottom) {
      doc.addPage()
      drawHeader()
    }

    const y = doc.y
    if (rowIndex % 2 === 1) {
      doc.rect(MARGIN, y, CONTENT_WIDTH, ROW_HEIGHT).fill('#FCFAF8')
    }

    doc.fillColor('#241c17').fontSize(8.5)
    let x = MARGIN
    row.forEach((cell, index) => {
      doc.text(String(cell ?? '—'), x + 6, y + 6, {
        width: widths[index] - 12,
        height: 12,
        lineBreak: false,
        ellipsis: true,
      })
      x += widths[index]
    })

    doc
      .moveTo(MARGIN, y + ROW_HEIGHT)
      .lineTo(PAGE_WIDTH - MARGIN, y + ROW_HEIGHT)
      .strokeColor('#F1ECE7')
      .lineWidth(0.5)
      .stroke()

    doc.y = y + ROW_HEIGHT
  })

  doc.y += 8
}

function ensureSpace(doc, height) {
  const bottom = PAGE_HEIGHT - doc.page.margins.bottom - 20
  if (doc.y + height > bottom) {
    doc.addPage()
  }
}

function addFooters(doc) {
  const range = doc.bufferedPageRange()
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index)
    // pdfkit 在 y 超过「页高 − 下边距」时会自动 addPage；页脚本来就在下边距里，
    // 不临时把 bottom 置 0 会额外生成一串只写着页码的空白页
    const bottomMargin = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    doc
      .font('cn')
      .fontSize(8)
      .fillColor('#a79c92')
      .text(`项目竣工总报告 · 第 ${index + 1} / ${range.count} 页`, MARGIN, PAGE_HEIGHT - 30, {
        width: CONTENT_WIDTH,
        align: 'center',
        lineBreak: false,
      })
    doc.page.margins.bottom = bottomMargin
  }
}

module.exports = { render }
