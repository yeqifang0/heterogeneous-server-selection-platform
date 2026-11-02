// 核心测算引擎：负载画像映射 → 容量换算 → 机型筛选 → 加权评分排序
// 所有系数与权重均来自后台规则表（rules.json），前端不写死任何换算逻辑。

const GB_PER_TB = 1024;

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------- 表单校验（后端二次校验，与前端规则一致） ----------
function validateForm(form) {
  const errors = {};
  const scenarioKeys = ['web', 'database', 'gpu-train', 'render', 'storage', 'edge', 'other'];
  if (!scenarioKeys.includes(form.scenario)) errors.scenario = '请选择业务场景';

  const users = toNum(form.concurrentUsers);
  if (users === null || !Number.isInteger(users)) errors.concurrentUsers = '预估并发用户数必须为整数';
  else if (users < 1 || users > 10000000) errors.concurrentUsers = '预估并发用户数须在 1 ~ 10,000,000 之间';

  const cpuCoresMin = toNum(form.cpuCoresMin);
  if (cpuCoresMin !== null && (!Number.isInteger(cpuCoresMin) || cpuCoresMin < 1)) errors.cpuCoresMin = 'CPU核数下限须为不小于1的整数';
  const cpuCoresMax = toNum(form.cpuCoresMax);
  if (cpuCoresMax !== null && (!Number.isInteger(cpuCoresMax) || cpuCoresMax < 1)) errors.cpuCoresMax = 'CPU核数上限须为不小于1的整数';
  if (cpuCoresMin !== null && cpuCoresMax !== null && cpuCoresMin > cpuCoresMax) errors.cpuCoresMax = 'CPU核数上限不能小于下限';
  const cpuFreqMin = toNum(form.cpuFreqMin);
  if (cpuFreqMin !== null && (cpuFreqMin <= 0 || cpuFreqMin > 10)) errors.cpuFreqMin = 'CPU主频要求须在 0 ~ 10 GHz 之间';

  const gpuCount = toNum(form.gpuCount);
  if (gpuCount !== null && (!Number.isInteger(gpuCount) || gpuCount < 1 || gpuCount > 64)) errors.gpuCount = 'GPU数量须为 1 ~ 64 的整数';

  const mem = toNum(form.memoryGB);
  if (mem === null || mem <= 0) errors.memoryGB = '内存容量必须为大于0的数值';
  else if (mem > 1048576) errors.memoryGB = '内存容量超出可测算范围（最大 1,048,576 GB）';

  const sv = toNum(form.storageValue);
  if (sv === null || sv <= 0) errors.storageValue = '存储容量必须为大于0的数值';
  else if ((form.storageUnit !== 'TB' ? sv : sv * 1024) > 10485760) errors.storageValue = '存储容量超出可测算范围（最大 10,240 TB）';
  if (!['GB', 'TB'].includes(form.storageUnit)) errors.storageUnit = '存储单位须为 GB 或 TB';

  const nic = toNum(form.nicMbps);
  if (nic !== null && (nic < 1 || nic > 400000)) errors.nicMbps = '网络带宽需求须在 1 ~ 400,000 Mbps 之间';

  const bMin = toNum(form.budgetMin);
  const bMax = toNum(form.budgetMax);
  if (bMin === null || bMin <= 0) errors.budgetMin = '预算下限必须为大于0的数值';
  else if (bMin > 1e10) errors.budgetMin = '预算下限超出可测算范围';
  if (bMax === null || bMax <= 0) errors.budgetMax = '预算上限必须为大于0的数值';
  else if (bMax > 1e10) errors.budgetMax = '预算上限超出可测算范围';
  if (bMin !== null && bMax !== null && bMin > bMax) errors.budgetMax = '预算上限不能小于下限';

  if (form.deliveryCycle && !['week', 'month', 'any'].includes(form.deliveryCycle)) errors.deliveryCycle = '交付周期选项无效';

  return { ok: Object.keys(errors).length === 0, errors };
}

