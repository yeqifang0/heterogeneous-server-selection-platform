// PDF 报告导出：pdfkit + Windows 中文字体（黑体），A4 可打印版式
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const FONT_CANDIDATES = [
  process.env.SSP_ZH_FONT,
  'C:\\Windows\\Fonts\\simhei.ttf',
  'C:\\Windows\\Fonts\\msyh.ttc',
  'C:\\Windows\\Fonts\\simsun.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
  '/System/Library/Fonts/PingFang.ttc'
].filter(Boolean);

function findZhFont() {
  for (const p of FONT_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch (e) { /* ignore */ }
  }
  return null;
}

const COLORS = {
  primary: '#1B5CFF', dark: '#12224A', gray: '#5A6B8C', line: '#D8E0EE',
  headBg: '#EAF0FF', zebra: '#F6F8FD', accent: '#00B478', warn: '#E67E22'
};

// ---------- 版式助手 ----------
function docInit() {
  const fontPath = findZhFont();
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: '异构服务器选型配置与算力匹配测算报告', Creator: '异构服务器选型配置与算力匹配测算平台 V1.0' } });
  if (fontPath) {
    doc.registerFont('zh', fontPath);
    doc.font('zh');
  }
  doc.zhOK = !!fontPath;
  return doc;
}

function textWidth(doc, s, size) {
  doc.fontSize(size || doc._fontSize);
  return doc.widthOfString(s);
}

function ensureSpace(doc, h) {
  if (doc.y + h > doc.page.height - 76) doc.addPage();
}

function h1(doc, s) {
  ensureSpace(doc, 40);
  doc.moveDown(0.6);
  doc.fillColor(COLORS.primary).fontSize(14).text(s, { paragraphGap: 0 });
  const y = doc.y + 3;
  doc.save().moveTo(48, y).lineTo(547, y).lineWidth(1.2).strokeColor(COLORS.primary).stroke().restore();
  doc.y = y + 8;
  doc.fillColor(COLORS.dark);
}

function h2(doc, s) {
  ensureSpace(doc, 26);
  doc.moveDown(0.4).fillColor(COLORS.dark).fontSize(11).text(s);
  doc.fillColor(COLORS.dark);
}

function para(doc, s, opts) {
  const size = (opts && opts.size) || 9.5;
  const lines = doc.heightOfString(s, { width: 499 - 96, fontSize: size });
  ensureSpace(doc, lines + 6);
  doc.fontSize(size).fillColor(opts && opts.color || COLORS.dark).text(s, { width: 499, align: (opts && opts.align) || 'left', lineGap: 2 });
}

// 通用表格：columns [{label, key|fn, width, align}]
function table(doc, columns, rows, opts) {
  const fontSize = (opts && opts.fontSize) || 8.5;
  const x0 = 48, tableW = 499;
  const colW = columns.map(c => c.width);
  const scale = tableW / colW.reduce((a, b) => a + b, 0);
  const ws = colW.map(w => +(w * scale).toFixed(2));

  function drawHeader() {
    ensureSpace(doc, 30);
    const h = 20;
    doc.save().fillColor(COLORS.headBg).rect(x0, doc.y, tableW, h).fill().restore();
    let x = x0;
    doc.fontSize(fontSize).fillColor(COLORS.dark);
    columns.forEach((c, i) => {
      doc.text(c.label, x + 3, doc.y + 6, { width: ws[i] - 6, align: c.align || 'left', ellipsis: true, lineBreak: false });
      x += ws[i];
    });
    doc.y += h;
  }

  drawHeader();
  rows.forEach((row, ri) => {
    const cells = columns.map(c => (c.fn ? c.fn(row) : row[c.key]));
    doc.fontSize(fontSize);
    const heights = cells.map((s, i) => doc.heightOfString(String(s), { width: ws[i] - 8 }));
    const rh = Math.max(16, Math.max(...heights) + 8);
    if (doc.y + rh > doc.page.height - 76) { doc.addPage(); drawHeader(); }
    if (ri % 2 === 1) {
      doc.save().fillColor(COLORS.zebra).rect(x0, doc.y, tableW, rh).fill().restore();
    }
    let x = x0;
    cells.forEach((s, i) => {
      doc.fillColor(COLORS.dark).text(String(s), x + 4, doc.y, { width: ws[i] - 8, align: columns[i].align || 'left', lineGap: 1 });
      x += ws[i];
    });
    doc.y += rh;
    doc.save().moveTo(x0, doc.y).lineTo(x0 + tableW, doc.y).lineWidth(0.5).strokeColor(COLORS.line).stroke().restore();
  });
  doc.moveDown(0.5);
}

