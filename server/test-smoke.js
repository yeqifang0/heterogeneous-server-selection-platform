// 引擎冒烟测试：测算 + 报告 + PDF
const path = require('path');
process.env.NODE_ENV = 'test';
const store = require('./src/store');
const calc = require('./src/calc');
const { buildReport } = require('./src/report');
const { renderReportPdf, findZhFont } = require('./src/pdf');
const fs = require('fs');

const rules = store.load('rules', null);
const machines = store.load('machines', null).machines;

const cases = [
  { name: '中型Web', form: { scenario: 'web', concurrentUsers: 10000, memoryGB: 256, storageValue: 4, storageUnit: 'TB', nicMbps: 1000, budgetMin: 100000, budgetMax: 500000, gpuRequirement: 'none', deliveryCycle: 'month', cpuCoresMin: 64 } },
  { name: 'GPU训练', form: { scenario: 'gpu-train', concurrentUsers: 2000, memoryGB: 1024, storageValue: 20, storageUnit: 'TB', budgetMin: 800000, budgetMax: 3000000, gpuRequirement: 'nvidia-dc', gpuCount: 8, deliveryCycle: 'any' } },
  { name: '存储', form: { scenario: 'storage', concurrentUsers: 500, memoryGB: 128, storageValue: 100, storageUnit: 'TB', budgetMin: 50000, budgetMax: 300000, gpuRequirement: 'none' } },
  { name: '国产AI', form: { scenario: 'gpu-train', concurrentUsers: 1000, memoryGB: 512, storageValue: 10, storageUnit: 'TB', budgetMin: 500000, budgetMax: 2000000, gpuRequirement: 'ascn' } },
  { name: '边缘', form: { scenario: 'edge', concurrentUsers: 200, memoryGB: 64, storageValue: 2, storageUnit: 'TB', budgetMin: 10000, budgetMax: 80000, gpuRequirement: 'none', deliveryCycle: 'week' } },
  { name: '低预算无解', form: { scenario: 'gpu-train', concurrentUsers: 100000, memoryGB: 1024, storageValue: 100, storageUnit: 'TB', budgetMin: 10000, budgetMax: 50000, gpuRequirement: 'unlimited' } }
];

let fail = 0;
for (const c of cases) {
  const v = calc.validateForm(c.form);
  if (!v.ok) { console.log(`✗ ${c.name} 校验失败:`, v.errors); fail++; continue; }
  const r = calc.runCompute(c.form, machines, rules);
  const top = r.top3[0];
  console.log(`✓ ${c.name}: 画像=${r.profileLabel} 推荐核数=${r.sizing.recCores} 内存=${r.sizing.recMemGB}GB GPU=${r.sizing.recGpuCount}卡 候选=${r.stats.feasible} | Top1: ${top ? top.machine.brand + ' ' + top.machine.model + ' ×' + top.cluster.nodes + ' 总价¥' + top.cluster.totalPrice.toLocaleString() + ' 得分' + top.scores.total : '无'} ${r.budgetRelaxed !== 'none' ? '[放宽:' + r.budgetRelaxed + ']' : ''}`);
}

// PDF 生成测试（取案例2）
const task = { id: 'TTEST01', createdAt: new Date().toISOString(), form: cases[1].form, result: calc.runCompute(cases[1].form, machines, rules) };
const report = buildReport(task, rules);
const out = fs.createWriteStream(path.join(__dirname, 'data', '_test_report.pdf'));
renderReportPdf(report, { orderNo: 'SO20261101000001', paidAt: new Date().toISOString() }, out);
out.on('finish', () => {
  const fp = path.join(__dirname, 'data', '_test_report.pdf');
  const size = fs.statSync(fp).size;
  const head = fs.readFileSync(fp).slice(0, 5).toString();
  console.log(`\nPDF 字体: ${findZhFont()}`);
  console.log(`PDF 生成: ${size} bytes, 头部=${head}`);
  console.log(fail === 0 ? '\n全部通过' : `\n${fail} 个失败`);
});