// ---------- 步骤1+2：负载画像映射与容量换算 ----------
function computeSizing(form, rules) {
  const sp = rules.scenarioProfiles[form.scenario] || rules.scenarioProfiles.other;
  const sz = rules.sizing;
  const k = form.concurrentUsers / 1000; // 千并发数

  const needCoresByUsers = Math.max(sz.minCores, k * sp.coresPer1kUsers * (1 + sz.headroomRatio));
  const userCoresMin = toNum(form.cpuCoresMin) || 0;
  let recCores = Math.ceil(Math.max(needCoresByUsers, userCoresMin));
  recCores = Math.min(recCores, sz.maxCores);

  const recMemByCores = recCores * sp.memGBPerCore;
  const recMemGB = Math.ceil(Math.max(recMemByCores, toNum(form.memoryGB), sz.minMemGB));

  const gpuReq = form.gpuRequirement || 'none';
  let recGpuCount = 0;
  if (gpuReq !== 'none') {
    const byUsers = Math.ceil(k * sp.gpuPer1kUsers);
    const byUserInput = toNum(form.gpuCount) || 0;
    const floorOne = gpuReq === 'unlimited' ? 0 : 1; // 指定卡型时至少1张
    recGpuCount = Math.max(byUsers, byUserInput, floorOne);
  }

  const storageGBFromUser = form.storageUnit === 'TB' ? toNum(form.storageValue) * GB_PER_TB : toNum(form.storageValue);
  const recStorageGB = Math.ceil(storageGBFromUser * sp.storageMultiplier + sz.systemStorageGB + k * sp.storageGBPer1kUsers);

  const recNicMbps = Math.ceil(Math.max(toNum(form.nicMbps) || 0, k * sp.nicMbpsPer1kUsers, sz.nicFloorMbps));

  const scaleLevel = (rules.scaleLevels || []).find(s => form.concurrentUsers >= s.min && form.concurrentUsers <= s.max);

  return {
    profile: sp.profile,
    scenarioConf: sp,
    recCores, recMemGB, recGpuCount, gpuClassRequired: gpuReq,
    recStorageGB, recNicMbps,
    scaleLevel: scaleLevel ? scaleLevel.label : '中型（1千~1万并发）',
    derivations: [
      { item: '推荐CPU总核数', value: `${recCores} 核`, basis: `每千并发×${sp.coresPer1kUsers}核 ×(1+${Math.round(sz.headroomRatio * 100)}%余量)${userCoresMin ? '，并满足用户核数下限要求' : ''}` },
      { item: '推荐内存容量', value: `${recMemGB} GB`, basis: `${recCores}核 × ${sp.memGBPerCore} GB/核，并取用户内存要求与换算值的较大者` },
      { item: '推荐GPU卡数', value: recGpuCount > 0 ? `${recGpuCount} 张` : '无（本负载画像不需要GPU）', basis: recGpuCount > 0 ? `每千并发×${sp.gpuPer1kUsers}张${toNum(form.gpuCount) ? '，并满足用户GPU数量要求' : ''}` : '负载画像非GPU密集' },
      { item: '推荐存储容量', value: `${recStorageGB} GB（约 ${(recStorageGB / GB_PER_TB).toFixed(1)} TB）`, basis: `用户存储 × ${sp.storageMultiplier}（${profileName(form.scenario)}画像系数）+ 系统盘 ${sz.systemStorageGB} GB + 每千并发×${sp.storageGBPer1kUsers} GB` },
      { item: '推荐网络带宽', value: `≥ ${recNicMbps} Mbps`, basis: `每千并发×${sp.nicMbpsPer1kUsers} Mbps，与用户带宽要求取较大者` }
    ]
  };
}

function profileName(scenario) {
  const map = { web: '通用Web', database: '数据库', 'gpu-train': 'GPU训练', render: '渲染', storage: '存储文件', edge: '边缘接入', other: '其他' };
  return map[scenario] || scenario;
}

// ---------- 步骤3：候选机型筛选（含预算/交付约束的逐级放宽） ----------
function machineTotalCores(m) {
  return m.cpu.count * m.cpu.coresPerCPU;
}

