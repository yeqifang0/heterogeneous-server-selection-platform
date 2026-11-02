// 异构服务器选型配置与算力匹配测算平台 V1.0 —— 后端服务入口
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const calc = require('./calc');
const { buildReport, REPORT_VERSION } = require('./report');
const { renderReportPdf } = require('./pdf');
const auth = require('./auth');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, _res, next) => { console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${req.method} ${req.path}`); next(); });

// 静态前端
app.use(express.static(path.join(__dirname, '..', '..', 'public')));

// ---------- 公共元信息（前端选项/收费均来自规则表，前端不写死） ----------
function getRules() { return store.load('rules', null); }
function getMachines() { return store.load('machines', { machines: [] }).machines; }

app.get('/api/bootstrap', (_req, res) => {
  const rules = getRules();
  res.json({
    options: rules.options,
    pricing: rules.pricing,
    weights: rules.weights,
    reportVersion: REPORT_VERSION,
    platform: '异构服务器选型配置与算力匹配测算平台',
    version: 'V1.0'
  });
});

auth.registerRoutes(app);
auth.ensureAdmin();

// ---------- 测算任务 ----------
const STAGES = [
  { name: '参数校验与回显', pct: 15 },
  { name: '负载画像映射', pct: 35 },
  { name: '容量换算（CPU/内存/GPU/存储/带宽）', pct: 55 },
  { name: '机型参数库匹配筛选', pct: 75 },
  { name: '四维加权评分排序', pct: 90 },
  { name: '报告生成', pct: 100 }
];

app.post('/api/tasks', auth.authOptional, (req, res) => {
  const form = req.body || {};
  const v = calc.validateForm(form);
  if (!v.ok) return res.status(400).json({ error: '表单校验未通过', fields: v.errors });

  const rules = getRules();
  const machines = getMachines();
  let result;
  try {
    result = calc.runCompute(form, machines, rules);
  } catch (e) {
    console.error('计算失败:', e);
    return res.status(500).json({ error: '测算引擎执行失败：' + e.message });
  }
  if (!result.candidates.length) {
    return res.status(422).json({ error: '机型库中暂无满足该需求的候选方案，请调整GPU类别/预算/规模后重试' });
  }

  const tasks = store.load('tasks', { tasks: [] });
  const task = {
    id: 'T' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase(),
    form, result, stages: STAGES,
    creatorUserId: req.user ? req.user.id : null,
    createdAt: new Date().toISOString()
  };
  tasks.tasks.push(task);
  if (tasks.tasks.length > 500) tasks.tasks = tasks.tasks.slice(-500); // 控制文件体积
  store.save('tasks', tasks);
  res.json({ taskId: task.id, stages: STAGES });
});

app.get('/api/tasks/:id', (req, res) => {
  const task = findTask(req.params.id);
  if (!task) return res.status(404).json({ error: '测算任务不存在' });
  res.json({
    taskId: task.id, createdAt: task.createdAt, stages: task.stages,
    form: task.form
  });
});

// 脱敏摘要（未付费可见）
app.get('/api/tasks/:id/summary', (req, res) => {
  const task = findTask(req.params.id);
  if (!task) return res.status(404).json({ error: '测算任务不存在' });
  const r = task.result;
  res.json({
    taskId: task.id,
    profileLabel: r.profileLabel,
    scaleLevel: r.sizing.scaleLevel,
    scenario: task.form.scenario,
    concurrentUsers: task.form.concurrentUsers,
    recCores: r.sizing.recCores,
    recMemGB: r.sizing.recMemGB,
    recGpuCount: r.sizing.recGpuCount,
    recStorageTB: +(r.sizing.recStorageGB / 1024).toFixed(1),
    recNicMbps: r.sizing.recNicMbps,
    machineTotal: r.stats.machineTotal,
    feasibleCount: r.stats.feasible,
    topCount: r.top3.length,
    hasAlternative: !!r.alternative,
    budgetRelaxed: r.budgetRelaxed,
    topBrandMasked: r.top3.map(c => c.machine.brand + ' ****'),
    bestScoreHint: r.top3.length ? Math.floor(r.top3[0].scores.total / 10) * 10 : null // 仅十位提示
  });
});

// 权益查询：已购产品
app.get('/api/tasks/:id/entitlement', (req, res) => {
  const task = findTask(req.params.id);
  if (!task) return res.status(404).json({ error: '测算任务不存在' });
  const orders = store.load('orders', { orders: [] }).orders.filter(o => o.taskId === task.id && o.status === 'paid');
  res.json({
    calcUnlocked: orders.some(o => ['quick', 'report'].includes(o.productId)),
    reportUnlocked: orders.some(o => o.productId === 'report')
  });
});

// 完整测算结果（需已购买快速测算或正式报告）
app.get('/api/tasks/:id/calc', (req, res) => {
  const task = requirePaid(req, res, ['quick', 'report']);
  if (!task) return;
  const r = task.result;
  res.json({
    taskId: task.id,
    sizing: { ...r.sizing, derivations: r.sizing.derivations, scenarioConf: undefined },
    profileLabel: r.profileLabel,
    top3: r.top3.map((c, i) => publicCandidate(c, i + 1)),
    alternative: r.alternative ? publicCandidate(r.alternative, 4) : null,
    filterNotes: r.filterNotes,
    valueRanking: r.valueRanking,
    weights: r.weights || getRules().weights,
    chart: { items: [...r.top3, r.alternative].filter(Boolean).map((c, i) => ({ name: `${c.machine.brand} ${c.machine.model}`, score: c.scores.total })) },
    stats: r.stats, computedAt: r.computedAt
  });
});

function publicCandidate(c, rank) {
  const m = c.machine, cl = c.cluster;
  return {
    rank, brand: m.brand, model: m.model, category: m.category, cpuArch: m.cpuArch,
    cpuDesc: `${m.cpu.count}×${m.cpu.model}（${m.cpu.count * m.cpu.coresPerCPU}核 @${m.cpu.freqGHz}GHz）`,
    gpuDesc: m.gpu ? `${m.gpu.count}×${m.gpu.model} ${m.gpu.vramGB}GB（FP16 ${m.gpu.fp16Tflops} TFLOPS/卡）` : '无',
    memDesc: `${cl.totalMemGB} GB（单机${m.memory.stdGB}GB，最大可扩${m.memory.maxGB}GB）`,
    storageDesc: `${cl.totalStorageTB} TB ${m.storage.type}（单机配置${cl.perNodeStorageTB}TB）`,
    networkDesc: m.network.model,
    nodes: cl.nodes, unitPrice: m.price, totalPrice: cl.totalPrice,
    powerKW: cl.totalPowerKW, warranty: m.warrantyYears, deliveryWeeks: m.deliveryWeeks,
    scores: c.scores, reasons: c.reasons, overBudget: !!c.overBudget
  };
}

// 完整报告（需已购买正式报告）
app.get('/api/tasks/:id/report', (req, res) => {
  const task = requirePaid(req, res, ['report']);
  if (!task) return;
  const rules = getRules();
  const report = buildReport(task, rules);
  const orders = store.load('orders', { orders: [] }).orders
    .filter(o => o.taskId === task.id && o.productId === 'report' && o.status === 'paid');
  res.json({ ...report, orderNo: orders.length ? orders[orders.length - 1].orderNo : null });
});

app.get('/api/tasks/:id/report.pdf', (req, res) => {
  const task = requirePaid(req, res, ['report']);
  if (!task) return;
  const rules = getRules();
  const report = buildReport(task, rules);
  const orders = store.load('orders', { orders: [] }).orders
    .filter(o => o.taskId === task.id && o.productId === 'report' && o.status === 'paid');
  const orderInfo = orders.length ? orders[orders.length - 1] : null;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`选型测算报告_${task.id}.pdf`)}`);
  try {
    renderReportPdf(report, orderInfo, res);
  } catch (e) {
    console.error('PDF生成失败:', e);
    if (!res.headersSent) res.status(500).json({ error: 'PDF生成失败：' + e.message });
  }
});

