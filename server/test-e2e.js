// 端到端 API 全链路测试（需服务已启动在 http://127.0.0.1:3000）
const BASE = 'http://127.0.0.1:3000';
let token = '', adminToken = '', taskId = '';
let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { failed++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};
async function req(method, path, body, tok) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (tok || token) headers.Authorization = 'Bearer ' + (tok || token);
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) return { status: res.status, json: await res.json() };
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
}

(async () => {
  console.log('【1】基础与表单校验');
  let r = await req('GET', '/api/bootstrap');
  ok('bootstrap 返回选项与定价', r.status === 200 && r.json.pricing.report.price === 199);

  r = await req('POST', '/api/tasks', {});
  ok('空表单返回400与逐字段中文错误', r.status === 400 && r.json.fields.scenario && r.json.fields.concurrentUsers, Object.keys(r.json.fields).join(','));

  r = await req('POST', '/api/tasks', { scenario: 'web', concurrentUsers: 99999999, memoryGB: 1, storageValue: 1, storageUnit: 'TB', budgetMin: 100, budgetMax: 50 });
  ok('数值越界与预算倒置被拦截', r.status === 400 && r.json.fields.concurrentUsers && r.json.fields.budgetMax, '并发:' + r.json.fields.concurrentUsers);

  console.log('【2】游客试算与脱敏摘要');
  r = await req('POST', '/api/tasks', {
    scenario: 'gpu-train', concurrentUsers: 3000, workloadDesc: '大模型分布式训练，千卡级预留',
    cpuFreqMin: 2.0, gpuRequirement: 'nvidia-dc', gpuCount: 8,
    memoryGB: 1024, storageValue: 20, storageUnit: 'TB', nicMbps: 10000,
    budgetMin: 800000, budgetMax: 3000000, deliveryCycle: 'any', remark: 'E2E测试'
  });
  ok('游客提交测算成功', r.status === 200 && r.json.taskId, r.json.taskId);
  taskId = r.json.taskId;

  r = await req('GET', '/api/tasks/' + taskId);
  ok('任务回显含11项表单字段与阶段', r.status === 200 && r.json.form.memoryGB === 1024 && r.json.stages.length === 6);

  r = await req('GET', '/api/tasks/' + taskId + '/summary');
  ok('脱敏摘要可见（画像/规模/掩码品牌）', r.status === 200 && r.json.profileLabel && r.json.topBrandMasked.join('').includes('****'), r.json.profileLabel + ' ' + r.json.topBrandMasked.join('/'));

  r = await req('GET', '/api/tasks/' + taskId + '/calc');
  ok('未付费访问完整结果被403拦截', r.status === 403);
  r = await req('GET', '/api/tasks/' + taskId + '/report');
  ok('未付费访问报告被403拦截', r.status === 403);

  console.log('【3】账号/订单/支付/解锁');
  r = await req('POST', '/api/orders', { taskId, productId: 'quick' });
  ok('未登录下单被401拦截', r.status === 401);

  const uname = 'e2e_' + Date.now().toString(36);
  r = await req('POST', '/api/auth/register', { username: uname, password: 'test123', displayName: '测试用户' });
  ok('注册成功并返回令牌', r.status === 200 && r.json.token);
  token = r.json.token;

  r = await req('POST', '/api/orders', { taskId, productId: 'quick' });
  ok('创建快速测算订单(待支付)', r.status === 200 && r.json.order.status === 'pending', r.json.order.orderNo + ' ¥' + r.json.order.amount);
  const quickOrder = r.json.order;

  r = await req('GET', '/api/tasks/' + taskId + '/calc');
  ok('待支付状态仍不可见完整结果', r.status === 403);

  r = await req('POST', '/api/orders/' + quickOrder.id + '/pay');
  ok('模拟支付成功并记录付费时间', r.status === 200 && r.json.order.status === 'paid' && r.json.order.paidAt);

  r = await req('GET', '/api/tasks/' + taskId + '/calc');
  ok('已购快速测算可见Top3与得分', r.status === 200 && r.json.top3.length === 3 && r.json.top3[0].scores.total > 0,
    'Top1: ' + r.json.top3[0].brand + ' ' + r.json.top3[0].model + ' ×' + r.json.top3[0].nodes + ' 得分' + r.json.top3[0].scores.total);

  r = await req('GET', '/api/tasks/' + taskId + '/report');
  ok('仅购快速测算仍不可见正式报告', r.status === 403);

  r = await req('POST', '/api/orders', { taskId, productId: 'report' });
  const reportOrder = r.json.order;
  r = await req('POST', '/api/orders/' + reportOrder.id + '/pay');
  ok('正式报告订单支付成功', r.status === 200 && r.json.order.status === 'paid', r.json.order.orderNo);

  r = await req('GET', '/api/tasks/' + taskId + '/report');
  ok('报告含六章结构与订单号留痕', r.status === 200 && r.json.ch1 && r.json.ch6 && r.json.orderNo && r.json.reportVersion === 'V1.0',
    '章节:' + [r.json.ch1, r.json.ch2, r.json.ch3, r.json.ch4, r.json.ch5, r.json.ch6, r.json.appendix].map(c => c.title.slice(0, 2)).join('/'));

  r = await req('GET', '/api/tasks/' + taskId + '/report.pdf');
  ok('PDF下载成功且为有效PDF', r.status === 200 && r.buf.slice(0, 5).toString() === '%PDF-', r.buf.length + ' bytes');
  if (r.buf && r.buf.length > 1000) {
    const fs = require('fs');
    fs.writeFileSync(__dirname + '\\data\\_e2e_report.pdf', r.buf);
  }

  r = await req('GET', '/api/orders');
  ok('订单列表可追溯（含订单号/付费时间/版本/用户）', r.status === 200 && r.json.orders.length === 2 &&
    r.json.orders[0].orderNo && r.json.orders[0].paidAt && r.json.orders[0].reportVersion === 'V1.0' && r.json.orders[0].username === uname);

  console.log('【4】管理后台');
  r = await req('POST', '/api/auth/login', { username: 'admin', password: 'Admin@123' });
  ok('管理员登录', r.status === 200 && r.json.user.role === 'admin');
  adminToken = r.json.token;

  r = await req('GET', '/api/admin/machines', undefined, adminToken);
  ok('机型库列表', r.status === 200 && r.json.machines.length >= 22, r.json.machines.length + ' 款');

  const badRules = (await req('GET', '/api/admin/rules', undefined, adminToken)).json.rules;
  badRules.weights.performance = 0.5; // 和变成1.1
  r = await req('PUT', '/api/admin/rules', { rules: badRules }, adminToken);
  ok('权重和≠1被后端拒绝', r.status === 400);

  r = await req('POST', '/api/admin/machines', {
    id: 'e2e-test-machine', brand: '测试品牌', model: 'E2E-1', category: '通用机架服务器', cpuArch: 'x86',
    cpu: { model: 'Test Xeon', count: 2, coresPerCPU: 16, freqGHz: 2.5 }, gpu: null,
    memory: { stdGB: 128, maxGB: 1024, slots: 16, type: 'DDR5' }, storage: { stdTB: 4, maxTB: 40, type: 'NVMe' },
    network: { model: '2×25GbE', nicGbps: 25 }, powerW: 700, price: 39999, warrantyYears: 3, deliveryWeeks: 2,
    tags: ['web'], status: 'active', note: 'E2E新增'
  }, adminToken);
  ok('新增机型成功', r.status === 200);

  r = await req('DELETE', '/api/admin/machines/e2e-test-machine', undefined, adminToken);
  ok('删除机型成功', r.status === 200);

  r = await req('GET', '/api/admin/orders', undefined, adminToken);
  ok('管理端可见全部订单', r.status === 200 && r.json.orders.length >= 2);

  r = await req('GET', '/api/admin/stats', undefined, adminToken);
  ok('运营统计', r.status === 200 && r.json.revenue >= 248, '收入 ¥' + r.json.stats_revenue_placeholder || r.json.revenue);

  console.log('【5】非管理员越权');
  r = await req('GET', '/api/admin/machines', undefined, token);
  ok('普通用户访问管理接口被403', r.status === 403);

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('测试脚本异常:', e); process.exit(1); });