function buildCandidate(m, sizing, form, rules) {
  const totalCores = machineTotalCores(m);
  const needCores = Math.max(sizing.recCores, 0);
  const nodesByCpu = Math.ceil(needCores / totalCores) || 1;
  const nodesByMem = Math.ceil(sizing.recMemGB / m.memory.stdGB) || 1;
  let nodesByGpu = 1;
  if (sizing.recGpuCount > 0) {
    if (!m.gpu) return null;
    nodesByGpu = Math.ceil(sizing.recGpuCount / m.gpu.count);
  }
  const machineStorageMaxGB = m.storage.maxTB * GB_PER_TB;
  if (sizing.recStorageGB > machineStorageMaxGB * rules.sizing.maxNodes) return null; // 最大可扩也无法满足
  // 存储按“最大可扩容量”计算节点数，单机盘容量按需配置（不小于标配）
  const nodesByStorage = Math.max(1, Math.ceil(sizing.recStorageGB / machineStorageMaxGB));
  let nodes = Math.max(nodesByCpu, nodesByMem, nodesByGpu, nodesByStorage);
  nodes = Math.min(nodes, rules.sizing.maxNodes);
  if (nodes >= rules.sizing.maxNodes) return null; // 需要节点数过多，说明机型不适用
  const perNodeStorageTB = Math.min(m.storage.maxTB, Math.max(m.storage.stdTB, Math.ceil(sizing.recStorageGB / GB_PER_TB / nodes * 10) / 10));

  // 用户CPU约束
  const cpuCoresMax = toNum(form.cpuCoresMax);
  if (cpuCoresMax && nodes * totalCores > cpuCoresMax) return null;
  const cpuFreqMin = toNum(form.cpuFreqMin);
  if (cpuFreqMin && m.cpu.freqGHz < cpuFreqMin) return null;

  const cluster = {
    nodes,
    totalCores: nodes * totalCores,
    totalMemGB: nodes * m.memory.stdGB,
    totalGpu: m.gpu ? nodes * m.gpu.count : 0,
    totalGpuFlops: m.gpu ? nodes * m.gpu.count * m.gpu.fp16Tflops : 0,
    perNodeStorageTB,
    totalStorageTB: +(nodes * perNodeStorageTB).toFixed(2),
    totalNicMbps: nodes * m.network.nicGbps * 1000,
    totalPrice: nodes * m.price,
    totalPowerKW: +(nodes * m.powerW / 1000).toFixed(2)
  };
  return { machine: m, cluster };
}