function findTask(id) {
  const tasks = store.load('tasks', { tasks: [] }).tasks;
  return tasks.find(t => t.id === id) || null;
}

function requirePaid(req, res, products) {
  const task = findTask(req.params.id);
  if (!task) { res.status(404).json({ error: '测算任务不存在' }); return null; }
  const orders = store.load('orders', { orders: [] }).orders
    .filter(o => o.taskId === task.id && o.status === 'paid' && products.includes(o.productId));
  if (!orders.length) { res.status(403).json({ error: '该内容需付费解锁后查看' }); return null; }
  return task;
}

// ---------- 订单与支付（模拟支付） ----------
app.post('/api/orders', auth.authRequired, (req, res) => {
  const { taskId, productId } = req.body || {};
  if (!taskId || !findTask(taskId)) return res.status(404).json({ error: '测算任务不存在' });
  const pricing = getRules().pricing;
  const product = pricing[productId];
  if (!product) return res.status(400).json({ error: '产品类型无效' });

  const orders = store.load('orders', { orders: [] });
  const dup = orders.orders.find(o => o.taskId === taskId && o.productId === productId && o.status === 'paid');
  if (dup) return res.status(400).json({ error: '该测算已购买此产品，无需重复支付', orderId: dup.id });

  const now = new Date();
  const order = {
    id: 'O' + crypto.randomBytes(8).toString('hex'),
    orderNo: 'SO' + now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + String(Math.floor(Math.random() * 900000) + 100000),
    userId: req.user.id, username: req.user.username,
    taskId, productId, productName: product.name,
    amount: product.price,
    status: 'pending', createdAt: now.toISOString(), paidAt: null,
    payMethod: null, reportVersion: REPORT_VERSION
  };
  orders.orders.push(order);
  store.save('orders', orders);
  res.json({ order });
});

