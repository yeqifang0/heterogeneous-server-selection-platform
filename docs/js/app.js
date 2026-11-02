// 前端主应用：哈希路由 + 用户侧页面（首页/录入/处理/结果/报告/订单/登录注册）
(function () {
  const $view = () => document.getElementById('view');
  const DRAFT_KEY = 'ssp_draft_v1';
  const LS = window.SSPStorage.local, SS = window.SSPStorage.session;
  const state = { bootstrap: null, user: null, seq: 0 };

  // ---------- 基础工具 ----------
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtMoney(n) { return '¥' + Number(n || 0).toLocaleString('zh-CN'); }
  function fmtTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    const p = x => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function toast(msg, type) {
    const box = document.getElementById('toast-box');
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, 2600);
  }
  function modal(html) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-mask"><div class="modal">${html}</div></div>`;
    return root.firstElementChild;
  }
  function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
  function confirmDialog(text) {
    return new Promise(resolve => {
      const mask = modal(`
        <h3>操作确认</h3>
        <p style="color:var(--gray);font-size:14px">${esc(text)}</p>
        <div class="modal-actions">
          <button class="btn btn-plain" id="cd-no">取消</button>
          <button class="btn btn-primary" id="cd-yes">确认</button>
        </div>`);
      mask.querySelector('#cd-no').onclick = () => { closeModal(); resolve(false); };
      mask.querySelector('#cd-yes').onclick = () => { closeModal(); resolve(true); };
      mask.onclick = e => { if (e.target === mask) { closeModal(); resolve(false); } };
    });
  }
  function optLabel(list, value) {
    const o = (list || []).find(x => x.value === value);
    return o ? o.label : (value || '-');
  }

  // ---------- 页头 ----------
  function renderUserArea() {
    const area = document.getElementById('user-area');
    const navAdmin = document.getElementById('nav-admin');
    if (state.user) {
      navAdmin.hidden = state.user.role !== 'admin';
      area.innerHTML = `
        <span class="user-name">${esc(state.user.displayName || state.user.username)}</span>
        <button class="btn btn-sm btn-plain" id="btn-logout">退出</button>`;
      area.querySelector('#btn-logout').onclick = async () => {
        try { await ssp.api('/api/auth/logout', { method: 'POST', body: {} }); } catch (e) { /* 忽略 */ }
        ssp.setToken(null);
        state.user = null;
        renderUserArea();
        toast('已退出登录');
        location.hash = '#/';
      };
    } else {
      navAdmin.hidden = true;
      area.innerHTML = `<a class="btn btn-sm btn-ghost" href="#/login">登录</a>
        <a class="btn btn-sm btn-primary" href="#/register">注册</a>`;
    }
  }

  // ---------- 路由 ----------
  function parseHash() {
    const raw = (location.hash || '#/').slice(1);
    const [pathPart, queryPart] = raw.split('?');
    const segs = pathPart.split('/').filter(Boolean);
    return { page: segs[0] || '', param: segs[1] || null, query: new URLSearchParams(queryPart || '') };
  }
  function route() {
    const { page, param, query } = parseHash();
    const map = {
      '': renderHome, form: renderForm, task: renderProcessing, result: renderResult,
      report: renderReport, orders: renderOrders, login: renderLogin, register: renderRegister, admin: renderAdmin
    };
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === (page || 'home')));
    state.seq++;
    (map[page] || renderNotFound)($view(), param, query);
    window.scrollTo(0, 0);
  }
  function renderNotFound(v) {
    v.innerHTML = `<div class="empty"><div class="icon">🧭</div>页面不存在，<a href="#/">返回首页</a></div>`;
  }
  function errorPage(v, e) {
    v.innerHTML = `<div class="empty"><div class="icon">⚠️</div>${esc(e.message || '加载失败')}<br><br>
      <a class="btn btn-primary" href="#/">返回首页</a></div>`;
  }

  // ---------- 首页 ----------
  function renderHome(v) {
    const b = state.bootstrap;
    const quick = b && b.pricing.quick, report = b && b.pricing.report;
    v.innerHTML = `
      <div class="hero">
        <h1><b>异构服务器选型配置</b><br>与算力匹配测算平台</h1>
        <p>录入业务负载、并发规模与预算区间，自动比对多品牌异构服务器（Intel / AMD / 鲲鹏 / 海光 × A800 / H800 / H100 / 昇腾910B…）机型参数库，输出算力匹配度、Top3 配置组合与性价比排序，生成可下载 PDF 的选型测算报告。</p>
        <div class="hero-actions">
          <a class="btn btn-lg btn-primary" href="#/form">开始使用 · 免费试算</a>
          <a class="btn btn-lg btn-ghost" href="#pricing">查看收费说明</a>
        </div>
        <div class="hero-meta">
          <div><b>22+</b><span>多品牌异构机型参数库</span></div>
          <div><b>4维</b><span>加权评分（性能/性价比/功耗/维保）</span></div>
          <div><b>6章</b><span>结构化选型测算报告</span></div>
          <div><b>PDF</b><span>报告在线生成并下载</span></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">适用场景</div>
        <div class="section-sub">面向采购服务器与算力资源的企业 IT、系统集成商与算力项目方</div>
        <div class="grid-4">
          <div class="card"><div class="feature-icon">🖥️</div><h3>通用业务上线</h3><p>Web 应用、数据库、中间件的通用服务器选型，按并发规模测算 CPU / 内存 / 存储容量。</p></div>
          <div class="card"><div class="feature-icon">🧠</div><h3>AI 训练与推理</h3><p>GPU 训练集群选型，支持 A800 / H800 / H100 与昇腾、深算等国产加速卡的算力匹配测算。</p></div>
          <div class="card"><div class="feature-icon">🎬</div><h3>渲染与视觉计算</h3><p>渲染农场、视觉计算平台的图形卡服务器配置组合与性价比对比。</p></div>
          <div class="card"><div class="feature-icon">🗄️</div><h3>存储与边缘接入</h3><p>大容量存储服务器与低功耗边缘节点的容量规划与交付周期约束筛选。</p></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">使用流程</div>
        <div class="section-sub">游客可免费试填并预览脱敏摘要，完整结果与正式报告付费解锁</div>
        <div class="steps">
          <div class="step"><b>录入需求</b><span>业务场景、并发规模、算力需求与预算区间，支持草稿暂存</span></div>
          <div class="step"><b>自动测算</b><span>负载画像映射 → 容量换算 → 机型库匹配 → 四维加权评分</span></div>
          <div class="step"><b>查看结果</b><span>Top3 推荐配置 + 备选方案，适配度柱状对比与性价比排序</span></div>
          <div class="step"><b>获取报告</b><span>付费解锁六章完整报告，在线查看并下载 PDF 版本</span></div>
        </div>
      </div>

      <div class="section" id="pricing">
        <div class="section-title">收费说明</div>
        <div class="section-sub">按报告/按次收费，未付费仅可预览脱敏摘要；支付后报告可反复查看与下载</div>
        <div class="grid-2">
          <div class="card price-card">
            <span class="p-name">${esc(quick ? quick.name : '快速测算')}</span>
            <div class="p-price">${quick ? quick.price : 49}<small> 元/${esc(quick ? quick.unit : '次')}</small></div>
            <p class="p-desc">${esc(quick ? quick.desc : '')}</p>
            <a class="btn btn-ghost" href="#/form">先免费试算</a>
          </div>
          <div class="card price-card" style="border:2px solid var(--primary)">
            <span class="p-name">${esc(report ? report.name : '正式选型报告')}</span>
            <div class="p-price">${report ? report.price : 199}<small> 元/${esc(report ? report.unit : '份')}</small></div>
            <p class="p-desc">${esc(report ? report.desc : '')}</p>
            <a class="btn btn-primary" href="#/form">开始测算并生成报告</a>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="notice"><b>服务边界与合规说明：</b>本平台仅输出配置选型与测算建议，不提供现场部署、上架布线、整机安装调试等服务；报告为选型辅助，不构成采购承诺，最终采购决策由用户自行判断。价格与配置信息来源于公开资料整理，实际以厂商正式报价为准。</div>
      </div>`;
  }

  // ---------- 录入页 ----------
  const FORM_LABELS = {
    scenario: '业务场景', concurrentUsers: '预估并发用户数', workloadDesc: '业务负载描述',
    cpuCoresMin: 'CPU核数下限', cpuCoresMax: 'CPU核数上限', cpuFreqMin: 'CPU主频要求(GHz)',
    gpuRequirement: 'GPU需求', gpuCount: 'GPU数量(张)', memoryGB: '内存容量(GB)',
    storageValue: '存储容量', storageUnit: '存储单位', nicMbps: '网络带宽需求(Mbps)',
    budgetMin: '预算下限(元)', budgetMax: '预算上限(元)', deliveryCycle: '交付周期要求', remark: '备注'
  };

  function renderForm(v) {
    const b = state.bootstrap;
    if (!b) { errorPage(v, new Error('平台配置加载失败，请刷新重试')); return; }
    const scenarios = b.options.scenarios, gpus = b.options.gpuRequirements, cycles = b.options.deliveryCycles;
    v.innerHTML = `
      <div class="page-head">
        <div><div class="page-title">录入测算需求</div>
        <div class="page-sub">带 <span style="color:var(--danger)">*</span> 为必填项；所有换算系数与评分权重由平台后台规则表统一配置</div></div>
      </div>
      <div class="draft-banner" id="draft-banner" hidden>
        <span>发现暂存草稿（<span id="draft-time"></span>）</span>
        <button class="btn btn-sm btn-primary" id="draft-restore">恢复草稿</button>
        <button class="btn btn-sm btn-plain" id="draft-drop">放弃</button>
      </div>
      <form class="card form-card" id="calc-form" novalidate>
        <div class="fieldset">
          <div class="legend">① 业务与规模</div>
          <div class="form-grid">
            <div class="field">
              <label>业务场景<span class="req">*</span></label>
              <select name="scenario"><option value="">请选择业务场景</option>${scenarios.map(s => `<option value="${s.value}">${esc(s.label)}</option>`).join('')}</select>
              <div class="err-msg"></div>
            </div>
            <div class="field">
              <label>预估并发用户数<span class="req">*</span></label>
              <input name="concurrentUsers" type="number" min="1" max="10000000" step="1" placeholder="1 ~ 10,000,000 的整数">
              <div class="err-msg"></div>
            </div>
            <div class="field full">
              <label>业务负载描述<span class="opt-tag">选填</span></label>
              <textarea name="workloadDesc" placeholder="例如：电商交易系统，读写比 3:7，高峰期在晚 20:00-22:00，单笔订单事务较轻…"></textarea>
              <div class="err-msg"></div>
            </div>
          </div>
        </div>

        <div class="fieldset">
          <div class="legend">② 算力需求</div>
          <div class="form-grid">
            <div class="field">
              <label>CPU核数下限<span class="opt-tag">选填</span></label>
              <input name="cpuCoresMin" type="number" min="1" step="1" placeholder="如 64">
              <div class="err-msg"></div>
            </div>
            <div class="field">
              <label>CPU核数上限<span class="opt-tag">选填</span></label>
              <input name="cpuCoresMax" type="number" min="1" step="1" placeholder="如 512">
              <div class="err-msg"></div>
            </div>
            <div class="field">
              <label>CPU主频要求(GHz)<span class="opt-tag">选填</span></label>
              <input name="cpuFreqMin" type="number" min="0.5" max="10" step="0.1" placeholder="如 2.5">
              <div class="err-msg"></div>
            </div>
            <div class="field">
              <label>GPU需求<span class="opt-tag">选填</span></label>
              <select name="gpuRequirement">${gpus.map(g => `<option value="${g.value}">${esc(g.label)}</option>`).join('')}</select>
              <div class="err-msg"></div>
            </div>
            <div class="field">
              <label>GPU数量(张)<span class="opt-tag">选填</span></label>
              <input name="gpuCount" type="number" min="1" max="64" step="1" placeholder="如 8">
              <div class="hint">仅在选择了GPU类别时生效</div>
              <div class="err-msg"></div>
            </div>
            <div class="field">
              <label>内存容量(GB)<span class="req">*</span></label>
              <input name="memoryGB" type="number" min="1" step="1" placeholder="如 256">
              <div class="err-msg"></div>
            </div>
            <div class="field">
              <label>存储容量<span class="req">*</span></label>
              <div class="inline-fields">
                <div class="field" style="margin:0"><input name="storageValue" type="number" min="0.1" step="0.1" placeholder="容量数值"><div class="err-msg"></div></div>
                <div class="field" style="margin:0;max-width:110px"><select name="storageUnit"><option value="GB">GB</option><option value="TB" selected>TB</option></select><div class="err-msg"></div></div>
              </div>
              <div class="err-msg" data-for="storageValue"></div>
            </div>
          </div>
        </div>

        <div class="fieldset">
          <div class="legend">③ 预算与交付</div>
          <div class="form-grid">
            <div class="field">
              <label>预算下限(元)<span class="req">*</span></label>
              <input name="budgetMin" type="number" min="1" step="1" placeholder="如 100000">
              <div class="err-msg"></div>
            </div>
            <div class="field">
              <label>预算上限(元)<span class="req">*</span></label>
              <input name="budgetMax" type="number" min="1" step="1" placeholder="如 500000">
              <div class="err-msg"></div>
            </div>
            <div class="field">
              <label>网络带宽需求(Mbps)<span class="opt-tag">选填</span></label>
              <input name="nicMbps" type="number" min="1" step="1" placeholder="如 1000">
              <div class="err-msg"></div>
            </div>
            <div class="field">
              <label>交付周期要求<span class="opt-tag">选填</span></label>
              <select name="deliveryCycle">${cycles.map(c => `<option value="${c.value}" ${c.value === 'any' ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
              <div class="err-msg"></div>
            </div>
            <div class="field full">
              <label>备注<span class="opt-tag">选填</span></label>
              <textarea name="remark" placeholder="其他补充说明，如机房供电限制、国产化要求、品牌偏好等"></textarea>
              <div class="err-msg"></div>
            </div>
          </div>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn btn-lg btn-primary" id="btn-submit">提交并开始测算</button>
          <button type="button" class="btn btn-ghost" id="btn-draft">暂存草稿</button>
          <span class="draft-tip" id="draft-tip"></span>
        </div>
      </form>`;

    const form = v.querySelector('#calc-form');

    // 草稿逻辑
    function readDraft() { try { return JSON.parse(LS.getItem(DRAFT_KEY)); } catch (e) { return null; } }
    function applyDraft(data) {
      if (!data) return;
      for (const [k, val] of Object.entries(data)) {
        const el = form.querySelector(`[name="${k}"]`);
        if (el && val !== null && val !== undefined && val !== '') el.value = val;
      }
    }
    const draft = readDraft();
    if (draft && draft.savedAt) {
      const banner = v.querySelector('#draft-banner');
      banner.hidden = false;
      v.querySelector('#draft-time').textContent = fmtTime(draft.savedAt);
      v.querySelector('#draft-restore').onclick = () => { applyDraft(draft.data); banner.hidden = true; toast('草稿已恢复', 'ok'); };
      v.querySelector('#draft-drop').onclick = () => { LS.removeItem(DRAFT_KEY); banner.hidden = true; };
    }
    function collectForm() {
      const data = {};
      form.querySelectorAll('[name]').forEach(el => { data[el.name] = el.value.trim(); });
      return data;
    }
    function saveDraft(silent) {
      const data = collectForm();
      LS.setItem(DRAFT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), data }));
      if (!silent) toast('草稿已暂存，下次进入可恢复', 'ok');
    }
    let draftTimer = null;
    form.addEventListener('input', () => {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => saveDraft(true), 700);
    });
    v.querySelector('#btn-draft').onclick = () => saveDraft(false);

    // 校验（与后端规则一致）
    function setErr(name, msg) {
      const el = form.querySelector(`[name="${name}"]`);
      if (!el) return;
      // 存储容量等组合字段的错误提示挂在 data-for 的外层 .field 上
      const msgBox = form.querySelector(`.err-msg[data-for="${name}"]`) || el.closest('.field').querySelector('.err-msg');
      const fieldWrap = (msgBox && msgBox.dataset.for) ? msgBox.closest('.field') : el.closest('.field');
      if (fieldWrap) fieldWrap.classList.toggle('invalid', !!msg);
      if (msgBox) msgBox.textContent = msg || '';
      const inner = el.closest('.field');
      if (inner && inner !== fieldWrap) inner.classList.toggle('invalid', !!msg);
    }
    function validateForm(data) {
      const errors = {};
      if (!data.scenario) errors.scenario = '请选择业务场景';
      const users = Number(data.concurrentUsers);
      if (!data.concurrentUsers || !Number.isInteger(users)) errors.concurrentUsers = '预估并发用户数必须为整数';
      else if (users < 1 || users > 10000000) errors.concurrentUsers = '预估并发用户数须在 1 ~ 10,000,000 之间';

      for (const k of ['cpuCoresMin', 'cpuCoresMax']) {
        if (data[k]) {
          const n = Number(data[k]);
          if (!Number.isInteger(n) || n < 1) errors[k] = 'CPU核数须为不小于1的整数';
        }
      }
      if (data.cpuCoresMin && data.cpuCoresMax && Number(data.cpuCoresMin) > Number(data.cpuCoresMax)) {
        errors.cpuCoresMax = 'CPU核数上限不能小于下限';
      }
      if (data.cpuFreqMin) {
        const f = Number(data.cpuFreqMin);
        if (!(f > 0) || f > 10) errors.cpuFreqMin = '主频须在 0 ~ 10 GHz 之间';
      }
      if (data.gpuCount) {
        const g = Number(data.gpuCount);
        if (!Number.isInteger(g) || g < 1 || g > 64) errors.gpuCount = 'GPU数量须为 1 ~ 64 的整数';
      }
      if (!data.memoryGB || !(Number(data.memoryGB) > 0)) errors.memoryGB = '内存容量必须为大于0的数值';
      else if (Number(data.memoryGB) > 1048576) errors.memoryGB = '内存容量超出可测算范围';
      if (!data.storageValue || !(Number(data.storageValue) > 0)) errors.storageValue = '存储容量必须为大于0的数值';
      else if (data.storageUnit === 'GB' ? Number(data.storageValue) > 10485760 : Number(data.storageValue) > 10240) errors.storageValue = '存储容量超出可测算范围';
      if (data.nicMbps) {
        const n = Number(data.nicMbps);
        if (n < 1 || n > 400000) errors.nicMbps = '网络带宽须在 1 ~ 400,000 Mbps 之间';
      }
      if (!data.budgetMin || !(Number(data.budgetMin) > 0)) errors.budgetMin = '预算下限必须为大于0的数值';
      else if (Number(data.budgetMin) > 1e10) errors.budgetMin = '预算下限超出可测算范围';
      if (!data.budgetMax || !(Number(data.budgetMax) > 0)) errors.budgetMax = '预算上限必须为大于0的数值';
      else if (Number(data.budgetMax) > 1e10) errors.budgetMax = '预算上限超出可测算范围';
      if (data.budgetMin && data.budgetMax && Number(data.budgetMin) > Number(data.budgetMax)) errors.budgetMax = '预算上限不能小于下限';
      return errors;
    }
    function showErrors(errors) {
      Object.keys(FORM_LABELS).forEach(k => setErr(k, errors[k] || ''));
      const first = Object.keys(errors)[0];
      if (first) {
        const el = form.querySelector(`[name="${first}"]`);
        if (el) { el.focus(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      }
    }

    form.onsubmit = async e => {
      e.preventDefault();
      const data = collectForm();
      const errors = validateForm(data);
      showErrors(errors);
      if (Object.keys(errors).length) { toast('请修正表单中标红的输入项', 'err'); return; }
      const btn = form.querySelector('#btn-submit');
      btn.disabled = true;
      btn.textContent = '正在提交测算…';
      try {
        const payload = { ...data };
        for (const k of ['concurrentUsers', 'cpuCoresMin', 'cpuCoresMax', 'cpuFreqMin', 'gpuCount', 'memoryGB', 'storageValue', 'nicMbps', 'budgetMin', 'budgetMax']) {
          if (payload[k] !== '') payload[k] = Number(payload[k]); else payload[k] = null;
        }
        const res = await ssp.api('/api/tasks', { body: payload });
        LS.removeItem(DRAFT_KEY);
        location.hash = '#/task/' + res.taskId;
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '提交并开始测算';
        if (err.fields) showErrors(err.fields);
        toast(err.message, 'err');
      }
    };
  }

  // ---------- 处理页 ----------
  async function renderProcessing(v, taskId) {
    v.innerHTML = `<div class="loading"><span class="spin"></span>正在载入测算任务…</div>`;
    let task;
    try { task = await ssp.api('/api/tasks/' + taskId); } catch (e) { errorPage(v, e); return; }
    const b = state.bootstrap;
    const f = task.form;
    const echoRows = [
      ['业务场景', optLabel(b.options.scenarios, f.scenario)],
      ['预估并发用户数', Number(f.concurrentUsers).toLocaleString('zh-CN') + ' 人'],
      ['业务负载描述', f.workloadDesc || '未填写'],
      ['CPU需求', [f.cpuCoresMin ? `核数≥${f.cpuCoresMin}` : '', f.cpuCoresMax ? `核数≤${f.cpuCoresMax}` : '', f.cpuFreqMin ? `主频≥${f.cpuFreqMin}GHz` : ''].filter(Boolean).join('，') || '未指定'],
      ['GPU需求', optLabel(b.options.gpuRequirements, f.gpuRequirement || 'none') + (f.gpuCount ? `（≥${f.gpuCount}张）` : '')],
      ['内存容量要求', `${f.memoryGB} GB`],
      ['存储容量要求', `${f.storageValue} ${f.storageUnit}`],
      ['网络带宽需求', f.nicMbps ? `${f.nicMbps} Mbps` : '未填写'],
      ['预算区间', `${fmtMoney(f.budgetMin)} ~ ${fmtMoney(f.budgetMax)}`],
      ['交付周期要求', optLabel(b.options.deliveryCycles, f.deliveryCycle || 'any')],
      ['备注', f.remark || '未填写']
    ];
    v.innerHTML = `
      <div class="page-head"><div><div class="page-title">正在测算</div>
      <div class="page-sub">任务号 ${esc(taskId)} · 已回显您录入的参数，评分计算在服务端完成后自动跳转</div></div></div>
      <div class="result-grid">
        <div class="card">
          <h3 style="font-size:16px;margin-bottom:12px;color:var(--dark)">已录入参数回显</h3>
          <table class="kv-table">${echoRows.map(([k, val]) => `<tr><td>${k}</td><td>${esc(val)}</td></tr>`).join('')}</table>
        </div>
        <div class="card">
          <h3 style="font-size:16px;margin-bottom:16px;color:var(--dark)">计算进度</h3>
          <div class="progress-track"><div class="progress-bar" id="pgbar"></div></div>
          <div class="stage-list" id="stages">
            ${(task.stages || []).map((s, i) => `
              <div class="stage" data-i="${i}"><span class="dot"></span><span class="name">${esc(s.name)}</span><span class="pct">${s.pct}%</span></div>`).join('')}
          </div>
        </div>
      </div>`;
    const seq = state.seq;
    const stages = task.stages || [];
    for (let i = 0; i < stages.length; i++) {
      const el = v.querySelector(`.stage[data-i="${i}"]`);
      if (!el || state.seq !== seq) return;
      el.classList.add('doing');
      await sleep(i === stages.length - 1 ? 650 : 420);
      if (state.seq !== seq) return;
      el.classList.remove('doing');
      el.classList.add('done');
      v.querySelector('#pgbar').style.width = stages[i].pct + '%';
    }
    await sleep(500);
    if (state.seq !== seq) return;
    location.hash = '#/result/' + taskId;
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ---------- 结果页 ----------
  async function renderResult(v, taskId) {
    v.innerHTML = `<div class="loading"><span class="spin"></span>正在载入测算结果…</div>`;
    let sum, ent;
    try {
      [sum, ent] = await Promise.all([
        ssp.api('/api/tasks/' + taskId + '/summary'),
        ssp.api('/api/tasks/' + taskId + '/entitlement')
      ]);
    } catch (e) { errorPage(v, e); return; }

    const relaxMap = { delivery: ['badge-orange', '预算内机型供货周期偏长，已放宽交付约束'], budgetMin: ['badge-orange', '预算下限内无完全匹配方案，已按预算上限筛选'], budgetMax: ['badge-red', '预算上限内无满足方案，以下为超预算参考方案'], none: null };
    const relax = relaxMap[sum.budgetRelaxed];

    v.innerHTML = `
      <div class="page-head">
        <div><div class="page-title">测算结果</div>
        <div class="page-sub">任务号 ${esc(taskId)}${relax ? ` · <span class="badge ${relax[0]}">${relax[1]}</span>` : ''}</div></div>
      </div>
      <div class="result-grid">
        <div>
          <div class="card" style="margin-bottom:18px">
            <h3 style="font-size:16px;margin-bottom:10px;color:var(--dark)">负载画像与容量需求 <span class="badge badge-blue">${esc(sum.profileLabel)}</span></h3>
            <div class="sum-item"><span>并发规模</span><b>${esc(sum.scaleLevel)}</b></div>
            <div class="sum-item"><span>推荐CPU总核数</span><b>≥ ${sum.recCores} 核</b></div>
            <div class="sum-item"><span>推荐内存容量</span><b>≥ ${sum.recMemGB.toLocaleString('zh-CN')} GB</b></div>
            <div class="sum-item"><span>推荐GPU卡数</span><b>${sum.recGpuCount > 0 ? '≥ ' + sum.recGpuCount + ' 张' : '无需GPU'}</b></div>
            <div class="sum-item"><span>推荐存储容量</span><b>≥ ${sum.recStorageTB} TB</b></div>
            <div class="sum-item"><span>推荐网络带宽</span><b>≥ ${sum.recNicMbps} Mbps</b></div>
            <div class="sum-item"><span>机型库匹配情况</span><b>共${sum.machineTotal}款 · ${sum.feasibleCount}款满足约束</b></div>
          </div>
          <div id="unlock-panel"></div>
        </div>
        <div id="detail-panel"></div>
      </div>`;

    if (ent.calcUnlocked) {
      await renderCalcDetail(v, taskId, ent);
    } else {
      renderLockedSummary(v, sum);
      renderUnlockPanel(v, taskId);
    }
  }

  function renderLockedSummary(v, sum) {
    const panel = v.querySelector('#detail-panel');
    panel.innerHTML = `
      <div class="locked-panel">
        <div class="blur-bg card">
          <h3 style="font-size:16px;color:var(--dark);margin-bottom:12px">Top3 推荐配置（脱敏预览）</h3>
          <div class="mask-row">${(sum.topBrandMasked || []).map(b => `<span class="mask-chip">${esc(b)}</span>`).join('')}</div>
          <div style="margin-top:22px;font-size:14px;color:var(--gray)">
            共匹配 ${sum.feasibleCount} 款候选机型 · 首选方案适配度约 <b>${sum.bestScoreHint !== null ? sum.bestScoreHint + '+ 分' : '-'}</b> · ${sum.topCount} 套推荐配置${sum.hasAlternative ? ' + 1 套备选' : ''}
          </div>
          <div class="chart-box" style="margin-top:18px"><h4>适配度得分对比</h4><div style="height:150px;background:rgba(46,124,255,.1);border:1px dashed rgba(96,145,255,.3);border-radius:8px"></div></div>
        </div>
        <div class="locked-overlay">
          <div class="lock-icon">🔒</div>
          <h3>完整测算结果付费解锁</h3>
          <p>解锁后可见：Top3 品牌型号与完整配置、适配度得分明细、柱状对比图、性价比排序与推荐理由。</p>
        </div>
      </div>`;
  }

  function renderUnlockPanel(v, taskId) {
    const b = state.bootstrap;
    const el = v.querySelector('#unlock-panel');
    el.innerHTML = `
      <div class="card">
        <h3 style="font-size:16px;margin-bottom:6px;color:var(--dark)">选择解锁方式</h3>
        <p style="font-size:13px;color:var(--gray);margin-bottom:6px">未付费仅可预览以上脱敏摘要</p>
        <div class="pay-cards" style="grid-template-columns:1fr">
          <div class="pay-card recommend">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <b style="font-size:16px;color:var(--dark)">${esc(b.pricing.report.name)}</b>
              <span style="font-size:24px;font-weight:800;color:var(--primary)">${b.pricing.report.price}<small style="font-size:12px;color:var(--gray)"> 元/${esc(b.pricing.report.unit)}</small></span>
            </div>
            <p style="font-size:13px;color:var(--gray);margin-bottom:14px">${esc(b.pricing.report.desc)}</p>
            <button class="btn btn-primary" data-buy="report">购买正式报告</button>
          </div>
          <div class="pay-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <b style="font-size:16px;color:var(--dark)">${esc(b.pricing.quick.name)}</b>
              <span style="font-size:24px;font-weight:800;color:var(--primary)">${b.pricing.quick.price}<small style="font-size:12px;color:var(--gray)"> 元/${esc(b.pricing.quick.unit)}</small></span>
            </div>
            <p style="font-size:13px;color:var(--gray);margin-bottom:14px">${esc(b.pricing.quick.desc)}</p>
            <button class="btn btn-ghost" data-buy="quick">购买快速测算</button>
          </div>
        </div>
      </div>`;
    el.querySelectorAll('[data-buy]').forEach(btn => {
      btn.onclick = () => buyProduct(taskId, btn.dataset.buy, () => renderResult(v, taskId));
    });
  }

  async function renderCalcDetail(v, taskId, ent) {
    const panel = v.querySelector('#detail-panel');
    panel.innerHTML = `<div class="loading"><span class="spin"></span>正在载入完整结果…</div>`;
    let calc;
    try { calc = await ssp.api('/api/tasks/' + taskId + '/calc'); } catch (e) { panel.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

    const plans = [...calc.top3, calc.alternative].filter(Boolean);
    const planCard = (p, isAlt) => `
      <div class="card plan-card ${isAlt ? 'alt' : ''}" style="margin-bottom:16px">
        <div class="plan-rank">
          <span class="rank-no">#${p.rank}</span>
          <div>
            <div class="plan-name">${esc(p.brand)} ${esc(p.model)}</div>
            <div><span class="badge ${isAlt ? 'badge-orange' : 'badge-blue'}">${isAlt ? '备选方案' : (p.rank === 1 ? '首选推荐' : '推荐' + p.rank)}</span>
            <span class="badge badge-gray">${esc(p.category)}</span>
            ${p.overBudget ? '<span class="badge badge-red">超预算</span>' : ''}</div>
          </div>
          <div style="margin-left:auto;text-align:right">
            <div class="score-big" style="font-size:30px">${p.scores.total}</div>
            <div style="font-size:12px;color:var(--gray)">适配度得分</div>
          </div>
        </div>
        <div class="score-pills">
          <span class="score-pill">性能匹配 <b>${p.scores.performance}</b></span>
          <span class="score-pill">性价比 <b>${p.scores.value}</b></span>
          <span class="score-pill">功耗 <b>${p.scores.power}</b></span>
          <span class="score-pill">维保供货 <b>${p.scores.service}</b></span>
        </div>
        <div class="plan-grid">
          <div><b>CPU</b>${esc(p.cpuDesc)}</div>
          <div><b>GPU</b>${esc(p.gpuDesc)}</div>
          <div><b>内存</b>${esc(p.memDesc)}</div>
          <div><b>存储</b>${esc(p.storageDesc)}</div>
          <div><b>网络</b>${esc(p.networkDesc)}</div>
          <div><b>部署</b>${p.nodes} 台 · 整机功耗 ${p.powerKW} kW · ${p.warranty}年维保 · ${p.deliveryWeeks}周供货</div>
          <div><b>单价</b>${fmtMoney(p.unitPrice)}</div>
          <div><b>总价</b><span style="color:var(--primary);font-weight:700">${fmtMoney(p.totalPrice)}</span></div>
        </div>
        <ul class="reasons">${(p.reasons || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      </div>`;

    panel.innerHTML = `
      ${ent.reportUnlocked ? `
        <div class="card" style="margin-bottom:16px;border:2px solid var(--primary);display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div style="flex:1"><b style="color:var(--dark)">已解锁正式选型报告</b>
          <div style="font-size:13px;color:var(--gray)">六章完整报告含横向对比矩阵、性价比排序与风险提示</div></div>
          <a class="btn btn-primary" href="#/report/${esc(taskId)}">查看完整报告</a>
          <button class="btn btn-ghost" id="btn-pdf-1">下载 PDF</button>
        </div>` : `
        <div class="card" style="margin-bottom:16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div style="flex:1"><b style="color:var(--dark)">需要正式选型报告？</b>
          <div style="font-size:13px;color:var(--gray)">六章完整报告 + PDF 下载，${state.bootstrap.pricing.report.price} 元/份</div></div>
          <button class="btn btn-primary" id="btn-buy-report2">购买正式报告</button>
        </div>`}
      <div class="chart-box" style="margin-bottom:16px">
        <h4>候选方案适配度得分对比（满分100，权重：性能${Math.round(calc.weights.performance * 100)}% / 性价比${Math.round(calc.weights.value * 100)}% / 功耗${Math.round(calc.weights.power * 100)}% / 维保${Math.round(calc.weights.service * 100)}%）</h4>
        <canvas id="result-chart"></canvas>
      </div>
      ${calc.top3.map(p => planCard(p, false)).join('')}
      ${calc.alternative ? planCard(calc.alternative, true) : ''}
      <div class="card" style="margin-bottom:16px">
        <h3 style="font-size:16px;color:var(--dark);margin-bottom:12px">性价比排序（综合算力/万元指数）</h3>
        <div class="table-wrap" style="box-shadow:none">
          <table class="tbl">
            <thead><tr><th>排名</th><th>品牌型号</th><th class="num">性价比指数</th><th class="num">总价</th><th class="center">适配度</th></tr></thead>
            <tbody>${calc.valueRanking.map(r => `
              <tr><td class="center">${r.rank}</td><td>${esc(r.name)}</td>
              <td class="num">${r.valueIndex}</td><td class="num">${fmtMoney(r.totalPrice)}</td><td class="center"><b style="color:var(--primary)">${r.totalScore}</b></td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h3 style="font-size:16px;color:var(--dark);margin-bottom:8px">筛选过程说明</h3>
        ${(calc.filterNotes || []).map(n => `<p style="font-size:13px;color:var(--gray);margin-bottom:4px">· ${esc(n)}</p>`).join('')}
      </div>`;

    requestAnimationFrame(() => {
      sspCharts.drawBarChart(panel.querySelector('#result-chart'),
        plans.map(p => ({ label: `${p.brand} ${p.model}`, value: p.scores.total, sub: p.rank === 4 ? '备选' : (p.rank === 1 ? '首选' : `推荐${p.rank}`) })),
        { theme: 'dark' });
    });
    const pdfBtn = panel.querySelector('#btn-pdf-1');
    if (pdfBtn) pdfBtn.onclick = () => downloadPdf(taskId);
    const buy2 = panel.querySelector('#btn-buy-report2');
    if (buy2) buy2.onclick = () => buyProduct(taskId, 'report', () => renderResult(v, taskId));
  }

  // ---------- 购买与支付 ----------
  function buyProduct(taskId, productId, onSuccess) {
    if (!ssp.token) {
      SS.setItem('ssp_return', location.hash);
      toast('请先登录后再购买');
      location.hash = '#/login';
      return;
    }
    ssp.api('/api/orders', { body: { taskId, productId } }).then(({ order }) => {
      showPayModal(order, onSuccess);
    }).catch(err => {
      if (err.message && err.message.indexOf('已购买') >= 0) { toast(err.message, 'ok'); onSuccess && onSuccess(); return; }
      toast(err.message, 'err');
    });
  }

  function showPayModal(order, onPaid) {
    const mask = modal(`
      <h3>确认支付订单</h3>
      <table class="kv-table">
        <tr><td>订单编号</td><td><b>${esc(order.orderNo)}</b></td></tr>
        <tr><td>商品</td><td>${esc(order.productName)}</td></tr>
        <tr><td>关联测算任务</td><td>${esc(order.taskId)}</td></tr>
        <tr><td>应付金额</td><td><b style="color:var(--primary);font-size:18px">${fmtMoney(order.amount)}</b></td></tr>
        <tr><td>报告版本</td><td>${esc(order.reportVersion)}</td></tr>
      </table>
      <div class="notice" style="margin-top:14px;padding:10px 14px">演示环境为<b>模拟支付</b>：点击下方按钮即视为支付成功并解锁内容，正式环境可对接微信/支付宝/对公转账。</div>
      <div class="modal-actions">
        <button class="btn btn-plain" id="pay-cancel">取消</button>
        <button class="btn btn-primary" id="pay-go">模拟支付 ${fmtMoney(order.amount)}</button>
      </div>`);
    mask.querySelector('#pay-cancel').onclick = closeModal;
    mask.querySelector('#pay-go').onclick = async () => {
      const btn = mask.querySelector('#pay-go');
      btn.disabled = true; btn.textContent = '支付中…';
      try {
        await ssp.api('/api/orders/' + order.id + '/pay', { method: 'POST', body: {} });
        closeModal();
        toast('支付成功，内容已解锁', 'ok');
        onPaid && onPaid();
      } catch (err) {
        btn.disabled = false; btn.textContent = '模拟支付 ' + fmtMoney(order.amount);
        toast(err.message, 'err');
      }
    };
  }

  function downloadPdf(taskId) {
    ssp.apiDownload('/api/tasks/' + taskId + '/report.pdf', `选型测算报告_${taskId}.pdf`).catch(e => toast(e.message, 'err'));
  }

  // ---------- 报告页 ----------
  async function renderReport(v, taskId) {
    v.innerHTML = `<div class="loading"><span class="spin"></span>正在生成报告视图…</div>`;
    let r;
    try { r = await ssp.api('/api/tasks/' + taskId + '/report'); } catch (e) {
      v.innerHTML = `
        <div class="empty"><div class="icon">🔒</div>${esc(e.message)}<br><br>
        <a class="btn btn-primary" href="#/result/${esc(taskId)}">返回结果页购买正式报告</a></div>`;
      return;
    }
    const scorePills = p => `<span class="score-pill">性能 <b>${p.scores.performance}</b></span><span class="score-pill">性价比 <b>${p.scores.value}</b></span><span class="score-pill">功耗 <b>${p.scores.power}</b></span><span class="score-pill">维保 <b>${p.scores.service}</b></span>`;
    v.innerHTML = `
      <div class="report-actions no-print">
        <button class="btn btn-primary" id="btn-pdf">下载 PDF 版本</button>
        <button class="btn btn-ghost" id="btn-print">打印 / 另存为 PDF</button>
        <a class="btn btn-plain" href="#/result/${esc(taskId)}">返回结果页</a>
      </div>
      <div class="report-doc">
        <div class="report-head">
          <h1>${esc(r.title)}</h1>
          <div class="meta">
            <span>报告版本：${esc(r.reportVersion)}</span>
            <span>生成时间：${fmtTime(r.generatedAt)}</span>
            <span>测算任务：${esc(r.taskId)}</span>
            ${r.orderNo ? `<span>订单编号：${esc(r.orderNo)}</span>` : ''}
          </div>
        </div>

        <div class="report-sec">
          <h2>${esc(r.ch1.title)}</h2>
          <div class="table-wrap" style="box-shadow:none"><table class="kv-table">
            ${r.ch1.rows.map(([k, val]) => `<tr><td style="width:150px">${esc(k)}</td><td>${esc(val)}</td></tr>`).join('')}
          </table></div>
        </div>

        <div class="report-sec">
          <h2>${esc(r.ch2.title)}</h2>
          <p>负载画像：<b>${esc(r.ch2.profile)}</b>　并发规模：<b>${esc(r.ch2.scaleLevel)}</b></p>
          <p class="note">${esc(r.ch2.intro)}</p>
          <h3>容量需求换算明细</h3>
          <div class="table-wrap" style="box-shadow:none"><table class="tbl" style="min-width:560px">
            <thead><tr><th>换算项</th><th>推荐值</th><th>计算依据（规则表系数）</th></tr></thead>
            <tbody>${r.ch2.derivations.map(d => `<tr><td><b>${esc(d.item)}</b></td><td style="white-space:nowrap">${esc(d.value)}</td><td style="color:var(--gray)">${esc(d.basis)}</td></tr>`).join('')}</tbody>
          </table></div>
          <h3>筛选过程说明</h3>
          ${r.ch2.notes.map(n => `<p class="note">· ${esc(n)}</p>`).join('')}
        </div>

        <div class="report-sec">
          <h2>${esc(r.ch3.title)}</h2>
          <p class="note">${esc(r.ch3.intro)}</p>
          <div class="table-wrap" style="box-shadow:none"><table class="tbl" style="min-width:840px">
            <thead><tr><th>序位</th><th>品牌型号</th><th>CPU配置</th><th>GPU</th><th>内存</th><th>存储</th><th>单价</th><th>数量</th><th>总价</th><th class="center">适配度</th></tr></thead>
            <tbody>
              ${r.ch3.plans.map(p => `<tr>
                <td><span class="badge badge-blue">${esc(p.tag)}</span></td>
                <td><b>${esc(p.name)}</b></td>
                <td>${esc(p.cpu)}</td><td>${esc(p.gpu)}</td>
                <td>${esc(p.memory)}</td><td>${esc(p.storage)}</td>
                <td class="num">${fmtMoney(p.unitPrice)}</td><td class="center">${p.nodes}台</td>
                <td class="num"><b>${fmtMoney(p.totalPrice)}</b></td>
                <td class="center"><b style="color:var(--primary);font-size:15px">${p.score}</b></td>
              </tr>`).join('')}
            </tbody>
          </table></div>
          ${r.ch3.plans.map(p => `
            <h3>${esc(p.tag)}：${esc(p.name)}（适配度 ${p.score} 分）</h3>
            <p style="margin-bottom:6px">${scorePills(p)}</p>
            <ul class="reasons" style="margin-top:6px">${p.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}
          ${r.ch3.alternative.length ? `
            <h3>备选方案</h3>
            <div class="table-wrap" style="box-shadow:none"><table class="tbl">
              <thead><tr><th>方案</th><th>配置概要</th><th>GPU</th><th class="num">总价</th><th class="center">适配度</th></tr></thead>
              <tbody>${r.ch3.alternative.map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.cpu)}</td><td>${esc(p.gpu)}</td><td class="num">${fmtMoney(p.totalPrice)}</td><td class="center"><b>${p.score}</b></td></tr>`).join('')}</tbody>
            </table></div>` : ''}
        </div>

        <div class="report-sec">
          <h2>适配度柱状对比图</h2>
          <div class="chart-box"><canvas id="report-chart"></canvas></div>
        </div>

        <div class="report-sec">
          <h2>${esc(r.ch4.title)}</h2>
          <div class="table-wrap" style="box-shadow:none"><table class="tbl" style="min-width:760px">
            <thead><tr><th>对比维度</th>${r.ch4.names.map((n, i) => `<th>${esc(r.ch4.columns[i])}<br><span style="font-weight:400;color:var(--gray)">${esc(n)}</span></th>`).join('')}</tr></thead>
            <tbody>${r.ch4.rows.map(row => `<tr><td><b>${esc(row.dim)}</b></td>${row.vals.map(val => `<td>${esc(val)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>
        </div>

        <div class="report-sec">
          <h2>${esc(r.ch5.title)}</h2>
          <div class="table-wrap" style="box-shadow:none"><table class="tbl">
            <thead><tr><th class="center">排名</th><th>品牌型号</th><th class="num">性价比指数（算力/万元）</th><th class="num">总价</th><th class="center">适配度得分</th></tr></thead>
            <tbody>${r.ch5.ranking.map(x => `<tr><td class="center">${x.rank}</td><td>${esc(x.name)}</td><td class="num">${x.valueIndex}</td><td class="num">${esc(x.totalPriceText)}</td><td class="center"><b>${x.totalScore}</b></td></tr>`).join('')}</tbody>
          </table></div>
          <h3>选型建议</h3>
          ${r.ch5.advice.map(a => `<p>· ${esc(a)}</p>`).join('')}
        </div>

        <div class="report-sec">
          <h2>${esc(r.ch6.title)}</h2>
          ${r.ch6.risks.map(k => `<div class="risk-item"><span class="badge badge-orange">${esc(k.type)}</span><div>${esc(k.text)}</div></div>`).join('')}
        </div>

        <div class="report-sec">
          <h2>${esc(r.appendix.title)}</h2>
          <div class="appendix">
            <p><b>参数假设：</b></p><p>${esc(r.appendix.assumptions)}</p>
            <p style="margin-top:10px"><b>免责声明：</b></p><p>${esc(r.appendix.disclaimer)}</p>
            <p style="margin-top:10px">评分权重：${esc(r.appendix.weightsUsed)}（规则版本 ${esc(r.appendix.rulesVersion)}）</p>
          </div>
        </div>
      </div>`;
    requestAnimationFrame(() => {
      sspCharts.drawBarChart(v.querySelector('#report-chart'),
        r.chart.items.map(it => ({ label: it.name, value: it.score, sub: it.tag })),
        { theme: 'light' });
    });
    v.querySelector('#btn-pdf').onclick = () => downloadPdf(taskId);
    v.querySelector('#btn-print').onclick = () => window.print();
  }

  // ---------- 订单页 ----------
  async function renderOrders(v) {
    if (!state.user) {
      SS.setItem('ssp_return', '#/orders');
      v.innerHTML = `<div class="empty"><div class="icon">👤</div>登录后可查看历史订单与已购报告<br><br><a class="btn btn-primary" href="#/login">去登录</a></div>`;
      return;
    }
    v.innerHTML = `<div class="loading"><span class="spin"></span>正在载入订单…</div>`;
    let orders;
    try { orders = (await ssp.api('/api/orders')).orders; } catch (e) { errorPage(v, e); return; }
    if (!orders.length) {
      v.innerHTML = `<div class="page-head"><div><div class="page-title">我的订单</div><div class="page-sub">订单与已购报告可长期追溯、可复看</div></div></div>
        <div class="empty"><div class="icon">📋</div>暂无订单<br><br><a class="btn btn-primary" href="#/form">开始一次测算</a></div>`;
      return;
    }
    v.innerHTML = `
      <div class="page-head"><div><div class="page-title">我的订单</div>
      <div class="page-sub">共 ${orders.length} 笔订单 · 已支付订单可反复查看/下载对应内容</div></div></div>
      <div class="table-wrap"><table class="tbl" style="min-width:860px">
        <thead><tr><th>订单编号</th><th>商品</th><th>关联任务</th><th class="num">金额</th><th>状态</th><th>下单时间</th><th>支付时间</th><th>报告版本</th><th>操作</th></tr></thead>
        <tbody>${orders.map(o => `
          <tr>
            <td><b>${esc(o.orderNo)}</b></td>
            <td>${esc(o.productName)}</td>
            <td><a href="#/result/${esc(o.taskId)}">${esc(o.taskId)}</a></td>
            <td class="num">${fmtMoney(o.amount)}</td>
            <td>${o.status === 'paid' ? '<span class="badge badge-green">已支付</span>' : '<span class="badge badge-orange">待支付</span>'}</td>
            <td style="white-space:nowrap">${fmtTime(o.createdAt)}</td>
            <td style="white-space:nowrap">${fmtTime(o.paidAt)}</td>
            <td>${esc(o.reportVersion)}</td>
            <td style="white-space:nowrap">${
              o.status === 'paid'
                ? (o.productId === 'report'
                    ? `<a class="btn btn-sm btn-primary" href="#/report/${esc(o.taskId)}">查看报告</a> <button class="btn btn-sm btn-ghost" data-pdf="${esc(o.taskId)}">PDF</button>`
                    : `<a class="btn btn-sm btn-primary" href="#/result/${esc(o.taskId)}">查看测算结果</a>`)
                : `<button class="btn btn-sm btn-warn" data-pay="${esc(o.id)}">去支付</button>`
            }</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
    v.querySelectorAll('[data-pay]').forEach(btn => {
      btn.onclick = async () => {
        try {
          const { order } = await ssp.api('/api/orders/' + btn.dataset.pay);
          showPayModal(order, () => renderOrders(v));
        } catch (e) { toast(e.message, 'err'); }
      };
    });
    v.querySelectorAll('[data-pdf]').forEach(btn => { btn.onclick = () => downloadPdf(btn.dataset.pdf); });
  }

  // ---------- 登录 / 注册 ----------
  function renderLogin(v, _param, query) {
    v.innerHTML = `
      <div class="card auth-card">
        <h2>登录账号</h2>
        <div class="sub">登录后可购买解锁、查看历史订单与已购报告</div>
        <form id="login-form" novalidate>
          <div class="field"><label>用户名</label><input name="username" autocomplete="username" placeholder="请输入用户名"><div class="err-msg"></div></div>
          <div class="field"><label>密码</label><input name="password" type="password" autocomplete="current-password" placeholder="请输入密码"><div class="err-msg"></div></div>
          <button class="btn btn-primary btn-lg" style="width:100%;margin-top:8px" type="submit">登 录</button>
        </form>
        <div class="auth-tip">还没有账号？<a href="#/register">立即注册</a>（注册免费，试算无需登录）<br>管理后台演示账号：admin / Admin@123</div>
      </div>`;
    const form = v.querySelector('#login-form');
    form.onsubmit = async e => {
      e.preventDefault();
      const username = form.username.value.trim(), password = form.password.value;
      const em = form.querySelectorAll('.err-msg');
      form.querySelectorAll('.field').forEach(f => f.classList.remove('invalid'));
      em.forEach(m => m.textContent = '');
      if (!username) { form.username.closest('.field').classList.add('invalid'); em[0].textContent = '请输入用户名'; return; }
      if (!password) { form.password.closest('.field').classList.add('invalid'); em[1].textContent = '请输入密码'; return; }
      try {
        const res = await ssp.api('/api/auth/login', { body: { username, password } });
        ssp.setToken(res.token);
        state.user = res.user;
        renderUserArea();
        toast('登录成功，欢迎 ' + (res.user.displayName || res.user.username), 'ok');
        location.hash = SS.getItem('ssp_return') || '#/';
        SS.removeItem('ssp_return');
      } catch (err) { toast(err.message, 'err'); }
    };
  }

  function renderRegister(v) {
    v.innerHTML = `
      <div class="card auth-card">
        <h2>注册账号</h2>
        <div class="sub">注册免费，游客也可直接试填测算</div>
        <form id="reg-form" novalidate>
          <div class="field"><label>用户名</label><input name="username" placeholder="3~20位字母、数字、下划线或中文"><div class="err-msg"></div></div>
          <div class="field"><label>昵称（选填）</label><input name="displayName" placeholder="用于页面显示"></div>
          <div class="field"><label>密码</label><input name="password" type="password" placeholder="至少6位"><div class="err-msg"></div></div>
          <div class="field"><label>确认密码</label><input name="password2" type="password" placeholder="再次输入密码"><div class="err-msg"></div></div>
          <button class="btn btn-primary btn-lg" style="width:100%;margin-top:8px" type="submit">注 册</button>
        </form>
        <div class="auth-tip">已有账号？<a href="#/login">直接登录</a></div>
      </div>`;
    const form = v.querySelector('#reg-form');
    form.onsubmit = async e => {
      e.preventDefault();
      const f = { username: form.username.value.trim(), displayName: form.displayName.value.trim(), password: form.password.value, password2: form.password2.value };
      const em = form.querySelectorAll('.err-msg');
      form.querySelectorAll('.field').forEach(x => x.classList.remove('invalid'));
      em.forEach(m => m.textContent = '');
      const setE = (i, msg) => { form.querySelectorAll('.field')[i].classList.add('invalid'); em[i].textContent = msg; };
      if (f.username.length < 3) return setE(0, '用户名至少3位');
      if (f.password.length < 6) return setE(1, '密码长度至少6位');
      if (f.password !== f.password2) return setE(2, '两次输入的密码不一致');
      try {
        const res = await ssp.api('/api/auth/register', { body: { username: f.username, password: f.password, displayName: f.displayName } });
        ssp.setToken(res.token);
        state.user = res.user;
        renderUserArea();
        toast('注册成功，已自动登录', 'ok');
        location.hash = SS.getItem('ssp_return') || '#/';
        SS.removeItem('ssp_return');
      } catch (err) {
        if (err.message.indexOf('用户名') >= 0) setE(0, err.message); else toast(err.message, 'err');
      }
    };
  }

  // ---------- 管理后台入口（实现在 admin.js） ----------
  function renderAdmin(v) {
    if (!state.user) {
      SS.setItem('ssp_return', '#/admin');
      v.innerHTML = `<div class="empty"><div class="icon">🛡️</div>管理后台需要管理员登录<br><br><a class="btn btn-primary" href="#/login">去登录</a></div>`;
      return;
    }
    if (state.user.role !== 'admin') {
      v.innerHTML = `<div class="empty"><div class="icon">⛔</div>当前账号无管理员权限，请使用管理员账号登录</div>`;
      return;
    }
    if (window.sspAdmin && typeof sspAdmin.render === 'function') sspAdmin.render(v);
    else v.innerHTML = `<div class="empty">管理模块加载失败，请刷新页面</div>`;
  }

  // ---------- 导出共享工具 & 启动 ----------
  window.sspUI = { esc, fmtMoney, fmtTime, toast, modal, closeModal, confirmDialog, optLabel, state };

  (async function init() {
    try { state.bootstrap = await ssp.api('/api/bootstrap'); }
    catch (e) {
      $view().innerHTML = `<div class="empty"><div class="icon">🔌</div>后端服务未启动或不可达，请先运行 server 目录下的服务<br><br><code>npm start</code></div>`;
      return;
    }
    try { state.user = (await ssp.api('/api/auth/me')).user; } catch (e) { state.user = null; }
    renderUserArea();
    window.addEventListener('hashchange', route);
    route();
  })();
})();