function filterCandidates(machines, sizing, form, rules) {
  const notes = [];
  const gpuClassRequired = sizing.gpuClassRequired;
  let pool = machines.filter(m => m.status !== 'disabled');
  if (gpuClassRequired !== 'none' && sizing.recGpuCount > 0) {
    if (gpuClassRequired !== 'unlimited') {
      pool = pool.filter(m => m.gpu && m.gpu.class === gpuClassRequired);
      notes.push(`按GPU需求筛选${gpuClassLabel(gpuClassRequired)}类机型后剩 ${pool.length} 款。`);
    }
  } else if (gpuClassRequired === 'none') {
    pool = pool.filter(m => !m.gpu);
    notes.push(`GPU需求为“无”，已排除GPU服务器后剩 ${pool.length} 款。`);
  }

  const bMin = toNum(form.budgetMin), bMax = toNum(form.budgetMax);
  const cycle = (rules.options.deliveryCycles || []).find(d => d.value === (form.deliveryCycle || 'any')) || { allowedWeeks: 999 };

  let feasible = [];
  for (const m of pool) {
    const c = buildCandidate(m, sizing, form, rules);
    if (c) feasible.push(c);
  }
  notes.push(`按CPU/内存/GPU/存储性能约束完成集群规模换算，${feasible.length} 款机型可满足容量需求。`);

  // 一级筛选：预算区间内 + 满足交付周期
  let pass = feasible.filter(c => c.cluster.totalPrice >= bMin && c.cluster.totalPrice <= bMax && c.machine.deliveryWeeks <= cycle.allowedWeeks);
  if (pass.length > 0) {
    notes.push(`其中 ${pass.length} 款总价落在预算区间内且满足交付周期（≤${cycle.label}），纳入评分排序。`);
    return { candidates: pass, notes, budgetRelaxed: 'none' };
  }
  // 二级放宽：仅预算区间（不限交付）
  pass = feasible.filter(c => c.cluster.totalPrice >= bMin && c.cluster.totalPrice <= bMax);
  if (pass.length > 0) {
    notes.push('警告：预算区间内无机型满足交付周期要求，已放宽交付约束（建议与供应商确认现货）。');
    return { candidates: pass, notes, budgetRelaxed: 'delivery' };
  }
  // 三级放宽：总价不超预算上限
  pass = feasible.filter(c => c.cluster.totalPrice <= bMax);
  if (pass.length > 0) {
    notes.push('警告：预算区间下限内无满足需求的方案，已放宽为“总价不超过预算上限”，最优方案价格可能低于预算下限属正常（预算下限仅作参考）。');
    return { candidates: pass, notes, budgetRelaxed: 'budgetMin' };
  }
  // 四级放宽：全部可行方案（标记超预算）
  if (feasible.length > 0) {
    notes.push('警告：预算上限内无满足需求的方案，以下按最小超预算幅度排序供参考，建议上调预算或降低规模。');
    feasible.sort((a, b) => a.cluster.totalPrice - b.cluster.totalPrice);
    const capped = feasible.slice(0, 6);
    for (const c of capped) c.overBudget = !!(c.cluster.totalPrice > bMax);
    return { candidates: capped, notes, budgetRelaxed: 'budgetMax' };
  }
  // 五级兜底：容量也无法满足时，不淘汰任何机型，按最大可部署规模给出最接近的参考方案
  notes.push('警告：机型库无可满足该规模的方案，以下为按「最大可部署规模」测算的最接近参考方案，建议分期建设、下调规模或联系厂商定制。');
  let basePool = pool;
  if (sizing.recGpuCount > 0) {
    const gpuInPool = pool.filter(m => m.gpu);
    if (gpuInPool.length) basePool = gpuInPool;
    else {
      const anyGpu = machines.filter(m => m.status !== 'disabled' && m.gpu);
      basePool = anyGpu.length ? anyGpu : machines.filter(m => m.status !== 'disabled');
    }
  }
  const lenient = basePool.map(m => buildCandidateLenient(m, sizing, form, rules));
  for (const c of lenient) c.overBudget = !!(c.cluster.totalPrice > bMax);
  return { candidates: lenient, notes, budgetRelaxed: 'capacity' };
}

function gpuClassLabel(cls) {
  const map = { 'nvidia-dc': 'NVIDIA数据中心卡', 'ascn': '国产AI加速卡', 'nvidia-graphics': '专业图形卡', 'unlimited': '不限' };
  return map[cls] || cls;
}

// 兜底候选：容量无法满足时不淘汰任何机型，按最大可部署规模给出最接近方案
function buildCandidateLenient(m, sizing, form, rules) {
  const totalCores = machineTotalCores(m);
  const machineStorageMaxGB = m.storage.maxTB * GB_PER_TB;
  const nodesByCpu = Math.max(1, Math.ceil(Math.max(sizing.recCores, 0) / totalCores));
  const nodesByMem = Math.max(1, Math.ceil(sizing.recMemGB / m.memory.stdGB));
  let nodesByGpu = 1;
  if (sizing.recGpuCount > 0 && m.gpu) nodesByGpu = Math.ceil(sizing.recGpuCount / m.gpu.count);
  const nodesByStorage = Math.max(1, Math.ceil(sizing.recStorageGB / machineStorageMaxGB));
  const nodes = Math.min(Math.max(nodesByCpu, nodesByMem, nodesByGpu, nodesByStorage, 1), rules.sizing.maxNodes);
  const perNodeStorageTB = Math.min(m.storage.maxTB, Math.max(m.storage.stdTB, Math.ceil(sizing.recStorageGB / GB_PER_TB / nodes * 10) / 10));

  const cluster = {
    nodes,
    totalCores: nodes * totalCores,
    totalMemGB: nodes * m.memory.stdGB,
    totalGpu: m.gpu ? nodes * m.gpu.count : 0,
    totalGpuFlops: m.gpu ? nodes * m.gpu.count * m.gpu.fp16Tflops : 0,
    perNodeStorageTB,
    totalStorageTB: +(nodes * perNodeStorageTB).toFixed(2),
    totalNicMbps: nodes * m.network.nicGbps * 1000,
    totalPrice: nodes * m.price,
    totalPowerKW: +(nodes * m.powerW / 1000).toFixed(2)
  };
  return { machine: m, cluster, capacityShort: true };
}