app.post('/api/orders/:id/pay', auth.authRequired, (req, res) => {
  const orders = store.load('orders', { orders: [] });
  const order = orders.orders.find(o => o.id === req.params.id || o.orderNo === req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.userId !== req.user.id) return res.status(403).json({ error: '无权操作他人订单' });
  if (order.status === 'paid') return res.json({ order, already: true });
  order.status = 'paid';
  order.paidAt = new Date().toISOString();
  order.payMethod = '模拟支付（演示环境）';
  store.save('orders', orders);
  res.json({ order });
});

app.get('/api/orders', auth.authRequired, (req, res) => {
  const orders = store.load('orders', { orders: [] }).orders
    .filter(o => o.userId === req.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ orders });
});

app.get('/api/orders/:id', auth.authRequired, (req, res) => {
  const orders = store.load('orders', { orders: [] }).orders;
  const order = orders.orders.find(o => o.id === req.params.id || o.orderNo === req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: '无权查看他人订单' });
  res.json({ order });
});

// ---------- 管理后台：机型参数库 / 规则表 / 订单 ----------
app.get('/api/admin/machines', auth.adminRequired, (_req, res) => {
  res.json({ machines: getMachines() });
});

function validateMachine(m) {
  const errors = [];
  if (!m.id || !/^[a-z0-9-]{3,40}$/.test(m.id)) errors.push('机型ID须为3~40位小写字母/数字/连字符');
  if (!m.brand || !m.model) errors.push('品牌与型号必填');
  if (!m.cpu || !(m.cpu.count > 0) || !(m.cpu.coresPerCPU > 0) || !(m.cpu.freqGHz > 0)) errors.push('CPU参数不完整（数量/核数/主频须大于0）');
  if (!m.memory || !(m.memory.stdGB > 0) || !(m.memory.maxGB >= m.memory.stdGB)) errors.push('内存参数无效（最大容量须不小于标配）');
  if (!m.storage || !(m.storage.stdTB > 0) || !(m.storage.maxTB >= m.storage.stdTB)) errors.push('存储参数无效');
  if (!(m.price > 0)) errors.push('单价必须大于0');
  if (!(m.powerW > 0)) errors.push('功耗必须大于0');
  if (m.gpu && (!(m.gpu.count > 0) || !(m.gpu.vramGB > 0) || !m.gpu.model)) errors.push('GPU参数不完整');
  return errors;
}