// 适配度柱状对比图（矢量绘制）
function barChart(doc, items, title) {
  ensureSpace(doc, 150);
  h2(doc, title);
  const x0 = 60, y0 = doc.y + 6, chH = 90, chW = 470, maxV = 100;
  const n = items.length;
  const slot = chW / n;
  const barW = Math.min(56, slot * 0.5);
  // 坐标轴
  doc.save().lineWidth(1).strokeColor(COLORS.gray)
    .moveTo(x0, y0).lineTo(x0, y0 + chH).moveTo(x0, y0 + chH).lineTo(x0 + chW, y0 + chH).stroke()
    .moveTo(x0, y0 + chH / 2).lineTo(x0 + chW, y0 + chH / 2).lineWidth(0.4).dash(2, { space: 3 }).stroke().restore();
  doc.fontSize(7).fillColor(COLORS.gray);
  doc.text('100', x0 - 20, y0 - 3, { lineBreak: false });
  doc.text('50', x0 - 16, y0 + chH / 2 - 3, { lineBreak: false });
  items.forEach((it, i) => {
    const h = Math.max(4, it.score / maxV * chH);
    const cx = x0 + slot * i + slot / 2;
    doc.save().fillColor(COLORS.primary).rect(cx - barW / 2, y0 + chH - h, barW, h).fill().restore();
    doc.fontSize(8.5).fillColor(COLORS.dark).text(String(it.score), cx - 20, y0 + chH - h - 12, { width: 40, align: 'center', lineBreak: false });
    doc.fontSize(7).fillColor(COLORS.gray);
    const label = it.name.length > 12 ? it.name.slice(0, 11) + '…' : it.name;
    doc.text(label, cx - slot / 2 + 2, y0 + chH + 5, { width: slot - 4, align: 'center' });
    doc.text(it.tag || '', cx - slot / 2 + 2, y0 + chH + 5 + 10, { width: slot - 4, align: 'center' });
  });
  doc.y = y0 + chH + 32;
}