// ---------- 步骤4：加权评分 ----------
function fitScore(ratio) {
  if (ratio <= 0) return 0;
  if (ratio >= 1) return Math.max(65, 100 - (ratio - 1) * 50);
  return Math.max(0, ratio * 100);
}

function normScores(arr, lo, hi, invert) {
  const min = Math.min(...arr), max = Math.max(...arr);
  return arr.map(v => {
    let t = max === min ? 1 : (v - min) / (max - min);
    if (invert) t = 1 - t;
    return +(lo + t * (hi - lo)).toFixed(1);
  });
}

function scoreCandidates(candidates, sizing, form, rules) {
  const w = rules.weights;
  const values = candidates.map(c => c.cluster.totalPrice / 10000); // 万元
  const caps = candidates.map(c =>
    c.cluster.totalCores * 1.0 +
    c.cluster.totalGpuFlops * 0.02 +
    c.cluster.totalMemGB * 0.05 +
    c.cluster.totalStorageTB * 1.0
  );
  const perfPerWan = caps.map((cap, i) => cap / Math.max(values[i], 0.01));
  const valueScores = normScores(perfPerWan, 55, 100);
  const powerScores = normScores(candidates.map(c => c.cluster.totalPowerKW), 60, 100, true);
  const cycle = (rules.options.deliveryCycles || []).find(d => d.value === (form.deliveryCycle || 'any')) || { allowedWeeks: 999 };

  candidates.forEach((c, i) => {
    const m = c.machine, cl = c.cluster;
    const dims = [];
    dims.push({ key: 'cpu', weight: 0.30, score: fitScore(cl.totalCores / sizing.recCores) });
    dims.push({ key: 'mem', weight: 0.20, score: fitScore(cl.totalMemGB / sizing.recMemGB) });
    if (sizing.recGpuCount > 0) {
      dims.push({ key: 'gpu', weight: 0.25, score: fitScore(cl.totalGpu / sizing.recGpuCount) });
    }
    dims.push({ key: 'storage', weight: 0.15, score: fitScore((cl.totalStorageTB * GB_PER_TB) / sizing.recStorageGB) });
    dims.push({ key: 'nic', weight: 0.10, score: fitScore(cl.totalNicMbps / sizing.recNicMbps) });
    const wsum = dims.reduce((s, d) => s + d.weight, 0);
    const perfScore = +(dims.reduce((s, d) => s + d.weight * d.score, 0) / wsum).toFixed(1);

    let service = 40 + (m.warrantyYears || 3) * 10;
    if (cycle.allowedWeeks >= 999) service += 25;
    else if (m.deliveryWeeks <= cycle.allowedWeeks) service += 30;
    else service += Math.max(0, 30 - (m.deliveryWeeks - cycle.allowedWeeks) * 10);
    const serviceScore = +Math.max(50, Math.min(100, service)).toFixed(1);

    const total = +(
      w.performance * perfScore + w.value * valueScores[i] +
      w.power * powerScores[i] + w.service * serviceScore
    ).toFixed(1);

    c.scores = {
      performance: perfScore, value: valueScores[i], power: powerScores[i], service: serviceScore, total,
      valueIndex: +perfPerWan[i].toFixed(2)
    };
    c.fitRatios = {
      cpu: +(cl.totalCores / sizing.recCores).toFixed(2),
      mem: +(cl.totalMemGB / sizing.recMemGB).toFixed(2),
      gpu: sizing.recGpuCount > 0 ? +(cl.totalGpu / sizing.recGpuCount).toFixed(2) : null,
      storage: +((cl.totalStorageTB * GB_PER_TB) / sizing.recStorageGB).toFixed(2),
      nic: +(cl.totalNicMbps / sizing.recNicMbps).toFixed(2)
    };
  });
  candidates.sort((a, b) => b.scores.total - a.scores.total);
  candidates.forEach(c => { c.reasons = buildReasons(c, sizing, form, rules); });
  return candidates;
}