app.post('/api/admin/machines', auth.adminRequired, (req, res) => {
  const m = req.body || {};
  const errors = validateMachine(m);
  if (errors.length) return res.status(400).json({ error: errors.join('；') });
  const db = store.load('machines', { machines: [] });
  if (db.machines.some(x => x.id === m.id)) return res.status(400).json({ error: '机型ID已存在' });
  db.machines.push(m);
  db.updatedAt = new Date().toISOString();
  store.save('machines', db);
  res.json({ ok: true, machines: db.machines });
});

app.put('/api/admin/machines/:id', auth.adminRequired, (req, res) => {
  const m = req.body || {};
  const errors = validateMachine(m);
  if (errors.length) return res.status(400).json({ error: errors.join('；') });
  const db = store.load('machines', { machines: [] });
  const idx = db.machines.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '机型不存在' });
  if (m.id !== req.params.id && db.machines.some(x => x.id === m.id)) return res.status(400).json({ error: '新机型ID与其他机型冲突' });
  db.machines[idx] = m;
  db.updatedAt = new Date().toISOString();
  store.save('machines', db);
  res.json({ ok: true, machines: db.machines });
});

app.delete('/api/admin/machines/:id', auth.adminRequired, (req, res) => {
  const db = store.load('machines', { machines: [] });
  const before = db.machines.length;
  db.machines = db.machines.filter(x => x.id !== req.params.id);
  if (db.machines.length === before) return res.status(404).json({ error: '机型不存在' });
  db.updatedAt = new Date().toISOString();
  store.save('machines', db);
  res.json({ ok: true, machines: db.machines });
});

app.get('/api/admin/rules', auth.adminRequired, (_req, res) => {
  res.json({ rules: getRules() });
});

app.put('/api/admin/rules', auth.adminRequired, (req, res) => {
  const rules = req.body && req.body.rules;
  if (!rules || !rules.scenarioProfiles || !rules.weights || !rules.sizing || !rules.pricing || !rules.reportTemplate) {
    return res.status(400).json({ error: '规则表结构不完整（须包含 scenarioProfiles/weights/sizing/pricing/reportTemplate）' });
  }
  const w = rules.weights;
  const wsum = +(w.performance + w.value + w.power + w.service).toFixed(4);
  if (wsum !== 1) return res.status(400).json({ error: `评分权重之和必须等于1，当前为 ${wsum}` });
  for (const [k, sp] of Object.entries(rules.scenarioProfiles)) {
    if (!(sp.coresPer1kUsers >= 0) || !(sp.memGBPerCore > 0) || !(sp.storageMultiplier > 0)) {
      return res.status(400).json({ error: `场景「${k}」系数无效：每千并发核数、每核内存、存储系数须大于0` });
    }
  }
  for (const p of Object.values(rules.pricing)) {
    if (!(p.price >= 0)) return res.status(400).json({ error: '产品价格必须不小于0' });
  }
  rules.updatedAt = new Date().toISOString();
  store.save('rules', rules);
  res.json({ ok: true, rules });
});

app.get('/api/admin/orders', auth.adminRequired, (_req, res) => {
  const orders = store.load('orders', { orders: [] }).orders
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ orders });
});

app.get('/api/admin/stats', auth.adminRequired, (_req, res) => {
  const orders = store.load('orders', { orders: [] }).orders;
  const tasks = store.load('tasks', { tasks: [] }).tasks;
  const machines = getMachines();
  res.json({
    machineCount: machines.length,
    taskCount: tasks.length,
    orderCount: orders.length,
    paidCount: orders.filter(o => o.status === 'paid').length,
    revenue: orders.filter(o => o.status === 'paid').reduce((s, o) => s + o.amount, 0)
  });
});

// 兜底：SPA 路由
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: '接口不存在' });
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
});

// 统一错误处理
app.use((err, _req, res, _next) => {
  console.error('服务异常:', err);
  if (!res.headersSent) res.status(500).json({ error: '服务内部错误：' + err.message });
});

app.listen(PORT, () => {
  console.log(`异构服务器选型配置与算力匹配测算平台 V1.0 后端已启动`);
  console.log(`访问地址: http://127.0.0.1:${PORT}`);
});