// ---------- 主入口 ----------
function renderReportPdf(report, orderInfo, writable) {
  const doc = docInit();
  if (writable) doc.pipe(writable);

  // 封面标题
  doc.fillColor(COLORS.primary).fontSize(9).text('异构服务器选型配置与算力匹配测算平台 V1.0', { align: 'center' });
  doc.moveDown(0.4);
  doc.fillColor(COLORS.dark).fontSize(20).text(report.title, { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(9).fillColor(COLORS.gray).text(`报告版本：${report.reportVersion}    生成时间：${new Date(report.generatedAt).toLocaleString('zh-CN')}`, { align: 'center' });
  if (orderInfo) {
    doc.fontSize(9).fillColor(COLORS.gray).text(`订单编号：${orderInfo.orderNo}    支付时间：${orderInfo.paidAt ? new Date(orderInfo.paidAt).toLocaleString('zh-CN') : '-'}`, { align: 'center' });
  }
  doc.moveDown(0.6);

  // 一、需求摘要
  h1(doc, report.ch1.title);
  table(doc, [{ label: '需求项', key: 'k', width: 90 }, { label: '内容', key: 'v', width: 300 }],
    report.ch1.rows.map(([k, v]) => ({ k, v })));

  // 二、负载画像分析
  h1(doc, report.ch2.title);
  para(doc, `负载画像：${report.ch2.profile}    并发规模：${report.ch2.scaleLevel}`, { size: 10 });
  para(doc, report.ch2.intro);
  h2(doc, '容量需求换算明细');
  table(doc, [
    { label: '换算项', key: 'item', width: 80 },
    { label: '推荐值', key: 'value', width: 100 },
    { label: '计算依据（规则表系数）', key: 'basis', width: 260 }
  ], report.ch2.derivations);
  if (report.ch2.notes && report.ch2.notes.length) {
    h2(doc, '筛选过程说明');
    report.ch2.notes.forEach(n => para(doc, '· ' + n, { size: 8.5, color: COLORS.gray }));
  }

  // 三、推荐配置方案
  h1(doc, report.ch3.title);
  para(doc, report.ch3.intro);
  table(doc, [
    { label: '序位', key: 'tag', width: 52 },
    { label: '品牌型号', key: 'name', width: 90 },
    { label: 'CPU配置', key: 'cpu', width: 120 },
    { label: 'GPU配置', key: 'gpu', width: 90 },
    { label: '内存', key: 'memory', width: 90 },
    { label: '存储', key: 'storage', width: 90 },
    { label: '网络', key: 'network', width: 70 },
    { label: '单价(元)', key: 'unitPrice', width: 55, align: 'right' },
    { label: '数量', key: 'nodes', width: 28, align: 'center' },
    { label: '总价(元)', key: 'totalPrice', width: 60, align: 'right' },
    { label: '适配度', key: 'score', width: 38, align: 'center' }
  ], report.ch3.plans, { fontSize: 7.5 });

  report.ch3.plans.forEach(p => {
    ensureSpace(doc, 50);
    h2(doc, `${p.tag}：${p.name}（适配度 ${p.score} 分）`);
    p.reasons.forEach(r => para(doc, '· ' + r, { size: 8.5 }));
  });

  if (report.ch3.alternative.length) {
    h2(doc, '备选方案');
    table(doc, [
      { label: '方案', key: 'name', width: 120 },
      { label: '配置概要', key: 'cpu', width: 150 },
      { label: 'GPU', key: 'gpu', width: 100 },
      { label: '总价(元)', key: 'totalPrice', width: 70, align: 'right' },
      { label: '适配度', key: 'score', width: 40, align: 'center' }
    ], report.ch3.alternative, { fontSize: 8 });
  }

  // 柱状图
  barChart(doc, report.chart.items, report.chart.title);

  // 四、横向对比矩阵
  h1(doc, report.ch4.title);
  const matrixCols = [
    { label: '对比维度', key: 'dim', width: 80 },
    ...report.ch4.columns.map((c, i) => ({ label: `${c}·${report.ch4.names[i]}`, key: `v${i}`, width: 110 }))
  ];
  const matrixRows = report.ch4.rows.map(r => {
    const o = { dim: r.dim };
    r.vals.forEach((v, i) => { o[`v${i}`] = v; });
    return o;
  });
  table(doc, matrixCols, matrixRows, { fontSize: 7.5 });

  // 五、性价比排序与选型建议
  h1(doc, report.ch5.title);
  table(doc, [
    { label: '性价比排名', key: 'rank', width: 50, align: 'center' },
    { label: '品牌型号', key: 'name', width: 130 },
    { label: '性价比指数(算力/万元)', key: 'valueIndex', width: 100, align: 'right' },
    { label: '总价', key: 'totalPriceText', width: 90, align: 'right' },
    { label: '适配度得分', key: 'totalScore', width: 60, align: 'center' }
  ], report.ch5.ranking, { fontSize: 8 });
  h2(doc, '选型建议');
  report.ch5.advice.forEach(a => para(doc, '· ' + a, { size: 8.8 }));

  // 六、风险与注意事项
  h1(doc, report.ch6.title);
  table(doc, [
    { label: '风险类别', key: 'type', width: 80 },
    { label: '说明与建议', key: 'text', width: 320 }
  ], report.ch6.risks, { fontSize: 8.2 });

  // 附录
  h1(doc, report.appendix.title);
  h2(doc, '参数假设');
  report.appendix.assumptions.split('\n').forEach(l => para(doc, l, { size: 8.2, color: COLORS.gray }));
  h2(doc, '免责声明');
  para(doc, report.appendix.disclaimer, { size: 8.2, color: COLORS.gray });
  para(doc, `评分权重：${report.appendix.weightsUsed}（规则版本 ${report.appendix.rulesVersion}）`, { size: 8.2, color: COLORS.gray });

  // 页脚
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(7.5).fillColor(COLORS.gray);
    doc.text(`第 ${i + 1} / ${range.count} 页 · 本报告仅为选型辅助参考，不构成采购承诺`, 48, doc.page.height - 40, { width: 499, align: 'center', lineBreak: false });
  }
  doc.end();
  return doc;
}

module.exports = { renderReportPdf, findZhFont };
