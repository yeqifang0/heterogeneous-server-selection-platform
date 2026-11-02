// API 请求封装：统一携带令牌、错误透出中文提示
(function () {
  const TOKEN_KEY = 'ssp_token';

  class ApiError extends Error {
    constructor(message, fields) {
      super(message);
      this.fields = fields || null;
    }
  }

  async function api(path, opts = {}) {
    const headers = {};
    const token = localStorage.getItem(TOKEN_KEY);
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
    const token = localStorage.getItem(TOKEN_KEY);
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
    get token() { return localStorage.getItem(TOKEN_KEY); },
    setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }
  };
})();