function buildReasons(c, sizing, form, rules) {
  const m = c.machine, cl = c.cluster, s = c.scores;
  const reasons = [];
  const bMin = toNum(form.budgetMin), bMax = toNum(form.budgetMax);
  const pos = bMax > bMin ? (cl.totalPrice - bMin) / (bMax - bMin) : 0.5;
  const pricePos = pos < 0.34 ? '预算区间低位' : pos < 0.75 ? '预算区间中位' : '预算区间高位';

  reasons.push(`CPU覆盖需求 ${Math.round(c.fitRatios.cpu * 100)}%、内存覆盖 ${Math.round(c.fitRatios.mem * 100)}%、存储覆盖 ${Math.round(c.fitRatios.storage * 100)}%，${cl.nodes} 节点即可满足并发规模测算需求。`);
  if (sizing.recGpuCount > 0 && m.gpu) {
    reasons.push(`${m.gpu.count * cl.nodes} × ${m.gpu.model}（FP16合计 ${cl.totalGpuFlops} TFLOPS），GPU密集负载下算力余量充足。`);
  }
  const w = rules.weights;
  const best = [
    ['性能匹配', s.performance, w.performance], ['性价比', s.value, w.value],
    ['功耗表现', s.power, w.power], ['维保供货', s.service, w.service]
  ].sort((a, b) => b[1] * b[2] - a[1] * a[2])[0];
  reasons.push(`综合适配度 ${s.total} 分（性能${s.performance}/性价比${s.value}/功耗${s.power}/维保${s.service}），${best[0]}表现突出；总价 ￥${cl.totalPrice.toLocaleString('zh-CN')} 处于${pricePos}。`);
  if (c.overBudget) reasons.push('注意：该方案总价超出预算上限，仅作对比参考。');
  if (c.capacityShort) reasons.push('注意：当前需求规模超出机型库容量上限，该方案为按最大可部署规模给出的最接近参考（覆盖率见上），建议分期建设或下调规模。');
  return reasons;
}

// ---------- 步骤5：汇总 ----------
function runCompute(form, machines, rules) {
  const sizing = computeSizing(form, rules);
  const { candidates: scored, notes, budgetRelaxed } = filterCandidates(machines, sizing, form, rules);
  scoreCandidates(scored, sizing, form, rules);

  const top3 = scored.slice(0, 3);
  const alternative = scored[3] || null;
  const valueRanking = [...scored].sort((a, b) => b.scores.valueIndex - a.scores.valueIndex).map((c, i) => ({
    rank: i + 1, name: `${c.machine.brand} ${c.machine.model}`,
    valueIndex: c.scores.valueIndex, totalScore: c.scores.total,
    totalPrice: c.cluster.totalPrice
  }));

  return {
    sizing,
    profileLabel: profileLabelOf(rules, sizing.profile),
    candidates: scored,
    top3, alternative,
    filterNotes: notes,
    budgetRelaxed,
    valueRanking,
    stats: { machineTotal: machines.length, feasible: scored.length },
    rulesVersion: rules.version,
    computedAt: new Date().toISOString()
  };
}

function profileLabelOf(rules, profile) {
  const p = (rules.options.profiles || []).find(x => x.value === profile);
  return p ? p.label : profile;
}

module.exports = { validateForm, runCompute, toNum };
