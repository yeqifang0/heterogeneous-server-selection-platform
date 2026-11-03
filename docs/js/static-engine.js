// 静态演示版引擎：将后端测算/报告/订单/认证逻辑移植到浏览器端运行（GitHub Pages 免服务器演示）
// 数据来源：data/machines.json + data/rules.json（管理员修改保存在浏览器 localStorage 覆盖层）
(function () {
  'use strict';

  // ==========================================================
  // 一、测算引擎移植（与 server/src/calc.js 保持一致）
  // ==========================================================
  const GB_PER_TB = 1024;

  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

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

  function computeSizing(form, rules) {
    const sp = rules.scenarioProfiles[form.scenario] || rules.scenarioProfiles.other;
    const sz = rules.sizing;
    const k = form.concurrentUsers / 1000;

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
      const floorOne = gpuReq === 'unlimited' ? 0 : 1;
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
    if (sizing.recStorageGB > machineStorageMaxGB * rules.sizing.maxNodes) return null;
    const nodesByStorage = Math.max(1, Math.ceil(sizing.recStorageGB / machineStorageMaxGB));
    let nodes = Math.max(nodesByCpu, nodesByMem, nodesByGpu, nodesByStorage);
    nodes = Math.min(nodes, rules.sizing.maxNodes);
    if (nodes >= rules.sizing.maxNodes) return null;
    const perNodeStorageTB = Math.min(m.storage.maxTB, Math.max(m.storage.stdTB, Math.ceil(sizing.recStorageGB / GB_PER_TB / nodes * 10) / 10));

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

    let pass = feasible.filter(c => c.cluster.totalPrice >= bMin && c.cluster.totalPrice <= bMax && c.machine.deliveryWeeks <= cycle.allowedWeeks);
    if (pass.length > 0) {
      notes.push(`其中 ${pass.length} 款总价落在预算区间内且满足交付周期（≤${cycle.label}），纳入评分排序。`);
      return { candidates: pass, notes, budgetRelaxed: 'none' };
    }
    pass = feasible.filter(c => c.cluster.totalPrice >= bMin && c.cluster.totalPrice <= bMax);
    if (pass.length > 0) {
      notes.push('警告：预算区间内无机型满足交付周期要求，已放宽交付约束（建议与供应商确认现货）。');
      return { candidates: pass, notes, budgetRelaxed: 'delivery' };
    }
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
    const values = candidates.map(c => c.cluster.totalPrice / 10000);
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

  function profileLabelOf(rules, profile) {
    const p = (rules.options.profiles || []).find(x => x.value === profile);
    return p ? p.label : profile;
  }

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

  // ==========================================================
  // 二、报告组装移植（与 server/src/report.js 保持一致）
  // ==========================================================
  const REPORT_VERSION = 'V1.0';

  function fmtMoney(n) { return '￥' + Number(n).toLocaleString('zh-CN'); }

  function scenarioLabel(form, rules) {
    const s = (rules.options.scenarios || []).find(x => x.value === form.scenario);
    return s ? s.label : form.scenario;
  }
  function gpuReqLabel(form, rules) {
    const g = (rules.options.gpuRequirements || []).find(x => x.value === (form.gpuRequirement || 'none'));
    return g ? g.label : '无';
  }
  function cycleLabel(form, rules) {
    const d = (rules.options.deliveryCycles || []).find(x => x.value === (form.deliveryCycle || 'any'));
    return d ? d.label : '不限';
  }
  function cpuDemandText(form) {
    const parts = [];
    if (form.cpuCoresMin) parts.push(`核数≥${form.cpuCoresMin}`);
    if (form.cpuCoresMax) parts.push(`核数≤${form.cpuCoresMax}`);
    if (form.cpuFreqMin) parts.push(`主频≥${form.cpuFreqMin}GHz`);
    return parts.length ? parts.join('，') : '未指定';
  }

  function planRow(c, rank, tag) {
    const m = c.machine, cl = c.cluster;
    return {
      rank, tag: tag || '',
      name: `${m.brand} ${m.model}`,
      brand: m.brand, model: m.model, category: m.category,
      cpu: `${m.cpu.count}×${m.cpu.model}（${cl.nodes > 1 ? '单机' : ''}${m.cpu.count * m.cpu.coresPerCPU}核@${m.cpu.freqGHz}GHz）${cl.nodes > 1 ? ` ×${cl.nodes}节点` : ''}`,
      gpu: m.gpu ? `${m.gpu.count}×${m.gpu.model} ${m.gpu.vramGB}GB${cl.nodes > 1 ? `（合计${cl.totalGpu}张）` : ''}` : '无',
      memory: `单机${m.memory.stdGB}GB ${m.memory.type}（最大可扩${m.memory.maxGB}GB）`,
      storage: `单机配置${cl.perNodeStorageTB}TB ${m.storage.type}，集群合计${cl.totalStorageTB}TB（单机最大可扩${m.storage.maxTB}TB）`,
      network: m.network.model,
      unitPrice: m.price, nodes: cl.nodes, totalPrice: cl.totalPrice,
      powerKW: cl.totalPowerKW, warranty: `${m.warrantyYears}年`, delivery: `${m.deliveryWeeks}周`,
      score: c.scores.total,
      scores: c.scores, reasons: c.reasons, overBudget: !!c.overBudget,
      cluster: cl, machineId: m.id
    };
  }

  function machineMaxMem(result, plan) {
    const c = result.candidates.find(x => x.machine.id === plan.machineId);
    return c ? c.machine.memory.maxGB : '-';
  }
  function machineMaxStorage(result, plan) {
    const c = result.candidates.find(x => x.machine.id === plan.machineId);
    return c ? c.machine.storage.maxTB : '-';
  }

  function buildAdvice(top3, result, rules) {
    if (!top3.length) return '当前需求条件下暂无满足约束的候选方案，建议调整预算区间或并发规模后重新测算。';
    const best = top3[0];
    const advice = [];
    advice.push(`首选「${best.name}」：适配度 ${best.score} 分，${best.nodes} 台部署总价 ${fmtMoney(best.totalPrice)}，落在预算区间内，建议作为主选方案启动询价。`);
    if (top3[1]) advice.push(`若追求更高性价比或供货弹性，可考察推荐2「${top3[1].name}」（适配度 ${top3[1].score} 分，总价 ${fmtMoney(top3[1].totalPrice)}），两者价差 ${fmtMoney(Math.abs(best.totalPrice - top3[1].totalPrice))}，可按渠道折扣最终比价。`);
    if (result.alternative) advice.push(`备选方案「${result.alternative.machine.brand} ${result.alternative.machine.model}」用于供应商独家锁定或断供时的替代路线，建议保留询价记录。`);
    advice.push('建议采购前向厂商/代理商索取正式报价与配置单，核对GPU型号显存版本、硬盘数量与接口卡明细，并以POC测试验证关键业务指标。');
    return advice;
  }

  function buildReport(task, rules) {
    const { form, result } = task;
    const sizing = result.sizing;
    const top3 = result.top3.map((c, i) => planRow(c, i + 1, i === 0 ? '首选推荐' : `推荐${i + 1}`));
    const alt = result.alternative ? [planRow(result.alternative, 4, '备选方案')] : [];

    const compareCols = [...top3, ...alt];
    const matrixRows = [
      { dim: '品牌型号', vals: compareCols.map(c => c.name) },
      { dim: 'CPU总核数', vals: compareCols.map(c => `${c.cluster.totalCores} 核`) },
      { dim: 'GPU算力(FP16)', vals: compareCols.map(c => c.cluster.totalGpuFlops > 0 ? `${c.cluster.totalGpuFlops} TFLOPS（${c.cluster.totalGpu}张）` : '无') },
      { dim: '内存容量', vals: compareCols.map(c => `${c.cluster.totalMemGB} GB`) },
      { dim: '存储容量', vals: compareCols.map(c => `${c.cluster.totalStorageTB} TB`) },
      { dim: '网络配置', vals: compareCols.map(c => c.network) },
      { dim: '整机功耗', vals: compareCols.map(c => `${c.cluster.totalPowerKW} kW`) },
      { dim: '维保/供货', vals: compareCols.map(c => `${c.warranty}维保 / ${c.delivery}供货`) },
      { dim: '部署节点数', vals: compareCols.map(c => `${c.nodes} 台`) },
      { dim: '总价', vals: compareCols.map(c => fmtMoney(c.totalPrice)) },
      { dim: '适配度得分', vals: compareCols.map(c => `${c.score}`) }
    ];

    const risks = [];
    const best = top3[0];
    if (best) {
      risks.push({ type: '性能余量', text: `本次测算已按 ${(Math.round(rules.sizing.headroomRatio * 100))}% 性能余量放大容量需求；首选方案CPU实际覆盖率为 ${Math.round((best.cluster.totalCores / sizing.recCores) * 100)}%，业务高峰期仍有弹性空间。若预期业务年增长超过50%，建议直接按下一档核数规划。` });
      risks.push({ type: '扩容建议', text: `首选方案单机内存最大可扩至 ${best.machineId ? machineMaxMem(result, best) : '-'} GB，存储最大可扩至 ${machineMaxStorage(result, best)} TB；建议首期按测算值采购、预留插槽与盘位，二期按业务观测数据滚动扩容。` });
      risks.push({ type: '功耗与机房', text: `首选方案整机功耗约 ${best.cluster.totalPowerKW} kW（含PUE${rules.powerPrice.pue}后约 ${(best.cluster.totalPowerKW * rules.powerPrice.pue).toFixed(1)} kW），年电费估算上限约 ${fmtMoney(Math.round(best.cluster.totalPowerKW * rules.powerPrice.pue * 24 * 365 * rules.powerPrice.electricityPricePerKwh))}；请提前核实机柜供电（建议单路冗余）与制冷能力。` });
    }
    if (result.budgetRelaxed === 'delivery') risks.push({ type: '供货风险', text: '预算区间内机型的标准供货周期不满足交付要求，已放宽交付约束。建议下单前与供应商书面确认现货或加急排产，并在合同中约定逾期条款。' });
    if (result.budgetRelaxed === 'budgetMax') risks.push({ type: '预算风险', text: '当前预算上限内无完全满足需求的方案，报告列出的方案总价超出预算，建议上调预算、降低并发规模预期或分期建设。' });
    if (result.budgetRelaxed === 'capacity') risks.push({ type: '容量风险', text: '当前需求规模超出机型库单方案可交付的容量上限（含最大集群节点数约束），本报告方案为按最大可部署规模给出的最接近参考，存在算力/容量缺口，建议分期建设、下调并发规模预期或联系厂商定制配置。' });
    if (form.gpuRequirement === 'none' && ['gpu-train', 'render'].includes(form.scenario)) {
      risks.push({ type: '需求冲突', text: '所选业务场景属于GPU密集型负载，但GPU需求选择“无”，已按无GPU方案测算。此类负载若无GPU支撑，渲染/训练时延将显著上升，请复核需求。' });
    }
    risks.push({ type: '合规边界', text: '本平台仅输出配置选型与测算建议，不提供现场部署、上架布线、整机安装调试等服务；最终采购决策由用户自行判断。' });

    const chartItems = compareCols.map(c => ({ name: c.name.length > 14 ? c.name.slice(0, 13) + '…' : c.name, score: c.score, tag: c.tag }));

    return {
      reportVersion: REPORT_VERSION,
      taskId: task.id,
      generatedAt: task.createdAt,
      weights: rules.weights,
      title: '异构服务器选型配置与算力匹配测算报告',
      ch1: {
        title: '一、需求摘要',
        rows: [
          ['业务场景', scenarioLabel(form, rules)],
          ['预估并发用户数', `${Number(form.concurrentUsers).toLocaleString('zh-CN')} 人`],
          ['业务负载描述', form.workloadDesc || '未填写'],
          ['CPU需求', cpuDemandText(form)],
          ['GPU需求', `${gpuReqLabel(form, rules)}${form.gpuCount ? `（数量≥${form.gpuCount}张）` : ''}`],
          ['内存容量要求', `${form.memoryGB} GB`],
          ['存储容量要求', `${form.storageValue} ${form.storageUnit}`],
          ['网络带宽需求', form.nicMbps ? `${form.nicMbps} Mbps` : '未填写'],
          ['预算区间', `${fmtMoney(form.budgetMin)} ~ ${fmtMoney(form.budgetMax)}`],
          ['交付周期要求', cycleLabel(form, rules)],
          ['备注', form.remark || '未填写']
        ]
      },
      ch2: {
        title: '二、负载画像分析',
        profile: result.profileLabel,
        scaleLevel: sizing.scaleLevel,
        intro: `业务场景「${scenarioLabel(form, rules)}」映射为${result.profileLabel}负载画像，并发规模为${sizing.scaleLevel}。基于平台规则表系数并计入性能余量后，容量需求换算如下：`,
        derivations: sizing.derivations,
        notes: result.filterNotes
      },
      ch3: {
        title: '三、推荐配置方案',
        plans: top3,
        alternative: alt,
        intro: `在机型参数库 ${result.stats.machineTotal} 款机型中，${result.stats.feasible} 款通过预算与性能约束筛选。按加权评分（性能匹配${Math.round(rules.weights.performance * 100)}%、性价比${Math.round(rules.weights.value * 100)}%、功耗${Math.round(rules.weights.power * 100)}%、维保供货${Math.round(rules.weights.service * 100)}%）排序，推荐方案如下：`
      },
      ch4: { title: '四、多机型横向对比矩阵', columns: compareCols.map(c => c.tag), rows: matrixRows, names: compareCols.map(c => c.name) },
      ch5: {
        title: '五、性价比排序与选型建议',
        ranking: result.valueRanking.map(r => ({ ...r, totalPriceText: fmtMoney(r.totalPrice) })),
        advice: buildAdvice(top3, result, rules)
      },
      ch6: { title: '六、风险与注意事项', risks },
      appendix: {
        title: '附：参数假设与免责声明',
        assumptions: rules.reportTemplate.assumptions,
        disclaimer: rules.reportTemplate.disclaimer,
        weightsUsed: `性能匹配 ${rules.weights.performance} / 性价比 ${rules.weights.value} / 功耗 ${rules.weights.power} / 维保供货 ${rules.weights.service}`,
        rulesVersion: rules.version
      },
      chart: { title: '候选方案适配度得分对比', items: chartItems }
    };
  }

  // ==========================================================
  // 三、静态数据层：JSON 数据 + localStorage 持久化（演示环境）
  // ==========================================================
  const LS_KEYS = {
    tasks: 'ssp_static_tasks', orders: 'ssp_static_orders', users: 'ssp_static_users',
    session: 'ssp_static_session', machines: 'ssp_static_machines', rules: 'ssp_static_rules'
  };

  // 存储统一走 api.js 的容错层（内嵌浏览器禁用 localStorage 时自动降级为内存存储）
  function store() { return window.SSPStorage.local; }

  function lsGet(key, fallback) {
    try { const v = JSON.parse(store().getItem(key)); return v === null || v === undefined ? fallback : v; }
    catch (e) { return fallback; }
  }
  function lsSet(key, val) { try { store().setItem(key, JSON.stringify(val)); } catch (e) { /* 降级为内存存储 */ } }

  const ADMIN_USER = { id: 'u-admin', username: 'admin', role: 'admin', displayName: '平台管理员', createdAt: '2026-11-01T00:00:00.000Z', password: 'Admin@123' };

  let _rulesCache = null, _machinesCache = null;

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new StaticError('静态数据加载失败（' + url + '，HTTP ' + res.status + '）');
    return res.json();
  }

  async function getRules() {
    if (_rulesCache) return _rulesCache;
    const overlay = lsGet(LS_KEYS.rules, null);
    if (overlay) { _rulesCache = overlay; return overlay; }
    _rulesCache = await fetchJson('data/rules.json');
    return _rulesCache;
  }

  async function getMachines() {
    if (_machinesCache) return _machinesCache;
    const overlay = lsGet(LS_KEYS.machines, null);
    if (overlay && Array.isArray(overlay.machines)) { _machinesCache = overlay.machines; return overlay.machines; }
    const db = await fetchJson('data/machines.json');
    _machinesCache = db.machines || [];
    return _machinesCache;
  }

  function getTasks() { return lsGet(LS_KEYS.tasks, { tasks: [] }).tasks; }
  function saveTasks(tasks) {
    if (tasks.length > 500) tasks = tasks.slice(-500);
    lsSet(LS_KEYS.tasks, { tasks });
  }
  function findTask(id) { return getTasks().find(t => t.id === id) || null; }

  function getOrders() { return lsGet(LS_KEYS.orders, { orders: [] }).orders; }
  function saveOrders(orders) { lsSet(LS_KEYS.orders, { orders }); }

  function getUsers() { return lsGet(LS_KEYS.users, { users: [] }).users; }
  function currentUser() { const s = lsGet(LS_KEYS.session, null); return s ? s.user : null; }
  function currentToken() { const s = lsGet(LS_KEYS.session, null); return s ? s.token : null; }
  function randHex(n) { let s = ''; while (s.length < n) s += Math.random().toString(16).slice(2); return s.slice(0, n); }

  function StaticError(message, fields) {
    const e = new Error(message);
    e.fields = fields || null;
    return e;
  }

  const STAGES = [
    { name: '参数校验与回显', pct: 15 },
    { name: '负载画像映射', pct: 35 },
    { name: '容量换算（CPU/内存/GPU/存储/带宽）', pct: 55 },
    { name: '机型参数库匹配筛选', pct: 75 },
    { name: '四维加权评分排序', pct: 90 },
    { name: '报告生成', pct: 100 }
  ];

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

  function requirePaidTask(taskId, products) {
    const task = findTask(taskId);
    if (!task) throw StaticError('测算任务不存在');
    const orders = getOrders().filter(o => o.taskId === taskId && o.status === 'paid' && products.includes(o.productId));
    if (!orders.length) throw StaticError('该内容需付费解锁后查看');
    return task;
  }

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

  // ==========================================================
  // 四、接口路由分发（覆盖 ssp.api，签名与后端一致）
  // ==========================================================
  async function handle(method, path, body) {
    // ---- bootstrap ----
    if (method === 'GET' && path === '/api/bootstrap') {
      const rules = await getRules();
      return {
        options: rules.options,
        pricing: rules.pricing,
        weights: rules.weights,
        reportVersion: REPORT_VERSION,
        platform: '异构服务器选型配置与算力匹配测算平台',
        version: 'V1.0'
      };
    }

    // ---- 认证（演示环境：账号保存在本浏览器） ----
    if (method === 'POST' && path === '/api/auth/register') {
      const { username, password, displayName } = body || {};
      if (!username || !/^[a-zA-Z0-9_\u4e00-\u9fa5]{3,20}$/.test(username)) throw StaticError('用户名须为3~20位字母、数字、下划线或中文');
      if (!password || String(password).length < 6) throw StaticError('密码长度至少6位');
      const users = getUsers();
      if (username === 'admin' || users.some(u => u.username === username)) throw StaticError('该用户名已被注册');
      const user = { id: 'u-' + randHex(16), username, role: 'user', displayName: displayName || username, password: String(password), createdAt: new Date().toISOString() };
      users.push(user); lsSet(LS_KEYS.users, { users });
      const pub = { id: user.id, username: user.username, role: user.role, displayName: user.displayName, createdAt: user.createdAt };
      lsSet(LS_KEYS.session, { token: 'st-' + randHex(24), user: pub });
      return { token: currentToken(), user: pub };
    }
    if (method === 'POST' && path === '/api/auth/login') {
      const { username, password } = body || {};
      let user = null;
      if (username === ADMIN_USER.username && password === ADMIN_USER.password) user = ADMIN_USER;
      else user = getUsers().find(u => u.username === username && u.password === String(password)) || null;
      if (!user) throw StaticError('用户名或密码错误');
      const pub = { id: user.id, username: user.username, role: user.role, displayName: user.displayName, createdAt: user.createdAt };
      lsSet(LS_KEYS.session, { token: 'st-' + randHex(24), user: pub });
      return { token: currentToken(), user: pub };
    }
    if (method === 'POST' && path === '/api/auth/logout') {
      try { store().removeItem(LS_KEYS.session); } catch (e) { /* ignore */ }
      return { ok: true };
    }
    if (method === 'GET' && path === '/api/auth/me') {
      return { user: currentUser() };
    }

    // ---- 测算任务 ----
    if (method === 'POST' && path === '/api/tasks') {
      const form = body || {};
      const v = validateForm(form);
      if (!v.ok) throw StaticError('表单校验未通过', v.errors);
      const rules = await getRules();
      const machines = await getMachines();
      let result;
      try { result = runCompute(form, machines, rules); }
      catch (e) { throw StaticError('测算引擎执行失败：' + e.message); }
      if (!result.candidates.length) throw StaticError('机型库中暂无满足该需求的候选方案，请调整GPU类别/预算/规模后重试');
      const me = currentUser();
      const task = {
        id: 'T' + Date.now().toString(36).toUpperCase() + randHex(3).toUpperCase(),
        form, result, stages: STAGES,
        creatorUserId: me ? me.id : null,
        createdAt: new Date().toISOString()
      };
      const tasks = getTasks(); tasks.push(task); saveTasks(tasks);
      return { taskId: task.id, stages: STAGES };
    }

    let m;
    if (method === 'GET' && (m = path.match(/^\/api\/tasks\/([^/]+)$/))) {
      const task = findTask(m[1]);
      if (!task) throw StaticError('测算任务不存在');
      return { taskId: task.id, createdAt: task.createdAt, stages: task.stages, form: task.form };
    }
    if (method === 'GET' && (m = path.match(/^\/api\/tasks\/([^/]+)\/summary$/))) {
      const task = findTask(m[1]);
      if (!task) throw StaticError('测算任务不存在');
      const r = task.result;
      return {
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
        bestScoreHint: r.top3.length ? Math.floor(r.top3[0].scores.total / 10) * 10 : null
      };
    }
    if (method === 'GET' && (m = path.match(/^\/api\/tasks\/([^/]+)\/entitlement$/))) {
      const task = findTask(m[1]);
      if (!task) throw StaticError('测算任务不存在');
      const orders = getOrders().filter(o => o.taskId === task.id && o.status === 'paid');
      return {
        calcUnlocked: orders.some(o => ['quick', 'report'].includes(o.productId)),
        reportUnlocked: orders.some(o => o.productId === 'report')
      };
    }
    if (method === 'GET' && (m = path.match(/^\/api\/tasks\/([^/]+)\/calc$/))) {
      const task = requirePaidTask(m[1], ['quick', 'report']);
      const r = task.result;
      const rules = await getRules();
      return {
        taskId: task.id,
        sizing: (() => { const s = { ...r.sizing }; delete s.scenarioConf; return s; })(),
        profileLabel: r.profileLabel,
        top3: r.top3.map((c, i) => publicCandidate(c, i + 1)),
        alternative: r.alternative ? publicCandidate(r.alternative, 4) : null,
        filterNotes: r.filterNotes,
        valueRanking: r.valueRanking,
        weights: r.weights || rules.weights,
        chart: { items: [...r.top3, r.alternative].filter(Boolean).map(c => ({ name: `${c.machine.brand} ${c.machine.model}`, score: c.scores.total })) },
        stats: r.stats, computedAt: r.computedAt
      };
    }
    if (method === 'GET' && (m = path.match(/^\/api\/tasks\/([^/]+)\/report$/))) {
      const task = requirePaidTask(m[1], ['report']);
      const rules = await getRules();
      const report = buildReport(task, rules);
      const orders = getOrders().filter(o => o.taskId === task.id && o.productId === 'report' && o.status === 'paid');
      return { ...report, orderNo: orders.length ? orders[orders.length - 1].orderNo : null };
    }

    // ---- 订单与支付（模拟支付） ----
    if (method === 'POST' && path === '/api/orders') {
      const me = currentUser();
      if (!me) throw StaticError('请先登录账号');
      const { taskId, productId } = body || {};
      if (!taskId || !findTask(taskId)) throw StaticError('测算任务不存在');
      const pricing = (await getRules()).pricing;
      const product = pricing[productId];
      if (!product) throw StaticError('产品类型无效');
      const orders = getOrders();
      if (orders.some(o => o.taskId === taskId && o.productId === productId && o.status === 'paid')) {
        throw StaticError('该测算已购买此产品，无需重复支付');
      }
      const now = new Date();
      const order = {
        id: 'O' + randHex(16),
        orderNo: 'SO' + now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + String(Math.floor(Math.random() * 900000) + 100000),
        userId: me.id, username: me.username,
        taskId, productId, productName: product.name,
        amount: product.price,
        status: 'pending', createdAt: now.toISOString(), paidAt: null,
        payMethod: null, reportVersion: REPORT_VERSION
      };
      orders.push(order); saveOrders(orders);
      return { order };
    }
    if (method === 'POST' && (m = path.match(/^\/api\/orders\/([^/]+)\/pay$/))) {
      const me = currentUser();
      if (!me) throw StaticError('请先登录账号');
      const orders = getOrders();
      const order = orders.find(o => o.id === m[1] || o.orderNo === m[1]);
      if (!order) throw StaticError('订单不存在');
      if (order.userId !== me.id) throw StaticError('无权操作他人订单');
      if (order.status !== 'paid') {
        order.status = 'paid';
        order.paidAt = new Date().toISOString();
        order.payMethod = '微信扫码支付';
        saveOrders(orders);
      }
      return { order };
    }
    if (method === 'GET' && path === '/api/orders') {
      const me = currentUser();
      if (!me) throw StaticError('请先登录账号');
      const orders = getOrders().filter(o => o.userId === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { orders };
    }
    if (method === 'GET' && (m = path.match(/^\/api\/orders\/([^/]+)$/))) {
      const me = currentUser();
      if (!me) throw StaticError('请先登录账号');
      const order = getOrders().find(o => o.id === m[1] || o.orderNo === m[1]);
      if (!order) throw StaticError('订单不存在');
      if (order.userId !== me.id && me.role !== 'admin') throw StaticError('无权查看他人订单');
      return { order };
    }

    // ---- 管理后台 ----
    if (method === 'GET' && path === '/api/admin/machines') {
      return { machines: await getMachines() };
    }
    if (method === 'POST' && path === '/api/admin/machines') {
      const mach = body || {};
      const errors = validateMachine(mach);
      if (errors.length) throw StaticError(errors.join('；'));
      const list = await getMachines();
      if (list.some(x => x.id === mach.id)) throw StaticError('机型ID已存在');
      list.push(mach);
      lsSet(LS_KEYS.machines, { machines: list }); _machinesCache = list;
      return { ok: true, machines: list };
    }
    if (method === 'PUT' && (m = path.match(/^\/api\/admin\/machines\/([^/]+)$/))) {
      const mach = body || {};
      const errors = validateMachine(mach);
      if (errors.length) throw StaticError(errors.join('；'));
      const list = await getMachines();
      const idx = list.findIndex(x => x.id === m[1]);
      if (idx < 0) throw StaticError('机型不存在');
      if (mach.id !== m[1] && list.some(x => x.id === mach.id)) throw StaticError('新机型ID与其他机型冲突');
      list[idx] = mach;
      lsSet(LS_KEYS.machines, { machines: list }); _machinesCache = list;
      return { ok: true, machines: list };
    }
    if (method === 'DELETE' && (m = path.match(/^\/api\/admin\/machines\/([^/]+)$/))) {
      const list = await getMachines();
      const next = list.filter(x => x.id !== m[1]);
      if (next.length === list.length) throw StaticError('机型不存在');
      lsSet(LS_KEYS.machines, { machines: next }); _machinesCache = next;
      return { ok: true, machines: next };
    }
    if (method === 'GET' && path === '/api/admin/rules') {
      return { rules: await getRules() };
    }
    if (method === 'PUT' && path === '/api/admin/rules') {
      const rules = body && body.rules;
      if (!rules || !rules.scenarioProfiles || !rules.weights || !rules.sizing || !rules.pricing || !rules.reportTemplate) {
        throw StaticError('规则表结构不完整（须包含 scenarioProfiles/weights/sizing/pricing/reportTemplate）');
      }
      const w = rules.weights;
      const wsum = +(w.performance + w.value + w.power + w.service).toFixed(4);
      if (wsum !== 1) throw StaticError(`评分权重之和必须等于1，当前为 ${wsum}`);
      for (const sp of Object.values(rules.scenarioProfiles)) {
        if (!(sp.coresPer1kUsers >= 0) || !(sp.memGBPerCore > 0) || !(sp.storageMultiplier > 0)) {
          throw StaticError('场景系数无效：每千并发核数、每核内存、存储系数须大于0');
        }
      }
      for (const p of Object.values(rules.pricing)) {
        if (!(p.price >= 0)) throw StaticError('产品价格必须不小于0');
      }
      rules.updatedAt = new Date().toISOString();
      lsSet(LS_KEYS.rules, rules); _rulesCache = rules;
      return { ok: true, rules };
    }
    if (method === 'GET' && path === '/api/admin/orders') {
      const orders = getOrders().slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { orders };
    }
    if (method === 'GET' && path === '/api/admin/stats') {
      const orders = getOrders();
      const tasks = getTasks();
      const machines = await getMachines();
      return {
        machineCount: machines.length,
        taskCount: tasks.length,
        orderCount: orders.length,
        paidCount: orders.filter(o => o.status === 'paid').length,
        revenue: orders.filter(o => o.status === 'paid').reduce((s, o) => s + o.amount, 0)
      };
    }

    throw StaticError('接口不存在：' + method + ' ' + path);
  }

  // ==========================================================
  // 五、接管 ssp.api / ssp.apiDownload
  // ==========================================================
  const realApi = window.ssp ? window.ssp.api : null;
  if (!realApi) throw new Error('static-engine.js 需在 api.js 之后加载');

  window.ssp.api = async function (path, opts = {}) {
    const method = (opts.method || (opts.body !== undefined ? 'POST' : 'GET')).toUpperCase();
    return handle(method, path, opts.body);
  };

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // 静态版 PDF 导出：跳转报告页后调用系统打印（另存为 PDF）
  window.ssp.apiDownload = async function (path) {
    const m = path.match(/^\/api\/tasks\/([^/]+)\/report\.pdf$/);
    if (!m) throw StaticError('下载失败：未知资源');
    const taskId = m[1];
    requirePaidTask(taskId, ['report']);
    if (window.sspUI && window.sspUI.toast) window.sspUI.toast('在线演示版：请在打印对话框选择“存储为 PDF”导出报告', 'ok');
    location.hash = '#/report/' + taskId;
    for (let i = 0; i < 40; i++) {
      if (document.querySelector('.report-doc')) break;
      await sleep(100);
    }
    await sleep(600); // 等待图表绘制
    window.print();
  };

  window.ssp.isStaticDemo = true;
})();
