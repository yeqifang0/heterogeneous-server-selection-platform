// 轻量柱状图（Canvas，无外部依赖，DPR 自适应，支持深/浅主题）
(function () {
  const THEMES = {
    dark: { grid: 'rgba(96,145,255,0.14)', tick: '#5F7398', label: '#8CA3CF', value: '#E8F0FF',
            sub: '#00E5FF', g1: '#00E5FF', g2: '#2E7CFF' },
    light: { grid: '#E7EDF8', tick: '#93A1BE', label: '#5A6B8C', value: '#12224A',
             sub: '#1B5CFF', g1: '#4D8BFF', g2: '#1B5CFF' }
  };

  function drawBarChart(canvas, items, opts = {}) {
    if (!canvas || !items || !items.length) return;
    const T = THEMES[opts.theme === 'light' ? 'light' : 'dark'];
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    const cssH = canvas.clientHeight || 260;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    const pad = { top: 26, right: 14, bottom: 44, left: 34 };
    const plotW = cssW - pad.left - pad.right;
    const plotH = cssH - pad.top - pad.bottom;
    const maxV = Math.max(opts.max || 100, Math.ceil(Math.max(...items.map(i => i.value)) / 10) * 10);
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
    grad.addColorStop(0, T.g1);
    grad.addColorStop(1, T.g2);

    // 网格与Y轴刻度
    ctx.strokeStyle = T.grid; ctx.fillStyle = T.tick;
    ctx.font = '11px "Microsoft YaHei", sans-serif'; ctx.textAlign = 'right';
    for (let g = 0; g <= 4; g++) {
      const v = maxV / 4 * g;
      const y = pad.top + plotH - plotH * g / 4;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + plotW, y); ctx.stroke();
      ctx.fillText(String(Math.round(v)), pad.left - 6, y + 4);
    }

    const n = items.length;
    const slot = plotW / n;
    const barW = Math.min(64, slot * 0.48);
    items.forEach((it, i) => {
      const cx = pad.left + slot * i + slot / 2;
      const h = Math.max(4, it.value / maxV * plotH);
      const y = pad.top + plotH - h;
      ctx.fillStyle = grad;
      roundRect(ctx, cx - barW / 2, y, barW, h, 6);
      ctx.fill();
      if (opts.theme !== 'light') {
        ctx.shadowColor = 'rgba(0,198,255,0.45)'; ctx.shadowBlur = 12;
        ctx.fill(); ctx.shadowBlur = 0;
      }
      // 数值
      ctx.fillStyle = T.value;
      ctx.font = 'bold 13px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(it.value), cx, y - 7);
      // 名称（自动换行为两行）
      ctx.fillStyle = T.label;
      ctx.font = '11.5px "Microsoft YaHei", sans-serif';
      const label = it.label || '';
      const line1 = label.length > 9 ? label.slice(0, 9) : label;
      const line2 = label.length > 9 ? label.slice(9, 18) : '';
      ctx.fillText(line1, cx, pad.top + plotH + 16);
      if (line2) ctx.fillText(line2, cx, pad.top + plotH + 30);
      if (it.sub) {
        ctx.fillStyle = T.sub;
        ctx.fillText(it.sub, cx, pad.top + plotH + (line2 ? 44 : 30));
      }
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  window.sspCharts = { drawBarChart };
})();
