/* ==========================================================================
   app.js —— 交互产品 v2（配套 app.html / app_data.js / app_data2.js）

   架构：两个顶层 Tab
     · 总观  单页滚动，从大盘看到行业/区域/退出的全貌，每页带年份切片器
     · 企业  一页看完一家企业：体检 + 行业/区域/退出上下文糅合在一起

   零依赖，纯 SVG 手绘图表，双击 HTML 即可离线运行
   ========================================================================== */
(function () {
  "use strict";

  const D = window.APP_DATA;
  const D2 = window.APP_DATA2;
  const D3 = window.APP_DATA3;
  if (!D || !D2) {
    document.body.innerHTML = "<p style='padding:40px'>未找到 app_data.js / app_data2.js，请与 app.html 放在同一目录。</p>";
    return;
  }
  if (!D3) {
    document.body.innerHTML = "<p style='padding:40px'>未找到 app_data3.js，请运行 100_ext.py 生成。</p>";
    return;
  }

  /* ==================== 全局状态 ==================== */
  const STATE = {
    year: D.meta.year_hi,          // 全局年份切片器
    tab: "overview",
    firm: null,                    // 当前企业 code
    indPick: null,                 // 行业页选中的行业
    provPick: null,                // 区域页选中的省
    exitInd: null,                 // 退出诊断选中的行业
    posPick: null,                 // 行业定位图点中的行业
    indMetric: "score",            // 行业排序指标
    provMetric: "ovs_rate",        // 区域排序指标
    exitMode: "overall",           // overall | industry
  };

  /* ==================== 数据索引 ==================== */
  const IND = D.industry.names;
  const IND_ROWS = D.industry.rows;
  const IND_COLS = D.industry.cols;
  const indObj = {};
  IND_ROWS.forEach(r => {
    const o = {};
    IND_COLS.forEach((c, i) => o[c] = r[i]);
    indObj[o.name] = o;
  });
  const PROV = D.province.names;
  const provObj = {};
  D.province.rows.forEach(r => {
    const o = {};
    D.province.cols.forEach((c, i) => o[c] = r[i]);
    provObj[o.name] = o;
  });

  /* 行业 × 年：map key = ind + "|" + year */
  const IY = {};
  D2.ind_year.rows.forEach(r => {
    const o = {};
    D2.ind_year.cols.forEach((c, i) => o[c] = r[i]);
    IY[o.ind + "|" + o.year] = o;
  });
  /* 省份 × 年 */
  const PY = {};
  D2.prov_year.rows.forEach(r => {
    const o = {};
    D2.prov_year.cols.forEach((c, i) => o[c] = r[i]);
    PY[o.prov + "|" + o.year] = o;
  });
  /* 逐年规模分位 */
  const TY = {};
  D2.thr_year.rows.forEach(r => {
    const o = {};
    D2.thr_year.cols.forEach((c, i) => o[c] = r[i]);
    TY[r.year + "|" + r.bin] = o;
  });
  const YO = {};
  D2.year_overview.forEach(o => YO[o.year] = o);

  const F = D.firms;
  const F_IDX = F.map(f => (f[0] + " " + f[1]).toLowerCase());
  const FX = D2.firm_x;            // 企业补充字段（仅出海）
  const STRESS = D2.stress;        // 压力量算
  const STOP = D2.stop;            // 止损规则判定
  const PEER = D2.peer;            // 模拟轨迹基准线
  const INDKM = D2.ind_km;         // 行业级 KM

  /* v3 增量数据（100_ext.py 产出） */
  const YT = {};                   // 年份 → 全局趋势
  D3.year_trend.forEach(o => YT[o.year] = o);
  const INDTREND = D3.ind_trend;   // 行业十年轨迹
  const IYMED = D3.ind_year_med;   // 全行业中位（按年）
  const PROVTREND = D3.prov_trend; // 省份十年轨迹
  const PYMED = D3.prov_year_med;  // 全省中位（按年）
  const PEERD = D3.peer_dist;      // 同侪分布带：ind||dec → 分位
  const PEERPOS = D3.peer_pos;     // 企业在同侪里的位置

  // 企业数组: [code,name,indIdx,provIdx,hasOvs,ratio,gap,sizePct,tenure,risk,verdict,
  //             gapVsInd,domGm,ratioPct,domPct,p1,p2,pImp,gapBad]
  const VERDICT = ["数据不足以判断", "加码", "维持", "未出海", "收缩"];
  const VCOLOR = ["#8A94A6", "#C0392B", "#2E86AB", "#6B7A8F", "#4A8B6F"];
  const YEARS = D2.meta.years;
  const LAST = D2.meta.last;

  /* ==================== 工具 ==================== */
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v)) ? "—" : Number(v).toFixed(d);
  const pct = v => (v === null || v === undefined || Number.isNaN(v)) ? "—" : Number(v).toFixed(1) + "%";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sign = (v, d = 2) => v == null ? "—" : (v > 0 ? "+" : "") + Number(v).toFixed(d);
  const yuan = v => v == null ? "—" : Number(v).toFixed(2) + " 亿";

  /* ==================== 极简 SVG 图表库 ==================== */
  function svgWrap(w, h, inner) {
    return `<svg viewBox="0 0 ${w} ${h}" class="chart" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
  }
  function txt(x, y, s, opt = {}) {
    /* halo：白描边 + paint-order=stroke，让文字压在虚线/网格线上时依然清晰 */
    const halo = opt.halo
      ? ` stroke="#FFFFFF" stroke-width="${opt.halo}" stroke-linejoin="round" paint-order="stroke"`
      : "";
    return `<text x="${x}" y="${y}" font-size="${opt.size || 11}" fill="${opt.fill || "#4A5568"}"
      text-anchor="${opt.anchor || "start"}" font-weight="${opt.weight || 400}"${halo}
      ${opt.rotate ? `transform="rotate(${opt.rotate} ${x} ${y})"` : ""}>${esc(s)}</text>`;
  }
  function grid(pad, w, h, yTicks, xTicks, xPos, yPos) {
    let g = "";
    (yTicks || []).forEach(t => {
      const yy = yPos(t.v);
      g += `<line x1="${pad.l}" y1="${yy}" x2="${pad.l + w}" y2="${yy}" stroke="#EDF0F4" stroke-width="1"/>`;
      g += txt(pad.l - 6, yy + 3.5, t.label, { anchor: "end", size: 10, fill: "#8A94A6" });
    });
    (xTicks || []).forEach(t => {
      const xx = xPos(t.v);
      g += `<line x1="${xx}" y1="${pad.t}" x2="${xx}" y2="${pad.t + h}" stroke="#F3F5F8" stroke-width="1"/>`;
      g += txt(xx, pad.t + h + 15, t.label, { anchor: "middle", size: 10, fill: "#8A94A6" });
    });
    return g;
  }
  function ticks(min, max, n = 5) {
    if (max === min) { max = min + 1; }
    const raw = (max - min) / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
    const out = [];
    // 起点用 eps 修正：浮点误差会让 ceil(min/step) 比理论值大一点点，
    // 于是 1~9 的轴上第一个刻度 1 被吞掉
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) {
      out.push({ v: +v.toFixed(6), label: Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : (+v.toFixed(2)).toString() });
    }
    return out;
  }

  /* 散点图：o.stroke 为描边色（区分「真能赚钱」），o.hollow 为空心 */
  function scatter(rows, o) {
    const W = o.width || 720, H = o.height || 400, pad = { l: 52, r: 20, t: 18, b: 46 };
    const w = W - pad.l - pad.r, h = H - pad.t - pad.b;
    const xs = rows.map(r => r.x).filter(v => v != null);
    const ys = rows.map(r => r.y).filter(v => v != null);
    if (!xs.length || !ys.length) return emptyChart("没有可画的数据");
    const xmin = o.xmin != null ? o.xmin : Math.min(...xs) * 0.95;
    const xmax = o.xmax != null ? o.xmax : Math.max(...xs) * 1.02;
    const ymin = o.ymin != null ? o.ymin : Math.min(...ys, 0) * 1.15;
    const ymax = o.ymax != null ? o.ymax : Math.max(...ys, 0) * 1.15;
    const X = v => pad.l + (v - xmin) / (xmax - xmin || 1) * w;
    const Y = v => pad.t + h - (v - ymin) / (ymax - ymin || 1) * h;
    const rmax = Math.max(...rows.map(r => r.s || 1));
    const rad = r => 4 + Math.sqrt((r.s || 1) / rmax) * 13;
    let g = "";
    g += grid(pad, w, h, ticks(ymin, ymax, 5), ticks(xmin, xmax, 6), X, Y);
    if (ymin < 0 && ymax > 0) {
      g += `<line x1="${pad.l}" y1="${Y(0)}" x2="${pad.l + w}" y2="${Y(0)}" stroke="#B9C2CF" stroke-dasharray="4 3"/>`;
    }
    rows.forEach(r => {
      if (r.x == null || r.y == null) return;
      const st = r.stroke || r.c;
      const picked = o.pickField && r[o.pickField] === o.pickValue;
      g += `<circle cx="${X(r.x)}" cy="${Y(r.y)}" r="${rad(r)}" fill="${r.c}" fill-opacity="${r.hollow ? 0.18 : (picked ? 0.9 : 0.62)}"
        stroke="${picked ? "#1A2433" : st}" stroke-width="${picked ? 2.6 : (r.hollow ? 1.6 : 1.2)}"${r.dash && !picked ? ' stroke-dasharray="3 2"' : ""}
        ${o.pickField ? `data-pick="${esc(r[o.pickField])}" style="cursor:pointer"` : ""}><title>${esc(r.tip || r.label)}</title></circle>`;
    });
    // 标签避让
    const placed = [];
    rows.forEach(r => {
      if (r.x == null || r.y == null) return;
      const rr = rad(r);
      if (rr > 8) placed.push({ x: X(r.x) - rr * .85, y: Y(r.y) - rr * .85, w: rr * 1.7, h: rr * 1.7 });
    });
    const hit = (bx, by, bw, bh) => placed.some(p =>
      bx < p.x + p.w && bx + bw > p.x && by < p.y + p.h && by + bh > p.y);
    const labs = [];
    rows.filter(r => r.x != null && r.y != null && r.label && r.show !== false)
      .sort((a, b) => (b.s || 1) - (a.s || 1))
      .slice(0, o.labelTop || 1e9)
      .forEach(r => {
        const rr = rad(r), cx = X(r.x), cy = Y(r.y);
        const tw = String(r.label).length * 9.6 * 0.56, th = 11;
        const cands = [
          [cx, cy - rr - 5 - th], [cx, cy + rr + 7 + th],
          [cx, cy - rr - 7 - th * 2.1], [cx, cy + rr + 9 + th * 2.1],
          [cx + rr + 5 + tw / 2, cy + 3.5], [cx - rr - 5 - tw / 2, cy + 3.5],
        ];
        for (const [lx, ly] of cands) {
          const bx = lx - tw / 2, by = ly - th;
          if (bx < pad.l - 6 || bx + tw > pad.l + w + 6 || by < pad.t - 4 || by + th > pad.t + h + 12) continue;
          if (hit(bx - 2, by, tw + 4, th + 2)) continue;
          placed.push({ x: bx - 2, y: by, w: tw + 4, h: th + 2 });
          labs.push(txt(lx, ly, r.label, { anchor: "middle", size: 9.5, fill: "#4A5568" }));
          break;
        }
      });
    g += labs.join("");
    g += txt(pad.l + w / 2, H - 8, o.xlabel || "", { anchor: "middle", size: 11, fill: "#6B7A8F" });
    g += txt(14, pad.t + h / 2, o.ylabel || "", { anchor: "middle", size: 11, fill: "#6B7A8F", rotate: -90 });
    return svgWrap(W, H, g);
  }

  function emptyChart(msg) {
    return `<div class="empty">${esc(msg)}</div>`;
  }

  /* 横向条形图
     数字看不清是上一版的主要抱怨 → 字号 10→12.5、行高 24→28、数值区 56→76、标签 10.5→11.5 */
  function hbars(items, o = {}) {
    if (!items.length) return emptyChart(o.emptyMsg || "没有数据");
    const W = o.width || 360, rowH = o.rowH || 28, pad = { l: o.labelW || 118, r: o.valueW || 76, t: 6, b: 6 };
    const H = items.length * rowH + pad.t + pad.b;
    const w = W - pad.l - pad.r;
    const max = Math.max(...items.map(i => Math.abs(i.v))) || 1;
    const neg = items.some(i => i.v < 0);
    let g = "";
    if (neg) {
      const zx = pad.l + w / 2;
      const scale = v => Math.abs(v) / max * (w / 2);
      items.forEach((it, i) => {
        const y = pad.t + i * rowH;
        const bw = Math.max(scale(it.v), 1.5);
        const x0 = it.v >= 0 ? zx : zx - bw;
        g += txt(pad.l - 8, y + rowH / 2 + 4, it.label, { anchor: "end", size: 11.5, fill: "#3D4859" });
        g += `<rect x="${x0}" y="${y + 5}" width="${bw}" height="${rowH - 12}" rx="2.5"
          fill="${it.c || "#2E86AB"}" fill-opacity="0.85"><title>${esc(it.label)}: ${it.vt != null ? it.vt : it.v}</title></rect>`;
        g += txt(it.v >= 0 ? x0 + bw + 7 : x0 - 7, y + rowH / 2 + 4.5, it.vt != null ? it.vt : fmt(it.v),
          { size: 12.5, fill: "#3D4859", weight: 600, anchor: it.v >= 0 ? "start" : "end" });
      });
      g += `<line x1="${zx}" y1="${pad.t}" x2="${zx}" y2="${pad.t + items.length * rowH}" stroke="#B9C2CF" stroke-width="1"/>`;
    } else {
      items.forEach((it, i) => {
        const y = pad.t + i * rowH;
        const bw = Math.abs(it.v) / max * w;
        g += txt(pad.l - 8, y + rowH / 2 + 4, it.label, { anchor: "end", size: 11.5, fill: "#3D4859" });
        g += `<rect x="${pad.l}" y="${y + 5}" width="${Math.max(bw, 1.5)}" height="${rowH - 12}"
          rx="2.5" fill="${it.c || "#2E86AB"}" fill-opacity="0.85"><title>${esc(it.label)}: ${it.vt != null ? it.vt : it.v}</title></rect>`;
        g += txt(pad.l + Math.max(bw, 1.5) + 7, y + rowH / 2 + 4.5, it.vt != null ? it.vt : fmt(it.v),
          { size: 12.5, fill: "#3D4859", weight: 600 });
      });
    }
    return svgWrap(W, H, g);
  }

  /* 折线（带置信带）。x 为年份时传 xint；v 为 null 的断点会把线断开 */
  function lineChart(pts, o = {}) {
    const W = o.width || 720, H = o.height || 320, pad = { l: 50, r: 24, t: 20, b: 42 };
    const valid = pts.filter(p => p.v != null);
    if (!valid.length) return emptyChart(o.emptyMsg || "没有可画的数据");
    const w = W - pad.l - pad.r, h = H - pad.t - pad.b;
    const allY = pts.flatMap(p => [p.lo, p.hi, p.v].filter(v => v != null));
    const ymin = o.ymin != null ? o.ymin : Math.min(...allY, 0) * 1.1;
    const ymax = o.ymax != null ? o.ymax : Math.max(...allY, 0) * 1.15;
    const xs = pts.map(p => p.x);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    const X = v => pad.l + (v - xmin) / (xmax - xmin || 1) * w;
    const Y = v => pad.t + h - (v - ymin) / (ymax - ymin || 1) * h;
    let xt = ticks(xmin, xmax, o.xn || Math.min(pts.length, 10));
    if (o.xint) {
      // 先过滤越界刻度，再按 v 去重。原顺序（先去重后过滤）会把第一个越界刻度
      // 当成"前一个"，导致紧邻的合法刻度被误删（1~9 的轴上会丢掉 1 或 9）
      xt = xt.map(t => ({ v: Math.round(t.v), label: String(Math.round(t.v)) }))
        .filter(t => t.v >= xmin && t.v <= xmax)
        .filter((t, i, a) => i === 0 || t.v !== a[i - 1].v);
    }
    let g = grid(pad, w, h, ticks(ymin, ymax, 5), xt, X, Y);
    if (ymin < 0 && ymax > 0) g += `<line x1="${pad.l}" y1="${Y(0)}" x2="${pad.l + w}" y2="${Y(0)}" stroke="#B9C2CF" stroke-dasharray="4 3"/>`;
    const band = pts.filter(p => p.lo != null && p.hi != null);
    if (band.length > 1) {
      const up = band.map(p => `${X(p.x)},${Y(p.hi)}`).join(" ");
      const dn = band.slice().reverse().map(p => `${X(p.x)},${Y(p.lo)}`).join(" ");
      g += `<polygon points="${up} ${dn}" fill="${o.color || "#2E86AB"}" fill-opacity="0.14"/>`;
    }
    const segs = []; let cur = [];
    pts.forEach(p => {
      if (p.v == null) { if (cur.length) segs.push(cur); cur = []; }
      else cur.push(p);
    });
    if (cur.length) segs.push(cur);
    segs.forEach(seg => {
      if (seg.length < 2) return;
      const d = seg.map((p, i) => `${i ? "L" : "M"}${X(p.x)},${Y(p.v)}`).join(" ");
      g += `<path d="${d}" fill="none" stroke="${o.color || "#2E86AB"}" stroke-width="2.2" stroke-linejoin="round"/>`;
    });
    valid.forEach(p => {
      g += `<circle cx="${X(p.x)}" cy="${Y(p.v)}" r="3.4" fill="#fff" stroke="${o.color || "#2E86AB"}" stroke-width="1.8"><title>x=${p.x}, y=${fmt(p.v)}</title></circle>`;
    });
    // 参考线（模拟轨迹基准线）
    if (o.refPts && o.refPts.length > 1) {
      const d = o.refPts.filter(p => p.v != null).map((p, i) => `${i ? "L" : "M"}${X(p.x)},${Y(p.v)}`).join(" ");
      g += `<path d="${d}" fill="none" stroke="${o.refColor || "#9AA5B4"}" stroke-width="1.8" stroke-dasharray="5 4"/>`;
    }
    g += txt(pad.l + w / 2, H - 8, o.xlabel || "", { anchor: "middle", size: 11, fill: "#6B7A8F" });
    g += txt(14, pad.t + h / 2, o.ylabel || "", { anchor: "middle", size: 11, fill: "#6B7A8F", rotate: -90 });
    return svgWrap(W, H, g);
  }

  /* 纵向柱 */
  function columns(pts, o = {}) {
    if (!pts.length) return emptyChart(o.emptyMsg || "没有数据");
    const W = o.width || 720, H = o.height || 260, pad = { l: 46, r: 18, t: 18, b: 38 };
    const w = W - pad.l - pad.r, h = H - pad.t - pad.b;
    const max = Math.max(...pts.map(p => p.v)) * 1.12;
    const bw = w / pts.length * 0.56;
    let g = grid(pad, w, h, ticks(0, max, 4), [], () => 0, () => 0);
    pts.forEach((p, i) => {
      const cx = pad.l + (i + 0.5) * (w / pts.length);
      const bh = p.v / max * h;
      g += `<rect x="${cx - bw / 2}" y="${pad.t + h - bh}" width="${bw}" height="${bh}" rx="2.5"
        fill="${p.c || "#2E86AB"}" fill-opacity="0.85"><title>${esc(p.label)}: ${fmt(p.v)}</title></rect>`;
      if (o.showVal !== false) g += txt(cx, pad.t + h - bh - 5, fmt(p.v, 1), { anchor: "middle", size: 9.5, fill: "#6B7A8F" });
      g += txt(cx, pad.t + h + 15, p.label, { anchor: "middle", size: 10, fill: "#6B7A8F" });
    });
    return svgWrap(W, H, g);
  }

  /* 多线趋势图（v3 新增）
     series: [{name, color, dash, pts:[{x,y}], width}]
     支持零轴、参照线、末点标注、图例由外部 HTML 画 */
  function multiLine(series, o = {}) {
    /* 右边距要放得下末点标注（如 "+4.53pp"），否则会被 viewBox 裁掉 */
    const W = o.width || 720, H = o.height || 300, pad = { l: 54, r: o.padR || 62, t: 18, b: 40 };
    const all = series.flatMap(s => s.pts.filter(p => p.y != null).map(p => p.y));
    if (!all.length) return emptyChart(o.emptyMsg || "没有可画的数据");
    const w = W - pad.l - pad.r, h = H - pad.t - pad.b;
    let ymin = o.ymin != null ? o.ymin : Math.min(...all, 0);
    let ymax = o.ymax != null ? o.ymax : Math.max(...all, 0);
    if (ymax === ymin) ymax = ymin + 1;
    const padY = (ymax - ymin) * 0.12;
    if (o.ymin == null) ymin -= padY;
    if (o.ymax == null) ymax += padY;
    const xs = series.flatMap(s => s.pts.map(p => p.x));
    const xmin = o.xmin != null ? o.xmin : Math.min(...xs);
    const xmax = o.xmax != null ? o.xmax : Math.max(...xs);
    const X = v => pad.l + (v - xmin) / (xmax - xmin || 1) * w;
    const Y = v => pad.t + h - (v - ymin) / (ymax - ymin || 1) * h;
    let xt = ticks(xmin, xmax, o.xn || 10);
    if (o.xint) {
      xt = xt.map(t => ({ v: Math.round(t.v), label: String(Math.round(t.v)) }))
        .filter(t => t.v >= xmin && t.v <= xmax)
        .filter((t, i, a) => i === 0 || t.v !== a[i - 1].v);
    }
    let g = grid(pad, w, h, ticks(ymin, ymax, 5), xt, X, Y);
    if (ymin < 0 && ymax > 0) {
      g += `<line x1="${pad.l}" y1="${Y(0)}" x2="${pad.l + w}" y2="${Y(0)}" stroke="#B9C2CF" stroke-dasharray="4 3"/>`;
    }
    series.forEach(s => {
      // 按 null 断段
      const segs = []; let cur = [];
      s.pts.forEach(p => {
        if (p.y == null) { if (cur.length) segs.push(cur); cur = []; }
        else cur.push(p);
      });
      if (cur.length) segs.push(cur);
      segs.forEach(seg => {
        if (seg.length < 2) return;
        const d = seg.map((p, i) => `${i ? "L" : "M"}${X(p.x)},${Y(p.y)}`).join(" ");
        g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.4}"
          stroke-linejoin="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""} stroke-linecap="round"/>`;
      });
      segs.forEach(seg => seg.forEach(p => {
        g += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3.6" fill="#fff" stroke="${s.color}" stroke-width="1.9">
          <title>${esc(s.name)} ${p.x}: ${fmt(p.y, 2)}</title></circle>`;
      }));
      // 末点标注（末点必须非空，否则会标到最后一个 null 上）
      const lastP = s.pts.filter(p => p.y != null).pop();
      if (lastP && o.endLabel !== false) {
        g += txt(X(lastP.x) + 7, Y(lastP.y) + 4, o.endFmt ? o.endFmt(lastP.y) : fmt(lastP.y, 2),
          { size: 11.5, fill: s.color, weight: 600 });
      }
    });
    g += txt(pad.l + w / 2, H - 8, o.xlabel || "", { anchor: "middle", size: 11, fill: "#6B7A8F" });
    if (o.ylabel) g += txt(14, pad.t + h / 2, o.ylabel, { anchor: "middle", size: 11, fill: "#6B7A8F", rotate: -90 });
    return svgWrap(W, H, g);
  }

  /* 同侪分布带图（v3 新增）
     横轴 = 出海溢价 pp；画同侪的 p10–p90 区间带 + p25–p75 浓带 + 中位线，
     再标出这家公司自己的位置。直观回答「我在同行里是什么水平」。 */
  function peerBand(cell, mine, o = {}) {
    if (!cell) return emptyChart("没有可用的同侪样本");
    const W = o.width || 720, H = o.height || 230, pad = { l: 48, r: 34, t: 18, b: 52 };
    const w = W - pad.l - pad.r, h = H - pad.t - pad.b;
    const lo = Math.min(cell.p10, cell.min, mine == null ? cell.p10 : mine);
    const hi = Math.max(cell.p90, cell.max, mine == null ? cell.p90 : mine);
    const span = (hi - lo) || 1;
    const ymin = lo - span * 0.14, ymax = hi + span * 0.14;
    const X = v => pad.l + (v - ymin) / (ymax - ymin || 1) * w;
    const yMid = pad.t + h * 0.5;
    let g = grid(pad, w, h, ticks(ymin, ymax, 4), [], () => 0, () => 0);
    // 零轴（溢价 = 0 的分界）——标注放在轴线上方，避免和「本公司」标签撞在一起
    if (ymin < 0 && ymax > 0) {
      g += `<line x1="${X(0)}" y1="${pad.t}" x2="${X(0)}" y2="${pad.t + h}" stroke="#C0392B" stroke-width="1.4" stroke-dasharray="5 3"/>`;
      g += txt(X(0), pad.t + h + 30, "0（海外毛利=境内毛利）", { anchor: "middle", size: 10, fill: "#C0392B" });
    }
    const bandH = 30;
    // p10–p90 外带
    g += `<rect x="${X(cell.p10)}" y="${yMid - bandH / 2}" width="${Math.max(X(cell.p90) - X(cell.p10), 2)}"
      height="${bandH}" rx="5" fill="#4A6FA5" fill-opacity="0.16"><title>p10–p90: ${cell.p10} ~ ${cell.p90}pp</title></rect>`;
    // p25–p75 浓带
    g += `<rect x="${X(cell.p25)}" y="${yMid - bandH / 2}" width="${Math.max(X(cell.p75) - X(cell.p25), 2)}"
      height="${bandH}" rx="5" fill="#4A6FA5" fill-opacity="0.42"><title>p25–p75: ${cell.p25} ~ ${cell.p75}pp</title></rect>`;
    // 中位线
    g += `<line x1="${X(cell.med)}" y1="${yMid - bandH / 2 - 9}" x2="${X(cell.med)}" y2="${yMid + bandH / 2 + 9}"
      stroke="#1A2433" stroke-width="2.4"><title>同侪中位 ${cell.med}pp</title></line>`;
    g += txt(X(cell.med), yMid + bandH / 2 + 24, "同侪中位 " + sign(cell.med) + "pp",
      { anchor: "middle", size: 11, fill: "#1A2433", weight: 600, halo: 4 });
    // 本公司位置
    if (mine != null) {
      const mx = X(mine);
      g += `<line x1="${mx}" y1="${yMid - bandH / 2 - 14}" x2="${mx}" y2="${yMid + bandH / 2 + 12}"
        stroke="#C0392B" stroke-width="2.8"><title>本公司 ${sign(mine)}pp</title></line>`;
      g += `<circle cx="${mx}" cy="${yMid}" r="6" fill="#C0392B" stroke="#fff" stroke-width="2"/>`;
      g += txt(mx, yMid - bandH / 2 - 20, "本公司 " + sign(mine) + "pp",
        { anchor: "middle", size: 11.5, fill: "#C0392B", weight: 700, halo: 4 });
    }
    // 极值
    g += txt(X(cell.min), yMid + bandH / 2 + 40, "最低 " + sign(cell.min),
      { anchor: "middle", size: 10, fill: "#8A94A6" });
    g += txt(X(cell.max), yMid + bandH / 2 + 40, "最高 " + sign(cell.max),
      { anchor: "middle", size: 10, fill: "#8A94A6" });
    g += txt(pad.l + w / 2, H - 6, "出海溢价（pp）", { anchor: "middle", size: 11, fill: "#6B7A8F" });
    return svgWrap(W, H, g);
  }
  /* 分位条 */
  function pctBar(v, label, note) {
    v = Math.max(0, Math.min(1, v == null ? 0 : v));
    return `<div class="pbar">
      <div class="pbar-head"><span>${esc(label)}</span><b>${v == null ? "—" : (v * 100).toFixed(0) + " 分位"}</b></div>
      <div class="pbar-track"><div class="pbar-fill" style="width:${v * 100}%"></div>
        <div class="pbar-mark" style="left:50%"></div></div>
      ${note ? `<div class="pbar-note">${note}</div>` : ""}
    </div>`;
  }

  /* 图表标签用的短名 */
  const SHORT = {
    "计算机、通信和其他电子设备制造业": "电子设备",
    "电气机械及器材制造业": "电气机械",
    "铁路、船舶、航空航天和其它运输设备制造业": "运输设备",
    "化学原料及化学制品制造业": "化学原料",
    "有色金属冶炼及压延加工业": "有色金属",
    "橡胶和塑料制品业": "橡塑",
    "农副食品加工业": "农副食品",
    "电力、热力生产和供应业": "电力热力",
    "生态保护和环境治理业": "生态环保",
    "专业技术服务业": "专业技术服务",
    "仪器仪表制造业": "仪器仪表",
    "通用设备制造业": "通用设备",
    "专用设备制造业": "专用设备",
    "医药制造业": "医药",
    "食品制造业": "食品",
    "汽车制造业": "汽车",
    "房地产业": "房地产",
    "商务服务业": "商务服务",
    "金属制品业": "金属制品",
    "非金属矿物制品业": "非金属矿物",
    "互联网和相关服务": "互联网服务",
    "软件和信息技术服务业": "软件服务",
    "土木工程建筑业": "土木工程",
    "批发业": "批发",
    "零售业": "零售",
    "其他行业": "其他",
  };
  const shortName = n => !n ? "—" : (SHORT[n] || n.replace(/(制造业|加工业|供应业|服务业)$/, "") || n);
  const provShort = n => !n ? "—" : String(n).replace(/省|市|自治区|壮族|回族|维吾尔|特别行政区/g, "").slice(0, 4);

  /* ==================== 通用组件 ==================== */
  function yearChips(cur, attr) {
    return YEARS.map(y => `<button class="ychip${y === cur ? " on" : ""}" ${attr}="${y}">${y}</button>`).join("");
  }

  function kpiBlock(items) {
    return `<div class="kpis">` + items.map(k =>
      `<div class="kpi${k.warn ? " warn" : ""}${k.hot ? " hot" : ""}"><b>${k.v}${k.u ? `<i>${k.u}</i>` : ""}</b><span>${k.l}</span></div>`
    ).join("") + `</div>`;
  }

  /* 一键总结：把散落各处的信息收成几句话 */
  function summaryBox(title, lines, cls) {
    return `<section class="card summary ${cls || ""}">
      <h3>${esc(title)}</h3>
      <ul class="sumlist">${lines.map(l => `<li>${l}</li>`).join("")}</ul>
    </section>`;
  }

  /* 数据不足警告条 */
  function warnBar(msg) {
    return `<div class="warnbar"><b>样本不足</b>${msg}</div>`;
  }

  /* ==================== 导出 ==================== */
  function downloadText(name, text, mime) {
    const blob = new Blob(["﻿" + text], { type: (mime || "text/plain") + ";charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
  }
  function toCSV(head, rows) {
    const q = v => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [head.map(q).join(",")].concat(rows.map(r => r.map(q).join(","))).join("\n");
  }
  /* 截图：SVG 序列化成 canvas 导出 PNG（纯前端，不依赖外部库） */
  function svgToPNG(svgEl, filename) {
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true);
    const vb = (clone.getAttribute("viewBox") || "0 0 720 400").split(/\s+/).map(Number);
    const W = vb[2], H = vb[3];
    clone.setAttribute("width", W * 2); clone.setAttribute("height", H * 2);
    const xml = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = W * 2; cv.height = H * 2;
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob(b => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b); a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
      });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }
  /* 导出按钮 */
  function exportBtns(prefix) {
    return `<div class="exportrow">
      <button class="xbtn" data-act="csv" data-pfx="${prefix}">导出 CSV</button>
      <button class="xbtn" data-act="png" data-pfx="${prefix}">图表存 PNG</button>
      <button class="xbtn" data-act="report" data-pfx="${prefix}">体检报告</button>
    </div>`;
  }

  /* ==================== 视图：总观（单页滚动） ==================== */
  function viewOverview() {
    const y = STATE.year;
    const yo = YO[y];
    const yPrev = y > YEARS[0] ? YO[y - 1] : null;

    /* --- 1. 首屏概览 --- */
    const hero = `
    <section class="hero">
      <div class="herotop">
        <div>
          <h1>出海质量图谱</h1>
          <p class="sub">A 股 ${D.meta.n_firms.toLocaleString()} 家企业 · ${D.meta.year_lo}–${LAST} 年 ${D.meta.n_obs.toLocaleString()} 个观测 ·
          数据源：年报分部披露 + CSMAR 财务治理</p>
        </div>
        <div class="yearbox">
          <span class="ylab">观察年份</span>
          <div class="ychips" data-role="year">${yearChips(y, "data-year")}</div>
        </div>
      </div>
      ${kpiBlock([
      { v: pct(yo.ovs_rate), l: `${y} 年企业出海率`, u: "" },
      { v: sign(yo.gap_med), l: `${y} 年出海溢价中位`, u: "pp" },
      { v: pct(yo.gap_cov), l: "溢价可算比例", warn: yo.gap_cov < 60 },
      { v: fmt(yo.cap, 0), l: "海外收入合计（亿元）" },
      { v: yo.ind_ok + "/" + yo.ind_all, l: "行业样本够用的个数" },
    ])}
      ${yPrev ? `<p class="heronote">
        ${y} 年对比 ${y - 1} 年：出海率 ${pct(yPrev.ovs_rate)} → <b>${pct(yo.ovs_rate)}</b>；
        溢价中位 ${sign(yPrev.gap_med)}pp → <b>${sign(yo.gap_med)}pp</b>；
        溢价可算比例 ${pct(yPrev.gap_cov)} → <b>${pct(yo.gap_cov)}</b>。
        ${y <= 2017 ? "早年份披露率明显偏低，跨年比较要留够余地。" : ""}
      </p>` : ""}
    </section>`;

    /* --- 1b. 十年全局趋势（v3 新增） --- */
    const trendSec = viewTrendSection();

    const iys = IND.map(n => IY[n + "|" + y]).filter(Boolean);
    const okRows = iys.filter(r => r.gap_med != null && r.gap_n >= 30);
    const thinRows = iys.filter(r => r.gap_med != null && r.gap_n < 30);
    /* 定位图点中的行业（v3 新增：点气泡 → 下方展开该行业体检卡） */
    const posPick = STATE.posPick && IY[STATE.posPick + "|" + y] ? STATE.posPick : null;
    const scatterRows = okRows.map(r => ({
      label: shortName(r.ind),
      x: (r.gate_med || 0) * 100,
      y: r.gap_med,
      s: r.cap || 1,
      c: r.gap_med >= 3 ? "#C0392B" : r.gap_med >= 0 ? "#D68910" : "#4A8B6F",
      // 描边：整个行业能不能赚到钱（溢价为正的企业占比过半 = 实心深描边）
      stroke: r.profitable === 1 ? "#1A2433" : "#FFFFFF",
      dash: r.profitable === 0,
      hollow: false,
      ind: r.ind,
      tip: `${r.ind}\n门槛 ${((r.gate_med || 0) * 100).toFixed(0)} 分位 | 溢价中位 ${r.gap_med}pp\n`
        + `溢价为正 ${r.pos_share}%（${r.gap_n} 个样本）| 容量 ${fmt(r.cap, 0)} 亿`,
    }));
    const posChart = `
    <section class="card" id="sec-pos">
      <div class="card-head">
        <h2>行业定位图 · ${y} 年</h2>
        <p>横轴是门槛（该行业出海企业的规模分位中位数，越低越容易进），纵轴是出海溢价中位（海外毛利率比境内高多少）。
        <b>右上＝进得去且赚得到</b>；右下＝进得去但赔钱；左上＝少数人在赚钱；左下＝又难又不赚。<b>点气泡看这个行业的详情。</b></p>
      </div>
      ${okRows.length ? scatter(scatterRows, {
      xlabel: "出海门槛（规模分位，越低越容易进）", ylabel: "出海溢价中位 (pp)", height: 430, labelTop: 26,
      pickField: "ind", pickValue: posPick,
    }) : warnBar(`${y} 年没有溢价样本 ≥30 的行业，这一年的行业定位图画不出来。`)}
      <div class="legend">
        <span><i style="background:#C0392B"></i>溢价 ≥3pp（赚得到）</span>
        <span><i style="background:#D68910"></i>0~3pp（持平）</span>
        <span><i style="background:#4A8B6F"></i>溢价 &lt;0（赔钱）</span>
        <span><i style="background:#fff;border:2px solid #1A2433"></i>黑边＝该行业过半企业能赚钱</span>
        <span><i style="background:#fff;border:2px dashed #B9C2CF"></i>白虚边＝过半企业亏</span>
      </div>
      ${thinRows.length ? `<p class="hint dim">另有 ${thinRows.length} 个行业溢价样本不足 30（${thinRows.map(r => shortName(r.ind) + " " + r.gap_n + " 个").join("、")}），
        中位数不稳，这一版没画出来。</p>` : ""}
      ${viewPosCard(posPick, y)}
      <div class="sectools">
        <button class="xbtn" data-act="csv" data-pfx="行业定位图">下载这张表 CSV</button>
        <button class="xbtn" data-act="png" data-pfx="行业定位图">图表存 PNG</button>
      </div>
    </section>`;

    /* --- 3. 三个榜单（年份联动） --- */
    const byGap = iys.filter(r => r.gap_med != null && r.gap_n >= 100).sort((a, b) => b.gap_med - a.gap_med);
    const byGate = iys.filter(r => r.gate_med != null && r.n >= 100).sort((a, b) => a.gate_med - b.gate_med);
    const byCap = iys.filter(r => r.cap > 0).sort((a, b) => b.cap - a.cap);
    const boards = `
    <div class="grid3">
      <section class="card">
        <h3>溢价最高 · 赚得到的行业</h3>
        ${hbars(byGap.slice(0, 6).map(r => ({ label: shortName(r.ind), v: r.gap_med, c: "#C0392B", vt: sign(r.gap_med) + "pp" })),
      { width: 380, labelW: 100 })}
        <p class="hint">溢价样本 ≥100 才上榜。这些行业出海确实有毛利加成。</p>
      </section>
      <section class="card">
        <h3>门槛最低 · 最容易进的行业</h3>
        ${hbars(byGate.slice(0, 6).map(r => ({ label: shortName(r.ind), v: (r.gate_med || 0) * 100, c: "#2E86AB", vt: (r.gate_med * 100).toFixed(0) + " 分位" })),
      { width: 380, labelW: 100 })}
        <p class="hint">门槛＝行业内出海企业的规模分位中位数。数字越低，不用很大就能出海。</p>
      </section>
      <section class="card">
        <h3>容量最大 · 池子最深的行业</h3>
        ${hbars(byCap.slice(0, 6).map(r => ({ label: shortName(r.ind), v: r.cap, c: "#4A6FA5", vt: fmt(r.cap, 0) + " 亿" })),
      { width: 380, labelW: 100 })}
        <p class="hint">容量＝该行业 ${y} 年海外收入合计。注意这是「已开发容量」，不是市场总规模。</p>
      </section>
    </div>`;

    /* --- 4. 行业全景（条形 + 指标切换器 + 行业选择卡） --- */
    const indSec = viewIndustrySection(y, iys);

    /* --- 5. 区域全景 --- */
    const provSec = viewProvinceSection(y);

    /* --- 6. 退出诊断 --- */
    const exitSec = viewExitSection();

    /* --- 7. 一键总结 --- */
    const sumSec = overviewSummary(y, yo, okRows, byGap, byGate, byCap);

    return hero + trendSec + posChart + boards + indSec + provSec + exitSec + sumSec;
  }

  /* ==================== 十年全局趋势（v3 新增） ==================== */
  function viewTrendSection() {
    const rows = D3.year_trend;
    const first = rows[0], last = rows[rows.length - 1];
    const sRate = rows.map(r => ({ x: r.year, y: r.ovs_rate }));
    const sGap = rows.map(r => ({ x: r.year, y: r.gap_med }));
    const sCov = rows.map(r => ({ x: r.year, y: r.gap_cov_ovs }));

    /* 三条线量纲不同（% 与 pp），拆成两张图：比例一张、溢价一张 */
    const chartPct = multiLine([
      { name: "企业出海率", color: "#2E86AB", pts: sRate },
      { name: "溢价可算比例（出海组内）", color: "#7B61A8", pts: sCov },
    ], {
      width: 620, height: 270, xint: true, xn: 10, ymin: 0,
      xlabel: "年份", ylabel: "占比 (%)", endFmt: v => fmt(v, 1) + "%",
    });
    const chartGap = multiLine([
      { name: "出海溢价中位", color: "#C0392B", pts: sGap },
    ], {
      width: 620, height: 270, xint: true, xn: 10,
      xlabel: "年份", ylabel: "出海溢价中位 (pp)", endFmt: v => sign(v) + "pp",
    });

    const capFirst = first.cap, capLast = last.cap;
    return `
    <section class="card" id="sec-trend">
      <div class="card-head">
        <h2>十年走势 · 这十年是变强了还是变多了</h2>
        <p>三条线各自回答一件事：出海的企业变多了吗？能算出溢价的企业变多了吗？出海真的更赚钱了吗？</p>
      </div>
      <div class="grid2">
        <section class="card">
          <h3>覆盖率 · 出海的企业与能算出溢价的企业</h3>
          ${chartPct}
          <div class="legend">
            <span><i style="background:#2E86AB"></i>企业出海率</span>
            <span><i style="background:#7B61A8"></i>溢价可算比例（出海组内）</span>
          </div>
          <p class="hint">${first.year} 年只有 ${pct(first.gap_cov_ovs)} 的出海企业能算出溢价，${last.year} 年是 ${pct(last.gap_cov_ovs)}。
          早年的溢价中位数不可靠，因为能算的那部分本身就是选择性披露的。</p>
        </section>
        <section class="card">
          <h3>出海溢价中位 · 十年走势</h3>
          ${chartGap}
          <p class="hint">从 ${sign(first.gap_med)}pp 到 ${sign(last.gap_med)}pp，方向是好的。但这个上升里有多少来自
          「披露改善、样本构成变化」、多少是真实盈利改善，页面给不出答案——要看平衡面板与企业固定效应的结果，
          那部分在分析报告里。</p>
        </section>
      </div>
      <div class="statline wrap">
        <div><span>${first.year} 出海率</span><b>${pct(first.ovs_rate)}</b></div>
        <div><span>${last.year} 出海率</span><b>${pct(last.ovs_rate)}</b></div>
        <div><span>海外收入 ${first.year}</span><b>${fmt(capFirst / 10000, 2)} 万亿</b></div>
        <div><span>海外收入 ${last.year}</span><b>${fmt(capLast / 10000, 2)} 万亿</b></div>
        <div><span>容量增长</span><b class="up">${(capLast / capFirst).toFixed(2)}×</b></div>
      </div>
    </section>`;
  }

  /* ==================== 定位图点选 → 行业体检卡（v3 新增） ==================== */
  function viewPosCard(pick, y) {
    if (!pick) {
      return `<p class="hint dim" id="poscard-empty">点上面任意一个气泡，这里会展开这个行业的体检卡。</p>`;
    }
    const r = IY[pick + "|" + y];
    if (!r) return "";
    const allMed = (() => {
      const rows = IND.map(n => IY[n + "|" + y]).filter(Boolean);
      const med = k => {
        const v = rows.map(x => x[k]).filter(x => x != null);
        return v.length ? v.sort((a, b) => a - b)[Math.floor(v.length / 2)] : null;
      };
      return { gap_med: med("gap_med"), ovs_rate: med("ovs_rate"), ratio_med: med("ratio_med"), pos_share: med("pos_share") };
    })();
    const trend = INDTREND[pick];
    const tr = trend ? trend.gap : null;

    /* 十年轨迹（该行业溢价 vs 全行业中位） */
    let trChart = "";
    if (tr && tr.length) {
      const indPts = tr.map(p => ({ x: p[0], y: p[1] }));
      const medPts = YEARS.map(yy => ({ x: yy, y: IYMED[yy] ? IYMED[yy].gap_med : null }));
      trChart = `
      <div class="indtrend">
        <h4 class="sub-h">这个行业的十年轨迹</h4>
        ${multiLine([
        { name: shortName(pick) + " 溢价中位", color: "#C0392B", pts: indPts },
        { name: "全行业中位", color: "#9AA5B4", pts: medPts, dash: "6 4", width: 1.8 },
      ], { width: 620, height: 240, xint: true, xn: 10, xlabel: "年份", ylabel: "出海溢价中位 (pp)", endLabel: false })}
        <div class="legend">
          <span><i style="background:#C0392B"></i>${esc(shortName(pick))}</span>
          <span><i style="background:#9AA5B4"></i>全行业中位</span>
        </div>
      </div>`;
    }

    const cmpRows = [
      { l: "出海率", mine: r.ovs_rate, base: allMed.ovs_rate, u: "%", dg: 1, up: true },
      { l: "渗透度中位", mine: r.ratio_med, base: allMed.ratio_med, u: "%", dg: 1, up: true },
      { l: "溢价中位", mine: r.gap_med, base: allMed.gap_med, u: "pp", dg: 2, up: true },
      { l: "溢价为正", mine: r.pos_share, base: allMed.pos_share, u: "%", dg: 1, up: true },
    ];

    return `
    <div class="poscard" id="poscard">
      <div class="poscard-head">
        <h3>${esc(shortName(pick))} · ${y} 年体检卡</h3>
        <button class="xbtn" data-act="csv" data-pfx="行业定位图">下载这张表 CSV</button>
      </div>
      <div class="statline wrap">
        <div><span>样本</span><b>${r.n}</b></div>
        <div><span>企业数</span><b>${r.firms}</b></div>
        <div><span>出海率</span><b>${pct(r.ovs_rate)}</b></div>
        <div><span>渗透度中位</span><b>${pct(r.ratio_med)}</b></div>
        <div><span>溢价中位</span><b class="${r.gap_med > 0 ? "up" : r.gap_med < 0 ? "down" : ""}">${sign(r.gap_med)}</b></div>
        <div><span>溢价为正</span><b>${pct(r.pos_share)}</b></div>
        <div><span>门槛</span><b>${r.gate_med == null ? "—" : (r.gate_med * 100).toFixed(0) + " 分位"}</b></div>
        <div><span>容量</span><b>${fmt(r.cap, 0)} 亿</b></div>
        <div><span>吸引力</span><b>${fmt(r.score, 2)}</b></div>
      </div>
      <div class="cmp2">
        ${cmpRows.map(c => cmpLine(c.l, c.mine, c.base, c.u, c.dg, c.up)).join("")}
      </div>
      ${trChart}
      <p class="hint">${industryAdvice(r, y)}</p>
    </div>`;
  }

  /* ==================== 行业全景区块 ==================== */
  function viewIndustrySection(y, iys) {
    const METRICS = [
      { k: "score", l: "吸引力分", get: r => r.score, vt: r => fmt(r.score, 2), c: "#4A6FA5", up: true },
      { k: "ovs_rate", l: "出海率", get: r => r.ovs_rate, vt: r => pct(r.ovs_rate), c: "#2E86AB", up: true },
      { k: "gap_med", l: "溢价中位", get: r => r.gap_med, vt: r => sign(r.gap_med) + "pp", c: "#C0392B", up: true },
      { k: "pos_share", l: "溢价为正", get: r => r.pos_share, vt: r => pct(r.pos_share), c: "#4A8B6F", up: true },
      { k: "gate_med", l: "门槛（越低越好）", get: r => r.gate_med == null ? null : r.gate_med * 100, vt: r => (r.gate_med * 100).toFixed(0) + " 分位", c: "#D68910", up: false },
      { k: "ratio_med", l: "渗透度中位", get: r => r.ratio_med, vt: r => pct(r.ratio_med), c: "#7B61A8", up: true },
      { k: "cap", l: "容量（亿元）", get: r => r.cap, vt: r => fmt(r.cap, 0), c: "#4A6FA5", up: true },
    ];
    const mk = STATE.indMetric;
    const met = METRICS.find(m => m.k === mk) || METRICS[0];
    const rows = iys.filter(r => met.get(r) != null);
    const sorted = rows.slice().sort((a, b) => met.up ? met.get(b) - met.get(a) : met.get(a) - met.get(b));
    const pick = STATE.indPick && IY[STATE.indPick + "|" + y] ? STATE.indPick : (sorted[0] ? sorted[0].ind : null);
    const pr = pick ? IY[pick + "|" + y] : null;

    /* 被选行业在全部行业里的排名与占比 */
    const rankBy = sorted.findIndex(r => r.ind === pick) + 1;
    const share = pr ? {
      cap: sorted.reduce((s, r) => s + (r.cap || 0), 0) ? pr.cap / sorted.reduce((s, r) => s + (r.cap || 0), 0) * 100 : null,
      n: sorted.reduce((s, r) => s + (r.n || 0), 0) ? pr.n / sorted.reduce((s, r) => s + (r.n || 0), 0) * 100 : null,
    } : null;

    /* 选中行业 vs 全行业中位 */
    const allMed = {
      ovs_rate: median(sorted.map(r => r.ovs_rate)),
      gap_med: median(sorted.map(r => r.gap_med)),
      pos_share: median(sorted.map(r => r.pos_share)),
      gate_med: median(sorted.map(r => r.gate_med)),
      ratio_med: median(sorted.map(r => r.ratio_med)),
    };

    const detail = pr ? `
      <div class="card ind-detail">
        <div class="card-head">
          <h2>${esc(pr.ind)} · ${y} 年</h2>
          <p>在 ${sorted.length} 个行业口径里，吸引力排第 <b>${rankBy}</b> 位。
          ${share ? `占全部行业海外收入的 <b>${pct(share.cap)}</b>，占全部行业样本的 <b>${pct(share.n)}</b>。` : ""}</p>
        </div>
        <div class="statline wrap">
          <div><span>样本</span><b>${pr.n}</b></div>
          <div><span>出海率</span><b>${pct(pr.ovs_rate)}</b></div>
          <div><span>渗透度中位</span><b>${pct(pr.ratio_med)}</b></div>
          <div><span>溢价中位</span><b class="${pr.gap_med > 0 ? "up" : pr.gap_med < 0 ? "down" : ""}">${sign(pr.gap_med)}</b></div>
          <div><span>溢价为正</span><b>${pct(pr.pos_share)}</b></div>
          <div><span>门槛(中位)</span><b>${((pr.gate_med || 0) * 100).toFixed(0)} 分位</b></div>
          <div><span>容量(亿)</span><b>${fmt(pr.cap, 0)}</b></div>
          <div><span>吸引力</span><b>${fmt(pr.score, 2)}</b></div>
        </div>
        <div class="cmp2">
          ${cmpLine("出海率", pr.ovs_rate, allMed.ovs_rate, "%", 1, true)}
          ${cmpLine("溢价中位", pr.gap_med, allMed.gap_med, "pp", 2, true)}
          ${cmpLine("溢价为正", pr.pos_share, allMed.pos_share, "%", 1, true)}
          ${cmpLine("门槛（分位）", pr.gate_med == null ? null : pr.gate_med * 100, allMed.gate_med == null ? null : allMed.gate_med * 100, "", 0, false)}
          ${cmpLine("渗透度中位", pr.ratio_med, allMed.ratio_med, "%", 1, true)}
        </div>
        <p class="hint">${industryAdvice(pr, y)}</p>
        ${viewIndTrend(pr.ind)}
        <div class="sectools">
          <button class="xbtn" data-act="csv" data-pfx="行业明细">下载行业明细 CSV</button>
          <button class="xbtn" data-act="png" data-pfx="行业明细">图表存 PNG</button>
        </div>
      </div>` : "";

    return `
    <section class="card" id="sec-ind">
      <div class="card-head">
        <h2>行业全景 · ${y} 年</h2>
        <p>切换指标看排序，点条形选中某个行业，下方给出它跟其他行业的对比。全部 ${IND.length} 个口径。</p>
      </div>
      <div class="switcher" data-role="indmetric">
        ${METRICS.map(m => `<button class="sw${m.k === mk ? " on" : ""}" data-metric="${m.k}">${m.l}</button>`).join("")}
      </div>
      <div class="indwrap">
        <div class="indbars">
          ${hbars(sorted.map(r => ({
        label: shortName(r.ind),
        v: met.get(r),
        c: met.c,
        vt: met.vt(r),
        pick: r.ind,
      })), { width: 560, labelW: 104, rowH: 28 })}
          <p class="hint dim">点条形可切换选中行业。</p>
        </div>
        <div class="indtable">
          <details class="foldtable">
            <summary><b>全行业明细表</b>（${sorted.length} 行）<span class="fthint"><i class="fc">默认折叠，点开查看</i><i class="fo">已展开，点击收起</i></span>
              <button class="xbtn foldcsv" data-act="csv" data-pfx="行业明细">下载 CSV</button></summary>
            <div class="tablewrap"><table class="dt">
              <thead><tr><th>行业</th><th>样本</th><th>出海率</th><th>渗透度中位</th>
              <th>溢价中位</th><th>溢价为正</th><th>门槛</th><th>容量(亿)</th><th>吸引力</th></tr></thead>
              <tbody>${sorted.map(r => `<tr class="${r.ind === pick ? "sel" : ""}" data-ind="${esc(r.ind)}">
                <td class="l">${esc(shortName(r.ind))}</td><td>${r.n}</td><td>${pct(r.ovs_rate)}</td>
                <td>${pct(r.ratio_med)}</td>
                <td class="${r.gap_med > 0 ? "up" : r.gap_med < 0 ? "down" : ""}">${sign(r.gap_med)}</td>
                <td>${pct(r.pos_share)}</td><td>${((r.gate_med || 0) * 100).toFixed(0)}</td>
                <td>${fmt(r.cap, 0)}</td><td><b>${fmt(r.score, 2)}</b></td></tr>`).join("")}</tbody>
            </table></div>
          </details>
        </div>
      </div>
    </section>
    ${detail}`;
  }

  function cmpLine(label, mine, base, unit, dg, upGood) {
    if (mine == null || base == null) {
      return `<div class="cmp"><span>${esc(label)}</span><b>—</b><i>行业中位 —</i></div>`;
    }
    const d = mine - base;
    const good = upGood ? d > 0 : d < 0;
    const cls = Math.abs(d) < 0.05 ? "" : good ? "up" : "down";
    return `<div class="cmp"><span>${esc(label)}</span><b>${fmt(mine, dg)}${unit}</b>
      <i class="${cls}">${sign(d, dg)}${unit} vs 行业中位</i></div>`;
  }

  /* 行业十年轨迹（v3 新增）：该行业 vs 全行业中位 */
  function viewIndTrend(ind) {
    const t = INDTREND[ind];
    if (!t) return "";
    const indPts = t.gap.map(p => ({ x: p[0], y: p[1] }));
    const medPts = YEARS.map(yy => ({ x: yy, y: IYMED[yy] ? IYMED[yy].gap_med : null }));
    /* 早年份样本不足的年份，值是 null（数据层已按 gap_n<30 不给值？看情况） */
    return `
    <div class="indtrend">
      <h4 class="sub-h">这个行业的十年轨迹 · 溢价中位 vs 全行业中位</h4>
      ${multiLine([
      { name: shortName(ind) + " 溢价中位", color: "#C0392B", pts: indPts },
      { name: "全行业中位", color: "#9AA5B4", pts: medPts, dash: "6 4", width: 1.8 },
    ], { width: 620, height: 250, xint: true, xn: 10, xlabel: "年份", ylabel: "出海溢价中位 (pp)", endLabel: false })}
      <div class="legend">
        <span><i style="background:#C0392B"></i>${esc(shortName(ind))}</span>
        <span><i style="background:#9AA5B4"></i>全行业中位</span>
      </div>
      <p class="hint">${indTrendHint(ind, t)}</p>
    </div>`;
  }

  function indTrendHint(ind, t) {
    const valid = t.gap.filter(p => p[1] != null);
    if (valid.length < 2) return "这个行业的溢价样本太少，画不出可靠的轨迹。";
    const f = valid[0], l = valid[valid.length - 1];
    const med = IYMED[l[0]];
    const diff = med && l[1] != null ? l[1] - med.gap_med : null;
    let s = `${f[0]} 年 ${sign(f[1])}pp → ${l[0]} 年 ${sign(l[1])}pp。`;
    if (diff != null) {
      s += ` ${l[0]} 年全行业中位是 ${sign(med.gap_med)}pp，这个行业${diff >= 0 ? "高出" : "低于"}中位 ${Math.abs(diff).toFixed(2)}pp。`;
    }
    /* 早年份样本不足要提醒：值是算出来的但不稳 */
    const thin = t.gapn.filter(p => p[1] < 30);
    if (thin.length) {
      s += ` 其中 ${thin.length} 个年份溢价样本不足 30 个（${thin.map(p => p[0]).join("、")}），这几年的中位数不稳。`;
    }
    return s;
  }

  /* 省份十年轨迹（v3 新增）：该省 vs 全省中位 */
  function viewProvTrend(prov) {
    const t = PROVTREND[prov];
    if (!t) return "";
    const isOver = t.overseas_reg === 1;
    if (isOver) {
      return `<div class="indtrend"><h4 class="sub-h">十年轨迹</h4>
        <p class="hint dim">${esc(prov)} 是境外注册地，样本只有个位数，画轨迹没有意义。</p></div>`;
    }
    const pPts = t.gap.map(p => ({ x: p[0], y: p[1] }));
    const medPts = YEARS.map(yy => ({ x: yy, y: PYMED[yy] ? PYMED[yy].gap_med : null }));
    return `
    <div class="indtrend">
      <h4 class="sub-h">这个省的十年轨迹 · 溢价中位 vs 全省中位</h4>
      ${multiLine([
      { name: shortName(prov) + " 溢价中位", color: "#C0392B", pts: pPts },
      { name: "全省中位", color: "#9AA5B4", pts: medPts, dash: "6 4", width: 1.8 },
    ], { width: 620, height: 250, xint: true, xn: 10, xlabel: "年份", ylabel: "出海溢价中位 (pp)", endLabel: false })}
      <div class="legend">
        <span><i style="background:#C0392B"></i>${esc(shortName(prov))}</span>
        <span><i style="background:#9AA5B4"></i>全省中位</span>
      </div>
      <p class="hint">${provTrendHint(prov, t)}</p>
    </div>`;
  }

  function provTrendHint(prov, t) {
    const valid = t.gap.filter(p => p[1] != null);
    if (valid.length < 2) return "这个省的溢价样本太少，画不出可靠的轨迹。";
    const f = valid[0], l = valid[valid.length - 1];
    const med = PYMED[l[0]];
    const diff = med && l[1] != null ? l[1] - med.gap_med : null;
    let s = `${f[0]} 年 ${sign(f[1])}pp → ${l[0]} 年 ${sign(l[1])}pp。`;
    if (diff != null) {
      s += ` ${l[0]} 年全省中位是 ${sign(med.gap_med)}pp，这个省${diff >= 0 ? "高出" : "低于"}中位 ${Math.abs(diff).toFixed(2)}pp。`;
    }
    const thin = t.gapn.filter(p => p[1] < 30);
    if (thin.length) {
      s += ` 其中 ${thin.length} 个年份溢价样本不足 30 个（${thin.map(p => p[0]).join("、")}），这几年的中位数不稳。`;
    }
    return s;
  }

  function industryAdvice(pr, y) {
    if (!pr) return "";
    const parts = [];
    const gap = pr.gap_med;
    if (gap != null && gap >= 3 && pr.pos_share >= 55) {
      parts.push(`<b>${shortName(pr.ind)}</b>在 ${y} 年是「进得去且赚得到」的组合：溢价中位 ${sign(gap)}pp，
      ${pct(pr.pos_share)} 的出海企业溢价为正。这是全表里最值得看的类型。`);
    } else if (gap != null && gap < 0) {
      parts.push(`这个行业的出海溢价中位是 ${sign(gap)}pp，${pct(pr.pos_share)} 的企业溢价为正——整体不赚钱。
      大概率是海外定价被压或者海外成本分摊口径有问题，进去前必须先验证单客户的毛利结构。`);
    } else {
      parts.push(`溢价中位 ${sign(gap)}pp、${pct(pr.pos_share)} 溢价为正，属于「能进但赚不到大钱」的中间地带。`);
    }
    if (pr.gate_med != null && pr.gate_med <= 0.45) {
      parts.push(`门槛只有 ${(pr.gate_med * 100).toFixed(0)} 分位，规模不是主要障碍，先行者已经用小规模跑通了。`);
    } else if (pr.gate_med != null && pr.gate_med >= 0.65) {
      parts.push(`门槛 ${(pr.gate_med * 100).toFixed(0)} 分位偏高，说明这个行业的出海需要相当体量才划算，
      小公司进去会被渠道和账期拖死。`);
    }
    if (pr.gap_n < 30) parts.push(`<b>注意：溢价只有 ${pr.gap_n} 个样本</b>，中位数不够稳，结论请当作参考。`);
    return parts.join(" ");
  }

  /* ==================== 区域全景区块 ==================== */
  function viewProvinceSection(y) {
    const PM = [
      { k: "ovs_rate", l: "出海率", get: r => r.ovs_rate, vt: r => pct(r.ovs_rate), c: "#2E86AB", up: true },
      { k: "gap_med", l: "溢价中位", get: r => r.gap_med, vt: r => sign(r.gap_med) + "pp", c: "#C0392B", up: true },
      { k: "ratio_med", l: "渗透度中位", get: r => r.ratio_med, vt: r => pct(r.ratio_med), c: "#7B61A8", up: true },
      { k: "pos_share", l: "溢价为正", get: r => r.pos_share, vt: r => pct(r.pos_share), c: "#4A8B6F", up: true },
      { k: "cap", l: "容量（亿元）", get: r => r.cap, vt: r => fmt(r.cap, 0), c: "#4A6FA5", up: true },
      { k: "score", l: "综合分", get: r => r.score, vt: r => fmt(r.score, 2), c: "#D68910", up: true },
    ];
    const mk = STATE.provMetric;
    const met = PM.find(m => m.k === mk) || PM[0];
    const rows = PROV.map(n => PY[n + "|" + y]).filter(Boolean).filter(r => r.n >= 50);
    const sorted = rows.slice().sort((a, b) => met.up ? met.get(b) - met.get(a) : met.get(a) - met.get(b));
    /* 默认选中当前指标榜首的省（和行业页一致），右侧不留空提示卡 */
    const pick = STATE.provPick && PY[STATE.provPick + "|" + y] ? STATE.provPick
      : (sorted[0] ? sorted[0].prov : null);
    const pr = pick ? PY[pick + "|" + y] : null;
    const tier = pick ? D2.prov_tier[pick] : null;
    const inner = pick ? (D2.prov_ind[pick] || []) : [];
    /* 样本偏少的省标出来，别让 30 个观测的省跟 2000 个观测的省并列看 */
    const thin = rows.filter(r => r.n < 100);

    /* 全省在 34 个省里的位置 */
    const allP = PROV.map(n => PY[n + "|" + y]).filter(Boolean);
    const provRank = (field, desc) => {
      const s = allP.filter(r => r[field] != null).slice().sort((a, b) => desc ? b[field] - a[field] : a[field] - b[field]);
      return s.findIndex(r => r.prov === pick) + 1;
    };

    const detail = pr ? `
      <div class="card prov-detail">
        <div class="card-head">
          <h2>${esc(pick)} · ${y} 年</h2>
          <p>${tier ? `属于<b>${esc(tier.tier)}</b>。` : ""}
          出海率在 ${allP.length} 个省里排第 <b>${provRank("ovs_rate", true)}</b>，
          溢价中位排第 <b>${provRank("gap_med", true)}</b>，容量排第 <b>${provRank("cap", true)}</b>。</p>
        </div>
        <div class="statline wrap">
          <div><span>样本</span><b>${pr.n}</b></div>
          <div><span>企业数</span><b>${pr.firms}</b></div>
          <div><span>出海率</span><b>${pct(pr.ovs_rate)}</b></div>
          <div><span>渗透度中位</span><b>${pct(pr.ratio_med)}</b></div>
          <div><span>溢价中位</span><b class="${pr.gap_med > 0 ? "up" : pr.gap_med < 0 ? "down" : ""}">${sign(pr.gap_med)}</b></div>
          <div><span>溢价为正</span><b>${pct(pr.pos_share)}</b></div>
          <div><span>容量(亿)</span><b>${fmt(pr.cap, 0)}</b></div>
          <div><span>综合分</span><b>${fmt(pr.score, 2)}</b></div>
        </div>
        ${inner.length ? `
        <h4 class="sub-h">省内出海结构 · 海外收入 top5 行业</h4>
        ${hbars(inner.map(r => ({
      label: shortName(r.ind), v: r.cap, c: "#4A6FA5", vt: fmt(r.cap, 0) + " 亿（" + r.share + "%）",
    })), { width: 560, labelW: 104 })}
        <p class="hint">这些是 ${esc(pick)} 省出海收入最高的 5 个行业。注意这是「谁贡献海外收入」的描述，
        不是「哪个行业更值得进」——后者看的是溢价，不是规模。</p>
        <div class="tablewrap"><table class="dt">
          <thead><tr><th>省内行业</th><th>样本</th><th>出海率</th><th>溢价中位</th><th>溢价为正样本</th><th>容量(亿)</th><th>省内占比</th></tr></thead>
          <tbody>${inner.map(r => `<tr>
            <td class="l">${esc(shortName(r.ind))}</td><td>${r.n}</td><td>${pct(r.ovs_rate)}</td>
            <td class="${r.gap_med > 0 ? "up" : r.gap_med < 0 ? "down" : ""}">${sign(r.gap_med)}</td>
            <td>${r.gap_n}</td><td>${fmt(r.cap, 0)}</td><td>${pct(r.share)}</td></tr>`).join("")}</tbody>
        </table></div>` : ""}
        <p class="hint">${provAdvice(pr, tier, y)}</p>
        ${viewProvTrend(pick)}
        <div class="sectools">
          <button class="xbtn" data-act="csv" data-pfx="区域明细">下载区域明细 CSV</button>
          <button class="xbtn" data-act="png" data-pfx="区域明细">图表存 PNG</button>
        </div>
      </div>` : "";

    /* 省际对比散点 */
    const scatterRows = rows.filter(r => r.gap_med != null && r.gap_n >= 30).map(r => ({
      label: provShort(r.prov),
      x: r.ovs_rate, y: r.gap_med, s: r.cap || 1,
      c: r.gap_med > 3 ? "#C0392B" : r.gap_med > 0 ? "#2E86AB" : "#8A94A6",
      stroke: pick && r.prov === pick ? "#1A2433" : null,
      tip: `${r.prov}\n出海率 ${r.ovs_rate}% | 溢价中位 ${sign(r.gap_med)}pp\n容量 ${fmt(r.cap, 0)} 亿 | 样本 ${r.n}`,
    }));

    return `
    <section class="card" id="sec-prov">
      <div class="card-head">
        <h2>区域全景 · ${y} 年</h2>
        <p>点一个省，看它的省内结构与在全国的位次。</p>
      </div>
      <div class="switcher" data-role="provmetric">
        ${PM.map(m => `<button class="sw${m.k === mk ? " on" : ""}" data-metric="${m.k}">${m.l}</button>`).join("")}
      </div>
      <div class="provwrap">
        <div class="indbars">
          ${hbars(sorted.map(r => ({
        label: provShort(r.prov), v: met.get(r), c: met.c, vt: met.vt(r), pick: r.prov,
      })), { width: 560, labelW: 84, rowH: 28 })}
          <p class="hint dim">点条形可切换选中省份。</p>
        </div>
        <div class="indtable">
          <details class="foldtable">
            <summary><b>省份明细表</b>（${sorted.length} 行）<span class="fthint"><i class="fc">默认折叠，点开查看</i><i class="fo">已展开，点击收起</i></span>
              <button class="xbtn foldcsv" data-act="csv" data-pfx="区域明细">下载 CSV</button></summary>
            <div class="tablewrap"><table class="dt">
              <thead><tr><th>省份</th><th>梯队</th><th>样本</th><th>企业数</th><th>出海率</th>
              <th>渗透度中位</th><th>溢价中位</th><th>溢价为正</th><th>容量(亿)</th></tr></thead>
              <tbody>${sorted.map(r => {
      const t = D2.prov_tier[r.prov];
      return `<tr class="${r.prov === pick ? "sel" : ""}" data-prov="${esc(r.prov)}">
                <td class="l">${esc(r.prov)}${r.n < 100 ? " <span class='dim' style='font-size:10px'>样本少</span>" : ""}</td>
                <td>${t ? esc(t.tier) : "—"}</td><td>${r.n}</td><td>${r.firms}</td>
                <td>${pct(r.ovs_rate)}</td><td>${pct(r.ratio_med)}</td>
                <td class="${r.gap_med > 0 ? "up" : r.gap_med < 0 ? "down" : ""}">${sign(r.gap_med)}</td>
                <td>${pct(r.pos_share)}</td><td>${fmt(r.cap, 0)}</td></tr>`;
    }).join("")}</tbody>
            </table></div>
          </details>
        </div>
      </div>
      ${thin.length ? `<p class="hint dim">样本 &lt;100 的 ${thin.length} 个省（${thin.map(r => r.prov + " " + r.n).join("、")}）已标出，
        它们的溢价中位不稳定，排序靠后不代表真的差。</p>` : ""}
      <h4 class="sub-h">省际对比 · 出海率 vs 溢价（${y} 年）</h4>
      ${scatter(scatterRows, { xlabel: "出海率 (%)", ylabel: "出海溢价中位 (pp)", height: 380, labelTop: 14 })}
      <p class="hint">溢价高的省份不一定出海率高——有些是「去的人少所以还行」，有些是「去的人多所以已经卷」。这张图分得出来。</p>
    </section>
    ${detail}`;
  }

  function provAdvice(pr, tier, y) {
    const parts = [];
    if (tier) parts.push(`${esc(pr.prov)}属于<b>${esc(tier.tier)}</b>，综合分 ${fmt(tier.comp, 2)}。`);
    if (pr.ovs_rate >= 55) parts.push(`${pct(pr.ovs_rate)} 的企业在出海，属于成熟市场——竞争充分、渠道齐，但溢价空间被压得比较小。`);
    else if (pr.ovs_rate >= 40) parts.push(`出海率 ${pct(pr.ovs_rate)}，处在扩张中段，先行窗口还在。`);
    else parts.push(`出海率只有 ${pct(pr.ovs_rate)}，要么是这省的产业结构不适合出海，要么是先发者还没验证——两种解读行动完全不同，需要单独看行业结构。`);
    if (pr.gap_med != null && pr.gap_med > 3) parts.push(`溢价中位 ${sign(pr.gap_med)}pp，说明这省出海的企业确实赚到了，但也要留意是不是集中在少数几个高毛利行业。`);
    if (pr.gap_med != null && pr.gap_med < 0) parts.push(`溢价中位 ${sign(pr.gap_med)}pp，整体不赚钱，这省的出海企业更像是产能外迁而不是市场开拓。`);
    if (pr.gap_n < 50) parts.push(`<b>溢价样本只有 ${pr.gap_n} 个</b>，结论请打折看。`);
    return parts.join(" ");
  }

  /* ==================== 退出诊断区块 ==================== */
  function viewExitSection() {
    const S = D.survival;
    const mode = STATE.exitMode;
    /* 切到「按行业」时如果还没选行业，默认选样本最多的那个，别给一个空下拉框 */
    let exitInd = STATE.exitInd;
    if (mode === "industry" && (!exitInd || !INDKM[exitInd])) {
      exitInd = Object.keys(INDKM).sort((a, b) => INDKM[b].n_firms - INDKM[a].n_firms)[0] || null;
      STATE.exitInd = exitInd;
    }
    const src = (mode === "industry" && exitInd && INDKM[exitInd]) ? INDKM[exitInd] : null;
    const km = src ? src.km : S.km;

    const hazCols = km.map(k => ({
      label: "第" + k.t + "年", v: k.hazard,
      c: k.t === 1 ? "#C0392B" : k.hazard >= (km[0].hazard * 0.6) ? "#D68910" : "#2E86AB",
    }));
    const survPts = km.map(k => ({ x: k.t, v: k.surv }));

    /* 个性化：这家企业「应该在第几年退出」 */
    const advice = exitAdvice(mode, exitInd, src, km);

    /* 三条止损规则：默认总趋势 + 按行业定制 */
    const rules = exitRules(mode, exitInd, src);

    const indOptions = IND.filter(n => INDKM[n]).map(n => `<option value="${esc(n)}"${n === exitInd ? " selected" : ""}>${esc(shortName(n))}</option>`).join("");

    return `
    <section class="card" id="sec-exit">
      <div class="card-head">
        <h2>退出诊断 · 什么时候该止损</h2>
        <p>${S.n_firms.toLocaleString()} 家出海企业里 ${S.n_exit} 家在样本期内退出（${(S.n_exit / S.n_firms * 100).toFixed(1)}%）。
        切到具体行业看这个行业自己的退出节奏。</p>
      </div>
      <div class="switcher" data-role="exitmode">
        <button class="sw${mode === "overall" ? " on" : ""}" data-exitmode="overall">全样本趋势</button>
        <button class="sw${mode === "industry" ? " on" : ""}" data-exitmode="industry">按行业定制</button>
      </div>
      ${mode === "industry" ? `<div class="pickerrow">
        <label>选择行业</label>
        <select id="exitind">${indOptions}</select>
        <span class="hint dim">${exitInd && INDKM[exitInd] ? `该行业 ${INDKM[exitInd].n_firms} 家出海企业，${INDKM[exitInd].n_exit} 次退出。` : ""}</span>
      </div>` : ""}
      <div class="grid2">
        <section class="card">
          <h3>逐年退出风险率${src ? " · " + esc(shortName(exitInd)) : ""}</h3>
          ${columns(hazCols, { height: 280, width: 620 })}
          <p class="hint">${exitHint(km, src)}</p>
        </section>
        <section class="card">
          <h3>累积存活率（KM 估计）</h3>
          ${lineChart(survPts, { height: 280, width: 620, ylabel: "还在出海的占比 (%)", xlabel: "出海第几年", color: "#4A6FA5", ymin: 0, ymax: 100, xint: true })}
          <p class="hint">${survHint(km, src, S)}</p>
        </section>
      </div>
      <div class="card insight">
        <h3>${mode === "industry" ? esc(shortName(exitInd)) + " 行业的退出结论" : "全样本退出结论"}</h3>
        ${advice}
      </div>
      <div class="card">
        <h3>四条能直接用的止损规则${src ? "（已按 " + esc(shortName(exitInd)) + " 定制）" : "（全样本默认）"}</h3>
        <ol class="rules">${rules.map(r => `
          <li><b>${esc(r.title)}</b>
            <p class="rcond">${r.body}</p>
            <p class="ract">${r.detail}</p></li>`).join("")}</ol>
      </div>
    </section>`;
  }

  /* 逐年退出风险率的一句话说明 */
  function exitHint(km, src) {
    if (!km.length) return "这个范围没有可用的退出事件。";
    const k1 = km[0], k2 = km[1];
    let s = "第 1 年退出率 <b>" + k1.hazard + "%</b>";
    if (k2) s += "，是第 2 年（" + k2.hazard + "%）的 " + (k1.hazard / k2.hazard).toFixed(1) + " 倍";
    s += "。";
    s += src
      ? "这个行业的风险峰值在第 " + src.peak_t + " 年。"
      : "过了第 1 年，风险率一路下降。";
    return s;
  }

  /* 累积存活率的一句话说明 */
  function survHint(km, src, S) {
    const parts = [];
    if (km.length) parts.push("10 年后仍有 " + km[km.length - 1].surv + "% 的企业在出海。");
    const med = src
      ? (src.med_t ? src.med_t + " 年" : "超过 10 年（样本期内存活率从未跌到 50%）")
      : (S.med_t ? S.med_t + " 年" : "超过 10 年（样本期内存活率从未跌到 50%）");
    parts.push("中位存续期 " + med + "。");
    return parts.join("");
  }

  function exitAdvice(mode, exitInd, src, km) {    if (mode === "industry" && src) {
      const k1 = km[0], peak = src.peak_t;
      return `<p>${esc(shortName(exitInd))}行业 ${src.n_firms} 家出海企业里，${src.n_exit} 家退出了（${(src.n_exit / src.n_firms * 100).toFixed(1)}%）。
        第 1 年退出率 ${k1 ? k1.hazard : "—"}%，${k1 && k1.hazard > 5 ? "显著高于全样本的 4.12%，说明这个行业出海第一年就容易做不下去，进去要预留更短的试错窗口。" :
          "低于全样本的 4.12%，这个行业第一年的存活情况好于平均。"}</p>
        <p>这个行业的风险峰值在<b>第 ${peak} 年</b>。${peak === 1
          ? "峰值就在第一年，止损线要设得非常早——第一年做不出正毛利就该撤。"
          : peak <= 3 ? "峰值在前三年，说明这个行业的出海模式需要一段时间才能跑通，但也意味着早期风险敞口集中。"
            : "峰值靠后，说明大多数企业能撑过去，但也说明前期投入要准备好。"}</p>
        <p class="dim">按这个行业的经验，如果一定要给一个时间点：<b>第 ${peak} 年</b>是最需要盯的窗口，
        连续两年海外毛利率为负或溢价落后同行 5pp 以上，就应该重新评估。</p>`;
    }
    const lc7 = D.lifecycle.find(l => l.k === 7);
    const lc8 = D.lifecycle.find(l => l.k === 8);
    return `<p>全样本最硬的结论是<b>第一年是生死线</b>：第 1 年退出率 ${D.survival.km[0].hazard}%，是第 2 年（${D.survival.km[1].hazard}%）的 ${(D.survival.km[0].hazard / D.survival.km[1].hazard).toFixed(1)} 倍。
      10 年后仍有 ${D.survival.km[D.survival.km.length - 1].surv}% 的企业在出海，中位存续期超过 10 年。</p>
    <p>但退出不是唯一风险：第 7 年溢价中位掉到 ${lc7 ? lc7.med : "0.68"}pp（全周期最低），第 8 年又回到 ${lc8 ? lc8.med : "—"}pp。
      <b>第 7 年的难看是同侪普遍规律，不是个体失败</b>——这时候要判断的是「你比同行差多少」，不是你自己的绝对值。</p>
    <p class="dim">所以止损线要设两道：一年内的「做不做得出来」（连续两年海外毛利率为负），
      和长期的「比不比得过同行」（相对同行业中位落后 5pp 以上）。</p>`;
  }

  function exitRules(mode, exitInd, src) {
    const S = D.survival;
    const lc7 = D.lifecycle.find(l => l.k === 7);
    const lc8 = D.lifecycle.find(l => l.k === 8);
    const k1 = src ? src.km[0] : S.km[0];
    const k2 = src ? src.km[1] : S.km[1];
    const peak = src ? src.peak_t : 1;

    const r1 = src
      ? {
        title: `第一年止损线：出海头两年溢价就是负的就撤`,
        body: `出海第 1~2 年溢价 &lt; 0（海外毛利率低于境内）。这个行业第 1 年退出率 <b>${k1 ? k1.hazard : "—"}%</b>${k1 && k2 ? `，是第 2 年的 ${(k1.hazard / k2.hazard).toFixed(1)} 倍` : ""}。`,
        detail: `把第一年的资源全压在验证上，不要平摊到三年。第一年跑不出正毛利是产品/定价/渠道问题，再等两年也不会变好。`,
      }
      : {
        title: `第一年止损线：出海头两年溢价就是负的就撤`,
        body: `出海第 1~2 年溢价 &lt; 0。全样本第 1 年退出率 <b>${S.km[0].hazard}%</b>，是第 2 年的 ${(S.km[0].hazard / S.km[1].hazard).toFixed(1)} 倍，各年最高。`,
        detail: `第一年设一条硬线：海外毛利率连续两年为负，就启动退出程序。第一年做不出来的东西，第三年也做不出来。`,
      };

    const r2 = src
      ? {
        title: `连续两年溢价为负：立刻启动退出程序`,
        body: `连续两年溢价 &lt; 0，即海外毛利率连续两年低于境内。这个行业 ${src.n_firms} 家出海企业里 ${src.n_exit} 家退出了。`,
        detail: `设一条自动触发线，写进决策文件，不靠临场判断。`,
      }
      : {
        title: `连续两年溢价为负：立刻启动退出程序`,
        body: `连续两年溢价 &lt; 0，即海外毛利率连续两年低于境内——这个生意本身不成立。全样本 ${S.n_firms} 家里 ${S.n_exit} 家退出（${(S.n_exit / S.n_firms * 100).toFixed(1)}%）。`,
        detail: `设一条自动触发线，写进决策文件，不靠临场判断。`,
      };

    const r3 = src
      ? {
        title: `第 ${peak} 年窗口：相对同侪落后 5pp 就重新评估`,
        body: `出海满 ${peak} 年且溢价 &lt; 同行中位 5pp 以上。这个行业的风险峰值就在第 ${peak} 年。`,
        detail: `第 ${Math.max(peak - 1, 1)} 年做一次同行对标。溢价高于同行中位就扛过去，落后 5pp 以上就收缩。`,
      }
      : {
        title: `第 7 年窗口：看相对位置，不看绝对值`,
        body: `出海满 7 年且溢价 &lt; 同行中位 5pp 以上。生命周期第 7 年全样本溢价中位掉到 <b>${lc7 ? lc7.med : "0.68"}pp</b>（全周期最低），第 8 年回到 ${lc8 ? lc8.med : "—"}pp。`,
        detail: `同样的 1pp，排在同行前面是安全区，排在后面就该收缩。别看绝对值。`,
      };

    const r4 = {
      title: `相对位置止损：溢价落后同行中位 5pp 以上`,
      body: `连续两个对标周期（半年一次）都落后同行中位 5pp 以上。预测模型里最重要的两个特征就是当期溢价（${D.model.risk.imp[0][1]}）和相对同侪位置（${D.model.risk.imp[1][1]}）。`,
      detail: `每半年跟同行业同规模的企业比一次溢价中位，连续两期落后就停止追加投入。`,
    };
    return [r1, r2, r3, r4];
  }

  /* ==================== 总观页一键总结 ==================== */
  function overviewSummary(y, yo, okRows, byGap, byGate, byCap) {
    const best = byGap[0], easy = byGate[0], big = byCap[0];
    const lines = [];
    lines.push(`<b>${y} 年整体</b>：${pct(yo.ovs_rate)} 的企业有海外收入，溢价中位 ${sign(yo.gap_med)}pp，
      只有 ${pct(yo.gap_cov)} 的出海企业能算出溢价（其余没披露海外成本，不给假数值）。`);
    if (best) lines.push(`<b>溢价最高</b>是 ${esc(shortName(best.ind))}（${sign(best.gap_med)}pp），<b>门槛最低</b>是 ${esc(shortName(easy.ind))}（${(easy.gate_med * 100).toFixed(0)} 分位），
      <b>容量最大</b>是 ${esc(shortName(big.ind))}（${fmt(big.cap, 0)} 亿）。`);
    /* 规模和门槛的关系 */
    const t0 = TY[y + "|0-10%"], t9 = TY[y + "|90-100%"];
    if (t0 && t9) {
      lines.push(`<b>规模越大出海越多，但溢价越低</b>：规模最低 10% 出海率 ${pct(t0.ovs_rate)}、溢价 ${sign(t0.gap_med)}pp；
        最高 10% 出海率 ${pct(t9.ovs_rate)}、溢价 ${sign(t9.gap_med)}pp。大公司出海更像规模扩张，小公司出海才是找利基。`);
    }
    if (yo.ind_ok < yo.ind_all) {
      lines.push(`<b>口径提醒</b>：${y} 年只有 ${yo.ind_ok}/${yo.ind_all} 个行业的溢价样本达到 30 个，
        行业层面的结论在这一年要保守看。${y <= 2017 ? "早年份整体披露率只有 " + pct(yo.gap_cov) + "，横向比较的可信度更低。" : ""}`);
    }
    lines.push(`<b>归因</b>：溢价的主要驱动不是「海外更赚钱」，而是「境内毛利率低」。
      归因模型里境内毛利率的重要性（${fmt(D.model.attrib.imp[0][1], 3)}）是第二名（${fmt(D.model.attrib.imp[1][1], 3)}）的 ${(D.model.attrib.imp[0][1] / D.model.attrib.imp[1][1]).toFixed(1)} 倍。`);
    return summaryBox(`一键总结 · ${y} 年出海质量`, lines);
  }

  /* ==================== 视图：企业（一页看完） ==================== */
  function viewFirm() {
    return `
    <section class="hero small">
      <h1>企业出海体检</h1>
      <p class="sub">一家企业一页看完：当前诊断、行业上下文、区域位置、退出机制、行动清单，全部在一起。</p>
      <div class="searchbox">
        <input id="fq" type="text" placeholder="输入 6 位代码或公司名，如 000001 / 中兴通讯 / 医药" autocomplete="off">
        <button id="fgo">查询</button>
      </div>
      <div class="quick" id="quick"></div>
    </section>
    <div id="firmout"></div>`;
  }

  function findFirm(q) {
    q = String(q || "").trim().toLowerCase();
    if (!q) return null;
    const exact = F.find(f => f[0] === q || f[1].toLowerCase() === q);
    if (exact) return exact;
    return F.find((f, i) => F_IDX[i].includes(q)) || null;
  }

  /* 同侪分布带（v3 新增）
     把「这家比同行差多少」从一句文字变成一张图：
     横轴 = 出海溢价，蓝色带是同行业同规模档企业的分布，红线是这家公司。 */
  function viewPeerBand(code, gap, indName) {
    const pos = PEERPOS[code];
    if (!pos || !PEERD[pos.ind + "||" + pos.dec]) {
      return `<section class="card">
        <h3>同侪分布 · 你在同行里的位置</h3>
        <p class="hint">这家没有足够的同行业同规模样本，画不出分布带。</p>
      </section>`;
    }
    const cell = PEERD[pos.ind + "||" + pos.dec];
    const pctTxt = pos.pct == null ? "—" : (pos.pct >= 50 ? "高于" : "低于") + "同侪中位 " + Math.abs(50 - pos.pct).toFixed(0) + " 个百分位";
    return `
    <section class="card">
      <h3>同侪分布 · 你在同行里的位置</h3>
      <p class="hint">同行业、同规模档（${shortName(pos.ind)} · 规模第 ${pos.dec + 1} 档）里 ${cell.n} 家能算出溢价的企业，
      它们的溢价分布如下。你在同侪的 <b>${pos.pct == null ? "—" : pos.pct + " 分位</b>"}（${esc(pctTxt)}）。</p>
      ${peerBand(cell, gap, { width: 760, height: 240 })}
      <div class="legend">
        <span><i style="background:rgba(74,111,165,.45)"></i>中间 50% 同侪（p25–p75）</span>
        <span><i style="background:rgba(74,111,165,.18)"></i>外侧 80% 同侪（p10–p90）</span>
        <span><i style="background:#1A2433"></i>同侪中位</span>
        <span><i style="background:#C0392B"></i>本公司</span>
      </div>
    </section>`;
  }

  /* ==================== 判定三档标尺（v3 新增） ====================
     原来是「一个颜色圆点 + 维持」两个字，客户不知道差多少才变成加码/收缩。
     改成：收缩 — 维持 — 加码 三档刻度尺，指针标出当前档；下面一行写依据。
     颜色口径：加码=红（好）／维持=蓝（中）／收缩=绿（差），与页面其它涨跌色一致。 */
  function verdictScale(f, indRow, rules, stops) {
    const [code, name, indI, provI, hasOvs, ratio, gap, sizePct, tenure, risk, verdict,
      gapVsInd, domGm, ratioPct, domPct, p1, p2, pImp, gapBad] = f;

    /* 位置：0=收缩 1=维持 2=加码；数据不足/未出海不落在刻度上 */
    const POS = { 1: 2, 2: 1, 4: 0 };
    const pos = POS[verdict];
    const indeterminate = verdict === 0;
    const notYet = verdict === 3;

    /* 依据行：把「为什么是这个档」摆出来 */
    const why = [];
    if (gap != null && indRow && indRow.gap_med != null) {
      const d = gap - indRow.gap_med;
      why.push(`溢价 ${sign(gap)}pp，同行中位 ${sign(indRow.gap_med)}pp（相对 ${sign(d)}pp）`);
    } else if (gap == null) {
      why.push("溢价未披露，算不出");
    }
    if (ratioPct != null) why.push(`渗透度在同行 ${ratioPct} 分位`);
    if (rules && rules.hit && rules.hit.length) {
      const names = rules.hit.map(id => (D2.rules.defs.find(dd => dd.id === id) || {}).name).filter(Boolean);
      why.push(`命中 ${rules.hit.length} 条规则${names.length ? "（" + names.join("、") + "）" : ""}`);
    } else if (rules) {
      why.push("六条硬信号都没命中");
    }
    if (stops && stops.length) {
      why.push(`触发 ${stops.length} 条止损规则`);
    }

    const ticks = [
      { k: 0, l: "收缩", c: "#4A8B6F" },
      { k: 1, l: "维持", c: "#2E86AB" },
      { k: 2, l: "加码", c: "#C0392B" },
    ];
    const markLeft = pos == null ? 0 : (pos / 2) * 100;

    return `
    <div class="vscale${indeterminate || notYet ? " off" : ""}">
      <div class="vscale-top">
        <span class="vscale-label">出海决策</span>
        <b class="vscale-val" style="color:${indeterminate ? "#8A94A6" : (pos == null ? "#5A6675" : ticks[pos].c)}">
          ${esc(VERDICT[verdict])}</b>
      </div>
      <div class="vscale-track">
        ${ticks.map(t => `<span class="vtick" style="left:${t.k / 2 * 100}%">
          <i style="background:${t.c}"></i><em>${t.l}</em></span>`).join("")}
        ${pos == null ? "" : `<span class="vmark" style="left:${markLeft}%"></span>`}
      </div>
      ${indeterminate ? `<p class="vscale-why">口径异常（海外与境内毛利率差超 ±${D.meta.gap_cap}pp），不给加码/收缩结论。</p>` :
        notYet ? `<p class="vscale-why">这家目前还没有海外收入，下面是「想出海」的可行性判断。</p>` :
          `<p class="vscale-why">${esc(why.join(" · "))}</p>`}
    </div>`;
  }

  /* ---------- 企业页主渲染 ---------- */
  function renderFirm(f) {
    if (!f) return `<div class="empty">没有匹配的企业。试试输入 6 位代码（如 000001）或公司名关键字。</div>`;
    const [code, name, indI, provI, hasOvs, ratio, gap, sizePct, tenure, risk, verdict,
      gapVsInd, domGm, ratioPct, domPct, p1, p2, pImp, gapBad] = f;
    const indName = indI >= 0 ? IND[indI] : "—";
    const provName = provI >= 0 ? PROV[provI] : "—";
    const o = indObj[indName] || {};
    const h = D.hist[code] || { y: [], r: [], g: [] };
    const x = FX[code] || {};
    const indRow = IY[indName + "|" + LAST] || {};
    const provRow = PY[provName + "|" + LAST] || {};
    const peer = PEER[indName];
    const st = STRESS[code];
    const rules = D2.firm_rules[code] || { hit: [], w: 0 };
    const stops = STOP[code] || [];

    const head = `
      <div class="firm-head">
        <div>
          <h2>${esc(name)} <span class="code">${esc(code)}</span></h2>
          <p class="meta">${esc(indName)} · ${esc(provName)} · 最新年报 ${LAST}</p>
        </div>
        <div class="firmhead-right">
          ${verdictScale(f, indRow, rules, stops)}
          ${exportBtns("企业体检")}
        </div>
      </div>`;

    const body = hasOvs === 1
      ? firmOvsBody({ f, code, name, indName, provName, o, h, x, indRow, provRow, st, rules, stops, gap, gapBad, ratio, sizePct, tenure, risk, verdict, gapVsInd, domGm, ratioPct, domPct, p1, p2, pImp })
      : firmNoBody({ f, code, name, indName, provName, o, h, x, indRow, provRow, peer, sizePct, ratio, p1, p2, pImp });

    return head + body + firmSummary({ f, code, name, indName, provName, o, indRow, provRow, st, rules, stops, hasOvs, gap, verdict, tenure, risk, sizePct, ratio });
  }

  /* ---------- 已出海企业 ---------- */
  function firmOvsBody(P) {
    const {
      code, name, indName, provName, o, h, x, indRow, provRow, st, rules, stops,
      gap, gapBad, ratio, sizePct, tenure, risk, verdict, gapVsInd, domGm, ratioPct, domPct, p1, p2, pImp
    } = P;
    const gapTxt = gap == null ? "未披露" : sign(gap) + "pp";
    const stageTxt = tenure == null ? "—" : `第 ${tenure} 年`;
    const indGap = indRow.gap_med != null ? indRow.gap_med : o.gap_med;
    const vsInd = (gap == null || indGap == null || gapBad === 1) ? null : gap - indGap;

    /* 归因三层 */
    const causes = [];
    if (gapBad === 1) {
      causes.push(["口径异常", `海外与境内毛利率差 ${sign(gap)}pp，超出 ±${D.meta.gap_cap}pp 的合理区间。分部报告里海外/境内的成本分摊口径一变，这个数就失真。全样本有 ${D.meta.n_gap_bad} 个企业·年（${(D.meta.n_gap_bad / D.meta.n_gap * 100).toFixed(1)}%）是这种情况，所以这类企业不给加码/收缩结论`]);
    } else if (gap == null) {
      causes.push(["溢价算不出来", "这家只披露了海外收入、没披露海外或境内分部成本，毛利率差无法计算。页面不给假数值，也不做推测"]);
    }
    if (x.ref_gate != null && sizePct != null && sizePct < x.ref_gate) {
      causes.push(["规模不达门槛", `规模在行业内 ${(sizePct * 100).toFixed(0)} 分位，低于同行业出海企业的门槛中位 ${(x.ref_gate * 100).toFixed(0)} 分位。规模会限制海外渠道铺设与账期承受力`]);
    }
    if (gap != null && gapBad !== 1) {
      if (domGm != null && x.ref_gm_dom != null && domGm > x.ref_gm_dom + 5) {
        causes.push(["境内太赚钱", `境内毛利率 ${fmt(domGm, 1)}%，高出同行中位 ${fmt(x.ref_gm_dom, 1)}%（+${fmt(domGm - x.ref_gm_dom, 1)}pp）。溢价被境内高毛利压下去了——不是海外不赚钱，是境内太好赚，海外显得不划算`]);
      }
      if (gap > 0 && domGm != null && x.ref_gm_dom != null && domGm < x.ref_gm_dom - 5) {
        causes.push(["境内基数低", `境内毛利率 ${fmt(domGm, 1)}%，低于同行中位 ${fmt(x.ref_gm_dom, 1)}%（${fmt(domGm - x.ref_gm_dom, 1)}pp）。这个正溢价有一部分是被境内低毛利抬上去的，不代表海外本身强`]);
      }
      if (x.ovs_gm != null && x.ref_gm_ovs != null && x.ovs_gm < x.ref_gm_ovs - 5) {
        causes.push(["海外端没跟上", `海外毛利率 ${fmt(x.ovs_gm, 1)}%，低于同行中位 ${fmt(x.ref_gm_ovs, 1)}%（${fmt(x.ovs_gm - x.ref_gm_ovs, 1)}pp）。规模 ${(sizePct * 100).toFixed(0)} 分位、渗透度 ${ratioPct} 分位都不差，差距落在海外这一块`]);
      }
    }
    if (ratio != null && indRow.ratio_med != null && ratio < indRow.ratio_med * 0.6) {
      causes.push(["渗透太浅", `海外占比 ${pct(ratio)}，同行中位 ${pct(indRow.ratio_med)}。没形成规模，摊不掉固定投入`]);
    }
    if (tenure != null && tenure >= 6 && tenure <= 8) {
      const lc7 = D.lifecycle.find(l => l.k === 7);
      causes.push(["第 7 年低谷", `全样本在出海第 7 年溢价中位降到 ${lc7 ? lc7.med : 0.68}pp，是全周期最低。这是同侪普遍规律，不是个体失败`]);
    }
    if (!causes.length && vsInd != null && vsInd < 0) {
      causes.push(["海外端没跟上", `规模 ${(sizePct * 100).toFixed(0)} 分位、渗透度 ${ratioPct} 分位都不差，差距落在海外这一块：你的溢价 ${sign(gap)}pp，同行业中位 ${sign(indGap)}pp，落后 ${fmt(-vsInd)}pp`]);
    }
    if (!causes.length) causes.push(["无明显短板", "各项指标都在同侪中位以上，维持当前节奏即可"]);

    /* 风险两层 */
    const riskOk = risk != null && gapBad !== 1;
    const RF = D.model.risk.folds;
    const riskBase = RF.length ? RF[RF.length - 1].base : 0.343;
    const riskAuc = RF.length ? (RF.reduce((a, b) => a + b.auc, 0) / RF.length).toFixed(2) : "0.62";
    const riskColor = !riskOk ? "#8A94A6" : risk > riskBase * 1.25 ? "#C0392B" : risk > riskBase * 0.9 ? "#D68910" : "#4A8B6F";
    const ruleW = rules.w || 0;
    const ruleMax = 13;   // 3+2+1+2+3+2
    const rulePct = ruleW / ruleMax;
    const ruleColor = ruleW >= 6 ? "#C0392B" : ruleW >= 3 ? "#D68910" : "#4A8B6F";

    /* 压力测试 */
    const stressBlock = st ? stressTable(st) : `<p class="hint">这家当年溢价口径异常或无法计算，压力量算不适用。</p>`;

    /* 行业上下文 */
    const indCtx = firmIndContext(indName, indRow, sizePct, ratio, gap, ratioPct, domPct);

    /* 区域上下文 */
    const provCtx = firmProvContext(provName, provRow);

    /* 退出机制 */
    const exitCtx = firmExitContext(indName, tenure, stops);

    /* 行动清单 */
    const actions = firmActions({ causes, rules, stops, st, gap, verdict, tenure, indRow, sizePct });

    /* 同侪分布带（v3 新增）：这家在同行里到底是什么水平 */
    const peerBlock = viewPeerBand(code, gap, indName);

    return `
    <div class="grid2">
      <section class="card">
        <h3>深度定位 · 你在同行里的位置</h3>
        ${pctBar(sizePct, "规模", `出海门槛 ${((indRow.gate_med || 0) * 100).toFixed(0)} 分位`)}
        ${pctBar(ratioPct == null ? null : ratioPct / 100, "海外渗透度",
      ratio == null ? "未披露" : `你 ${pct(ratio)} / 同行中位 ${pct(indRow.ratio_med)}（行业内 ${ratioPct} 分位）`)}
        <div class="statline">
          <div><span>出海溢价</span><b>${gapTxt}</b></div>
          <div><span>行业中位</span><b>${sign(indGap)}pp</b></div>
          <div><span>相对同侪</span><b class="${vsInd > 0 ? "up" : vsInd < 0 ? "down" : ""}">${vsInd == null ? "—" : sign(vsInd) + "pp"}</b></div>
        </div>
        <p class="hint">${gapBad === 1
        ? `这个数超过了 ±${D.meta.gap_cap}pp 的合理区间，大概率是分部成本分摊口径变了，不是真实的毛利差。先看下面的十年轨迹确认是不是某一年突然跳上来——如果是，别拿这个数做决定。`
        : gap == null
          ? "这家企业当年只披露了海外收入、没披露海外成本，溢价算不出来。约 4 成出海企业是这种状态。"
          : vsInd > 0 ? "跑赢同行业中位，可以继续。" : "低于同行业中位，先看归因再决定要不要加码。"}</p>
      </section>

      <section class="card">
        <h3>阶段判断 · ${stageTxt}</h3>
        ${lineChart(D.lifecycle.map(l => ({ x: l.k, v: l.med, lo: l.lo, hi: l.hi })),
      { height: 240, ylabel: "溢价中位 (pp)", xlabel: "出海第 k 年", color: "#2E86AB", xint: true })}
        <p class="hint">阴影是全样本该阶段的 95% bootstrap 置信带。${tenure != null && tenure <= 10
        ? `你在第 ${tenure} 年，全样本这一年的中位是 ${(D.lifecycle.find(l => l.k === tenure) || {}).med ?? "—"}pp。`
        : ""}</p>
      </section>
    </div>

    ${peerBlock}

    <div class="grid2">
      <section class="card">
        <h3>竞争压力 · 同行都在做什么</h3>
        <div class="statline">
          <div><span>行业出海率</span><b>${pct(indRow.ovs_rate)}</b></div>
          <div><span>你的渗透度</span><b>${pct(ratio)}</b></div>
          <div><span>行业门槛</span><b>${((indRow.gate_med || 0) * 100).toFixed(0)} 分位</b></div>
        </div>
        <p class="hint">${indRow.ovs_rate > 65
        ? `这个行业 ${pct(indRow.ovs_rate)} 的同行已经在出海，属于「不进则退」的环境。压力来自同侪，不是来自新进入者。`
        : `这个行业只有 ${pct(indRow.ovs_rate)} 的同行出海，先发的窗口还在，但市场验证也不足。`}</p>
      </section>

      <section class="card">
        <h3>下一年风险 · 两层判断</h3>
        <div class="risk2">
          <div class="risklayer">
            <div class="riskgauge">
              <div class="gv" style="color:${riskColor}">${riskOk ? (risk * 100).toFixed(0) + "%" : "—"}</div>
              <div class="gl">① 机器学习打分 · 次年溢价恶化概率</div>
            </div>
            <p class="hint">XGBoost，walk-forward 验证 AUC ${riskAuc}，样本基准 ${(riskBase * 100).toFixed(1)}%。
            ${gapBad === 1 ? "这家当年溢价口径异常，模型特征被污染，不打分。"
          : !riskOk ? "这家缺关键财务特征，没有打分。"
            : risk > riskBase * 1.25 ? "明显高于基准，建议提前准备收缩预案。"
              : risk > riskBase * 0.9 ? "略高于基准，保持观察。" : "低于基准，风险可控。"}</p>
          </div>
          <div class="risklayer">
            <div class="riskgauge">
              <div class="gv" style="color:${ruleColor}">${ruleW}<i style="font-size:18px">/${ruleMax}</i></div>
              <div class="gl">② 规则层 · ${rules.hit.length} 条硬信号命中</div>
            </div>
            <p class="hint">${rules.hit.length ? "命中：" + rules.hit.map(id => {
              const def = D2.rules.defs.find(dd => dd.id === id);
              return def ? def.name : id;
            }).join("、") + "。每条都有明确触发条件，见下方清单。" : "六条硬信号一条没命中，各项指标都在同侪中位以上。"}</p>
          </div>
        </div>
      </section>
    </div>

    <section class="card">
      <h3>规则层 · 6 条硬信号逐条判定</h3>
      <div class="rulelist">${ruleRows(rules, x, gap, sizePct, indRow, ratio).map(r => `
        <div class="rulehit ${r.on ? "on" : "off"}">
          <span class="rmark">${r.on ? "命中" : "未中"}</span>
          <div>
            <b>${esc(r.name)}<i>${esc(r.layer)}</i></b>
            <p>${r.txt}</p>
          </div>
        </div>`).join("")}</div>
      <p class="hint dim">规则层是机器学习之外的第二层判断：每条都是可解释的硬条件，不依赖模型稳定性。
      机器学习只预测「溢价会不会恶化」，规则层告诉你「为什么可能恶化」。</p>
      <div class="sectools">
        <button class="xbtn" data-act="csv" data-pfx="规则层">导出全样本规则层判定 CSV</button>
      </div>
    </section>

    <section class="card">
      <h3>压力测试 · 溢价再掉会怎样</h3>
      ${stressBlock}
    </section>

    <section class="card">
      <h3>归因 · 为什么是这个结果</h3>
      <ul class="causes">
        ${causes.map(c => `<li><b>${c[0]}</b><span>${c[1]}</span></li>`).join("")}
      </ul>
      <p class="hint dim">归因只到「同侪对比」层面：能说清你比同行差在哪个可观测指标上，
      说不了汇率、关税、渠道这些年报里没有的东西。</p>
    </section>

    ${indCtx}

    ${provCtx}

    ${exitCtx}

    <section class="card">
      <h3>你的十年轨迹</h3>
      ${lineChart(h.y.map((yy, i) => ({ x: yy, v: h.g[i] })),
      { height: 220, ylabel: "出海溢价 (pp)", xlabel: "年份", color: "#C0392B", xint: true, xn: 5 })}
      <p class="hint">只画能算出来的年份。空白处是当年没披露海外成本的年份，不是 0。</p>
    </section>

    <section class="card">
      <h3>行动清单</h3>
      <ol class="steps">${actions.map(a => `<li><b>${esc(a.t)}</b>${a.d}</li>`).join("")}</ol>
    </section>`;
  }

  /* ---------- 压力测试表（双轨分母） ---------- */
  function stressTable(st) {
    const rows = st.rows.map(r => {
      const npCell = st.np_neg === 1
        ? `<span class="dim">当期亏损，不适用</span>`
        : (r.pct_np != null ? `<b class="${r.pct_np > 25 ? "up" : ""}">${r.pct_np}%</b>` : "—");
      return `<tr>
        <td class="l">海外毛利率再降 ${r.dpp}pp</td>
        <td>${fmt(r.loss_yi, 3)} 亿</td>
        <td>${npCell}</td>
        <td>${r.pct_assets != null ? fmt(r.pct_assets, 2) + "%" : "—"}</td>
        <td>${r.pct_ovs_gm != null ? fmt(r.pct_ovs_gm, 1) + "%" : "—"}</td>
      </tr>`;
    }).join("");
    return `
    <div class="stresshead">
      <div><span>海外收入</span><b>${fmt(st.rev_yi, 2)} 亿</b></div>
      <div><span>总资产</span><b>${fmt(st.assets_yi, 1)} 亿</b></div>
      <div><span>净利润</span><b class="${st.np_neg ? "down" : ""}">${fmt(st.np_yi, 2)} 亿</b></div>
      <div><span>海外毛利率</span><b>${st.gm_ovs != null ? fmt(st.gm_ovs, 1) + "%" : "—"}</b></div>
    </div>
    <div class="tablewrap"><table class="dt">
      <thead><tr><th>情景</th><th>海外毛利减少</th><th>相当于净利润</th><th>占总资产</th><th>占海外毛利</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="hint">溢价每降 1pp，海外收入对应的毛利就少 1%。${st.np_neg === 1
        ? "<b>这家企业当期净利润为负</b>，「相当于净利润 X%」没有意义，所以这一列留空，只看「占总资产」——后者对所有企业都成立。"
        : "「相当于净利润」只对盈利企业有意义，所以这一列只对盈利企业给数。"}
      最后一列是相对海外毛利的占比，跟企业盈亏无关，任何情况下都能看。</p>`;
  }

  /* ---------- 规则层逐条 ---------- */
  function ruleRows(rules, x, gap, sizePct, indRow, ratio) {
    const hit = rules.hit || [];
    const has = id => hit.includes(id);
    const defs = D2.rules.defs;
    const rows = [];
    /* 1 溢价恶化 */
    let t1 = "当前溢价";
    if (gap == null) t1 = "溢价算不出来，这条无法判定";
    else if (gap < 0) t1 = `当前溢价 ${sign(gap)}pp，已经为负`;
    else if (x.gap_prev != null) t1 = `当前溢价 ${sign(gap)}pp，上一年 ${sign(x.gap_prev)}pp`;
    else t1 = `当前溢价 ${sign(gap)}pp`;
    rows.push({
      id: 1, name: defs[0].name, layer: defs[0].layer, on: has(1),
      txt: `触发条件：溢价 <0，或较上一年下滑 ≥2pp。${t1}。`,
    });
    /* 2 渗透见顶 */
    let t2 = "缺少上年渗透度，无法比较";
    if (x.ratio_prev != null && ratio != null) {
      const d = ratio - x.ratio_prev;
      t2 = `海外占比 ${pct(ratio)}，上一年 ${pct(x.ratio_prev)}（${sign(d, 1)}pp）`;
    }
    rows.push({
      id: 2, name: defs[1].name, layer: defs[1].layer, on: has(2),
      txt: `触发条件：海外渗透度较上一年不再增长。${t2}。`,
    });
    /* 3 规模不足 */
    let t3 = "规模数据缺失";
    if (x.ref_gate != null && sizePct != null) {
      t3 = `你在 ${(sizePct * 100).toFixed(0)} 分位，同行业出海企业门槛中位 ${(x.ref_gate * 100).toFixed(0)} 分位`;
    }
    rows.push({
      id: 3, name: defs[2].name, layer: defs[2].layer, on: has(3),
      txt: `触发条件：规模分位低于同行业出海企业的门槛中位。${t3}。`,
    });
    /* 4 境内高毛利 */
    let t4 = "境内毛利率数据缺失";
    if (x.dom_gm != null && x.ref_gm_dom != null) {
      t4 = `境内毛利率 ${fmt(x.dom_gm, 1)}%，同行中位 ${fmt(x.ref_gm_dom, 1)}%（${sign(x.dom_gm - x.ref_gm_dom, 1)}pp）`;
    }
    rows.push({
      id: 4, name: defs[3].name, layer: defs[3].layer, on: has(4),
      txt: `触发条件：境内毛利率高出同行中位 5pp 以上。${t4}。高出越多，海外的溢价越被压低。`,
    });
    /* 5 海外毛利偏低 */
    let t5 = "海外毛利率数据缺失";
    if (x.ovs_gm != null && x.ref_gm_ovs != null) {
      t5 = `海外毛利率 ${fmt(x.ovs_gm, 1)}%，同行中位 ${fmt(x.ref_gm_ovs, 1)}%（${sign(x.ovs_gm - x.ref_gm_ovs, 1)}pp）`;
    }
    rows.push({
      id: 5, name: defs[4].name, layer: defs[4].layer, on: has(5),
      txt: `触发条件：海外毛利率低于同行中位 5pp 以上。${t5}。这说明差距在海外这一端，不在境内基数。`,
    });
    /* 6 财务承压 */
    let t6 = "杠杆与现金流数据缺失";
    if (x.lev != null && x.ref_lev != null) {
      t6 = `资产负债率 ${fmt(x.lev * 100, 1)}%，同行中位 ${fmt(x.ref_lev * 100, 1)}%（${sign((x.lev - x.ref_lev) * 100, 1)}pp）`;
      if (x.cashflow != null) t6 += `；经营现金流 ${fmt(x.cashflow, 3)}`;
    }
    rows.push({
      id: 6, name: defs[5].name, layer: defs[5].layer, on: has(6),
      txt: `触发条件：杠杆高出同行中位 10pp 以上，或经营现金流为负。${t6}。出海铺渠道要垫钱，扛不住现金流就会死在路上。`,
    });
    return rows;
  }

  /* ---------- 企业页：行业上下文 ---------- */
  function firmIndContext(indName, indRow, sizePct, ratio, gap, ratioPct, domPct) {
    const all = IND.map(n => IY[n + "|" + LAST]).filter(r => r && r.gap_med != null && r.gap_n >= 30);
    const rows = all.map(r => ({
      label: shortName(r.ind), x: (r.gate_med || 0) * 100, y: r.gap_med, s: r.cap || 1,
      c: r.gap_med >= 3 ? "#C0392B" : r.gap_med >= 0 ? "#D68910" : "#4A8B6F",
      stroke: r.profitable === 1 ? "#1A2433" : "#FFFFFF", dash: r.profitable === 0,
      show: r.ind === indName,
      tip: `${r.ind}\n门槛 ${((r.gate_med || 0) * 100).toFixed(0)} 分位 | 溢价 ${sign(r.gap_med)}pp\n溢价为正 ${r.pos_share}% | 容量 ${fmt(r.cap, 0)} 亿`,
    }));
    const sorted = all.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    const rank = sorted.findIndex(r => r.ind === indName) + 1;
    const my = IY[indName + "|" + LAST];
    return `
    <section class="card">
      <h3>行业上下文 · ${esc(indName)}</h3>
      <div class="statline wrap">
        <div><span>行业样本</span><b>${my ? my.n : "—"}</b></div>
        <div><span>行业出海率</span><b>${pct(my && my.ovs_rate)}</b></div>
        <div><span>渗透度中位</span><b>${pct(my && my.ratio_med)}</b></div>
        <div><span>溢价中位</span><b class="${my && my.gap_med > 0 ? "up" : my && my.gap_med < 0 ? "down" : ""}">${my ? sign(my.gap_med) : "—"}</b></div>
        <div><span>溢价为正</span><b>${pct(my && my.pos_share)}</b></div>
        <div><span>门槛</span><b>${my ? ((my.gate_med || 0) * 100).toFixed(0) + " 分位" : "—"}</b></div>
        <div><span>吸引力排名</span><b>${rank} / ${IND.length}</b></div>
        <div><span>容量(亿)</span><b>${my ? fmt(my.cap, 0) : "—"}</b></div>
      </div>
      <h4 class="sub-h">这个行业在所有行业里的位置</h4>
      ${scatter(rows, { xlabel: "出海门槛（规模分位）", ylabel: "出海溢价中位 (pp)", height: 350, labelTop: 26 })}
      <p class="hint">${esc(indName)} 是唯一被描黑边的点，其余 ${all.length - 1} 个行业作参照。
      横轴越靠右说明这个行业越多人已经在做（门槛高），纵轴越高说明做的人更赚钱。
      <b>右上＝进得去且赚得到</b>；右下＝进得去但赔钱；左上＝还没人占位，但要自己验证。</p>
      <p class="hint">${indRow && indRow.ovs_rate > 65
        ? `这个行业 ${pct(indRow.ovs_rate)} 的同行已经在出海，属于「不进则退」的环境——你不是在开拓新市场，是在追赶已有格局。`
        : indRow && indRow.ovs_rate < 35
          ? `这个行业只有 ${pct(indRow.ovs_rate)} 的同行出海。机会在，但没人验证过能不能赚钱，你要自己跑通盈利模型。`
          : `这个行业 ${pct(indRow && indRow.ovs_rate)} 的同行出海，处在中间地带。`}</p>
    </section>`;
  }

  /* ---------- 企业页：区域上下文 ---------- */
  function firmProvContext(provName, provRow) {
    const t = D2.prov_tier[provName];
    const inner = D2.prov_ind[provName] || [];
    const all = PROV.map(n => PY[n + "|" + LAST]).filter(r => r && r.gap_med != null && r.n >= 100);
    const rank = all.slice().sort((a, b) => b.ovs_rate - a.ovs_rate).findIndex(r => r.prov === provName) + 1;
    return `
    <section class="card">
      <h3>区域上下文 · ${esc(provName)}</h3>
      <div class="statline wrap">
        <div><span>梯队</span><b>${t ? esc(t.tier) : "—"}</b></div>
        <div><span>省内样本</span><b>${provRow ? provRow.n : "—"}</b></div>
        <div><span>出海率</span><b>${pct(provRow && provRow.ovs_rate)}</b></div>
        <div><span>溢价中位</span><b class="${provRow && provRow.gap_med > 0 ? "up" : provRow && provRow.gap_med < 0 ? "down" : ""}">${provRow ? sign(provRow.gap_med) : "—"}</b></div>
        <div><span>渗透度中位</span><b>${pct(provRow && provRow.ratio_med)}</b></div>
        <div><span>容量(亿)</span><b>${provRow ? fmt(provRow.cap, 0) : "—"}</b></div>
        <div><span>出海率排名</span><b>${rank} / ${PROV.length}</b></div>
      </div>
      ${inner.length ? `
      <h4 class="sub-h">本省出海收入 top5 行业</h4>
      ${hbars(inner.map(r => ({ label: shortName(r.ind), v: r.cap, c: "#4A6FA5", vt: fmt(r.cap, 0) + " 亿（" + r.share + "%）" })), { width: 560, labelW: 104 })}
      <p class="hint">${esc(provName)}的出海盘子靠这几个行业撑着。如果你的行业不在这个名单里，
      说明本省没有现成的供应链、客户或服务商支持你的出海动作，成本会更高。</p>` : ""}
      <p class="hint">${provAdvice(provRow || { prov: provName, ovs_rate: 0, gap_med: 0, gap_n: 0 }, t, LAST)}</p>
    </section>`;
  }

  /* ---------- 企业页：退出机制 ---------- */
  function firmExitContext(indName, tenure, stops) {
    const km = INDKM[indName];
    const all = D.survival;
    const myT = tenure;
    const curHazard = km && myT && km.km.find(k => k.t === myT);
    const peak = km ? km.peak_t : 1;
    const hitMap = {}; stops.forEach(s => hitMap[s.id] = s);
    return `
    <section class="card">
      <h3>退出机制 · 这家企业该在第几年撤</h3>
      <div class="grid2">
        <div>
          <div class="statline wrap">
            <div><span>你在第几年</span><b>${myT != null ? myT + " 年" : "—"}</b></div>
            <div><span>行业第1年退出率</span><b>${km ? km.km[0].hazard + "%" : "—"}</b></div>
            <div><span>行业风险峰值</span><b>${km ? "第 " + peak + " 年" : "—"}</b></div>
            <div><span>行业10年存活</span><b>${km ? km.km[km.km.length - 1].surv + "%" : "—"}</b></div>
          </div>
          <p class="hint">${km
        ? `${esc(shortName(indName))}行业 ${km.n_firms} 家出海企业里 ${km.n_exit} 家退出。
          ${curHazard ? `你现在处于第 ${myT} 年，这一年该行业的退出风险率是 <b>${curHazard.hazard}%</b>（在险 ${curHazard.at_risk} 家）。` : ""}
          ${peak <= 2 ? "风险峰值就在前两年，止损线要设得早。" : `风险峰值在第 ${peak} 年。`}`
        : "这个行业样本太少，算不出自己的退出曲线，用全样本代替。"}</p>
          <p class="hint">${myT != null && myT >= 6 && myT <= 8
        ? "<b>你正处在第 7 年低谷窗口。</b>这个阶段的溢价难看是同侪普遍规律，先比相对位置再决定要不要收缩。"
        : myT != null && myT === 1
          ? "<b>你还在第一年，这是风险最高的阶段。</b>全样本第 1 年退出率是后面年份的 1.6 倍，现在没做出来的东西，第三年也做不出来。"
          : myT != null && myT >= 9
            ? "你已经过了最危险的阶段，退出风险很低。这个阶段要关注的是溢价水平，不是生存。"
            : ""}</p>
        </div>
        <div>
          ${km ? lineChart(km.km.map(k => ({ x: k.t, v: k.hazard })),
        { height: 220, ylabel: "退出风险率 (%)", xlabel: "出海第几年", color: "#C0392B", xint: true, ymin: 0 })
        : lineChart(all.km.map(k => ({ x: k.t, v: k.hazard })),
          { height: 220, ylabel: "退出风险率 (%)", xlabel: "出海第几年", color: "#8A94A6", xint: true, ymin: 0 })}
          <p class="hint dim">${km ? esc(shortName(indName)) + " 行业自己的退出曲线" : "全样本退出曲线（该行业样本不足）"}</p>
        </div>
      </div>
      <h4 class="sub-h">四条止损规则 · 这家企业的判定</h4>
      <div class="rulelist">
        <div class="rulehit ${hitMap[0] ? "on" : "off"}">
          <span class="rmark">${hitMap[0] ? "触发" : "未触发"}</span>
          <div><b>第一年止损线（前置）：出海第 1~2 年溢价就是负的</b>
            <p>${hitMap[0] ? esc(hitMap[0].txt)
        : (myT != null && myT <= 2 ? "当前溢价不为负，第一年没有踩线。" : myT != null ? "已经过了前两年，第一年止损线对你已经没有意义——现在要看的是相对位置。" : "出海年数未知，这条无法判定。")}</p></div>
        </div>
        <div class="rulehit ${hitMap[1] ? "on" : "off"}">
          <span class="rmark">${hitMap[1] ? "触发" : "未触发"}</span>
          <div><b>连续两年出海溢价为负</b>
            <p>${hitMap[1] ? esc(hitMap[1].txt) : (myT != null && myT > 2 ? "没有连续两年溢价为负。" : "当前没有连续两年溢价为负。")}</p></div>
        </div>
        <div class="rulehit ${hitMap[2] ? "on" : "off"}">
          <span class="rmark">${hitMap[2] ? "触发" : "未触发"}</span>
          <div><b>第 7 年低谷：出海第 6~8 年且溢价 &lt;1pp</b>
            <p>${hitMap[2] ? esc(hitMap[2].txt) : (myT != null && myT >= 6 && myT <= 8 ? "你正处在低谷窗口，但当前溢价还不算差，属于同侪正常波动。" : "当前不在低谷窗口，或者溢价没有掉到低谷区。")}</p></div>
        </div>
        <div class="rulehit ${hitMap[3] ? "on" : "off"}">
          <span class="rmark">${hitMap[3] ? "触发" : "未触发"}</span>
          <div><b>相对位置止损：溢价落后同行业中位 5pp 以上</b>
            <p>${hitMap[3] ? esc(hitMap[3].txt) : "当前溢价没有落后同行业中位 5pp 以上。"}</p></div>
        </div>
      </div>
      ${hitMap[4] ? `<div class="warnbar hard"><b>硬信号</b>${esc(hitMap[4].txt)}</div>` : ""}
    </section>`;
  }

  /* ---------- 企业页：行动清单 ---------- */
  function firmActions(P) {
    const { causes, rules, stops, st, gap, verdict, tenure, indRow, sizePct } = P;
    const acts = [];
    const hitNames = rules.hit.map(id => (D2.rules.defs.find(dd => dd.id === id) || {}).name);
    if (stops.some(s => s.id === 4)) {
      acts.push({ t: "立刻复核海外业务", d: "连续两年海外毛利率为负，这不是周期问题。先查是定价、成本分摊还是汇率，再决定要不要继续投入。" });
    }
    if (hitNames.includes("溢价恶化")) {
      acts.push({ t: "把溢价拆开看", d: "溢价在恶化（为负或较上年下滑 ≥2pp），先分清是海外毛利率掉了还是境内毛利率涨了——这两个的处理方式完全相反。规则层已经标了具体是哪一侧。" });
    }
    if (hitNames.includes("渗透见顶")) {
      acts.push({ t: "停止扩规模，转做单点盈利", d: "海外渗透度不再增长，说明现在的渠道或产品已经打到了天花板。接下来的目标应该是把单点毛利做厚，而不是继续铺量。" });
    }
    if (hitNames.includes("规模不足")) {
      acts.push({ t: "用轻资产方式试", d: "规模低于行业门槛，铺渠道和垫账期会先把你压垮。考虑代理、贴牌或者只做一两个国家的渠道商合作。" });
    }
    if (hitNames.includes("境内高毛利挤压")) {
      acts.push({ t: "重新算这笔账", d: "境内毛利率高出同行 5pp 以上，海外相对不划算。要么把优质产能往海外挪（海外客户愿不愿意为溢价买单要验证），要么承认这个业务在国内更赚钱。" });
    }
    if (hitNames.includes("海外毛利偏低")) {
      acts.push({ t: "查海外端的成本结构", d: "规模、渗透度都在同侪中位以上，差距落在海外毛利率本身。要查的是海外本地化成本、渠道返点、物流和关税承担方式。" });
    }
    if (hitNames.includes("财务承压")) {
      acts.push({ t: "先做现金流压力测试", d: "杠杆偏高或经营现金流为负。海外铺渠道要垫钱，先算清楚最坏情况下能不能撑到第 1 年止损线判定。" });
    }
    if (!acts.length) {
      acts.push({ t: "维持当前节奏", d: "六条硬信号一条没命中，各项指标都在同侪中位以上。下一个观察点是下一年的溢价和渗透度——半年做一次同行对标就够了。" });
    }
    if (st && st.np_neg === 0 && st.rows[1].pct_np != null && st.rows[1].pct_np >= 15) {
      acts.push({ t: "对溢价下滑做预案", d: `海外毛利率再降 5pp，海外毛利会少 ${fmt(st.rows[1].loss_yi, 3)} 亿，相当于当前净利润的 ${st.rows[1].pct_np}%。这个量级已经够影响全年业绩，得提前想好应对（比如调整报价、转嫁运费、或者收缩低毛利订单）。` });
    }
    if (tenure != null && tenure === 1) {
      acts.push({ t: "盯住第一年", d: `全样本第 1 年退出率 ${D.survival.km[0].hazard}%，是后面年份的 ${(D.survival.km[0].hazard / D.survival.km[1].hazard).toFixed(1)} 倍。设一条硬止损线：连续两年海外毛利率为负就启动退出程序。` });
    }
    if (gap != null && verdict === 1) {
      acts.push({ t: "加码要加在点上", d: "当前判定是加码。但别平均加——优先加在溢价贡献最大的那部分市场，避开规模不达门槛或渗透见顶的板块。" });
    }
    if (gap != null && verdict === 4) {
      acts.push({ t: "收缩要有次序", d: "当前判定是收缩。先缩掉溢价最负的板块，保留还有正毛利的部分——整体收缩是最差的选择。" });
    }
    return acts.slice(0, 6);
  }

  /* ---------- 未出海企业 ---------- */
  function firmNoBody(P) {
    const { code, name, indName, provName, o, h, x, indRow, provRow, peer, sizePct, ratio, p1, p2, pImp } = P;
    const mySize = sizePct;
    const gateMed = indRow.gate_med != null ? indRow.gate_med : o.gate_med;
    const gateP25 = o.gate_p25, gateP75 = o.gate_p75;
    const canPass = mySize != null && gateMed != null ? mySize >= gateMed : null;
    const score = (p1 != null && p2 != null) ? { s1: p1, s2: p2, total: p1 * p2 } : null;

    const posRows = IND.map(n => IY[n + "|" + LAST]).filter(r => r && r.gap_med != null && r.gap_n >= 30)
      .map(r => ({
        label: shortName(r.ind), x: (r.gate_med || 0) * 100, y: r.gap_med, s: r.cap || 1,
        c: r.gap_med >= 3 ? "#C0392B" : r.gap_med >= 0 ? "#D68910" : "#4A8B6F",
        stroke: r.profitable === 1 ? "#1A2433" : "#FFFFFF", dash: r.profitable === 0,
        show: r.ind === indName,
        tip: `${r.ind}\n门槛 ${((r.gate_med || 0) * 100).toFixed(0)} 分位 | 溢价 ${sign(r.gap_med)}pp\n溢价为正 ${r.pos_share}%`,
      }));

    /* 模拟轨迹基准线 */
    const peerBlock = peerBlockFor(peer, sizePct, indName);

    return `
    <div class="note-bar">这家企业 ${LAST} 年没有海外收入。下面是「该不该进」的评估，不是「能不能进」的结论。</div>

    <div class="grid2">
      <section class="card">
        <h3>行业吸引力 · ${esc(indName)}</h3>
        <div class="statline wrap">
          <div><span>行业出海率</span><b>${pct(indRow.ovs_rate)}</b></div>
          <div><span>行业溢价中位</span><b>${sign(indRow.gap_med)}</b></div>
          <div><span>溢价为正</span><b>${pct(indRow.pos_share)}</b></div>
          <div><span>吸引力排名</span><b>${IND.filter(n => (IY[n + "|" + LAST] || {}).score > (indRow.score || 0)).length + 1} / ${IND.length}</b></div>
        </div>
        <p class="hint">${indRow.ovs_rate > 60
        ? "这个行业已经打得很凶，进去要跟 6 成以上的同行抢。"
        : indRow.ovs_rate < 35 ? "这个行业出海的人还少，窗口期可能还在，但也没人验证过能不能赚。" : "处在中间地带，可以进但不是风口。"}</p>
        <p class="hint">${indRow.gap_med != null && indRow.gap_med > 0
        ? `行业里 ${pct(indRow.pos_share)} 的出海企业溢价为正，中位 ${sign(indRow.gap_med)}pp——这个行业的出海是能赚钱的。`
        : `行业里只有 ${pct(indRow.pos_share)} 的出海企业溢价为正，中位 ${sign(indRow.gap_med)}pp——这个行业的出海整体不赚钱，进去要先想清楚凭什么你能例外。`}</p>
      </section>

      <section class="card">
        <h3>门槛 · 要多大才进得去</h3>
        <div class="gatebar">
          <div class="grow"><span class="glabel">P25</span><div class="gbar"><i style="left:${(gateP25 || 0) * 100}%"></i></div><b>${((gateP25 || 0) * 100).toFixed(0)}</b></div>
          <div class="grow"><span class="glabel">中位</span><div class="gbar"><i style="left:${(gateMed || 0) * 100}%"></i></div><b>${((gateMed || 0) * 100).toFixed(0)}</b></div>
          <div class="grow"><span class="glabel">P75</span><div class="gbar"><i style="left:${(gateP75 || 0) * 100}%"></i></div><b>${((gateP75 || 0) * 100).toFixed(0)}</b></div>
          <div class="grow you"><span class="glabel">你</span><div class="gbar"><i style="left:${(mySize || 0) * 100}%"></i></div><b>${mySize == null ? "—" : ((mySize * 100).toFixed(0))}</b></div>
        </div>
        <p class="hint">${canPass === null ? "规模数据缺失。"
        : canPass ? "你的规模已经过了行业中位门槛，规模不是障碍。"
          : "你的规模还没到行业中位门槛。要进的话，先想清楚是靠细分市场绕开，还是等规模和渠道再厚一点。"}</p>
      </section>
    </div>

    ${peerBlock}

    <section class="card">
      <h3>你的行业在 ${IND.length} 个行业里的位置</h3>
      ${scatter(posRows, { xlabel: "出海门槛（规模分位）", ylabel: "出海溢价中位 (pp)", height: 360, labelTop: 26 })}
      <p class="hint"><b style="color:#C0392B">${esc(indName)}</b> 是唯一描黑边的点，其余是参照。
      横轴越靠右说明这个行业越多人已经在做（门槛高），纵轴越高说明做的人更赚钱。
      <b>右上＝值得进但要挤；右下＝进了也白进；左上＝还没人占位，但要自己验证。</b></p>
    </section>

    <section class="card">
      <h3>资格评估 · 两阶段模型</h3>
      <div class="grid3 inner">
        <div class="qbox"><b>${score ? (score.s1 * 100).toFixed(0) : "—"}%</b><span>出海概率</span>
          <p>用你自身的规模分位、境内外毛利率、ROA、杠杆、企业年龄与行业出海率打分</p></div>
        <div class="qbox"><b>${score ? (score.s2 * 100).toFixed(0) : "—"}%</b><span>出海后赚钱概率</span>
          <p>同样是这 6 个特征，预测「出海后海外毛利率能否高于境内」。基准是 ${(D.model.qualify.stage2.base_rate * 100).toFixed(1)}%，高于基准算占优</p></div>
        <div class="qbox hl"><b>${score ? (score.total * 100).toFixed(0) : "—"}%</b><span>综合资格分</span>
          <p>两个概率相乘。低于 25% 说明你现在进去是逆风的</p></div>
      </div>
      <p class="hint">logit 模型，5 折交叉验证 AUC：阶段一 ${D.model.qualify.stage1.auc}（是否出海），阶段二 ${D.model.qualify.stage2.auc}（出海是否赚钱）。
      ${score ? "" : "<b>这家有财务特征缺失，两阶段模型打不了分。</b>"}
      ${pImp === 1 ? "<b>注意：这家没披露境内分部毛利率，模型里用样本中位代入。</b>" : ""}
      这是<b>统计基准</b>，不是可行性尽调——它说的是「像你这样的公司，历史上结果如何」。</p>
    </section>

    <section class="card">
      <h3>第一步建议</h3>
      <ol class="steps">
        <li><b>先验证毛利，再谈规模。</b>这个行业出海企业里 ${pct(indRow.pos_share)} 溢价为正。
          带一份海外报价单去比：如果报价比境内低 10% 还做不到正毛利，先别进。</li>
        <li><b>${canPass ? "用现有规模打样，不要一次压重注" : "先补规模或用代理/代工方式试水"}。</b>
          行业里 ${pct(indRow.ovs_rate)} 的人在做，你进去不是第一个，可以抄作业。</li>
        <li><b>盯住第 1 年。</b>全样本第 1 年退出率 ${D.survival.km[0].hazard}%，是后面所有年份里最高的。
          第一年不出成绩很正常，但要有止损线（比如连续两年海外毛利率为负就退）。</li>
      </ol>
    </section>`;
  }

  /* ---------- 模拟轨迹基准线 ---------- */
  function peerBlockFor(peer, sizePct, indName) {
    if (!peer) {
      return `<section class="card">
        <h3>模拟轨迹 · 如果你像同侪一样出海</h3>
        ${warnBar(`${esc(indName)}行业的出海样本太少（不足 20 家可算溢价），做不出可靠的同侪基准线。`)}
      </section>`;
    }
    /* 两级回退：同行业同规模分位 → 同行业整体 */
    let tier = 1, src = null, note = "";
    if (sizePct != null) {
      const dec = String(Math.min(9, Math.floor(sizePct * 10)));
      if (peer.dec[dec] && peer.dec[dec].n >= 5) src = peer.dec[dec];
    }
    if (!src) {
      tier = 2;
      src = peer.ind_all;
      note = sizePct != null
        ? "同行业同规模档的同侪不足 5 家，已放宽到「同行业全部已出海企业」的基准线，参考性略降。"
        : "这家缺规模分位，用的是同行业全部已出海企业的基准线。";
    }
    const curve = src.curve || [];
    const live = curve.filter(c => c.gap != null);
    /* 第一年是最关键的观察点，不能因为同规模档样本不足就整列丢掉。
       某一年的同规模档样本 <5 时，用同行业整体那一年的值顶上，并标出来。 */
    const overall = (peer && peer.ind_all) ? peer.ind_all.curve : [];
    const merged = curve.map(c => {
      if (c.gap != null) return { ...c, tier: 1 };
      const o = overall.find(x => x.k === c.k);
      if (o && o.gap != null) return { ...c, gap: o.gap, ratio: o.ratio, n: o.n, tier: 2 };
      return { ...c, tier: 0 };
    });
    const drawn = merged.filter(c => c.gap != null);
    const fallbackK = merged.filter(c => c.tier === 2).map(c => c.k);
    return `
    <section class="card">
      <h3>模拟轨迹 · 如果你像同侪一样出海</h3>
      <p class="hint">灰线是同侪基准：<b>同行业${tier === 1 ? "、同规模分位档" : "全部"}</b>的已出海企业在出海第 k 年时的溢价中位（${src.n} 个同侪观测）。
      这不是预测，是「历史上像你的公司出海之后普遍是什么结果」。</p>
      ${drawn.length ? lineChart(
      drawn.map(c => ({ x: c.k, v: c.gap })),
      {
        height: 250, ylabel: "同侪溢价中位 (pp)", xlabel: "出海第 k 年", color: "#8A94A6",
        xint: true,
        // y 轴范围必须跟着数据走：有些行业（如医药）同侪溢价全是负的，
        // 写死 ymin=-3 会让线画到 viewBox 外面，串到下面的卡片上
        ymin: Math.min(-3, ...drawn.map(c => c.gap)) * 1.15,
        ymax: Math.max(6, ...drawn.map(c => c.gap)) * 1.1,
      }
    ) : warnBar("这个同侪组的各年份样本都不足 5 个，画不出基准线。")}
      <div class="tablewrap"><table class="dt">
        <thead><tr><th>出海第 k 年</th>${drawn.map(c => `<th>${c.k}</th>`).join("")}</tr></thead>
        <tbody>
          <tr><td class="l">同侪溢价中位 (pp)</td>${drawn.map(c => `<td>${sign(c.gap)}</td>`).join("")}</tr>
          <tr><td class="l">同侪渗透度中位</td>${drawn.map(c => `<td>${pct(c.ratio)}</td>`).join("")}</tr>
          <tr><td class="l">该年样本数</td>${drawn.map(c => `<td>${c.n}</td>`).join("")}</tr>
        </tbody></table></div>
      ${note ? `<p class="hint warn-note">${esc(note)}</p>` : ""}
      ${fallbackK.length ? `<p class="hint warn-note">第 ${fallbackK.join("、")} 年的同规模档同侪不足 5 个，
        这几年用的是<b>同行业整体</b>的中位值顶上，参考性弱一些但至少能看出趋势。</p>` : ""}
      <p class="hint">${peerReadHint(drawn)}</p>
    </section>`;
  }

  /* 模拟轨迹读法说明 */
  function peerReadHint(live) {
    if (!live.length) return "没有可用的同侪基准线。";
    const top = live.reduce((a, b) => (b.gap > a.gap ? b : a));
    const last = live[live.length - 1];
    let s = "读法：曲线在第 " + top.k + " 年到顶，";
    s += last.k >= 7
      ? "之后回落——这就是「出海第 7 年低谷」的来源，不是你做坏了。"
      : "整体是在爬坡的，早期进入能吃到利基。";
    s += "同侪第 1 年溢价中位 " + sign(live[0].gap) + "pp，第 " + last.k + " 年 " + sign(last.gap) + "pp。";
    return s;
  }

  /* ---------- 企业页：一键总结 ---------- */
  function firmSummary(P) {
    const { code, name, indName, provName, o, indRow, provRow, st, rules, stops, hasOvs, gap, verdict, tenure, risk, sizePct, ratio } = P;
    const lines = [];
    lines.push(`<b>${esc(name)}</b>（${esc(code)}），${esc(indName)}，${esc(provName)}。当前判定：<b style="color:${VCOLOR[verdict]}">${VERDICT[verdict]}</b>。`);
    if (hasOvs === 1) {
      lines.push(`出海第 ${tenure != null ? tenure : "—"} 年，渗透度 ${pct(ratio)}（行业内 ${P.ratioPct != null ? P.ratioPct : "—"} 分位），溢价 ${gap == null ? "算不出来" : sign(gap) + "pp"}，行业中位 ${indRow && indRow.gap_med != null ? sign(indRow.gap_med) + "pp" : "—"}。`);
      const hits = (rules.hit || []).map(id => (D2.rules.defs.find(dd => dd.id === id) || {}).name).filter(Boolean);
      lines.push(`<b>风险两层</b>：机器学习 ${risk != null ? (risk * 100).toFixed(0) + "%" : "—"}，规则层命中 ${hits.length} 条${hits.length ? "（" + hits.join("、") + "）" : ""}。`);
      if (st) {
        const r5 = st.rows[1];
        lines.push(`<b>压力测试</b>：海外毛利率再降 5pp，海外毛利少 ${fmt(r5.loss_yi, 3)} 亿`
          + (st.np_neg === 1 ? `，占当前总资产的 ${fmt(r5.pct_assets, 2)}%（当期亏损，不看净利口径）。`
            : r5.pct_np != null ? `，相当于当前净利润的 ${r5.pct_np}%。` : "。"));
      }
      if (stops.length) {
        lines.push(`<b>止损规则</b>：${stops.map(s => s.txt).join("；")}。`);
      } else {
        lines.push(`<b>止损规则</b>：三条都没触发。`);
      }
      if (indRow && provRow) {
        lines.push(`<b>行业与区域</b>：${esc(indName)}出海率 ${pct(indRow.ovs_rate)}、溢价中位 ${sign(indRow.gap_med)}pp；
          ${esc(provName)}${D2.prov_tier[provName] ? "属于" + D2.prov_tier[provName].tier : ""}，出海率 ${pct(provRow.ovs_rate)}。`);
      }
    } else {
      const score = (P.p1 != null && P.p2 != null) ? (P.p1 * P.p2 * 100).toFixed(0) : "—";
      lines.push(`<b>未出海</b>。两阶段资格分 ${score}%，行业是 ${esc(indName)}（出海率 ${pct(indRow && indRow.ovs_rate)}、溢价中位 ${indRow ? sign(indRow.gap_med) : "—"}pp、吸引力排名 ${IND.filter(n => (IY[n + "|" + LAST] || {}).score > (indRow.score || 0)).length + 1}/${IND.length}）。`);
      lines.push(`<b>门槛</b>：你在 ${sizePct != null ? (sizePct * 100).toFixed(0) : "—"} 分位，行业门槛中位 ${indRow && indRow.gate_med != null ? (indRow.gate_med * 100).toFixed(0) : "—"} 分位。`);
      lines.push(`<b>第一步</b>：先验证毛利，再谈规模；用现有规模打样，盯住第 1 年。`);
    }
    return summaryBox(`一键总结 · ${name}`, lines);
  }

  /* ==================== 中位数工具 ==================== */
  function median(arr) {
    const v = arr.filter(x => x != null).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  /* ==================== 路由 ==================== */
  const VIEWS = {
    overview: { t: "总观", f: viewOverview },
    firm: { t: "企业", f: viewFirm },
  };

  function render(key) {
    const v = VIEWS[key] || VIEWS.overview;
    STATE.tab = key;
    $$(".tab").forEach(b => b.classList.toggle("on", b.dataset.k === key));
    const main = $("#main");
    main.innerHTML = v.f();
    main.scrollTop = 0;
    if (key === "firm") initFirm();
    bindEvents();
  }

  function initFirm() {
    const input = $("#fq"), out = $("#firmout"), quick = $("#quick");
    const picks = [
      ["000063", "中兴通讯"], ["600519", "贵州茅台"],
      ["002050", "三花智控"], ["000045", "深纺织A"],
    ];
    quick.innerHTML = "<span>试试：</span>" + picks.map(p => `<button class="chip" data-q="${p[0]}">${p[1]}</button>`).join("");
    const go = q => {
      const f = findFirm(q);
      STATE.firm = f ? f[0] : null;
      out.innerHTML = renderFirm(f);
      bindFirmEvents();
      if (f) window.scrollTo({ top: 0, behavior: "auto" });
    };
    $("#fgo").onclick = () => go(input.value);
    input.onkeydown = e => { if (e.key === "Enter") go(input.value); };
    quick.querySelectorAll(".chip").forEach(b => b.onclick = () => { input.value = b.dataset.q; go(b.dataset.q); });
    /* 默认演示企业：优先选同侪分布带能画出来的（PEERPOS 有该企业），
       否则同侪带图会是空的，演示效果差 */
    const demo = F.find(f => f[4] === 1 && f[6] != null && f[2] >= 0 && PEERPOS[f[0]])
      || F.find(f => f[4] === 1 && f[6] != null && f[2] >= 0);
    if (demo) { input.value = demo[0]; go(demo[0]); }
  }

  /* ==================== 事件绑定 ==================== */
  function bindEvents() {
    /* 年份切片器 */
    $$('[data-role="year"] [data-year]').forEach(b => b.onclick = () => {
      STATE.year = +b.dataset.year;
      render(STATE.tab);
    });
    /* 行业指标切换 */
    $$('[data-role="indmetric"] .sw').forEach(b => b.onclick = () => {
      STATE.indMetric = b.dataset.metric; render(STATE.tab);
    });
    /* 区域指标切换 */
    $$('[data-role="provmetric"] .sw').forEach(b => b.onclick = () => {
      STATE.provMetric = b.dataset.metric; render(STATE.tab);
    });
    /* 退出模式切换 */
    $$('[data-role="exitmode"] .sw').forEach(b => b.onclick = () => {
      STATE.exitMode = b.dataset.exitmode; render(STATE.tab);
    });
    /* 退出行业选择 */
    const sel = $("#exitind");
    if (sel) sel.onchange = () => { STATE.exitInd = sel.value; render(STATE.tab); };
    /* 行业选择：条形图 + 表格 */
    $$('[data-ind]').forEach(el => el.onclick = () => {
      STATE.indPick = el.dataset.ind; render(STATE.tab);
    });
    /* 行业定位图：点气泡选中行业（v3） */
    $$('#sec-pos circle[data-pick]').forEach(el => el.onclick = () => {
      STATE.posPick = el.dataset.pick; render(STATE.tab);
      /* 展开后滚到卡片处，别让用户以为没反应。
         用 auto 而不是 smooth：smooth 动画在无头浏览器虚拟时钟下会一直占着时间片。 */
      const card = $("#poscard");
      if (card) card.scrollIntoView({ behavior: "auto", block: "nearest" });
    });
    $$('.indbars rect').forEach((el, i) => { });
    /* 省份选择 */
    $$('[data-prov]').forEach(el => el.onclick = () => {
      STATE.provPick = el.dataset.prov; render(STATE.tab);
    });
    /* 导出 */
    $$('[data-act]').forEach(b => b.onclick = (ev) => {
      /* 折叠表标题栏里的下载按钮：不能触发 details 的展开/收起 */
      if (ev && b.closest("summary")) ev.stopPropagation();
      doExport(b.dataset.act, b.dataset.pfx, b);
    });
  }

  function bindFirmEvents() {
    $$('[data-act]').forEach(b => b.onclick = () => doExport(b.dataset.act, b.dataset.pfx, b));
  }

  /* ==================== 导出实现 ==================== */
  function doExport(act, pfx, btn) {
    const y = STATE.year;
    if (act === "csv") {
      if (pfx === "行业定位图" || pfx === "行业明细") {
        const rows = IND.map(n => IY[n + "|" + y]).filter(Boolean);
        downloadText(`行业定位图_${y}.csv`, toCSV(
          ["行业", "年份", "样本", "企业数", "出海数", "出海率%", "渗透度中位%", "溢价中位pp", "溢价样本", "溢价为正%", "门槛分位", "境内毛利率中位%", "海外毛利率中位%", "容量亿", "吸引力", "整体能赚钱"],
          rows.map(r => [r.ind, r.year, r.n, r.firms, r.ovs_n, r.ovs_rate, r.ratio_med, r.gap_med, r.gap_n, r.pos_share, r.gate_med, r.gm_dom_med, r.gm_ovs_med, r.cap, r.score, r.profitable ? "是" : "否"])));
      } else if (pfx === "区域明细") {
        const rows = PROV.map(n => PY[n + "|" + y]).filter(Boolean);
        downloadText(`区域明细_${y}.csv`, toCSV(
          ["省份", "年份", "样本", "企业数", "出海数", "出海率%", "渗透度中位%", "溢价中位pp", "溢价样本", "溢价为正%", "容量亿", "综合分", "梯队"],
          rows.map(r => { const t = D2.prov_tier[r.prov]; return [r.prov, r.year, r.n, r.firms, r.ovs_n, r.ovs_rate, r.ratio_med, r.gap_med, r.gap_n, r.pos_share, r.cap, r.score, t ? t.tier : ""]; })));
      } else if (pfx === "企业体检") {
        const f = STATE.firm ? F.find(x => x[0] === STATE.firm) : null;
        if (!f) { alert("先选一家企业"); return; }
        downloadText(`企业体检_${f[1]}.csv`, firmCSV(f));
      } else if (pfx === "规则层") {
        const rows = Object.keys(D2.firm_rules).map(code => {
          const r = D2.firm_rules[code];
          const nm = (F.find(x => x[0] === code) || [])[1] || "";
          return [code, nm, r.w, r.hit.join(" ")];
        });
        downloadText(`规则层判定.csv`, toCSV(["代码", "企业", "加权分", "命中规则"], rows));
      } else {
        downloadText(`${pfx}.csv`, toCSV(["项目", "值"], []));
      }
    } else if (act === "png") {
      /* 导出按钮所在卡片里的第一张图，而不是页面第一张图 */
      const card = btn && btn.closest ? btn.closest(".card") : null;
      const svg = card ? card.querySelector("svg.chart") : document.querySelector("svg.chart");
      if (svg) {
        const f = STATE.firm ? F.find(x => x[0] === STATE.firm) : null;
        const tag = f ? `${f[1]}_${pfx}` : pfx;
        svgToPNG(svg, `${tag}_${y}.png`);
      } else alert("这一块没有可导出的图表");
    } else if (act === "report") {
      const f = STATE.firm ? F.find(x => x[0] === STATE.firm) : null;
      if (!f) { alert("先在企业页选一家企业，再导出体检报告"); return; }
      downloadText(`出海体检报告_${f[1]}.txt`, firmReport(f));
    }
  }

  /* 企业体检 CSV：这家企业的全部关键量，一行 */
  function firmCSV(f) {
    const [code, name, indI, provI, hasOvs, ratio, gap, sizePct, tenure, risk, verdict,
      gapVsInd, domGm, ratioPct, domPct, p1, p2, pImp, gapBad] = f;
    const indName = indI >= 0 ? IND[indI] : "—";
    const provName = provI >= 0 ? PROV[provI] : "—";
    const indRow = IY[indName + "|" + LAST] || {};
    const provRow = PY[provName + "|" + LAST] || {};
    const st = STRESS[code];
    const rules = D2.firm_rules[code] || { hit: [], w: 0 };
    const x = FX[code] || {};
    const head = ["代码", "企业", "行业", "省份", "是否出海", "判定", "出海年数", "海外渗透度%",
      "渗透度行业内分位", "出海溢价pp", "溢价行业中位pp", "相对同侪pp", "规模分位",
      "海外毛利率%", "境内毛利率%", "资产负债率", "ROA", "规则层命中", "规则层加权分",
      "ML风险分", "海外收入亿", "总资产亿", "净利润亿"];
    const row = [code, name, indName, provName, hasOvs === 1 ? "是" : "否", VERDICT[verdict],
      tenure, ratio, ratioPct, gap, indRow.gap_med, gapVsInd, sizePct,
      x.ovs_gm, x.dom_gm, x.lev, x.roa, rules.hit.length, rules.w, risk,
      st ? st.rev_yi : null, st ? st.assets_yi : null, st ? st.np_yi : null];
    const stressRows = st ? st.rows.map(r => [code, name, r.dpp, r.loss_yi, r.pct_np, r.pct_assets, r.pct_ovs_gm]) : [];
    const sHead = ["代码", "企业", "降Xpp", "毛利减少亿", "占净利%", "占总资产%", "占海外毛利%"];
    const sCsv = stressRows.length ? "\n\n" + toCSV(sHead, stressRows) : "";
    return toCSV(head, [row]) + sCsv;
  }

  /* ==================== 体检报告（纯文本） ==================== */
  function firmReport(f) {
    const [code, name, indI, provI, hasOvs, ratio, gap, sizePct, tenure, risk, verdict,
      gapVsInd, domGm, ratioPct, domPct, p1, p2, pImp, gapBad] = f;
    const indName = indI >= 0 ? IND[indI] : "—";
    const provName = provI >= 0 ? PROV[provI] : "—";
    const indRow = IY[indName + "|" + LAST] || {};
    const provRow = PY[provName + "|" + LAST] || {};
    const st = STRESS[code];
    const rules = D2.firm_rules[code] || { hit: [], w: 0 };
    const stops = STOP[code] || [];
    const x = FX[code] || {};
    const L = [];
    L.push(`A 股出海体检报告 · ${name}（${code}）`);
    L.push(`行业：${indName}    注册地：${provName}    最新年报：${LAST}`);
    L.push(`数据源：年报分部披露 + CSMAR 财务治理，全样本 ${D.meta.n_obs.toLocaleString()} 个企业·年`);
    L.push("");
    L.push(`【结论】${VERDICT[verdict]}`);
    if (hasOvs === 1) {
      L.push("");
      L.push("一、基本面");
      L.push(`  出海年数：第 ${tenure} 年`);
      L.push(`  海外渗透度：${pct(ratio)}（行业内 ${ratioPct} 分位，同行中位 ${pct(indRow.ratio_med)}）`);
      L.push(`  出海溢价：${gap == null ? "未披露" : sign(gap) + "pp"}（同行业中位 ${sign(indRow.gap_med)}pp，相对同侪 ${sign(gapVsInd)}pp）`);
      L.push(`  规模分位：${(sizePct * 100).toFixed(0)}（同行业出海门槛中位 ${((indRow.gate_med || 0) * 100).toFixed(0)} 分位）`);
      if (x.ovs_gm != null) L.push(`  海外毛利率：${fmt(x.ovs_gm, 1)}%（同行中位 ${fmt(x.ref_gm_ovs, 1)}%）`);
      if (x.dom_gm != null) L.push(`  境内毛利率：${fmt(x.dom_gm, 1)}%（同行中位 ${fmt(x.ref_gm_dom, 1)}%）`);
      L.push("");
      L.push("二、风险两层判断");
      L.push(`  ① 机器学习打分（次年溢价恶化概率）：${risk != null ? (risk * 100).toFixed(0) + "%" : "—"}${gapBad === 1 ? "（口径异常，停用）" : ""}`);
      L.push(`  ② 规则层硬信号：命中 ${rules.hit.length} 条 / 权重 ${rules.w}`);
      rules.hit.forEach(id => {
        const def = D2.rules.defs.find(dd => dd.id === id);
        L.push(`     - ${def ? def.name + "（" + def.layer + "）" : id}`);
      });
      L.push("");
      L.push("三、压力测试（海外毛利率下降的影响）");
      if (st) {
        L.push(`  海外收入 ${fmt(st.rev_yi, 2)} 亿，总资产 ${fmt(st.assets_yi, 1)} 亿，净利润 ${fmt(st.np_yi, 2)} 亿${st.np_neg ? "（当期亏损）" : ""}`);
        st.rows.forEach(r => {
          L.push(`  降 ${r.dpp}pp → 海外毛利少 ${fmt(r.loss_yi, 3)} 亿`
            + (st.np_neg ? `，占总资产 ${fmt(r.pct_assets, 2)}%（当期亏损，不适用净利口径）` : `，相当于净利润 ${r.pct_np}%`)
            + `，占海外毛利 ${r.pct_ovs_gm}%`);
        });
      } else L.push("  不适用（溢价不可算或口径异常）");
      L.push("");
      L.push("四、止损规则");
      if (stops.length) stops.forEach(s => L.push(`  [触发] ${s.txt}`));
      else L.push("  三条规则均未触发");
      L.push("");
      L.push("五、行业与区域上下文");
      L.push(`  ${indName}：样本 ${indRow.n}，出海率 ${pct(indRow.ovs_rate)}，溢价中位 ${sign(indRow.gap_med)}pp，溢价为正 ${pct(indRow.pos_share)}，门槛 ${((indRow.gate_med || 0) * 100).toFixed(0)} 分位，容量 ${fmt(indRow.cap, 0)} 亿`);
      L.push(`  ${provName}：${D2.prov_tier[provName] ? D2.prov_tier[provName].tier : "—"}，样本 ${provRow.n}，出海率 ${pct(provRow.ovs_rate)}，溢价中位 ${sign(provRow.gap_med)}pp，容量 ${fmt(provRow.cap, 0)} 亿`);
      L.push("");
      L.push("六、结论口径说明");
      L.push("  本报告所有对比均为同期横截面，不做跨期因果推断。");
      L.push("  溢价 = 海外毛利率 − 境内毛利率（pp），仅当海外成本 > 0 时计算。");
      L.push("  |海外毛利率 − 境内毛利率| > 50pp 判为分部成本分摊口径异常，这类企业不给方向性结论。");
      L.push(`  机器学习 AUC ${D.model.risk.folds.map(f2 => f2.auc).join("/")}（walk-forward 弱预测），只用于排序，不作精确概率。`);
    } else {
      L.push("");
      L.push("一、资格评估");
      L.push(`  出海概率：${p1 != null ? (p1 * 100).toFixed(0) + "%" : "—"}`);
      L.push(`  出海后赚钱概率：${p2 != null ? (p2 * 100).toFixed(0) + "%" : "—"}（基准 ${(D.model.qualify.stage2.base_rate * 100).toFixed(1)}%）`);
      L.push(`  综合资格分：${p1 != null && p2 != null ? (p1 * p2 * 100).toFixed(0) + "%" : "—"}`);
      L.push("");
      L.push("二、行业上下文");
      L.push(`  ${indName}：出海率 ${pct(indRow.ovs_rate)}，溢价中位 ${sign(indRow.gap_med)}pp，溢价为正 ${pct(indRow.pos_share)}%，门槛中位 ${((indRow.gate_med || 0) * 100).toFixed(0)} 分位`);
      L.push(`  你的规模分位 ${sizePct != null ? (sizePct * 100).toFixed(0) : "—"}`);
      L.push("");
      L.push("三、第一步建议");
      L.push("  1. 先验证毛利，再谈规模。");
      L.push("  2. 用现有规模打样，不要一次压重注。");
      L.push(`  3. 盯住第 1 年（全样本第 1 年退出率 ${D.survival.km[0].hazard}%），设硬止损线。`);
    }
    L.push("");
    L.push("—— 本报告由交互式出海决策支持系统自动生成，数据口径见页脚 ——");
    return L.join("\n");
  }

  /* ==================== 启动 ==================== */
  $$(".tab").forEach(b => b.onclick = () => render(b.dataset.k));
  render("overview");
})();
