// 报告数据组装：按第六节报告结构生成六章 + 附录的 JSON（在线渲染与 PDF 共用）
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

function buildReport(task, rules) {
  const { form, result } = task;
  const sizing = result.sizing;
  const top3 = result.top3.map((c, i) => planRow(c, i + 1, i === 0 ? '首选推荐' : `推荐${i + 1}`));
  const alt = result.alternative ? [planRow(result.alternative, 4, '备选方案')] : [];

  // 第四章：横向对比矩阵
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

  // 第六章：风险与注意事项
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

module.exports = { buildReport, REPORT_VERSION };
