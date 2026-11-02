// 管理后台：机型参数库维护 / 规则表配置 / 订单管理 / 运营概览
(function () {
  const { esc, fmtMoney, fmtTime, toast, modal, closeModal, confirmDialog } = window.sspUI;

  function render(v) {
    v.innerHTML = `
      <div class="page-head">
        <div><div class="page-title">管理后台</div>
        <div class="page-sub">机型参数库、换算系数、评分权重、收费标准与报告模板均在此维护，前端不写死</div></div>
      </div>
      <div class="tabs" id="admin-tabs">
        <div class="tab active" data-tab="overview">运营概览</div>
        <div class="tab" data-tab="machines">机型参数库</div>
        <div class="tab" data-tab="rules">规则与计费配置</div>
        <div class="tab" data-tab="orders">订单管理</div>
      </div>
      <div id="admin-body"></div>`;
    const body = v.querySelector('#admin-body');
    v.querySelectorAll('.tab').forEach(t => {
      t.onclick = () => {
        v.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        switchTab(body, t.dataset.tab);
      };
    });
    switchTab(body, 'overview');
  }

  function switchTab(body, tab) {
    body.innerHTML = `<div class="loading"><span class="spin"></span>载入中…</div>`;
    ({ overview: loadOverview, machines: loadMachines, rules: loadRules, orders: loadOrders }[tab])(body).catch(e => {
      body.innerHTML = `<div class="empty">${esc(e.message || '加载失败')}</div>`;
    });
  }

  // ---------- 概览 ----------
  async function loadOverview(body) {
    const s = await ssp.api('/api/admin/stats');
    body.innerHTML = `
      <div class="stat-cards">
        <div class="stat-card"><b>${s.machineCount}</b><span>机型库机型数</span></div>
        <div class="stat-card"><b>${s.taskCount}</b><span>累计测算任务</span></div>
        <div class="stat-card"><b>${s.orderCount}</b><span>累计订单</span></div>
        <div class="stat-card"><b>${s.paidCount}</b><span>已支付订单</span></div>
        <div class="stat-card"><b>${fmtMoney(s.revenue)}</b><span>累计收入（模拟）</span></div>
      </div>
      <div class="card"><p style="font-size:13.5px;color:var(--gray)">提示：新增/修改机型后立即对测算生效；调整换算系数或评分权重只影响之后的测算任务，历史报告保持生成时的规则快照。</p></div>`;
  }

  // ---------- 机型参数库 ----------
  let machinesCache = [];
  async function loadMachines(body) {
    const { machines } = await ssp.api('/api/admin/machines');
    machinesCache = machines;
    const gpuClassLabel = { 'nvidia-dc': 'NVIDIA数据中心卡', 'ascn': '国产AI卡', 'nvidia-graphics': '图形卡' };
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <span style="font-size:14px;color:var(--gray)">共 ${machines.length} 款机型（${machines.filter(m => m.status !== 'disabled').length} 款启用中）</span>
        <button class="btn btn-primary" id="m-add">＋ 新增机型</button>
      </div>
      <div class="table-wrap"><table class="tbl" style="min-width:1080px">
        <thead><tr><th>ID</th><th>品牌 / 型号</th><th>类别</th><th>CPU</th><th>GPU</th><th>内存(GB)</th><th>存储(TB)</th><th class="num">单价</th><th class="num">功耗</th><th>维保/供货</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${machines.map(m => `
          <tr>
            <td style="font-size:12px;color:var(--gray)">${esc(m.id)}</td>
            <td><b>${esc(m.brand)}</b> ${esc(m.model)}</td>
            <td>${esc(m.category)}</td>
            <td>${m.cpu.count}×${esc(m.cpu.model)}<br><span style="color:var(--gray);font-size:12px">${m.cpu.count * m.cpu.coresPerCPU}核@${m.cpu.freqGHz}GHz</span></td>
            <td>${m.gpu ? `${m.gpu.count}×${esc(m.gpu.model)}<br><span style="color:var(--gray);font-size:12px">${gpuClassLabel[m.gpu.class] || m.gpu.class}</span>` : '—'}</td>
            <td>${m.memory.stdGB} / ${m.memory.maxGB}</td>
            <td>${m.storage.stdTB} / ${m.storage.maxTB}</td>
            <td class="num">${fmtMoney(m.price)}</td>
            <td class="num">${m.powerW}W</td>
            <td>${m.warrantyYears}年 / ${m.deliveryWeeks}周</td>
            <td>${m.status === 'disabled' ? '<span class="badge badge-gray">停用</span>' : '<span class="badge badge-green">启用</span>'}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-sm btn-plain" data-edit="${esc(m.id)}">编辑</button>
              <button class="btn btn-sm btn-danger" data-del="${esc(m.id)}">删除</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
    body.querySelector('#m-add').onclick = () => machineModal(body, null);
    body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
      machineModal(body, machinesCache.find(m => m.id === b.dataset.edit));
    });
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const m = machinesCache.find(x => x.id === b.dataset.del);
      if (!m) return;
      if (!(await confirmDialog(`确认删除机型「${m.brand} ${m.model}」？删除后不可恢复。`))) return;
      try { await ssp.api('/api/admin/machines/' + m.id, { method: 'DELETE' }); toast('机型已删除', 'ok'); loadMachines(body); }
      catch (e) { toast(e.message, 'err'); }
    });
  }

  function machineModal(body, m) {
    const isNew = !m;
    m = m || { id: '', brand: '', model: '', category: '通用机架服务器', cpuArch: 'x86', cpu: { model: '', count: 2, coresPerCPU: 16, freqGHz: 2.4 }, gpu: null, memory: { stdGB: 128, maxGB: 1024, slots: 16, type: 'DDR4-3200 ECC' }, storage: { stdTB: 4, maxTB: 40, type: 'NVMe SSD' }, network: { model: '2×25GbE', nicGbps: 25 }, powerW: 800, price: 50000, warrantyYears: 3, deliveryWeeks: 4, tags: [], status: 'active', note: '' };
    const g = m.gpu || { model: '', count: 8, vramGB: 80, fp16Tflops: 312, class: 'nvidia-dc' };
    const scenarios = sspUI.state.bootstrap.options.scenarios;
    const inp = (label, name, val, attrs) => `<div class="field"><label>${label}</label><input name="${name}" value="${esc(val === null || val === undefined ? '' : val)}" ${attrs || ''}><div class="err-msg"></div></div>`;
    const mask = modal(`
      <h3>${isNew ? '新增机型' : '编辑机型：' + esc(m.brand + ' ' + m.model)}</h3>
      <form id="machine-form" novalidate>
        <div class="fieldset"><div class="legend">基本信息</div><div class="form-grid">
          ${inp('机型ID（小写字母/数字/连字符）', 'id', m.id, isNew ? '' : 'disabled')}
          ${inp('品牌', 'brand', m.brand, 'placeholder="浪潮"')}
          ${inp('型号', 'model', m.model, 'placeholder="NF5280M6"')}
          ${inp('类别', 'category', m.category, 'placeholder="通用机架服务器"')}
          <div class="field"><label>CPU架构</label><select name="cpuArch">
            ${['x86', 'x86-AMD', 'x86-国产', 'arm'].map(a => `<option value="${a}" ${m.cpuArch === a ? 'selected' : ''}>${a}</option>`).join('')}
          </select></div>
          <div class="field full"><label>适用场景标签</label>
            <div style="display:flex;gap:12px;flex-wrap:wrap;padding-top:4px">
              ${scenarios.map(s => `<label style="font-weight:400;font-size:13px;display:flex;align-items:center;gap:5px"><input type="checkbox" name="tag_${s.value}" ${m.tags.includes(s.value) ? 'checked' : ''}>${esc(s.label)}</label>`).join('')}
            </div></div>
        </div></div>
        <div class="fieldset"><div class="legend">CPU / GPU</div><div class="form-grid">
          ${inp('CPU型号', 'cpu_model', m.cpu.model, 'placeholder="Intel Xeon Silver 4314"')}
          ${inp('CPU数量(颗)', 'cpu_count', m.cpu.count, 'type="number" min="1" step="1"')}
          ${inp('每颗CPU核数', 'cpu_cores', m.cpu.coresPerCPU, 'type="number" min="1" step="1"')}
          ${inp('主频(GHz)', 'cpu_freq', m.cpu.freqGHz, 'type="number" min="0.5" step="0.1"')}
          <div class="field full" style="display:flex;align-items:center;gap:8px;padding-top:2px">
            <input type="checkbox" name="has_gpu" id="has_gpu" ${m.gpu ? 'checked' : ''} style="width:auto"><label for="has_gpu" style="margin:0">配备GPU</label>
          </div>
          ${inp('GPU型号', 'gpu_model', g.model, 'placeholder="NVIDIA A800 80GB PCIe"')}
          ${inp('GPU数量(张)', 'gpu_count', g.count, 'type="number" min="1" step="1"')}
          ${inp('单卡显存(GB)', 'gpu_vram', g.vramGB, 'type="number" min="1" step="1"')}
          ${inp('单卡FP16算力(TFLOPS)', 'gpu_flops', g.fp16Tflops, 'type="number" min="1" step="1"')}
          <div class="field"><label>GPU类别</label><select name="gpu_class">
            ${[['nvidia-dc', 'NVIDIA数据中心卡'], ['ascn', '国产AI加速卡'], ['nvidia-graphics', '专业图形卡']].map(([v2, l]) => `<option value="${v2}" ${g.class === v2 ? 'selected' : ''}>${l}</option>`).join('')}
          </select></div>
        </div></div>
        <div class="fieldset"><div class="legend">内存 / 存储 / 网络</div><div class="form-grid">
          ${inp('标配内存(GB)', 'mem_std', m.memory.stdGB, 'type="number" min="1" step="1"')}
          ${inp('最大内存(GB)', 'mem_max', m.memory.maxGB, 'type="number" min="1" step="1"')}
          ${inp('内存插槽数', 'mem_slots', m.memory.slots, 'type="number" min="1" step="1"')}
          ${inp('内存类型', 'mem_type', m.memory.type)}
          ${inp('标配存储(TB)', 'sto_std', m.storage.stdTB, 'type="number" min="0.1" step="0.1"')}
          ${inp('最大存储(TB)', 'sto_max', m.storage.maxTB, 'type="number" min="0.1" step="0.1"')}
          ${inp('存储类型', 'sto_type', m.storage.type)}
          ${inp('网络配置', 'net_model', m.network.model)}
          ${inp('网卡速率(GbE)', 'net_gbps', m.network.nicGbps, 'type="number" min="1" step="1"')}
        </div></div>
        <div class="fieldset"><div class="legend">商务参数</div><div class="form-grid">
          ${inp('单价(元)', 'price', m.price, 'type="number" min="1" step="1"')}
          ${inp('整机功耗(W)', 'powerW', m.powerW, 'type="number" min="1" step="1"')}
          ${inp('维保(年)', 'warrantyYears', m.warrantyYears, 'type="number" min="1" step="1"')}
          ${inp('供货周期(周)', 'deliveryWeeks', m.deliveryWeeks, 'type="number" min="1" step="1"')}
          <div class="field"><label>状态</label><select name="status">
            <option value="active" ${m.status !== 'disabled' ? 'selected' : ''}>启用</option>
            <option value="disabled" ${m.status === 'disabled' ? 'selected' : ''}>停用</option>
          </select></div>
          ${inp('备注', 'note', m.note || '')}
        </div></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-plain" id="mf-cancel">取消</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>`);

    const form = mask.querySelector('#machine-form');
    const gpuFields = ['gpu_model', 'gpu_count', 'gpu_vram', 'gpu_flops', 'gpu_class'];
    const syncGpu = () => {
      const on = form.querySelector('[name="has_gpu"]').checked;
      gpuFields.forEach(n => { form.querySelector(`[name="${n}"]`).closest('.field').style.display = on ? '' : 'none'; });
    };
    form.querySelector('[name="has_gpu"]').onchange = syncGpu;
    syncGpu();
    mask.querySelector('#mf-cancel').onclick = closeModal;

    form.onsubmit = async e => {
      e.preventDefault();
      const num = n => Number(form.querySelector(`[name="${n}"]`).value);
      const str = n => form.querySelector(`[name="${n}"]`).value.trim();
      const obj = {
        id: isNew ? str('id') : m.id,
        brand: str('brand'), model: str('model'), category: str('category'), cpuArch: str('cpuArch'),
        cpu: { model: str('cpu_model'), count: num('cpu_count'), coresPerCPU: num('cpu_cores'), freqGHz: num('cpu_freq') },
        gpu: form.querySelector('[name="has_gpu"]').checked ? {
          model: str('gpu_model'), count: num('gpu_count'), vramGB: num('gpu_vram'), fp16Tflops: num('gpu_flops'), class: str('gpu_class')
        } : null,
        memory: { stdGB: num('mem_std'), maxGB: num('mem_max'), slots: num('mem_slots'), type: str('mem_type') },
        storage: { stdTB: num('sto_std'), maxTB: num('sto_max'), type: str('sto_type') },
        network: { model: str('net_model'), nicGbps: num('net_gbps') },
        powerW: num('powerW'), price: num('price'), warrantyYears: num('warrantyYears'), deliveryWeeks: num('deliveryWeeks'),
        tags: scenarios.filter(s => form.querySelector(`[name="tag_${s.value}"]`).checked).map(s => s.value),
        status: str('status'), note: str('note')
      };
      try {
        await ssp.api(isNew ? '/api/admin/machines' : '/api/admin/machines/' + m.id,
          isNew ? { body: obj } : { method: 'PUT', body: obj });
        closeModal();
        toast(isNew ? '机型已新增，立即参与测算' : '机型已更新', 'ok');
        loadMachines(body);
      } catch (err) { toast(err.message, 'err'); }
    };
  }

  // ---------- 规则与计费配置 ----------
  let rulesState = null;
  function numInput(label, path, val, step, hint) {
    return `<div class="field"><label>${label}</label>
      <input type="number" step="${step || 1}" data-path="${path}" value="${val}">
      ${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  }

  async function loadRules(body) {
    rulesState = (await ssp.api('/api/admin/rules')).rules;
    const r = rulesState;
    const scenarioLabels = Object.fromEntries(r.options.scenarios.map(s => [s.value, s.label]));
    body.innerHTML = `
      <div class="card rules-section">
        <h3>评分权重（四项之和必须等于 1）</h3>
        <div class="form-grid">
          ${numInput('性能匹配权重', 'weights.performance', r.weights.performance, 0.05)}
          ${numInput('性价比权重', 'weights.value', r.weights.value, 0.05)}
          ${numInput('功耗权重', 'weights.power', r.weights.power, 0.05)}
          ${numInput('维保供货权重', 'weights.service', r.weights.service, 0.05)}
        </div>
        <p style="margin-top:8px;font-size:13px">当前合计：<b id="w-sum"></b></p>
      </div>

      <div class="card rules-section">
        <h3>场景负载画像换算系数（每千并发）</h3>
        <div class="table-wrap" style="box-shadow:none"><table class="tbl" style="min-width:900px">
          <thead><tr><th>业务场景</th><th>画像</th><th class="num">CPU核数/千并发</th><th class="num">内存GB/核</th><th class="num">GPU卡/千并发</th><th class="num">存储GB/千并发</th><th class="num">存储放大系数</th><th class="num">带宽Mbps/千并发</th></tr></thead>
          <tbody>${Object.entries(r.scenarioProfiles).map(([k, sp]) => `
            <tr><td><b>${esc(scenarioLabels[k] || k)}</b><br><span style="font-size:11px;color:var(--gray)">${k}</span></td>
            <td>${esc((r.options.profiles.find(p => p.value === sp.profile) || {}).label || sp.profile)}</td>
            <td><input type="number" step="0.5" min="0" data-path="scenarioProfiles.${k}.coresPer1kUsers" value="${sp.coresPer1kUsers}"></td>
            <td><input type="number" step="0.5" min="0.5" data-path="scenarioProfiles.${k}.memGBPerCore" value="${sp.memGBPerCore}"></td>
            <td><input type="number" step="0.5" min="0" data-path="scenarioProfiles.${k}.gpuPer1kUsers" value="${sp.gpuPer1kUsers}"></td>
            <td><input type="number" step="10" min="0" data-path="scenarioProfiles.${k}.storageGBPer1kUsers" value="${sp.storageGBPer1kUsers}"></td>
            <td><input type="number" step="0.1" min="1" data-path="scenarioProfiles.${k}.storageMultiplier" value="${sp.storageMultiplier}"></td>
            <td><input type="number" step="1" min="0" data-path="scenarioProfiles.${k}.nicMbpsPer1kUsers" value="${sp.nicMbpsPer1kUsers}"></td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>

      <div class="card rules-section">
        <h3>基础换算参数</h3>
        <div class="form-grid">
          ${numInput('性能余量比例', 'sizing.headroomRatio', r.sizing.headroomRatio, 0.05, '0.3 = 计入30%余量')}
          ${numInput('系统盘预留(GB)', 'sizing.systemStorageGB', r.sizing.systemStorageGB, 50)}
          ${numInput('推荐最小核数', 'sizing.minCores', r.sizing.minCores, 1)}
          ${numInput('推荐最大核数', 'sizing.maxCores', r.sizing.maxCores, 100)}
          ${numInput('最小内存(GB)', 'sizing.minMemGB', r.sizing.minMemGB, 16)}
          ${numInput('带宽下限(Mbps)', 'sizing.nicFloorMbps', r.sizing.nicFloorMbps, 100)}
          ${numInput('单方案最大节点数', 'sizing.maxNodes', r.sizing.maxNodes, 10)}
          ${numInput('电价(元/度)', 'powerPrice.electricityPricePerKwh', r.powerPrice.electricityPricePerKwh, 0.05)}
          ${numInput('PUE系数', 'powerPrice.pue', r.powerPrice.pue, 0.05)}
        </div>
      </div>

      <div class="card rules-section">
        <h3>收费标准</h3>
        <div class="form-grid">
          <div class="field"><label>快速测算价格(元/次)</label><input type="number" step="1" min="0" data-path="pricing.quick.price" value="${r.pricing.quick.price}"></div>
          <div class="field"><label>快速测算名称</label><input data-path="pricing.quick.name" value="${esc(r.pricing.quick.name)}"></div>
          <div class="field full"><label>快速测算说明</label><input data-path="pricing.quick.desc" value="${esc(r.pricing.quick.desc)}"></div>
          <div class="field"><label>正式报告价格(元/份)</label><input type="number" step="1" min="0" data-path="pricing.report.price" value="${r.pricing.report.price}"></div>
          <div class="field"><label>正式报告名称</label><input data-path="pricing.report.name" value="${esc(r.pricing.report.name)}"></div>
          <div class="field full"><label>正式报告说明</label><input data-path="pricing.report.desc" value="${esc(r.pricing.report.desc)}"></div>
        </div>
      </div>

      <div class="card rules-section">
        <h3>报告模板（参数假设与免责声明）</h3>
        <div class="field" style="margin-bottom:12px"><label>参数假设（每行一条，展示于报告附录）</label>
          <textarea data-path="reportTemplate.assumptions" rows="6">${esc(r.reportTemplate.assumptions)}</textarea></div>
        <div class="field"><label>免责声明</label>
          <textarea data-path="reportTemplate.disclaimer" rows="5">${esc(r.reportTemplate.disclaimer)}</textarea></div>
      </div>

      <div style="display:flex;gap:14px;align-items:center">
        <button class="btn btn-primary btn-lg" id="rules-save">保存全部配置</button>
        <span style="font-size:13px;color:var(--gray)">保存后立即对新测算生效</span>
      </div>`;

    const sumEl = body.querySelector('#w-sum');
    const updSum = () => {
      const s = ['performance', 'value', 'power', 'service']
        .reduce((acc, k) => acc + Number(body.querySelector(`[data-path="weights.${k}"]`).value), 0);
      sumEl.textContent = s.toFixed(2);
      sumEl.style.color = Math.abs(s - 1) < 1e-6 ? 'var(--ok)' : 'var(--danger)';
    };
    body.querySelectorAll('[data-path^="weights."]').forEach(i => i.addEventListener('input', updSum));
    updSum();

    body.querySelector('#rules-save').onclick = async () => {
      const draft = JSON.parse(JSON.stringify(rulesState));
      body.querySelectorAll('[data-path]').forEach(el => {
        const raw = el.value.trim();
        const val = el.type === 'number' ? Number(raw) : raw;
        setPath(draft, el.dataset.path, val);
      });
      try {
        const res = await ssp.api('/api/admin/rules', { method: 'PUT', body: { rules: draft } });
        rulesState = res.rules;
        toast('规则配置已保存，立即生效', 'ok');
        window.sspUI.state.bootstrap = await ssp.api('/api/bootstrap');
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  function setPath(obj, path, val) {
    const ks = path.split('.');
    let o = obj;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = val;
  }

  // ---------- 订单管理 ----------
  async function loadOrders(body) {
    const { orders } = await ssp.api('/api/admin/orders');
    if (!orders.length) { body.innerHTML = `<div class="empty">暂无订单</div>`; return; }
    body.innerHTML = `
      <div class="table-wrap"><table class="tbl" style="min-width:960px">
        <thead><tr><th>订单编号</th><th>用户</th><th>商品</th><th>关联任务</th><th class="num">金额</th><th>状态</th><th>下单时间</th><th>支付时间</th><th>报告版本</th></tr></thead>
        <tbody>${orders.map(o => `
          <tr><td><b>${esc(o.orderNo)}</b></td><td>${esc(o.username)}</td><td>${esc(o.productName)}</td>
          <td><a href="#/result/${esc(o.taskId)}">${esc(o.taskId)}</a></td>
          <td class="num">${fmtMoney(o.amount)}</td>
          <td>${o.status === 'paid' ? '<span class="badge badge-green">已支付</span>' : '<span class="badge badge-orange">待支付</span>'}</td>
          <td style="white-space:nowrap">${fmtTime(o.createdAt)}</td><td style="white-space:nowrap">${fmtTime(o.paidAt)}</td>
          <td>${esc(o.reportVersion)}</td></tr>`).join('')}
        </tbody>
      </table></div>`;
  }

  window.sspAdmin = { render };
})();
