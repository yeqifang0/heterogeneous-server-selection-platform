// API 请求封装：统一携带令牌、错误透出中文提示
(function () {
  const TOKEN_KEY = 'ssp_token';

  // 存储容错：部分内嵌浏览器（微信/QQ 内核、沙箱 iframe、隐私模式）禁用 localStorage，
  // 统一降级为内存存储保证可用（降级后刷新页面会丢失登录态/草稿，属预期行为）
  var SSPStorage = (function () {
    function memStore() {
      var mem = {};
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem: function (k, v) { mem[k] = String(v); },
        removeItem: function (k) { delete mem[k]; },
        clear: function () { mem = {}; }
      };
    }
    function pick(native) {
      try { var t = '__ssp_probe__'; native.setItem(t, '1'); native.removeItem(t); return native; }
      catch (e) { return memStore(); }
    }
    var out = {};
    try { out.local = pick(window.localStorage); } catch (e) { out.local = memStore(); }
    try { out.session = pick(window.sessionStorage); } catch (e) { out.session = memStore(); }
    return out;
  })();
  window.SSPStorage = SSPStorage;

  class ApiError extends Error {
    constructor(message, fields) {
      super(message);
      this.fields = fields || null;
    }
  }

  async function api(path, opts = {}) {
    const headers = {};
    const token = SSPStorage.local.getItem(TOKEN_KEY);
    if (token) headers.Authorization = 'Bearer ' + token;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, {
      method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* 非JSON响应 */ }
    if (!res.ok) throw new ApiError(data.error || ('请求失败（HTTP ' + res.status + '）'), data.fields);
    return data;
  }

  // 带鉴权的文件下载（PDF）
  async function apiDownload(path, filename) {
    const headers = {};
    const token = SSPStorage.local.getItem(TOKEN_KEY);
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(path, { headers });
    if (!res.ok) {
      let msg = '下载失败（HTTP ' + res.status + '）';
      try { const j = await res.json(); msg = j.error || msg; } catch (e) { /* ignore */ }
      throw new ApiError(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'report.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  window.ssp = {
    api, apiDownload, ApiError,
    get token() { return SSPStorage.local.getItem(TOKEN_KEY); },
    setToken(t) { t ? SSPStorage.local.setItem(TOKEN_KEY, t) : SSPStorage.local.removeItem(TOKEN_KEY); }
  };
})();
