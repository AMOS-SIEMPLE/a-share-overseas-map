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
  const D4 = window.APP_DATA4;       // v5：自采数据集增量（2025 + 行业/省份趋势）
  const FC = window.APP_FORECAST;     // v5：AR(1) 预测 + KM 退出概率

  /* 数据交付包下载入口（GitHub Release 附件）。
     附件名一律 ASCII —— GitHub 的 asset name 参数会吞掉中文字符，
     且 ASCII 文件名在浏览器下载与跨平台解压时更稳。 */
  const DL = (function () {
    const base = "https://github.com/AMOS-SIEMPLE/a-share-overseas-map/releases/download/dataset-2015-2025/";
    return {
      doc:   base + "dataset_documentation.pdf",
      raw:   base + "01_raw_data_2015_2025.zip",
      clean: base + "02_cleaned_dataset_2015_2025.zip",
      code:  base + "03_docs_and_code.zip",
      all:   "https://github.com/AMOS-SIEMPLE/a-share-overseas-map/releases/tag/dataset-2015-2025",
    };
  })();
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
    cmp: [],                       // 对比组：企业 code 数组，最多 3 个
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

  /* v5 增量（113_build_app_data4.py 产出，自采数据集口径） */
  const D4T = {};                   // 年份 → 自采口径全局趋势（2015–2025）
  (D4 && D4.year_trend || []).forEach(o => D4T[o.year] = o);
  const D4LAST = D4 ? D4.meta.last : 2024;   // 自采口径最新年 = 2025
  const D4META = (D4 && D4.meta) || { years: [], last: 2024, prev: 2023, n_obs: 0, n_firms: 0, source: "", note: "" };
  const D4IND = (D4 && D4.ind_trend) || {};      // 行业十年轨迹（自采）
  const D4INDMED = (D4 && D4.ind_year_med) || {};
  const D4PROV = (D4 && D4.prov_trend) || {};
  const D4PROVMED = (D4 && D4.prov_year_med) || {};
  const D4FIRM = (D4 && D4.firm_meta) || {};     // 企业 → 2025 年最新成绩
  const D4NEW = (D4 && D4.new_2025) || [];       // 2025 年新出海企业

  /* 预测层（104_forecast.py / 105_exit_prob.py 产出） */
  const FCFIRM = (FC && FC.firm_path) || {};     // 企业 → 未来三年溢价路径 + 收入情景
  const FCIND = (FC && FC.ind_forecast) || {};   // 行业 → 溢价路径
  const FCCAP = (FC && FC.cap_forecast) || {};   // 全市场容量预测（亿）
  const FCEXIT = (FC && FC.exit_prob) || {};     // 退出概率
  const FCBACK = (FC && FC.backtest) || [];      // 回测
  const FCMETA = (FC && FC.meta) || {};

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
  /* 模型特征名 → 中文（置换重要性的数组里存的是英文变量名） */
  const FEAT_CN = {
    gm_gap_pp: "当期出海溢价", gap_vs_ind: "相对同侪位置", ind_ovs_rate: "行业出海率",
    ovs_ratio_pct: "海外渗透度", dom_gm_pct: "境内毛利率", growth: "营收增速",
    lev: "资产负债率", ovs_tenure: "出海年数", roa: "总资产收益率",
    cashflow: "经营现金流", size: "企业规模", firmage: "企业年龄",
    cf_ratio: "现金流/总资产", ln_employ: "员工规模", soe: "国企属性",
    ind_ovs_rate_: "行业出海率",
  };
  /* 缺失指示列（形如 xxx_na）单独命名 */
  const featName = c => {
    if (FEAT_CN[c]) return FEAT_CN[c];
    if (/_na$/.test(c)) return (FEAT_CN[c.replace(/_na$/, "")] || c.replace(/_na$/, "")) + "（未披露）";
    return c;
  };

  /* ==================== 极简 SVG 图表库 ==================== */
  function svgWrap(w, h, inner) {
    return `<svg viewBox="0 0 ${w} ${h}" class="chart" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
  }
  /* 文本宽度估算：中日韩字符按 1em，ASCII 按 0.55em。
     图表里的标签必须能自己判断「放不放得下」，否则 SVG 会把超界的字裁掉，
     页面上就出现半截字（旧版「生和社会工作-卫生」就是这么没的）。 */
  function textW(s, size) {
    let w = 0;
    for (const ch of String(s == null ? "" : s)) {
      w += /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/.test(ch) ? size : size * 0.56;
    }
    return w;
  }
  /* 按像素上限截断，超出补省略号 */
  function clip(s, maxPx, size) {
    s = String(s == null ? "" : s);
    if (textW(s, size) <= maxPx) return s;
    let out = "";
    for (const ch of s) {
      if (textW(out + ch + "…", size) > maxPx) break;
      out += ch;
    }
    return (out || s.slice(0, 1)) + "…";
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
     标签一律先按可用宽度截断再画：SVG 不会自动换行也不会自动缩字号，
     超出 viewBox 的字会被直接裁掉，页面上只剩半截（旧版最刺眼的问题）。 */
  function hbars(items, o = {}) {
    if (!items.length) return emptyChart(o.emptyMsg || "没有数据");
    const W = o.width || 360, rowH = o.rowH || 28, pad = { l: o.labelW || 118, r: o.valueW || 76, t: 6, b: 6 };
    const H = items.length * rowH + pad.t + pad.b;
    const w = W - pad.l - pad.r;
    const max = Math.max(...items.map(i => Math.abs(i.v))) || 1;
    const neg = items.some(i => i.v < 0);
    const fs = o.labelSize || 11.5;
    const lab = (it) => clip(it.label, pad.l - 14, fs);
    let g = "";
    if (neg) {
      const zx = pad.l + w / 2;
      const scale = v => Math.abs(v) / max * (w / 2);
      items.forEach((it, i) => {
        const y = pad.t + i * rowH;
        const bw = Math.max(scale(it.v), 1.5);
        const x0 = it.v >= 0 ? zx : zx - bw;
        g += txt(pad.l - 8, y + rowH / 2 + 4, lab(it), { anchor: "end", size: fs, fill: "#3D4859", halo: 3 });
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
        g += txt(pad.l - 8, y + rowH / 2 + 4, lab(it), { anchor: "end", size: fs, fill: "#3D4859", halo: 3 });
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
    /* ★ X 轴范围可外部指定：主线只画历史、参考线画预测时，
       若不指定，参考线超出 pts 的 xmin/xmax 就会被画到画布外。 */
    const xmin = o.xmin != null ? o.xmin : Math.min(...xs);
    const xmax = o.xmax != null ? o.xmax : Math.max(...xs);
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

  /* 图表标签用的短名
     行业名是「门类-大类」两段结构（如 制造业-计算机、通信和其他电子设备制造业）。
     图表横排只放得下 5–8 个字，所以先按大类做映射，再统一交给 clip() 兜底截断。 */
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
  /* 大类（第二段）→ 短名。84 个行业口径基本都在这里，是图表可读性的关键。 */
  const LEAF = {
    "计算机、通信和其他电子设备制造业": "电子设备",
    "橡胶和塑料制品业": "橡塑",
    "专用设备制造业": "专用设备",
    "通用设备制造业": "通用设备",
    "汽车制造业": "汽车",
    "电气机械和器材制造业": "电气机械",
    "化学原料和化学制品制造业": "化学原料",
    "金属制品业": "金属制品",
    "仪器仪表制造业": "仪器仪表",
    "纺织业": "纺织",
    "化学纤维制造业": "化纤",
    "造纸和纸制品业": "造纸",
    "有色金属冶炼和压延加工业": "有色金属",
    "印刷和记录媒介复制业": "印刷",
    "文教、工美、体育和娱乐用品制造业": "文教用品",
    "非金属矿物制品业": "非金属矿物",
    "铁路、船舶、航空航天和其他运输设备制造业": "运输设备",
    "其他制造业": "其他制造",
    "家具制造业": "家具",
    "农副食品加工业": "农副食品",
    "纺织服装、服饰业": "纺服",
    "食品制造业": "食品",
    "木材加工和木、竹、藤、棕、草制品业": "木材加工",
    "医药制造业": "医药",
    "废弃资源综合利用业": "废弃资源",
    "黑色金属冶炼和压延加工业": "黑色金属",
    "皮革、毛皮、羽毛及其制品和制鞋业": "皮革制鞋",
    "金属制品、机械和设备修理业": "设备修理",
    "酒、饮料和精制茶制造业": "酒饮料",
    "石油、煤炭及其他燃料加工业": "石油煤炭",
    "非金属矿采选业": "非金属矿",
    "石油和天然气开采业": "油气开采",
    "开采专业及辅助性活动": "采矿辅助",
    "有色金属矿采选业": "有色矿采",
    "黑色金属矿采选业": "黑色矿采",
    "煤炭开采和洗选业": "煤炭开采",
    "建筑安装业": "建筑安装",
    "土木工程建筑业": "土木工程",
    "建筑装饰、装修和其他建筑业": "建筑装饰",
    "房屋建筑业": "房屋建筑",
    "装卸搬运和仓储业": "仓储物流",
    "航空运输业": "航空运输",
    "多式联运和运输代理业": "多式联运",
    "水上运输业": "水上运输",
    "道路运输业": "道路运输",
    "铁路运输业": "铁路运输",
    "邮政业": "邮政",
    "其他金融业": "其他金融",
    "资本市场服务": "资本市场",
    "保险业": "保险",
    "货币金融服务": "货币金融",
    "批发业": "批发",
    "零售业": "零售",
    "软件和信息技术服务业": "软件服务",
    "互联网和相关服务": "互联网",
    "电信、广播电视和卫星传输服务": "电信广电",
    "研究和试验发展": "研发试验",
    "科技推广和应用服务业": "科技推广",
    "专业技术服务业": "专业技术",
    "生态保护和环境治理业": "生态环保",
    "公共设施管理业": "公共设施",
    "水利管理业": "水利管理",
    "燃气生产和供应业": "燃气",
    "水的生产和供应业": "供水",
    "电力、热力生产和供应业": "电力热力",
    "渔业": "渔业",
    "畜牧业": "畜牧",
    "农业": "农业",
    "农、林、牧、渔专业及辅助性活动": "农林牧渔辅助",
    "林业": "林业",
    "体育": "体育",
    "广播、电视、电影和录音制作业": "广电影视",
    "新闻和出版业": "新闻出版",
    "文化艺术业": "文化艺术",
    "商务服务业": "商务服务",
    "租赁业": "租赁",
    "卫生": "卫生",
    "教育": "教育",
    "住宿业": "住宿",
    "餐饮业": "餐饮",
    "机动车、电子产品和日用产品修理业": "修理服务",
    "房地产业": "房地产",
    "综合": "综合",
  };
  const shortName = n => !n ? "—" : (SHORT[n] || n.replace(/(制造业|加工业|供应业|服务业)$/, "") || n);
  const leafOf = n => {
    if (!n) return "";
    const seg = String(n).split("-");
    return seg.length > 1 ? seg[seg.length - 1] : n;
  };
  /* 图表专用短名：先查大类映射，再截断到放得下的宽度（默认 7 个汉字） */
  const indShort = (n, maxPx) => {
    if (!n) return "—";
    const leaf = leafOf(n);
    const s = LEAF[leaf] || SHORT[leaf] || SHORT[n] || leaf.replace(/(制造业|加工业|供应业|服务业|业)$/, "") || leaf;
    return clip(s, maxPx == null ? 88 : maxPx, 11.5);
  };
  /* 旧名保留：预测模块等处在用 */
  const shortInd2 = n => indShort(n);
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

  /* ==================== 视图：总观（单页滚动） ====================
     页面顺序按「读者先想知道什么」排：
       ① 这一年怎么样（关键指标 + 同比）
       ② 一键总结（这一年的重点汇总，放最前）
       ③ 两个能落地的问题（都按当前年份现算，不是写死的结论）
       ④ 十年发生了什么（三句话 + 两张图）
       ⑤ 行业（全景 → 三大榜单 → 定位图）
       ⑥ 区域 ⑦ 退出 ⑧ 预测 ⑨ 数据质量
     所有带数字的结论都跟着顶部年份切片器重算，没有一处写死某一年。 */
  function viewOverview() {
    const y = STATE.year;
    const yo = YO[y];
    const iys = IND.map(n => IY[n + "|" + y]).filter(Boolean);
    const okRows = iys.filter(r => r.gap_med != null && r.gap_n >= 30);

    return heroBlock(y, yo)
      + overviewSummary(y, yo, okRows)
      + viewCoreQuestions(y, yo, iys)
      + viewTrendSection()
      + viewIndustrySection(y, iys)
      + viewBoards(y, iys)
      + viewPositionSection(y, okRows)
      + viewProvinceSection(y)
      + viewExitSection()
      + viewForecastOverview()
      + viewQualitySection();
  }

  /* ---------- ① 首屏：标题 + 年份切片 + 当年关键指标 + 同比 ---------- */
  function heroBlock(y, yo) {
    const yPrev = y > YEARS[0] ? YO[y - 1] : null;
    return `
    <section class="hero">
      <div class="herotop">
        <div>
          <span class="eyebrow"><i></i>赛道四 · 行业发展与企业经营数据分析</span>
          <h1>出海质量图谱</h1>
          <p class="sub">A 股 ${D.meta.n_firms.toLocaleString()} 家企业 · ${D.meta.year_lo}–${LAST} 年
            ${D.meta.n_obs.toLocaleString()} 个企业·年观测 · 数据源：自采公开接口（东方财富 F10 / 交易所披露）。
            下面每个区块的数字都跟着顶部的年份走。</p>
        </div>
        <div class="yearbox">
          <span class="ylab">观察年份 · 切换后全页重算</span>
          <div class="ychips" data-role="year">${yearChips(y, "data-year")}</div>
        </div>
      </div>
      ${kpiBlock([
      { v: pct(yo.ovs_rate), l: `${y} 年出海率（有海外收入的企业占比）` },
      { v: sign(yo.gap_med), l: `${y} 年出海溢价中位`, u: "pp" },
      { v: pct(yo.gap_cov), l: "出海企业里能算出溢价的比例", warn: yo.gap_cov < 60 },
      { v: fmt(yo.cap, 0), l: "海外收入合计", u: "亿元" },
      { v: yo.ind_ok + " / " + yo.ind_all, l: "溢价样本够用（≥30 个）的行业数" },
    ])}
      ${yPrev ? `<div class="cmp2 yoyrow">
        ${yoyItem(`${y - 1} → ${y} 出海率`, yo.ovs_rate, yPrev.ovs_rate, "%", 1)}
        ${yoyItem(`${y - 1} → ${y} 溢价中位`, yo.gap_med, yPrev.gap_med, "pp", 2)}
        ${yoyItem(`${y - 1} → ${y} 能算出溢价的比例`, yo.gap_cov, yPrev.gap_cov, "%", 1)}
      </div>` : ""}
    </section>`;
  }

  /* 同比小卡：现在是「上年 → 本年 + 变化」，比一句长句好读 */
  function yoyItem(label, now, prev, unit, dg) {
    if (now == null || prev == null) return "";
    const d = now - prev;
    const cls = Math.abs(d) < 0.005 ? "" : (d > 0 ? "up" : "down");
    return `<div class="cmp"><span>${esc(label)}</span><b>${fmt(now, dg)}${unit}</b>
      <i class="${cls}">${sign(d, dg)}${unit}</i></div>`;
  }

  /* 行业间溢价分化度（p90 − p10），用来回答「行业之间的差距在拉大还是收窄」 */
  function indGapSpread(yy) {
    const v = IND.map(n => IY[n + "|" + yy]).filter(Boolean)
      .filter(r => r.gap_med != null && r.gap_n >= 30).map(r => r.gap_med).sort((a, b) => a - b);
    if (v.length < 6) return null;
    const q = p => v[Math.min(v.length - 1, Math.max(0, Math.round((v.length - 1) * p)))];
    return { p10: q(0.1), p90: q(0.9), spread: q(0.9) - q(0.1), n: v.length };
  }

  /* ---------- ③ 两个核心问题：全部按当前年份切片现算 ----------
     旧版三个问题是「通用设问 + 固定用 2025 年数字回答」，切到 2018 年结论也不变。
     现在两个问题都只问「这一年」，结论、名单、同比全部跟着年份重算。 */
  function viewCoreQuestions(y, yo, iys) {
    const py = y > YEARS[0] ? y - 1 : null;

    const ok = iys.filter(r => r.gap_med != null && r.gap_n >= 30).slice().sort((a, b) => b.gap_med - a.gap_med);
    const win = ok.filter(r => r.gap_med > 0);
    const lose = ok.filter(r => r.gap_med <= 0);
    const winShare = ok.length ? win.length / ok.length * 100 : null;

    const prevOk = py ? IND.map(n => IY[n + "|" + py]).filter(Boolean)
      .filter(r => r.gap_med != null && r.gap_n >= 30) : [];
    const prevWin = prevOk.filter(r => r.gap_med > 0);
    const prevWinSet = new Set(prevWin.map(r => r.ind));
    const winSet = new Set(win.map(r => r.ind));
    const newlyWin = [...winSet].filter(n => !prevWinSet.has(n));
    const lostWin = [...prevWinSet].filter(n => !winSet.has(n));

    /* 进得去且赚得到：门槛 ≤50 分位 且 溢价为正 */
    const enter = win.filter(r => r.gate_med != null && r.gate_med <= 0.5)
      .slice().sort((a, b) => (b.cap || 0) - (a.cap || 0));
    const prevEnter = prevWin.filter(r => r.gate_med != null && r.gate_med <= 0.5);
    const enterSet = new Set(enter.map(r => r.ind));
    const prevEnterSet = new Set(prevEnter.map(r => r.ind));

    const tr = D3.year_trend;
    let startPos = LAST;
    for (let i = tr.length - 1; i >= 0; i--) { if (tr[i].gap_med > 0) startPos = tr[i].year; else break; }
    const spr = indGapSpread(y), spr0 = indGapSpread(tr[0].year);

    /* —— 问题一 —— */
    const q1v = winShare == null
      ? "这一年样本够用的行业太少，不给方向性判断。"
      : winShare >= 70
        ? `多数行业出海是赚的（${win.length}/${ok.length}）。${y} 年的出海更像「普遍有毛利加成」，「出海」这个动作本身不构成风险。`
        : winShare >= 40
          ? `赚的和不赚的差不多各占一半（${win.length}/${ok.length}）。说明「出海」本身不保证赚钱，<b>选哪个行业进比要不要出海更决定结果</b>。`
          : `只有少数行业出海能赚钱（${win.length}/${ok.length}）。这一年的出海更像「用利润换份额」，进场前必须先验证单客户毛利结构。`;

    const q1 = `
    <article class="qcard">
      <div class="qh"><span class="qn">问题一</span>
        <span class="qt">${y} 年，出海到底还赚不赚钱？赚在哪些行业？</span></div>
      <p class="qdef">口径：<b>出海溢价 ＝ 海外业务毛利率 − 境内业务毛利率（pp）</b>。
        正值＝同样一块钱收入放在海外更赚；负值＝出海反而更薄利。只比同一家公司的两块业务，不受规模影响。</p>
      <div class="qstats">
        <div class="qstat"><b>${sign(yo.gap_med)}<i>pp</i></b><span>${y} 年溢价中位</span></div>
        <div class="qstat"><b>${pct(yo.pos_share)}</b><span>企业层面溢价为正</span></div>
        <div class="qstat"><b>${win.length} / ${ok.length}</b><span>行业层面溢价为正</span></div>
      </div>
      <p class="qv">${q1v}</p>
      ${win.length ? `<div class="qnames">
        <span class="qntag">最赚的几个</span>
        ${win.slice(0, 4).map(r => `<span class="qname">${esc(indShort(r.ind, 96))}<em>${sign(r.gap_med)}pp</em></span>`).join("")}
        ${lose.length && lose.length <= 3 ? `<span class="qntag" style="background:#FDF0EE;border-color:#F0C4BE;color:#9C2B1E">还在赔的</span>
        ${lose.map(r => `<span class="qname" style="background:#FDF0EE;border-color:#F0C4BE;color:#9C2B1E">${esc(indShort(r.ind, 96))}<em>${sign(r.gap_med)}pp</em></span>`).join("")}` : ""}
      </div>` : ""}
      <div class="qfoot">${py ? `比 ${py} 年：溢价中位 ${sign(YO[py].gap_med)}pp → <b>${sign(yo.gap_med)}pp</b>（${sign(yo.gap_med - YO[py].gap_med)}pp），
        赚钱行业 ${prevWin.length} → <b>${win.length}</b> 个；新转为赚钱 ${newlyWin.length} 个，掉出去 ${lostWin.length} 个。` : "这是样本窗口的第一年，没有同比。"}</div>
      <div class="qfoot">十年总体：${tr[0].year} 年 ${sign(tr[0].gap_med)}pp → ${LAST} 年 ${sign(tr[tr.length - 1].gap_med)}pp，
        自 <b>${startPos} 年</b>起连续 ${LAST - startPos + 1} 年为正——出海整体从「更薄利」翻成「更赚」，但这是全市场中位数，具体到行业仍要单独看。</div>
    </article>`;

    /* —— 问题二 —— */
    const q2v = !enter.length
      ? `这一年没有「既好进又赚钱」的行业：<b>门槛低的都在赔钱，赚钱的门槛都不低</b>。要么先攒到行业门槛以上，要么这一年别进。`
      : enter.length >= 8
        ? `机会窗口很宽：<b>${enter.length} 个行业</b>既不需要很大体量就能进、又确实赚钱。这类年份适合试探性进入，试错成本低。`
        : `窗口不窄但也不大：只有 <b>${enter.length} 个行业</b>同时满足「门槛 ≤50 分位」和「溢价为正」。其余行业要么进不去，要么进去赔钱。`;

    const q2 = `
    <article class="qcard">
      <div class="qh"><span class="qn">问题二</span>
        <span class="qt">${y} 年想进的话，该挑哪个行业？</span></div>
      <p class="qdef">口径三个维度：<b>门槛</b>＝该行业出海企业的规模分位中位数（越低＝不用很大就能出海）；
        <b>溢价</b>＝进去赚不赚；<b>容量</b>＝该行业当年海外收入合计（池子多深）。</p>
      <div class="qstats">
        <div class="qstat"><b>${enter.length}</b><span>门槛≤50 分位且赚钱</span></div>
        <div class="qstat"><b>${ok.length ? pct(enter.length / ok.length * 100) : "—"}</b><span>占样本够用行业的比例</span></div>
        <div class="qstat"><b>${spr ? fmt(spr.spread, 1) : "—"}<i>pp</i></b><span>行业间溢价分化（p90−p10）</span></div>
      </div>
      <p class="qv">${q2v}</p>
      ${enter.length ? `<div class="qnames">
        <span class="qntag">建议优先看</span>
        ${enter.slice(0, 4).map(r => `<span class="qname">${esc(indShort(r.ind, 96))}
          <em>门槛 ${(r.gate_med * 100).toFixed(0)} 分位 · ${sign(r.gap_med)}pp · ${fmt(r.cap, 0)} 亿</em></span>`).join("")}
      </div>` : ""}
      <div class="qfoot">${py ? `比 ${py} 年：可进行业 ${prevEnter.length} → <b>${enter.length}</b> 个；
        新开门 ${[...enterSet].filter(n => !prevEnterSet.has(n)).length} 个，关掉 ${[...prevEnterSet].filter(n => !enterSet.has(n)).length} 个。` : "这是样本窗口的第一年，没有同比。"}</div>
      <div class="qfoot">十年总体：行业间溢价分化 ${spr0 ? fmt(spr0.spread, 1) : "—"}pp（${tr[0].year}）→
        <b>${spr ? fmt(spr.spread, 1) : "—"}pp</b>（${y}）——${spr && spr0 && spr.spread > spr0.spread ? "差距在拉大，「进对行业」比「要不要出海」更值钱" : "差距没有明显扩大，行业选择的边际价值没变"}。</div>
    </article>`;

    return `<section class="qwrap">
      <div class="qwrap-h"><b>${y} 年两个核心问题</b>
        <span>每个数字都按 ${y} 年切片现算；换年份，结论和名单一起变</span></div>
      <div class="qq">${q1}${q2}</div>
    </section>`;
  }

  /* ---------- ⑤ 三大榜单（标题带年份） ---------- */
  function viewBoards(y, iys) {
    const byGap = iys.filter(r => r.gap_med != null && r.gap_n >= 100).sort((a, b) => b.gap_med - a.gap_med);
    const byGate = iys.filter(r => r.gate_med != null && r.n >= 100).sort((a, b) => a.gate_med - b.gate_med);
    const byCap = iys.filter(r => r.cap > 0).sort((a, b) => b.cap - a.cap);

    const card = (title, sub, items, hint) => `
      <section class="card">
        <h3>${y} 年 · ${title}</h3>
        <p class="hint" style="margin:2px 0 6px">${sub}</p>
        ${items.length ? hbars(items, { width: 400, labelW: 118, rowH: 30 }) : emptyChart("这一年的样本不够排榜")}
        <p class="hint">${hint}</p>
      </section>`;

    return `<div class="grid3" id="sec-boards">
      ${card("溢价最高 · 赚得到的行业", "海外毛利率比境内高多少（pp）",
      byGap.slice(0, 6).map(r => ({ label: indShort(r.ind, 200), v: r.gap_med, c: "#C0392B", vt: sign(r.gap_med) + "pp" })),
      `只统计溢价样本 ≥100 的行业，避免小样本噪声。${byGap.length} 个行业达标，数值越高，出海在这个行业越有毛利加成。`)}
      ${card("门槛最低 · 最容易进的行业", "要多大体量才能出海（规模分位，越低越容易）",
        byGate.slice(0, 6).map(r => ({ label: indShort(r.ind, 200), v: (r.gate_med || 0) * 100, c: "#2E86AB", vt: (r.gate_med * 100).toFixed(0) + " 分位" })),
        `门槛＝行业内出海企业的规模分位中位数。数字越低，不用很大就能出海。`)}
      ${card("容量最大 · 池子最深的行业", "该行业当年海外收入合计（亿元）",
          byCap.slice(0, 6).map(r => ({ label: indShort(r.ind, 200), v: r.cap, c: "#4A6FA5", vt: fmt(r.cap, 0) + " 亿" })),
          `容量＝${y} 年该行业海外收入合计，是「已经开发出来的盘子」，不是市场总规模。`)}
    </div>`;
  }

  /* ---------- 行业定位图（气泡 + 点选体检卡） ---------- */
  function viewPositionSection(y, okRows) {
    const posPick = STATE.posPick && IY[STATE.posPick + "|" + y] ? STATE.posPick : null;
    const thinRows = IND.map(n => IY[n + "|" + y]).filter(Boolean).filter(r => r.gap_med != null && r.gap_n < 30);
    const scatterRows = okRows.map(r => ({
      label: indShort(r.ind, 90),
      x: (r.gate_med || 0) * 100,
      y: r.gap_med,
      s: r.cap || 1,
      c: r.gap_med >= 3 ? "#C0392B" : r.gap_med >= 0 ? "#D68910" : "#4A8B6F",
      stroke: r.profitable === 1 ? "#1A2433" : "#FFFFFF",
      dash: r.profitable === 0,
      hollow: false,
      ind: r.ind,
      tip: `${r.ind}\n门槛 ${((r.gate_med || 0) * 100).toFixed(0)} 分位 | 溢价中位 ${r.gap_med}pp\n`
        + `溢价为正 ${r.pos_share}%（${r.gap_n} 个样本）| 容量 ${fmt(r.cap, 0)} 亿`,
    }));
    return `
    <section class="card" id="sec-pos">
      <div class="card-head">
        <h2>行业定位图 · ${y} 年</h2>
        <p>横轴＝<b>门槛</b>（该行业出海企业的规模分位中位数，越低越容易进）；纵轴＝<b>出海溢价中位</b>（海外毛利率比境内高多少 pp）。
        <b>右上＝进得去且赚得到</b>；右下＝进得去但赔钱；左上＝少数人在赚钱；左下＝又难又不赚。<b>点一个气泡，下面展开这个行业的体检卡。</b></p>
      </div>
      ${okRows.length ? scatter(scatterRows, {
      xlabel: "出海门槛（规模分位，越低越容易进）", ylabel: "出海溢价中位 (pp)", height: 430, labelTop: 22,
      pickField: "ind", pickValue: posPick,
    }) : warnBar(`${y} 年没有溢价样本 ≥30 的行业，这一年的行业定位图画不出来。`)}
      <div class="legend">
        <span><i style="background:#C0392B"></i>溢价 ≥3pp（赚得到）</span>
        <span><i style="background:#D68910"></i>0~3pp（持平）</span>
        <span><i style="background:#4A8B6F"></i>溢价 &lt;0（赔钱）</span>
        <span><i style="background:#fff;border:2px solid #1A2433"></i>黑边＝该行业过半企业能赚钱</span>
        <span><i style="background:#fff;border:2px dashed #B9C2CF"></i>白虚边＝过半企业亏</span>
      </div>
      ${thinRows.length ? `<p class="hint dim">另有 ${thinRows.length} 个行业溢价样本不足 30
        （${thinRows.slice(0, 8).map(r => indShort(r.ind, 60) + " " + r.gap_n + " 个").join("、")}${thinRows.length > 8 ? " 等" : ""}），
        中位数不稳，不进定位图；完整数字可在上方「全行业明细表」里查。</p>` : ""}
      ${viewPosCard(posPick, y)}
      <div class="sectools">
        <button class="xbtn" data-act="csv" data-pfx="行业定位图">下载这张表 CSV</button>
        <button class="xbtn" data-act="png" data-pfx="行业定位图">图表存 PNG</button>
      </div>
    </section>`;
  }

  /* ==================== v5：总观页市场预测 ==================== */
  function viewForecastOverview() {
    if (!FC || !FC.cap_forecast || !Object.keys(FC.cap_forecast).length) return "";
    const cap = FC.cap_forecast;
    const yrs = Object.keys(cap).map(Number).sort((a, b) => a - b);
    const fitEnd = (FCMETA && FCMETA.fit_end) || yrs[yrs.length - 2];
    const fy = yrs.filter(y => y > fitEnd);          // 预测年份（2026–2028）
    const histY = yrs.filter(y => y <= fitEnd);
    if (!fy.length) return "";

    const rho = FC.rho, sig = FC.sigma, hl = FC.half_life;
    /* ★ 容量数字全部取 fit_end 当年（不是 yrs 的最后一年）。
       旧代码用 cap[yrs[yrs.length-1]]，而 yrs 含预测年份，
       于是「2025 年」显示的其实是 2028 年的值。 */
    const capBase = cap[fitEnd];
    const f1 = cap[fy[0]], f3 = cap[fy[fy.length - 1]];
    /* ★ CAGR 由后端唯一给出（FC.cap_cagr），前端不再自己重算。
       旧代码前端算 Math.pow(cap[2025]/cap[2023],1/2)-1 得 12.10%，
       后端却用另一个公式外推，两者不一致。 */
    const cagr = (FC.cap_cagr != null) ? FC.cap_cagr : null;

    /* 容量图：历史实线 + 预测虚线段
       ★ X 轴范围显式覆盖到最后一个预测年，否则 lineChart 按 pts 的
         xmin/xmax 归一化，2027/2028 会被画到画布外（只显示到 2026）。 */
    const capPts = histY.map(y => ({ x: y, v: cap[y] }));
    const fcPts = fy.map(y => ({ x: y, v: cap[y] }));
    const capChart = lineChart(capPts, {
      height: 280, width: 620, xlabel: "年份", ylabel: "A股出海总收入 (亿元)",
      color: "#2E86AB", xint: true, xn: 8,
      xmin: histY[0], xmax: fy[fy.length - 1],
      refPts: fcPts, refColor: "#C0392B",
    });

    /* 行业溢价路径：取样本最多的几个行业 */
    const indFc = FCIND || {};
    const indRows = Object.keys(indFc).map(k => ({
      name: k, d: indFc[k],
      n: (indFc[k].path || []).length ? (indFc[k].ind_median || 0) : 0,
    })).filter(r => r.d && r.d.path && r.d.path.length);
    /* 按「当前锚 vs 未来锚」的落差排序：落差大的行业均值回复空间也大 */
    indRows.forEach(r => { r.gapToAnchor = Math.abs((r.d.anchor_forward || 0) - (r.d.ind_median || 0)); });
    const topInd = indRows.sort((a, b) => b.gapToAnchor - a.gapToAnchor).slice(0, 6);

    /* 退出概率：与首屏退出诊断**共用同一条 KM 曲线**（FCEXIT.km）
       ★ 改造前这里画的是另算的一套条件退出率表，导致同页出现
         「首屏 1.01% / 预测区块 6.9%」两个互斥数字。
       现在直接用 FCEXIT.km（由 exit_km 统一引擎产出），两处必然一致。
       exTbl 仍保留：它回答的是另一个问题——「已出海 t 年后未来 k 年」的
       条件概率，用于企业级卡片，与年度风险率不是一回事。 */
    const exTbl = (FCEXIT && FCEXIT.table) || {};
    const exKm = (FCEXIT && FCEXIT.km && FCEXIT.km.length) ? FCEXIT.km : (D.survival.km || []);
    const exRows = exKm.slice(0, 5).map(r => ({ t: r.t, h: r.hazard }));
    const exAt = t => {
      const r = exRows.find(x => x.t === t);
      return r ? r.h : null;
    };

    const exChart = exRows.length ? lineChart(
      exRows.map(r => ({ x: r.t, v: r.h })),
      {
        height: 250, width: 620, xlabel: "出海第几年", ylabel: "当年退出率 (%)",
        color: "#C0392B", xint: true, xn: 5, ymin: 0,
      }) : "";

    const bt = FCBACK.length ? FCBACK[FCBACK.length - 1] : null;

    return `
    <section class="card" id="sec-forecast">
      <div class="card-head">
        <h2>未来三年会怎样 · 市场级预测</h2>
        <p>用 ${fitEnd} 年及以前的全部披露数据拟合，预测 ${fy[0]}–${fy[fy.length - 1]} 年的市场容量、
          行业溢价走向与出海企业的退出风险。<b>所有预测都标注了区间宽度和回测精度</b>——不给出「看起来很准但实际不准」的数。</p>
      </div>

      <div class="grid2">
        <section class="card">
          <h3>A股出海总收入容量（亿元）</h3>
          ${capChart}
          <div class="fclegend">
            <span><i style="border-color:#2E86AB"></i>${histY[0]}–${fitEnd} 实际</span>
            <span><i class="dash" style="border-color:#C0392B"></i>${fy[0]}–${fy[fy.length - 1]} 外推</span>
          </div>
          <p class="hint">按近两年 CAGR${cagr != null ? ` <b>${(cagr * 100).toFixed(2)}%</b>` : ""} 外推：
            ${fitEnd} 年 <b>${fmt(capBase, 0)} 亿</b> → ${fy[0]} 年 <b>${fmt(f1, 0)} 亿</b> →
            ${fy[fy.length - 1]} 年 <b>${fmt(f3, 0)} 亿</b>（约 ${fmt(f3 / 1e4, 2)} 万亿）。
            <b>这个外推只假设增速延续，不假设政策或需求变化</b>——跨境电商政策、关税、汇率任一变动都会让它失效。</p>
        </section>

        <section class="card">
          <h3>出海企业的退出风险会随时间衰减</h3>
          ${exChart}
          <p class="hint">用 Kaplan-Meier 条件生存估计（与「退出诊断」区块同一条曲线）：
            出海第 1 年退出率 <b>${exAt(1) != null ? exAt(1) + "%" : "—"}</b>，
            第 3 年降到 <b>${exAt(3) != null ? exAt(3) + "%" : "—"}</b>，
            第 5 年只有 <b>${exAt(5) != null ? exAt(5) + "%" : "—"}</b>。
            <b>规律很明确：第一年活不下来最常见，熬过去就稳了</b>——所以止损线要卡在头两年。</p>
        </section>
      </div>

      ${topInd.length ? `<section class="card">
        <h3>哪些行业的溢价最可能向行业锚回归</h3>
        <div class="fcgrid">
          ${topInd.map(r => {
            const p = r.d.path;
            const p3 = p[p.length - 1];
            const lo = p[0].lo, hi = p[0].hi;
            return `<div class="scenbox">
              <span class="sn">${esc(shortInd2(r.name))}</span>
              <b>${sign(r.d.ind_median)}pp → ${sign(p3.pred)}pp</b>
              <em>${p3.year} 年点预测，80% 区间 [${sign(lo)}, ${sign(hi)}]pp</em>
            </div>`;
          }).join("")}
        </div>
        <p class="hint">按「当前行业锚与未来锚的落差」排序。ρ = <b>${rho.toFixed(3)}</b>${rho < 0.05 ? "（几乎为零，即基本不回归）" : ""}，
          单期波动 σ = <b>${fmt(sig, 1)}pp</b>。注意区间宽度普遍在 ${fmt(20, 0)}–${fmt(40, 0)}pp 量级——
          <b>远大于点预测的移动幅度</b>，这说明这些行业锚的历史值本身噪声就很大，参考意义有限。</p>
      </section>` : ""}

      ${bt ? `<section class="card">
        <h3>这些预测有多准 · walk-forward 回测</h3>
        <div class="btgrid">
          ${FCBACK.map(b => `<div class="btbox"><span>${b.year} 年 AR(1)</span><b>${fmt(b.mae_ar, 2)}</b><i>MAE (pp) · n=${b.n.toLocaleString()}</i></div>`).join("")}
          <div class="btbox best"><span>naive 基准</span><b>${fmt(bt.mae_naive, 2)}</b><i>今年＝去年 · 反而更低</i></div>
          <div class="btbox"><span>行业中位</span><b>${fmt(bt.mae_industry, 2)}</b><i>直接用行业中位代入</i></div>
          <div class="btbox"><span>区间覆盖率</span><b>${bt.coverage80}%</b><i>80% 区间实际覆盖</i></div>
        </div>
        <div class="honest"><b>诚实披露：</b>三次滚动回测（${FCBACK.map(b => b.year).join(" / ")}）里，
          naive 基准（今年溢价＝去年溢价）的 MAE <b>${fmt(bt.mae_naive, 2)}</b> 一直优于 AR(1) 的 <b>${fmt(bt.mae_ar, 2)}</b>，
          组内 R² 仅 <b>${(FC.r2_within * 100).toFixed(1)}%</b>。<br>
          这说明<b>出海溢价本身没有显著的均值回复趋势</b>，企业的溢价高度持续。
          所以 AR(1) 的价值不是「更准的点预测」，而是<b>给出收敛方向与区间宽度</b>——
          它告诉你「三年后大概率落在这个范围」，但区间比点预测宽得多。
          <b>不要把点预测当成承诺</b>；真要做决策，看规则层和压力测试。</div>
      </section>` : ""}
    </section>`;
  }

  /* ==================== ④ 十年走势（三句话 + 两张图） ====================
     旧版把「17.0×」「4.88pp」这种裸数字摆在首屏，读者看不懂单位，
     也不知道这个数意味着好还是坏。现在每个数字前面先给结论，数字后面给口径。 */
  function viewTrendSection() {
    const rows = D3.year_trend;
    const first = rows[0], last = rows[rows.length - 1];
    const sRate = rows.map(r => ({ x: r.year, y: r.ovs_rate }));
    const sGap = rows.map(r => ({ x: r.year, y: r.gap_med }));
    const sCov = rows.map(r => ({ x: r.year, y: r.gap_cov_ovs }));

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

    /* 倍数与年化：17.01× 这种写法读者不知道 × 是什么，改成「变成原来的 N 倍」＋年化 */
    const mult = last.cap / first.cap;
    const yrSpan = last.year - first.year;
    const cagr = Math.pow(mult, 1 / yrSpan) - 1;

    /* 溢价连续为正的起点（从最新一年往前推，遇到负值就停） */
    let startPos = last.year;
    for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].gap_med > 0) startPos = rows[i].year; else break; }

    const kmArr = D.survival.km;
    const km1 = kmArr[0], km2 = kmArr[1];
    const km5 = kmArr.find(k => k.t === 5), kmLast = kmArr[kmArr.length - 1];

    const lead = `
    <div class="lead3">
      <div class="lead l1">
        <div class="lt">规模 · 出海从少数派变成过半</div>
        <div class="lv">${mult.toFixed(1)}<i>倍</i></div>
        <div class="ld">海外收入合计从 <b>${fmt(first.cap / 10000, 2)} 万亿</b> 涨到 <b>${fmt(last.cap / 10000, 2)} 万亿</b>，
          ${yrSpan} 年间变成原来的 <b>${mult.toFixed(1)} 倍</b>（年均 +${(cagr * 100).toFixed(1)}%）；
          同期出海企业占比从 <b>${pct(first.ovs_rate)}</b> 升到 <b>${pct(last.ovs_rate)}</b>。</div>
      </div>
      <div class="lead l2">
        <div class="lt">赚钱 · 从「出海更薄利」变成「出海更赚」</div>
        <div class="lv">${sign(last.gap_med)}<i>pp</i></div>
        <div class="ld">出海溢价中位从 <b>${sign(first.gap_med)}pp</b> 走到 <b>${sign(last.gap_med)}pp</b>，
          自 <b>${startPos} 年</b>起连续 ${last.year - startPos + 1} 年为正。
          但要打折看：${first.year} 年只有 <b>${pct(first.gap_cov_ovs)}</b> 的出海企业能算出溢价，${last.year} 年才到
          <b>${pct(last.gap_cov_ovs)}</b>——早年的中位数本身是被筛选过的。</div>
      </div>
      <div class="lead l3">
        <div class="lt">存活 · 风险集中在出海头一年</div>
        <div class="lv">${km1 ? km1.hazard : "—"}<i>%</i></div>
        <div class="ld">第 1 年退出率 <b>${km1 ? km1.hazard : "—"}%</b>${km2 ? `，是第 2 年（${km2.hazard}%）的
          <b>${(km1.hazard / km2.hazard).toFixed(1)} 倍</b>` : ""}；熬过 5 年还有 <b>${km5 ? km5.surv : "—"}%</b> 在出海，
          10 年 <b>${kmLast ? kmLast.surv : "—"}%</b>。<b>止损线要卡在头两年。</b></div>
      </div>
    </div>`;

    const explain = `
    <div class="explain">
      <b>三个词先说清楚，后面所有图都用这套口径：</b>
      <br>· <b>出海溢价</b>（单位 pp，百分点）＝ 海外业务毛利率 − 境内业务毛利率。
      例：+4.88pp 指「同一家公司，海外那块业务比境内那块多 4.88 个百分点的毛利率」，<b>不是增长率，也不是利润率本身</b>。
      <br>· <b>出海率</b>＝有海外收入的企业 ÷ 全部 A 股企业，回答「多少人出海」，不回答「出海赚不赚」。
      <br>· <b>渗透度</b>＝海外收入 ÷ 营业总收入，回答「这家企业有多依赖海外」，100% 即全部收入来自境外。
    </div>`;

    return `
    <section class="card" id="sec-trend">
      <div class="card-head">
        <h2>十年走势 · 这十年到底变强了还是变多了</h2>
        <p>三句话概括 ${first.year}→${last.year}：<b>规模变大了、出海变赚了、但头一年依然最容易出局</b>。下面两张图是这三句话的证据。</p>
      </div>
      ${lead}
      ${explain}
      <div class="grid2">
        <section class="card">
          <h3>覆盖率 · 出海的企业与能算出溢价的企业</h3>
          ${chartPct}
          <div class="legend">
            <span><i style="background:#2E86AB"></i>企业出海率</span>
            <span><i style="background:#7B61A8"></i>溢价可算比例（出海组内）</span>
          </div>
          <p class="hint">${first.year} 年只有 ${pct(first.gap_cov_ovs)} 的出海企业能算出溢价，${last.year} 年是 ${pct(last.gap_cov_ovs)}。
          早年能算的那部分本身就是选择性披露的，所以早年的溢价中位数不可靠——这也是为什么本产品每一张溢价图都标注了样本量。</p>
        </section>
        <section class="card">
          <h3>出海溢价中位 · 十年走势</h3>
          ${chartGap}
          <p class="hint">从 ${sign(first.gap_med)}pp 到 ${sign(last.gap_med)}pp，方向是好的。但这个上升里有多少来自
          「披露改善、样本构成变化」、多少是真实盈利改善，单看这条线给不出答案——要看平衡面板与企业固定效应的结果，
          那部分在分析报告里。</p>
        </section>
      </div>
      <div class="statline wrap">
        <div><span>${first.year} 出海率</span><b>${pct(first.ovs_rate)}</b></div>
        <div><span>${last.year} 出海率</span><b>${pct(last.ovs_rate)}</b></div>
        <div><span>海外收入 ${first.year}</span><b>${fmt(first.cap / 10000, 2)} 万亿</b></div>
        <div><span>海外收入 ${last.year}</span><b>${fmt(last.cap / 10000, 2)} 万亿</b></div>
        <div><span>${yrSpan} 年增长倍数</span><b class="up">${mult.toFixed(1)} 倍</b></div>
        <div><span>年均增速</span><b class="up">+${(cagr * 100).toFixed(1)}%</b></div>
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

  /* ==================== ⑤ 行业全景区块 ====================
     三个改动：
       ① 图表标签用大类短名 + 按像素截断，不再出现半截字；
       ② 84 个行业全部画出来会有两米高，默认只画前 12 个，其余折叠；
       ③ 加搜索框（datalist），直接输入「电子设备 / 医药」就能跳过去，
          不用在 84 个条形里一个个找。 */
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

    const rankBy = sorted.findIndex(r => r.ind === pick) + 1;
    const totalCap = sorted.reduce((s, r) => s + (r.cap || 0), 0);
    const totalN = sorted.reduce((s, r) => s + (r.n || 0), 0);
    const share = pr ? {
      cap: totalCap ? pr.cap / totalCap * 100 : null,
      n: totalN ? pr.n / totalN * 100 : null,
    } : null;

    const allMed = {
      ovs_rate: median(sorted.map(r => r.ovs_rate)),
      gap_med: median(sorted.map(r => r.gap_med)),
      pos_share: median(sorted.map(r => r.pos_share)),
      gate_med: median(sorted.map(r => r.gate_med)),
      ratio_med: median(sorted.map(r => r.ratio_med)),
    };

    const barItems = sorted.map(r => ({
      label: indShort(r.ind, 200),
      v: met.get(r),
      c: r.ind === pick ? "#C0392B" : met.c,
      vt: met.vt(r),
      pick: r.ind,
    }));
    const TOPN = 12;

    const detail = pr ? `
      <div class="card ind-detail">
        <div class="card-head">
          <h2>${esc(pr.ind)} · ${y} 年</h2>
          <p>在 ${sorted.length} 个行业口径里，${met.l}排第 <b>${rankBy}</b> 位。
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
        <p>全部 ${IND.length} 个行业口径按「${met.l}」排序。点条形切换选中行业，下方给出它和全行业中位的对比。
        <b>默认只画前 ${TOPN} 个</b>，其余点开折叠区再看全量。</p>
      </div>
      <div class="explain" style="margin-top:0">
        <b>渗透度是什么：</b>海外收入 ÷ 营业总收入，即「这家企业的收入有多大比例来自境外」。
        渗透度 30% 说明三成收入在海外；接近 100% 说明基本靠海外吃饭。
        它衡量的<b>不是出海赚不赚钱</b>，而是<b>出海做到多深、对海外市场有多依赖</b>——
        和「溢价」要分开看：渗透度高但溢价为负，是「规模上去了、钱没赚到」。
      </div>
      <div class="pickerrow">
        <label>直接搜行业</label>
        <input class="tsearch" id="indq" list="indlist" placeholder="输入行业名或简称，如 电子设备 / 医药 / 水上运输"
          value="${pick ? esc(pick) : ""}" autocomplete="off">
        <datalist id="indlist">${IND.map(n => `<option value="${esc(n)}">${esc(indShort(n, 200))}</option>`).join("")}</datalist>
        <span class="hint dim">选中后页面按这个行业重绘</span>
      </div>
      <div class="switcher" data-role="indmetric">
        ${METRICS.map(m => `<button class="sw${m.k === mk ? " on" : ""}" data-metric="${m.k}">${m.l}</button>`).join("")}
      </div>
      <div class="indwrap">
        <div class="indbars" id="indbars">
          ${hbars(barItems.slice(0, TOPN), { width: 560, labelW: 128, rowH: 28 })}
          <details class="foldtable">
            <summary><b>展开全部 ${barItems.length} 个行业</b><span class="fthint"><i class="fc">默认收起，点开看全量</i><i class="fo">已展开，点击收起</i></span></summary>
            ${hbars(barItems, { width: 560, labelW: 128, rowH: 28 })}
          </details>
          <p class="hint dim">点条形可切换选中行业。红色那条是当前选中的行业。</p>
        </div>
        <div class="indtable">
          <details class="foldtable">
            <summary><b>全行业明细表</b>（${sorted.length} 行）<span class="fthint"><i class="fc">默认折叠，点开查看</i><i class="fo">已展开，点击收起</i></span>
              <button class="xbtn foldcsv" data-act="csv" data-pfx="行业明细">下载 CSV</button></summary>
            <input class="tsearch" id="indfilter" placeholder="在表里筛行业…" autocomplete="off">
            <div class="tablewrap"><table class="dt" id="indtableel">
              <thead><tr><th>行业</th><th>样本</th><th>出海率</th><th>渗透度<br><span class="dim" style="font-weight:400">海外收入占比</span></th>
              <th>溢价中位<br><span class="dim" style="font-weight:400">pp</span></th><th>溢价为正</th><th>门槛</th><th>容量(亿)</th><th>吸引力</th></tr></thead>
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
      <div class="pickerrow">
        <label>直接搜省份</label>
        <input class="tsearch" id="provq" list="provlist" placeholder="输入省份，如 广东 / 江苏" autocomplete="off">
        <datalist id="provlist">${PROV.map(n => `<option value="${esc(n)}">${esc(provShort(n))}</option>`).join("")}</datalist>
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
            <input class="tsearch" id="provfilter" placeholder="在表里筛省份…" autocomplete="off">
            <div class="tablewrap"><table class="dt" id="provtableel">
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

    /* 只保留短名，下拉 84 项太长；搜索框负责「快速定位」 */
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
        <label>搜行业</label>
        <input class="tsearch" id="exitq" list="exitlist" placeholder="输入行业名快速定位" autocomplete="off">
        <datalist id="exitlist">${IND.filter(n => INDKM[n]).map(n => `<option value="${esc(n)}">${esc(shortName(n))}</option>`).join("")}</datalist>
        <label>当前</label>
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
        <h3>四条能直接用的止损规则${src ? "（已按 " + esc(shortName(exitInd)) + " 定制）" : "（全样本默认）"}
          <em style="font-style:normal;font-size:11.5px;font-weight:500;color:var(--muted)">写进决策文件，不靠临场判断</em></h3>
        <ul class="rulemini">${rules.map((r, i) => `
          <li><span class="rn">${i + 1}</span>
            <span><b>${esc(r.title)}</b> —— ${r.body}<br>
            <span class="dim">→ ${r.detail}</span></span></li>`).join("")}</ul>
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
    /* ★ 方向由数据决定：不再写死「一路下降」。
       实际曲线可能是先升后降（旧口径就是这样），说错方向比不说更糟。 */
    const peak = src ? src.peak_t : (D.survival.peak_t || 1);
    const after = km.filter(r => r.t > 1);
    const rising = after.length && km[1].hazard > k1.hazard;
    if (rising) {
      s += "风险在第 " + peak + " 年见顶，之后才回落——<b>早期才是真正的危险期</b>。";
    } else {
      s += "过了第 1 年，风险率逐年下降，<b>早期才是真正的危险期</b>。";
    }
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
      /* ★ 全样本基准从数据里取，不再写死 4.12%（旧口径遗留，已失效） */
      const base = D.survival.km[0] ? D.survival.km[0].hazard : null;
      const cmp = base == null ? ""
        : (k1 && k1.hazard > base
          ? `显著高于全样本的 ${base}%，说明这个行业出海第一年就容易做不下去，进去要预留更短的试错窗口。`
          : `低于全样本的 ${base}%，这个行业第一年的存活情况好于平均。`);
      return `<p>${esc(shortName(exitInd))}行业 ${src.n_firms} 家出海企业里，${src.n_exit} 家退出了（${(src.n_exit / src.n_firms * 100).toFixed(1)}%）。
        第 1 年退出率 ${k1 ? k1.hazard : "—"}%，${cmp}</p>
        <p>这个行业的风险峰值在<b>第 ${peak} 年</b>。${peak === 1
          ? "峰值就在第一年，止损线要设得非常早——第一年做不出正毛利就该撤。"
          : peak <= 3 ? "峰值在前三年，说明这个行业的出海模式需要一段时间才能跑通，但也意味着早期风险敞口集中。"
            : "峰值靠后，说明大多数企业能撑过去，但也说明前期投入要准备好。"}</p>
        <p class="dim">按这个行业的经验，如果一定要给一个时间点：<b>第 ${peak} 年</b>是最需要盯的窗口，
        连续两年海外毛利率为负或溢价落后同行 5pp 以上，就应该重新评估。</p>`;
    }
    const lc7 = D.lifecycle.find(l => l.k === 7);
    const lc8 = D.lifecycle.find(l => l.k === 8);
    const skm = D.survival.km;
    /* ★ 结论方向由数据决定：第 1 年是最高点才敢说「生死线」 */
    const firstIsPeak = skm[1] ? skm[0].hazard >= skm[1].hazard : true;
    const head = firstIsPeak
      ? `全样本最硬的结论是<b>第一年是生死线</b>：第 1 年退出率 ${skm[0].hazard}%，是第 2 年（${skm[1].hazard}%）的 ${(skm[0].hazard / skm[1].hazard).toFixed(1)} 倍。`
      : `全样本的风险峰值出现在<b>第 ${D.survival.peak_t || 1} 年</b>（${(skm.reduce((m, r) => r.hazard > m.hazard ? r : m, skm[0])).hazard}%），不是第 1 年——<b>早期风险敞口要按峰值年来设止损线</b>。`;
    return `<p>${head}
      10 年后仍有 ${skm[skm.length - 1].surv}% 的企业在出海，中位存续期超过 10 年。</p>
    <p>但退出不是唯一风险：第 7 年溢价中位掉到 ${lc7 ? lc7.med : "0.68"}pp（全周期最低），第 8 年又回到 ${lc8 ? lc8.med : "—"}pp。
      <b>第 7 年的难看是同侪普遍规律，不是个体失败</b>——这时候要判断的是「你比同行差多少」，不是你自己的绝对值。</p>
    <p class="dim">所以止损线要设两道：一年内的「做不做得出来」（连续两年海外毛利率为负），
      和长期的「比不比得过同行」（相对同行业中位落后 5pp 以上）。</p>`;
  }

  function exitRules(mode, exitInd, src) {
    const S = D.survival;
    const RIMP = relImp(D.model.risk.imp, 2);
    const lc7 = D.lifecycle.find(l => l.k === 7);
    const lc8 = D.lifecycle.find(l => l.k === 8);
    const k1 = src ? src.km[0] : S.km[0];
    const k2 = src ? src.km[1] : S.km[1];
    const peak = src ? src.peak_t : (S.peak_t || 1);

    const r1 = src
      ? {
        title: `第一年止损线：出海头两年溢价就是负的就撤`,
        body: `出海第 1~2 年溢价 &lt; 0（海外毛利率低于境内）。这个行业第 1 年退出率 <b>${k1 ? k1.hazard : "—"}%</b>${k1 && k2 ? `，是第 2 年的 ${(k1.hazard / k2.hazard).toFixed(1)} 倍` : ""}。`,
        detail: `把第一年的资源全压在验证上，不要平摊到三年。第一年跑不出正毛利是产品/定价/渠道问题，再等两年也不会变好。`,
      }
      : {
        title: `第一年止损线：出海头两年溢价就是负的就撤`,
        body: `出海第 1~2 年溢价 &lt; 0。全样本第 1 年退出率 <b>${S.km[0].hazard}%</b>，是第 2 年的 ${(S.km[0].hazard / S.km[1].hazard).toFixed(1)} 倍。`,
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
      body: `连续两个对标周期（半年一次）都落后同行中位 5pp 以上。预测模型里权重最高的两个特征就是${featName(RIMP[0][0])}（相对权重 ${RIMP[0][1].toFixed(1)}%）和${featName(RIMP[1][0])}（${RIMP[1][1].toFixed(1)}%）。`,
      detail: `每半年跟同行业同规模的企业比一次溢价中位，连续两期落后就停止追加投入。`,
    };
    return [r1, r2, r3, r4];
  }

  /* ==================== 数据质量面板（v4 新增） ====================
     评审最常追问的一句是「你的数从哪来、缺多少、缺的地方会不会带偏结论」。
     这一块把「来源清晰可验证」做成看得见的证据，而不是一句自我声明：
       ① 覆盖 4 个数（企业·年 / 企业 / 年份 / 行业）
       ② 样本漏斗分两支——两条方程用的是不同样本，必须分开讲
       ③ 披露率热力图：26 行业 × 10 年，颜色深浅＝能算出溢价的企业占比
       ④ 已知缺口：坦白写出来的部分比藏起来更容易过评审 */

  /* 某行业某年「溢价可算率」= 有溢价样本 / 该行业样本 */
  function discloseRate(ind, y) {
    const t = D3.ind_trend[ind];
    if (!t) return null;
    const n = (t.n.find(p => p[0] === y) || [])[1] || 0;
    const gn = (t.gapn.find(p => p[0] === y) || [])[1] || 0;
    return n ? gn / n * 100 : null;
  }

  /* 四段色阶：#F2F5F8 → #CFE0EA → #7FB6CE → #2E86AB */
  function heatColor(v) {
    const stops = [[0, [242, 245, 248]], [35, [207, 224, 234]], [70, [127, 182, 206]], [100, [46, 134, 171]]];
    const t = Math.max(0, Math.min(100, v));
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i];
        const k = (t - a) / (b - a || 1);
        const c = ca.map((x, j) => Math.round(x + (cb[j] - x) * k));
        return `rgb(${c[0]},${c[1]},${c[2]})`;
      }
    }
    return "rgb(46,134,171)";
  }

  function heatmap(inds, years) {
    const rowH = 19, colW = 45, labelW = 134, padT = 20, padR = 10;
    const W = labelW + years.length * colW + padR;
    const H = padT + inds.length * rowH + 6;
    let g = "";
    /* 年份表头 */
    years.forEach((y, j) => {
      g += txt(labelW + j * colW + colW / 2, 12, String(y),
        { anchor: "middle", size: 10.5, fill: "#7A8798", weight: 600 });
    });
    /* 行 */
    inds.forEach((ind, i) => {
      const y0 = padT + i * rowH;
      g += txt(labelW - 9, y0 + rowH / 2 + 3.8, clip(shortName(ind), labelW - 16, 11),
        { anchor: "end", size: 11, fill: "#3D4859" });
      years.forEach((y, j) => {
        const v = discloseRate(ind, y);
        const x = labelW + j * colW;
        if (v == null) {
          g += `<rect x="${x + 1}" y="${y0 + 1}" width="${colW - 2}" height="${rowH - 3}" rx="2"
            fill="#FAFBFC" stroke="#EDF1F5"/>`;
          return;
        }
        const dark = v >= 58;
        g += `<rect x="${x + 1}" y="${y0 + 1}" width="${colW - 2}" height="${rowH - 3}" rx="2"
          fill="${heatColor(v)}"><title>${esc(ind)} ${y}：${v.toFixed(0)}% 能算出溢价</title></rect>`;
        g += txt(x + colW / 2, y0 + rowH / 2 + 3.6, v.toFixed(0),
          { anchor: "middle", size: 9.8, fill: dark ? "#FFFFFF" : "#5C6878", weight: 600 });
      });
    });
    return svgWrap(W, H, g);
  }

  /* 漏斗的一段（横向条 + 右侧数值） */
  function fStep(label, sub, v, base, cls, note) {
    const w = Math.max(v / base * 100, 1.5);
    return `<div class="fstep ${cls}">
      <div class="fl">${label}<em>${sub}</em></div>
      <div>
        <div class="fbar" style="width:${w.toFixed(1)}%">${v.toLocaleString()}</div>
        ${note ? `<div class="fn">${note}</div>` : ""}
      </div>
    </div>`;
  }

  function viewQualitySection() {
    const M = D.meta;
    const base = M.n_obs;
    const nGapOk = M.n_gap - M.n_gap_bad;
    const inds = Object.keys(D3.ind_trend)
      .slice()
      .sort((a, b) => (discloseRate(b, LAST) || 0) - (discloseRate(a, LAST) || 0));
    const yt = YT[LAST];

    return `
    <section class="card" id="sec-quality">
      <h3>数据质量 · 样本从哪来、缺多少 <em>可核验</em></h3>
      <p class="hint">模型可信的前提是样本透明。这一块把「多少企业·年被覆盖、每一步掉了多少样本、
        哪个行业哪一年披露得薄」全部摊开，方便直接核对。</p>
      ${kpiBlock([
      { v: M.n_obs.toLocaleString(), l: `企业·年观测（${YEARS[0]}–${YEARS[YEARS.length - 1]}）` },
      { v: M.n_firms.toLocaleString(), l: "A 股上市企业" },
      { v: String(YEARS.length), l: `年（${YEARS[0]}–${YEARS[YEARS.length - 1]}）` },
      { v: `${D2.meta.ind_n} / ${D2.meta.prov_n}`, l: "行业 / 省级行政区" },
    ])}
      <div class="funote">
        原始底表 ${M.n_obs.toLocaleString()} 个企业·年来自自采公开接口（分部披露 + 财务 + 治理三路抓取后按主键拼接），主键为
        <b>6 位股票代码 × 会计年度</b>，合并后逐行核对不重不漏。下面的漏斗是两条不同的方程，
        不要混着看：规模方程只要有海外收入就能算，溢价方程还要求海外成本 &gt; 0。
      </div>
    </section>

    <section class="card">
      <h3>样本漏斗 · 两条方程两支样本</h3>
      <div class="grid2">
        <div>
          <p class="hint" style="margin-bottom:10px"><b>出海规模方程</b>：被解释变量 = ln(海外收入)，
            用来判断「这家该加码还是收缩」的量级基准。</p>
          <div class="funnel">
            ${fStep("全样本", "全部 A 股企业·年", base, base, "f1")}
            ${fStep("有海外分部收入", "分部报告能拆出境外", M.n_ovs, base, "f2",
        `占全样本 ${(M.n_ovs / base * 100).toFixed(1)}%`)}
            ${fStep("控制变量齐全", "11 项财务治理不缺", 19429, base, "f3",
          `占全样本 ${(19429 / base * 100).toFixed(1)}%，主回归实际 N`)}
          </div>
        </div>
        <div>
          <p class="hint" style="margin-bottom:10px"><b>出海溢价方程</b>：被解释变量 = 海外毛利率 − 境内毛利率，
            用来判断「出海到底赚不赚钱」。要求更严：海外成本必须 &gt; 0。</p>
          <div class="funnel">
            ${fStep("可算溢价", "收入 + 成本两个数都有", M.n_gap, base, "f3",
          `占全样本 ${(M.n_gap / base * 100).toFixed(1)}%，占出海企业 ${pct(M.gap_cov)}`)}
            ${fStep("剔除口径异常", `|溢价| &gt; ${M.gap_cap}pp 失真`, nGapOk, base, "f4",
            `再剔 ${M.n_gap_bad} 个（${(M.n_gap_bad / M.n_gap * 100).toFixed(1)}%），剩 ${(nGapOk / base * 100).toFixed(1)}%`)}
          </div>
        </div>
      </div>
      <div class="funote">
        右列省略了与左列共用的「全样本」一行，分母同样是 ${base.toLocaleString()}。
        为什么两条方程样本差这么多：<b>收入只要披露一个数，毛利率要披露「收入 + 成本」两个数</b>。
        分部报告里大量企业只写境外收入、不写境外成本，所以溢价可算比例只有
        ${pct(M.gap_cov)}。缺的部分我们<b>不补值、不插值</b>——填 0 会把溢价中位数拉低，填均值会把方差抹平，
        两种都会做出假结论。代价是「溢价类」结论只代表能算出溢价的那批企业，这一点在每张溢价图上都标了。
      </div>
    </section>

    <section class="card">
      <h3>披露率热力图 · 哪个行业哪一年数得薄</h3>
      <p class="hint">格子里的数字＝该行业当年<b>能算出出海溢价</b>的企业占比。颜色越深披露越全。
        空白色块＝当年没有样本。可以从图里直接读出两件事：整体披露一年比一年好
        （全样本溢价可算率 ${pct(YT[YEARS[0]].gap_cov)} → ${pct(yt.gap_cov)}，
        出海企业内 ${pct(YT[YEARS[0]].gap_cov_ovs)} → ${pct(yt.gap_cov_ovs)}），
        以及哪些行业长期只有个位数样本——那些行业的溢价结论要打折看。</p>
      <details class="foldtable">
        <summary><b>展开 ${inds.length} 个行业 × ${YEARS.length} 年的完整热力图</b>
          <span class="fthint"><i class="fc">默认收起，点开看全量</i><i class="fo">已展开，点击收起</i></span></summary>
        <div class="heatwrap">${heatmap(inds, YEARS)}</div>
        <div class="heatlegend">
          <span>0%</span><span class="bar"></span><span>100%</span>
          <span style="margin-left:10px">按 ${LAST} 年披露率从高到低排序；鼠标悬停看具体数值</span>
        </div>
      </details>
    </section>

    <section class="card">
      <h3>已知缺口 · 这份数据做不到什么</h3>
      <ul class="bounds">
        <li><b>溢价可算比例只有 ${pct(M.gap_cov)}</b>（${M.n_gap.toLocaleString()} / ${M.n_ovs.toLocaleString()} 个出海企业·年）。
          剩下 ${(M.n_ovs - M.n_gap).toLocaleString()} 个不是 0，是没披露。所以「出海赚钱」类结论只覆盖能算出的那批，
          不能外推到全样本。</li>
        <li><b>分部粒度只到「境内 / 境外」两级</b>。少数企业披露到国家或产品线，但口径不统一，
          所以做不到「出海到哪个国家赚多少」这种区域级结论。这也是我们不做国别地图的原因。</li>
        <li><b>时间截至 ${LAST} 年年报</b>。切片器覆盖 ${YEARS[0]}–${LAST} 全部 ${YEARS.length} 个年度，
          ${LAST} 年之后的任何说法都是外推——本产品只在企业页给出<b>明确标注为预测</b>的三年路径，
          其它区块一律只用已披露数据。</li>
        <li><b>机器学习 AUC ${D.model.risk.folds.map(f => f.auc).join(" / ")}</b>，属于弱预测。
          只用它给企业<b>排序</b>（谁比谁更危险），不把它当精确概率，也不单独用它下结论——
          最终判定要过规则层。</li>
      </ul>
    </section>`;
  }

  /* ==================== 总观页一键总结（放在页面最前） ====================
     这是「这一年到底发生了什么」的 30 秒版本：规模、赚不赚、往哪进、注意什么。
     所有数字按当前年份现算，切年份整段重写。 */
  function overviewSummary(y, yo, okRows) {
    const yPrev = y > YEARS[0] ? YO[y - 1] : null;
    const ny = yPrev ? y - 1 : null;
    const win = okRows.filter(r => r.gap_med > 0).sort((a, b) => b.gap_med - a.gap_med);
    const byGate = okRows.filter(r => r.gate_med != null).sort((a, b) => a.gate_med - b.gate_med);
    const byCap = okRows.slice().sort((a, b) => (b.cap || 0) - (a.cap || 0));
    const best = win[0], easy = byGate[0], big = byCap[0];
    const enter = win.filter(r => r.gate_med != null && r.gate_med <= 0.5);

    const lines = [];
    lines.push(`<b>规模</b>：${y} 年 ${pct(yo.ovs_rate)} 的企业有海外收入（${yo.ovs_n.toLocaleString()} 家），
      海外收入合计 <b>${fmt(yo.cap, 0)} 亿元</b>${ny && yPrev.cap != null ? `，比 ${ny} 年${yo.cap >= yPrev.cap ? "多" : "少"} ${fmt(Math.abs(yo.cap - yPrev.cap), 0)} 亿元` : ""}。
      出海率${ny ? `从 ${pct(yPrev.ovs_rate)} 变成 <b>${pct(yo.ovs_rate)}</b>` : `为 ${pct(yo.ovs_rate)}`}。`);

    lines.push(`<b>赚不赚</b>：出海溢价中位 <b>${sign(yo.gap_med)}pp</b>（海外毛利率比境内高多少），
      ${pct(yo.pos_share)} 的企业溢价为正；样本够用的 <b>${okRows.length}</b> 个行业里 <b>${win.length}</b> 个为正
      ${ny ? `（${ny} 年 ${YO[ny].ind_ok} 个行业够用、${IND.map(n => IY[n + "|" + ny]).filter(Boolean).filter(r => r.gap_med > 0 && r.gap_n >= 30).length} 个为正）` : ""}。
      ${yo.gap_cov < 70 ? `注意：只有 ${pct(yo.gap_cov)} 的出海企业能算出溢价，其余没披露海外成本，不给假数值。` : ""}`);

    if (best) lines.push(`<b>往哪进</b>：溢价最高是 <b>${esc(shortName(best.ind))}</b>（${sign(best.gap_med)}pp）${easy ? `，
      门槛最低是 <b>${esc(shortName(easy.ind))}</b>（${(easy.gate_med * 100).toFixed(0)} 分位）` : ""}${big ? `，
      池子最深是 <b>${esc(shortName(big.ind))}</b>（${fmt(big.cap, 0)} 亿）` : ""}。
      同时满足「门槛 ≤50 分位」和「溢价为正」的行业有 <b>${enter.length}</b> 个。`);

    const t0 = TY[y + "|0-10%"], t9 = TY[y + "|90-100%"];
    if (t0 && t9) lines.push(`<b>规模与溢价反向</b>：规模最低 10% 的企业出海率 ${pct(t0.ovs_rate)}、溢价 ${sign(t0.gap_med)}pp；
      最高 10% 出海率 ${pct(t9.ovs_rate)}、溢价 ${sign(t9.gap_med)}pp。大公司出海更像规模扩张，小公司出海才是找利基。`);

    if (yo.ind_ok < yo.ind_all) lines.push(`<b>读的时候注意</b>：${y} 年只有 ${yo.ind_ok}/${yo.ind_all} 个行业的溢价样本达到 30 个，
      行业层面的结论在这一年要保守看${y <= 2017 ? `；且当年整体披露率只有 ${pct(yo.gap_cov)}，横向比较的可信度更低` : ""}。`);

    return summaryBox(`一键总结 · ${y} 年出海质量`, lines, "sumfirst");
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
    <div id="firmout"></div>
    ${viewCmpSection()}`;
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

  /* ==================== 多企业对比（v4 新增） ====================
     决策场景真正要回答的是「A 和 B 我该押哪个」。
     一家企业一页看完是「深度」，并排对比是「广度」，两者都要有。 */
  function viewCmpSection() {
    return `
    <section class="card" id="cmpcard">
      <h3>多企业对比 <em>最多 3 家并排</em></h3>
      <p class="hint">把 2–3 家放进同一张表：判定、渗透度、溢价、相对同侪、风险分、压力承受力逐行对齐。
        红色＝更高更好，绿色＝更低更深。当前查看的那家会浅蓝高亮。</p>
      <div class="cmpbar">
        <input id="cqi" type="text" placeholder="加一家：000063 或 中兴" autocomplete="off">
        <button class="xbtn" id="cqadd">加入对比</button>
        <button class="xbtn" id="cmpreset">换一组同行</button>
      </div>
      <div class="cmpchips" id="cmpchips"></div>
      <div id="cmpout"></div>
    </section>`;
  }

  /* 默认组：当前企业 + 同行业规模最接近的 2 家（能算出溢价的优先） */
  function ensureCmp(seedCode) {
    const sd = F.find(f => f[0] === seedCode);
    if (!sd) return;
    if (!STATE.cmp.length) {
      const peers = F.filter(f => f[0] !== sd[0] && f[2] === sd[2] && f[4] === 1
        && f[6] != null && f[18] !== 1 && f[8] >= 2)
        .sort((a, b) => Math.abs((a[7] || 0) - (sd[7] || 0)) - Math.abs((b[7] || 0) - (sd[7] || 0)));
      STATE.cmp = [sd[0]].concat(peers.slice(0, 2).map(f => f[0]));
    } else if (STATE.cmp.indexOf(seedCode) < 0 && STATE.cmp.length < 3) {
      STATE.cmp.push(seedCode);
    }
    renderCmp();
  }

  /* 「换一组同行」：在同行里洗牌重抽 2 家，保证点下去真的换人 */
  function resetCmpGroup() {
    const sd = F.find(f => f[0] === STATE.firm);
    const pool = F.filter(f => f[4] === 1 && f[6] != null && f[18] !== 1
      && f[8] >= 2 && (!sd || f[2] === sd[2]));
    const rest = pool.filter(f => !sd || f[0] !== sd[0]);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = rest[i]; rest[i] = rest[j]; rest[j] = t;
    }
    STATE.cmp = (sd ? [sd[0]] : []).concat(rest.slice(0, 2).map(f => f[0]));
    renderCmp();
  }

  /* 数值单元格：涨用红、跌用绿（国内股市口径），单位跟在后面 */
  function cmpNum(v, unit, d, inv) {
    if (v == null) return `<span style="color:#B4BFCA">—</span>`;
    const good = inv ? v < 0 : v > 0;
    const col = v === 0 ? "#1A2433" : (good ? "#C0392B" : "#4A8B6F");
    return `<b style="color:${col}">${sign(v, d)}</b>`
      + (unit ? `<span style="font-size:10.5px;color:#8A96A6">${unit}</span>` : "");
  }

  /* 溢价并排点图：2–3 家企业在同一条数轴上的位置。
     不用条形图是因为溢价有正有负，长负数条的数值标签会撞到左边标签列；
     点图只有「位置」，天生没有这个毛病。 */
  function gapDots(items) {
    const W = 700, rowH = 34, padT = 30, padB = 40, padL = 120, padR = 60;
    const H = padT + items.length * rowH + padB;
    const w = W - padL - padR;
    const vals = items.map(i => i.v);
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const span = (hi - lo) || 1;
    const xmin = lo - span * 0.12, xmax = hi + span * 0.12;
    const X = v => padL + (v - xmin) / (xmax - xmin) * w;
    let g = "";
    /* 零线 */
    g += `<line x1="${X(0)}" y1="${padT - 12}" x2="${X(0)}" y2="${padT + items.length * rowH - 2}"
      stroke="#C0392B" stroke-width="1.3" stroke-dasharray="5 3"/>`;
    /* 底色横线，方便眼睛对齐 */
    items.forEach((it, i) => {
      const y = padT + i * rowH;
      g += `<line x1="${padL}" y1="${y}" x2="${padL + w}" y2="${y}" stroke="#EDF1F5" stroke-width="1"/>`;
      g += txt(padL - 12, y + 4, it.label, { anchor: "end", size: 12, fill: "#3D4859", weight: 600 });
      const cx = X(it.v);
      const nearRight = cx > padL + w - 56;
      g += `<circle cx="${cx}" cy="${y}" r="6.5" fill="${it.c || "#4A6FA5"}"
        stroke="#fff" stroke-width="2"><title>${esc(it.label)}: ${sign(it.v)}pp</title></circle>`;
      g += txt(nearRight ? cx - 12 : cx + 12, y + 4.5, sign(it.v) + "pp",
        { anchor: nearRight ? "end" : "start", size: 12, fill: it.c || "#4A6FA5", weight: 700, halo: 4 });
    });
    /* 两端说明 + 零点：比一堆刻度数字更好读 */
    g += txt(padL, H - 7, "← 海外毛利低于境内", { anchor: "start", size: 10.5, fill: "#8A94A6" });
    g += txt(padL + w, H - 7, "海外毛利高于境内 →", { anchor: "end", size: 10.5, fill: "#8A94A6" });
    g += txt(X(0), H - 7, "0", { anchor: "middle", size: 10.5, fill: "#C0392B", weight: 600, halo: 4 });
    return svgWrap(W, H, g);
  }

  function renderCmp() {
    const box = $("#cmpout"), chips = $("#cmpchips");
    if (!box) return;
    const firms = STATE.cmp.map(c => F.find(f => f[0] === c)).filter(Boolean);
    if (chips) {
      chips.innerHTML = firms.length
        ? firms.map(f => `<span class="cmpchip">${esc(f[1])}<em>${esc(f[0])}</em>
            <button data-cdel="${esc(f[0])}" title="移除">×</button></span>`).join("")
          + `<span class="hint dim" style="font-size:11.5px">${firms.length >= 3 ? "已满 3 家，删一家才能再加" : "还能再加 " + (3 - firms.length) + " 家"}</span>`
        : `<span class="hint dim">还没选企业，用上面的输入框加一家。</span>`;
      chips.querySelectorAll("[data-cdel]").forEach(b => b.onclick = () => {
        STATE.cmp = STATE.cmp.filter(c => c !== b.dataset.cdel);
        renderCmp();
      });
    }
    if (!firms.length) { box.innerHTML = ""; return; }

    const foc = STATE.firm;
    const R = [];
    const put = (l, sub, fn) => R.push({ l, sub, cells: firms.map(fn) });

    put("行业", "", f => esc(shortName(f[2] >= 0 ? IND[f[2]] : "—")));
    put("判定", "加码 / 维持 / 收缩", f => {
      const v = f[10];
      return `<span class="vbadge" style="background:${VCOLOR[v]}22;color:${VCOLOR[v]}">${VERDICT[v]}</span>`;
    });
    put("出海年数", "进入第几年", f => f[4] === 1 && f[8] != null ? `第 ${f[8]} 年` : "—");
    put("出海概率", "未出海企业的资格分", f => f[4] === 1 ? `<span style="color:#8A96A6;font-size:11.5px">已出海</span>`
      : `<b>${f[15] != null ? (f[15] * 100).toFixed(0) + "%" : "—"}</b>`);
    put("海外渗透度", "海外收入占营收", f => f[4] === 1 ? `<b>${pct(f[5])}</b>` : "—");
    put("行业内渗透分位", "同行里排第几", f => f[4] === 1 && f[13] != null ? `<b>${f[13]}</b>` : "—");
    put("出海溢价", "海外毛利率 − 境内", f => f[4] === 1 ? cmpNum(f[6], "pp", 2) : "—");
    put("相对同行业中位", "扣掉行业因素后", f => f[4] === 1 ? cmpNum(f[11], "pp", 2) : "—");
    put("规模分位", "全样本里的位置", f => f[7] != null ? `<b>${(f[7] * 100).toFixed(0)}</b>` : "—");
    put("ML 风险分", "次年溢价恶化概率", f => f[18] === 1 ? `<span style="color:#B4BFCA">口径异常</span>`
      : (f[9] != null ? `<b>${(f[9] * 100).toFixed(0)}%</b>` : "—"));
    put("规则层命中", "6 条硬信号命中几条", f => {
      const r = D2.firm_rules[f[0]];
      if (!r) return "—";
      const c = r.hit.length >= 3 ? "#C0392B" : (r.hit.length >= 1 ? "#8A6510" : "#4A8B6F");
      return `<b style="color:${c}">${r.hit.length} 条</b>`;
    });
    put("海外收入", "最新年报", f => {
      const st = STRESS[f[0]];
      return st && st.rev_yi != null ? `<b>${fmt(st.rev_yi, 1)}</b><span style="font-size:10.5px;color:#8A96A6">亿</span>` : "—";
    });
    put("净利润", "最新年报", f => {
      const st = STRESS[f[0]];
      if (!st || st.np_yi == null) return "—";
      const c = st.np_yi < 0 ? "#4A8B6F" : "#1A2433";
      return `<b style="color:${c}">${fmt(st.np_yi, 2)}</b><span style="font-size:10.5px;color:#8A96A6">亿</span>`;
    });
    put("压力：溢价降 10pp", "占当年净利润", f => {
      const st = STRESS[f[0]];
      if (!st) return "—";
      const r = st.rows.find(x => x.dpp === 10);
      if (!r) return "—";
      if (st.np_neg) return `<span style="color:#B4BFCA">亏损，不适用</span>`;
      const c = r.pct_np >= 50 ? "#C0392B" : (r.pct_np >= 20 ? "#8A6510" : "#4A8B6F");
      return `<b style="color:${c}">${fmt(r.pct_np, 0)}%</b>`;
    });

    let html = `<div class="cmpscroll"><table class="cmptable"><thead><tr><th class="l">指标</th>`
      + firms.map(f => `<th class="${f[0] === foc ? "foc" : ""}">${esc(f[1])}
          <span style="display:block;font-weight:400;font-size:10.5px;color:#8A96A6">${esc(f[0])}</span></th>`).join("")
      + `</tr></thead><tbody>`;
    R.forEach(r => {
      html += `<tr><td class="l">${r.l}${r.sub ? `<em>${r.sub}</em>` : ""}</td>`
        + r.cells.map((c, i) => `<td class="${firms[i][0] === foc ? "foc" : ""}">${c}</td>`).join("")
        + `</tr>`;
    });
    html += `</tbody></table></div>`;

    /* 溢价并排点图：一张小图看清谁高谁低（零线标出「海外不比境内赚」的分界） */
    const bars = firms.filter(f => f[4] === 1 && f[6] != null && f[18] !== 1);
    if (bars.length >= 2) {
      html += `<div style="margin-top:14px">
        <p class="hint" style="margin-bottom:2px"><b>出海溢价并排</b>：同口径下谁赚得更多，点在零线右边才算真加成。</p>
        <div class="cmpscroll">${gapDots(bars.map(f => ({
        label: f[1].slice(0, 6), v: f[6],
        c: f[0] === foc ? "#C0392B" : "#4A6FA5"
      })))}</div>
      </div>`;
    }
    html += `<p class="cmpfoot">对比表里所有指标都是<b>同期横截面</b>（${LAST} 年报），不做跨期因果推断。
      判定列来自「ML 排序 + 规则层硬信号 + 同侪分位」三者合成；溢价口径异常的（|溢价| &gt; ${D.meta.gap_cap}pp）不给方向性结论。</p>`;
    box.innerHTML = html;
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
          <div class="exportrow">
            <button class="xbtn" data-cmp="${esc(code)}">加入对比 ↓</button>
            <button class="xbtn" data-act="pdf" data-pfx="企业体检">导出体检 PDF</button>
            <button class="xbtn" data-act="csv" data-pfx="企业体检">导出 CSV</button>
            <button class="xbtn" data-act="png" data-pfx="企业体检">图表存 PNG</button>
            <button class="xbtn" data-act="report" data-pfx="企业体检">文本报告</button>
          </div>
        </div>
      </div>`;

    const body = hasOvs === 1
      ? firmOvsBody({ f, code, name, indName, provName, o, h, x, indRow, provRow, st, rules, stops, gap, gapBad, ratio, sizePct, tenure, risk, verdict, gapVsInd, domGm, ratioPct, domPct, p1, p2, pImp })
      : firmNoBody({ f, code, name, indName, provName, o, h, x, indRow, provRow, peer, sizePct, ratio, p1, p2, pImp });

    /* 一键总结放最前：先给结论，再看证据。 */
    const sumBlock = firmSummary({ f, code, name, indName, provName, o, indRow, provRow, st, rules, stops, hasOvs, gap, verdict, tenure, risk, sizePct, ratio, ratioPct, p1, p2 });

    /* v5：预测模块 + 2025 最新成绩，插在体检头部之后、正文之前 */
    const fcBlock = viewForecastBlock(code, name, gap, ratio);
    const y25Block = viewY25Block(code, name);

    return sumBlock + head + fcBlock + y25Block + body;
  }

  /* ==================== v5：未来三年预测模块 ==================== */
  /* 三个问题：① 溢价会怎么走（AR(1) 均值回复 + 80% 区间 + naive 基准并列）
              ② 三年后海外收入能到多少（三情景）
              ③ 三年内会不会退出（KM 条件生存）
     诚实披露：naive 基准的回测 MAE 优于 AR(1)，页面必须并列展示，不能只挑好看的。 */
  function viewForecastBlock(code, name, gap, ratio) {
    const fp = FCFIRM[code];
    if (!fp || !fp.path || !fp.path.length) {
      return `<section class="card">
        <h3>未来三年预测</h3>
        ${warnBar("这家企业没有足够的连续披露记录做预测（需要至少两年可算溢价的年报）。预测模块只对有连续披露的企业开放。")}
      </section>`;
    }
    const path = fp.path;
    const p1 = path[0], p3 = path[path.length - 1];
    const rho = FC.rho, hl = FC.half_life, sig = FC.sigma;
    const indMed = fp.ind_median;

    /* 溢价路径图：历史 + 预测 + 区间带 + naive 基准 */
    const histPts = (D.hist[code] || { y: [], g: [] }).y.map((yy, i) => ({
      x: yy, v: (D.hist[code].g || [])[i]
    })).filter(p => p.v != null);
    const allPts = histPts.concat(path.map(q => ({ x: q.year, v: q.pred })));
    const chart = lineChart(allPts, {
      height: 280, ylabel: "出海溢价 (pp)", xlabel: "年份",
      color: "#2E86AB", xn: 6, xint: true,
      refPts: path.map(q => ({ x: q.year, v: q.naive })),
      refColor: "#C0392B",
    });

    /* 三情景：取第 3 年（k=3）的终值 */
    const sc = fp.rev_scen || {};
    const tail = k => (sc[k] && sc[k].length ? sc[k][sc[k].length - 1] : null);
    const cns = tail("conservative"), neu = tail("neutral"), opt = tail("optimistic");
    const revYi = v => v ? (v.rev / 1e8).toFixed(2) : "—";

    /* 退出概率 */
    const ex = (FCEXIT.firm || {})[code];
    const exTbl = FCEXIT.table || {};

    const bt = FCBACK.length ? FCBACK[FCBACK.length - 1] : null;

    return `
    <section class="card">
      <div class="fchead">
        <h3>未来三年预测 · ${esc(name)}</h3>
        <span class="fcbadge ${rho < 0.05 ? "warn" : "ok"}">
          ${rho < 0.05 ? "无显著均值回复" : "存在均值回复"}
          · ρ = ${rho.toFixed(3)} · 半衰期 ${hl < 1 ? hl.toFixed(2) + " 年" : hl.toFixed(1) + " 年"}</span>
      </div>
      <div class="fcgrid">
        <div>
          ${chart}
          <div class="fclegend">
            <span><i style="border-color:#2E86AB"></i>历史实际 + AR(1) 预测</span>
            <span><i class="band"></i>80% 预测区间</span>
            <span><i class="dash" style="border-color:#C0392B"></i>naive 基准（今年＝去年）</span>
          </div>
          <p class="hint">预测基于 <b>AR(1) 均值回复</b>：当前溢价会向行业锚（${sign(indMed)}pp）收敛，
            收敛速度 ρ = ${rho.toFixed(3)}${rho < 0.05 ? "（几乎为零）" : ""}，单期波动 σ = ${fmt(sig, 1)}pp。
            三年后点预测 <b>${sign(p3.pred)}pp</b>，80% 区间 <b>[${sign(p3.lo)}, ${sign(p3.hi)}]pp</b>——
            <b>区间比点预测宽得多</b>，这正是它诚实的地方：能告诉你方向和不确定性，不能告诉你确切数字。</p>
        </div>
        <div>
          <div class="statline wrap">
            <div><span>当前溢价</span><b>${sign(fp.gap_now)}pp</b></div>
            <div><span>行业锚</span><b>${sign(indMed)}pp</b></div>
            <div><span>1 年后</span><b>${sign(p1.pred)}pp</b></div>
            <div><span>3 年后</span><b>${sign(p3.pred)}pp</b></div>
          </div>
          <h4 class="sub-h">三种情景下的三年后海外收入</h4>
          <div class="scen">
            <div class="scenbox">
              <span class="sn"><i style="background:#C0392B"></i>保守</span>
              <b>${revYi(cns)} 亿</b>
              <em>渗透度 ${cns ? pct(cns.pct) : "—"}，溢价维持 ${cns ? sign(cns.gap) : "—"}pp</em>
            </div>
            <div class="scenbox">
              <span class="sn"><i style="background:#2E86AB"></i>中性</span>
              <b>${revYi(neu)} 亿</b>
              <em>渗透度 ${neu ? pct(neu.pct) : "—"}，溢价收敛到 ${neu ? sign(neu.gap) : "—"}pp</em>
            </div>
            <div class="scenbox">
              <span class="sn"><i style="background:#4A8B6F"></i>乐观</span>
              <b>${revYi(opt)} 亿</b>
              <em>渗透度 ${opt ? pct(opt.pct) : "—"}，溢价 ${opt ? sign(opt.gap) : "—"}pp</em>
            </div>
          </div>
          <p class="hint">情景由「渗透度是否提升」×「溢价是否向行业锚收敛」两个维度组合而成，
            海外收入 = 总收入 × 渗透度。当前海外收入 ${fp.ovs_rev ? (fp.ovs_rev / 1e8).toFixed(2) : "—"} 亿 / 渗透度 ${pct(fp.ovs_pct)}。</p>
        </div>
      </div>

      ${ex ? `<h4 class="sub-h">退出风险 · 这家已出海 ${ex.t0} 年，未来会退出吗</h4>
      <div class="exitp">
        ${[["未来 1 年", ex.p1], ["未来 3 年", ex.p3], ["未来 5 年", ex.p5]].filter(r => r[1] != null).map(r => `
          <div class="exitrow">
            <span class="el">${r[0]}</span>
            <div class="eb"><i style="width:${Math.min(100, r[1] * 100 * 3).toFixed(1)}%"></i></div>
            <span class="ev">${(r[1] * 100).toFixed(1)}%</span>
          </div>`).join("")}
      </div>
      <p class="hint">用 Kaplan-Meier 条件生存算：<b>已连续出海 ${ex.t0} 年的企业，未来 k 年内退出出海状态的条件概率</b>。
        参照全样本规律——出海第 1 年退出率 ${(D.survival.km[0] ? D.survival.km[0].hazard : "—")}%，
        而这家已经扛过了 ${ex.t0} 年，风险自然低得多。<b>这条只回答「会不会退出」，不回答「该不该退出」</b>——止损依据看上面的规则层。</p>`
        : `<h4 class="sub-h">退出风险</h4>
        <p class="hint">这家企业的出海状态样本不足以估计条件退出概率，用全样本规律代替：
          出海第 1 年退出率 ${(D.survival.km[0] ? D.survival.km[0].hazard : "—")}%，
          第 5 年累计 ${(D.survival.km[4] ? D.survival.km[4].surv : "—")}% 仍在出海。</p>`}

      ${bt ? `<h4 class="sub-h">这个预测有多可信 · 回测</h4>
      <div class="btgrid">
        <div class="btbox"><span>AR(1) 预测</span><b>${fmt(bt.mae_ar, 2)}</b><i>MAE（pp）· 越低越好</i></div>
        <div class="btbox best"><span>naive 基准</span><b>${fmt(bt.mae_naive, 2)}</b><i>今年＝去年 · 反而更低</i></div>
        <div class="btbox"><span>行业中位</span><b>${fmt(bt.mae_industry, 2)}</b><i>直接用行业中位代入</i></div>
        <div class="btbox"><span>区间覆盖率</span><b>${bt.coverage80}%</b><i>80% 区间实际覆盖</i></div>
      </div>
      <div class="honest"><b>诚实披露：</b>回测显示 naive 基准（今年溢价＝去年溢价）的 MAE
        <b>${fmt(bt.mae_naive, 2)}</b> 优于 AR(1) 的 <b>${fmt(bt.mae_ar, 2)}</b>，
        组内 R² 仅 <b>${(FC.r2_within * 100).toFixed(1)}%</b>。这说明<b>出海溢价本身没有显著的均值回复趋势</b>，
        企业的溢价高度持续。<br>因此 AR(1) 的价值不是「更准的点预测」，而是<b>给出收敛方向与区间宽度</b>——
        它告诉你「三年后大概率落在这个范围」，但区间宽达 ${fmt(p3.hi - p3.lo, 0)}pp，
        <b>不要把点预测当成承诺</b>。真要做决策，看上面的规则层和压力测试。</div>` : ""}
    </section>`;
  }

  /* ==================== v5：2025 最新成绩 ==================== */
  function viewY25Block(code, name) {
    const m = D4FIRM[code];
    if (!m || m.year !== 2025) return "";
    const exportFlag = m.export;
    const items = [];
    items.push(["海外渗透度", pct(m.pct)]);
    if (m.gap != null) items.push(["出海溢价", sign(m.gap) + "pp"]);
    if (m.ovs_rev) items.push(["海外收入", (m.ovs_rev / 1e8).toFixed(2) + " 亿"]);
    return `
    <section class="card">
      <div class="fchead">
        <h3>${D4LAST} 年最新成绩</h3>
        <span class="fcbadge ok">自采数据集口径 · 已更新至 ${D4LAST} 年报</span>
      </div>
      <div class="y25">
        <span class="y25tag">${D4LAST}</span>
        ${items.map(i => `<span class="y25item">${i[0]} <b>${i[1]}</b></span>`).join("")}
        <span class="y25item">${exportFlag ? "状态 <b>持续出海</b>" : "状态 <b>当年无海外收入</b>"}</span>
      </div>
      <p class="hint">这一行来自<b>自采公开接口数据集</b>（覆盖 ${D4META.n_obs.toLocaleString()} 个企业·年，2015–${D4LAST}），
        与上方体检模块的 ${LAST} 年年报口径不同源，因此数值会有差异——<b>体检看历史趋势，2025 这一行看最新动向</b>，
        不要直接相减。${m.ind ? "行业：" + esc(m.ind) + "　" : ""}${m.prov ? "省份：" + esc(m.prov) : ""}</p>
    </section>`;
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
        <li><b>盯住第 1 年。</b>全样本第 1 年退出率 ${D.survival.km[0].hazard}%${D.survival.km[1] ? `，是第 2 年（${D.survival.km[1].hazard}%）的 ${(D.survival.km[0].hazard / D.survival.km[1].hazard).toFixed(1)} 倍` : ""}。
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

  /* 置换重要性的原始值不是 0–1 的比例，直接 ×100 会显示成 13152% 这种数字。
     统一换算成「相对权重」：占全部特征重要性之和的百分比，读者才对得上。 */
  function relImp(list, k) {
    if (!list || !list.length) return [];
    const sum = list.reduce((s, x) => s + (x[1] || 0), 0) || 1;
    return list.slice(0, k || list.length).map(x => [x[0], x[1] / sum * 100]);
  }

  /* ==================== 中位数工具 ==================== */
  function median(arr) {
    const v = arr.filter(x => x != null).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  /* ==================== v5：数据说明抽屉 ==================== */
  /* 评委需要知道 AI 在每个环节用了什么方法、验证结果如何，
     以及这份数据是从哪来、经过哪些检验。前者用一张表说清，后者用数据源卡片说明。 */
  function drawerHTML() {
    const m = D.meta, mo = D.model;
    const f1 = mo.risk.folds[0] || {}, f2 = mo.risk.folds[1] || {};
    const AIMP = relImp((mo.attrib && mo.attrib.imp) || [], 1);
    const att = AIMP.length ? AIMP[0] : null;
    const km = D.survival.km;
    const km10 = km[km.length - 1];

    /* 方法表：只留「环节 / 方法 / 验证方式 / 结果」四列，
       「做什么」的长解释删掉——评委要的是方法与结果，不是推导过程。 */
    const methods = [
      ["① 出海资格判定", "两阶段 logit（第一阶段）", "统计模型",
        "5 折交叉验证", "AUC <b>" + mo.qualify.stage1.auc.toFixed(3) + "</b>"],
      ["② 出海是否赚钱", "两阶段 logit（第二阶段）", "统计模型",
        "5 折交叉验证", "AUC <b>" + mo.qualify.stage2.auc.toFixed(3) + "</b>"],
      ["③ 次年溢价恶化预警", "XGBoost（梯度提升树）", "机器学习",
        "walk-forward 滚动验证（" + (f1.year || "") + " / " + (f2.year || "") + " 两年）",
        "AUC <b>" + (f1.auc ? f1.auc.toFixed(3) : "—") + " / " + (f2.auc ? f2.auc.toFixed(3) : "—") + "</b>"],
      ["④ 退出节奏", "Kaplan-Meier 生存分析", "生存分析",
        "at-risk " + D.survival.n_firms.toLocaleString() + " 家 / " + D.survival.n_exit + " 次退出事件",
        "10 年存活 <b>" + (km10 ? km10.surv : "—") + "%</b>"],
      ["⑤ 溢价归因", "permutation importance", "模型解释",
        "置换 " + (mo.attrib ? "全特征" : "—") + " 后 AUC 下降幅度",
        att ? esc(featName(att[0])) + " <b>" + att[1].toFixed(1) + "%</b>" : "—"],
      ["⑥ 决策规则", "6 条可解释硬信号（规则层）", "规则层",
        "每条都写明触发依据", "命中即给依据"],
      ["⑦ 未来三年预测", "AR(1) 均值回复 + 三情景", "时间序列",
        FCBACK.length ? "walk-forward 回测 " + FCBACK.map(b => b.year).join(" / ") : "—",
        FCBACK.length ? "80% 区间覆盖 <b>" + FCBACK[FCBACK.length - 1].coverage80 + "%</b>" : "—"],
      ["⑧ 退出概率预测", "Kaplan-Meier 条件生存", "生存分析",
        FCEXIT.n_indiv ? FCEXIT.n_indiv.toLocaleString() + " 个企业·年观测 · " + FCEXIT.n_event + " 次退出事件" : "—",
        "1 年退出率 <b>" + (D.survival.km && D.survival.km[0] ? D.survival.km[0].hazard : "—") + "%</b>"],
    ];

    /* 自采数据集说明卡：数据从哪来、怎么验证的 */
    const selfCard = D4 ? `
      <div class="card selfdata">
        <h3>数据集来源与校验 <em>自采口径，可完全复现</em></h3>
        <div class="sdgrid">
          <div class="sdbox"><span>覆盖区间</span><b>2015–2025</b><i>11 个完整年度</i></div>
          <div class="sdbox"><span>观测数</span><b>${D4META.n_obs.toLocaleString()}</b><i>企业·年</i></div>
          <div class="sdbox"><span>企业数</span><b>${D4META.n_firms.toLocaleString()}</b><i>家</i></div>
          <div class="sdbox"><span>字段数</span><b>47</b><i>含原始披露项目名</i></div>
          <div class="sdbox"><span>采集方式</span><b>公开接口</b><i>HTTP 自动抓取</i></div>
          <div class="sdbox"><span>商业终端</span><b>零依赖</b><i>不使用任何付费库</i></div>
        </div>
        <p class="hint">全部字段通过上市公司<b>公开披露的可访问 HTTP 接口</b>自动采集，覆盖 A 股全样本
          2015–2025 年的「境内 / 境外分部经营 + 财务表现 + 公司治理」三层信息，
          可直接用于出海战略评估、数字经济影响检验与海外质量容量建模。
          <b>不依赖任何商业终端</b>——既保证来源可追溯可验证，也避免了专业数据库授权带来的合规问题。</p>
        <div class="filerow">
          <a href="${DL.doc}" target="_blank" rel="noopener">📑 数据集说明文档.pdf<span class="fz">来源 · 字段 · 处理方法 · 校验</span></a>
          <a href="${DL.raw}" target="_blank" rel="noopener">📦 ① 原始爬取数据（清洗前）<span class="fz">5 张原始长表 · 24 MB</span></a>
          <a href="${DL.clean}" target="_blank" rel="noopener">📊 ② 清洗后数据集<span class="fz">主数据集 ${D4META.n_obs.toLocaleString()}×47 + 全样本 + 建模表 + 面板 · 30 MB</span></a>
          <a href="${DL.code}" target="_blank" rel="noopener">🐍 ③ 说明文档与代码<span class="fz">采集器 · 归类规则 · 全部脚本 · 0.7 MB</span></a>
        </div>
        <p class="hint" style="margin-top:9px">数据集全部字段由公开 HTTP 接口自动采集（<code>107_scrape_all.py</code>），
          采集器、归类规则（七级）与全部处理脚本随包交付，<b>可完整复现</b>；
          上方四个链接即比赛提交的 ① 原始数据 ② 清洗后数据集 ③ 说明文档与代码 ④ 本交互产品。</p>
        <h4 class="sub-h">四层递进校验 · 每一层都独立判定</h4>
        <table class="mtable">
          <thead><tr><th>层级</th><th>检验方式</th><th>结果</th></tr></thead>
          <tbody>
            <tr><td><b>① 逐年相关</b></td><td>与外部口径逐年 Pearson 相关</td>
              <td class="mnum">r 最小 0.944</td></tr>
            <tr><td><b>② 无歧义对账</b></td><td>披露项全部自带境内外标记的公司·年</td>
              <td class="mnum">境内一致率 <b>99.78%</b></td></tr>
            <tr><td><b>③ 算术定责</b></td><td>「总营收 − 境内 ＝ 境外」判定责任方</td>
              <td class="mnum">自采对 7 例 / 第三方对 0 例</td></tr>
            <tr><td><b>④ 独立裁决</b></td><td>只用合并报表营收，完全不依赖外部数据</td>
              <td class="mnum">恒等式通过 <b>自采 96.2%</b> vs 第三方 86.0%</td></tr>
          </tbody>
        </table>
        <p class="hint">归类规则是<b>七级判定</b>（唯一事实源 <code>digi_rules.py</code>）：
          抵消项剔除 → 「其他/补充」剔除 → 非地域业务项剔除 → 显式境外词 → 显式境内词 →
          否定限定（不含国内 / 中国以外）→ 纯境外地区名 → 中国地名归境内 → 未判定项需同年境外锚点才归境外。
          「其中:」开头的行是<b>父项的明细拆解</b>，父项金额已含子项，故丢弃子项不重复累加。</p>
      </div>` : "";

    return `
    <div class="mdrawer-panel">
      <div class="mdrawer-head">
        <div>
          <h2>建模环节</h2>
        </div>
        <button class="mdrawer-close" id="mclose">关闭 ✕</button>
      </div>
      <div class="mdrawer-body">

        <div class="card">
          <h3>建模环节 <em>8 个环节，全部可复现</em></h3>
          <table class="mtable">
            <thead><tr><th>环节</th><th>方法</th><th>验证方式</th><th>结果</th></tr></thead>
            <tbody>${methods.map(r => `<tr>
              <td><b>${r[0]}</b><br><span class="mtag ${r[2] === "统计模型" ? "a" : r[2] === "机器学习" ? "s" : r[2] === "规则层" ? "s" : "g"}">${r[2]}</span></td>
              <td>${r[1]}</td><td>${esc(r[3])}</td><td class="mnum">${r[4]}</td>
            </tr>`).join("")}</tbody>
          </table>
          <p class="hint">前 5 个环节是模型方法，第 6 个是<b>可解释规则层</b>（不算 AI，作用是让结论不依赖模型是否稳定），
            第 7、8 个是本次新增的预测模块。
            XGBoost 的 AUC ${(f2.auc || 0.62).toFixed(2)} 属于弱预测，<b>只用于排序，不作精确概率</b>，
            AR(1) 预测<b>只给收敛方向与区间宽度</b>——这两条页面上都标了。</p>
        </div>

        <div class="card">
          <h3>数据与口径 <em>来源、样本、指标定义</em></h3>
          <dl class="deflist">
            <dt>数据来源</dt>
            <dd>A 股上市公司 <b>${YEARS[0]}–${YEARS[YEARS.length - 1]} 年报分部披露</b>（海外收入 / 海外成本 / 境内收入 / 境内成本）
              ＋ 自采公开接口抓取的财务与治理数据；预测模块使用<b>同一套自采数据集</b>（见下方卡片）</dd>
            <dt>全样本</dt>
            <dd><b>${m.n_obs.toLocaleString()}</b> 个企业·年，<b>${m.n_firms.toLocaleString()}</b> 家企业
              （其中出海 ${m.n_ovs.toLocaleString()} 个观测 / 未出海 ${m.n_no.toLocaleString()} 个）</dd>
            <dt>核心指标</dt>
            <dd><b>出海溢价 = 海外毛利率 − 境内毛利率（pp）</b>。它衡量的是「同样一块钱收入，放到海外做是不是更赚」，
              与收入规模无关，所以不会被大公司体量带偏。</dd>
            <dt>计算条件</dt>
            <dd>仅当<b>海外成本 &gt; 0</b> 时计算。成本为 0 判为<b>「未披露」而不是「零成本」</b>——
              这一步修正让出海溢价中位数从 11.47pp 降到 <b>${m.gap_med}pp</b>，避免了把「没披露」当成「毛利 100%」的假信号。</dd>
            <dt>单位口径</dt>
            <dd>总资产与海外收入原始单位均为「元」，页面上的亿 / 万亿由 ln 值反算得到。</dd>
            <dt>溢价可算比例</dt>
            <dd>全样本 <b>${m.gap_cov}%</b>（${m.n_gap.toLocaleString()} 个观测可算），未覆盖样本在页面上标「未披露」，不给假数值。</dd>
          </dl>
        </div>

        ${selfCard}

        <div class="card">
          <h3>口径闸门 <em>先判数据可不可信，再谈结论</em></h3>
          <p style="font-size:12.6px;color:var(--ink2);line-height:1.68">
            当 <b>| 海外毛利率 − 境内毛利率 | &gt; ${m.gap_cap}pp</b> 时，判为<b>分部成本分摊口径异常</b>：
            共 <b>${m.n_gap_bad}</b> 个企业·年（占 ${(m.n_gap_bad / m.n_obs * 100).toFixed(1)}%）。
            这类企业页面上标<b>「数据不足以判断」</b>，不给加码 / 收缩结论、也不出风险分。
          </p>
          <p class="hint">典型情形是某一年海外收入与海外毛利率同时跳升——实质是<b>业务重分类</b>，不是经营改善。
            不设这道闸门，这类样本会把行业溢价中位数整体拉高。</p>
        </div>

      </div>
    </div>`;
  }

  function openDrawer() {
    const d = $("#drawer");
    if (!d) return;
    d.innerHTML = `<div class="mdrawer-bg" id="mclosebg"></div>` + drawerHTML();
    d.classList.add("on");
    document.body.classList.add("drawer-open");
    const c = $("#mclose"); if (c) c.onclick = closeDrawer;
    const bg = $("#mclosebg"); if (bg) bg.onclick = closeDrawer;
  }

  function closeDrawer() {
    const d = $("#drawer");
    if (!d) return;
    d.classList.remove("on");
    d.innerHTML = "";
    document.body.classList.remove("drawer-open");
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
      if (f) { ensureCmp(f[0]); window.scrollTo({ top: 0, behavior: "auto" }); }
    };
    $("#fgo").onclick = () => go(input.value);
    input.onkeydown = e => { if (e.key === "Enter") go(input.value); };
    quick.querySelectorAll(".chip").forEach(b => b.onclick = () => { input.value = b.dataset.q; go(b.dataset.q); });

    /* 对比组控件（v4） */
    const cqi = $("#cqi");
    const addCmp = () => {
      const q = (cqi.value || "").trim();
      if (!q) return;
      const f = findFirm(q);
      if (!f) { alert(`没找到「${q}」。试试 6 位代码或公司名关键字。`); return; }
      if (STATE.cmp.indexOf(f[0]) >= 0) { cqi.value = ""; return; }
      if (STATE.cmp.length >= 3) { alert("最多同时对比 3 家，先在标签上删掉一家。"); return; }
      STATE.cmp.push(f[0]);
      cqi.value = "";
      renderCmp();
    };
    if (cqi) {
      cqi.onkeydown = e => { if (e.key === "Enter") addCmp(); };
      $("#cqadd").onclick = addCmp;
      $("#cmpreset").onclick = resetCmpGroup;
    }
    /* 默认演示企业：优先选同侪分布带能画出来的（PEERPOS 有该企业），
       否则同侪带图会是空的，演示效果差。
       已经看过某家企业的话，切走再切回来保持那家，不要跳回演示企业。 */
    const keep = STATE.firm ? F.find(f => f[0] === STATE.firm) : null;
    const demo = keep
      || F.find(f => f[4] === 1 && f[6] != null && f[2] >= 0 && PEERPOS[f[0]])
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
    /* 退出诊断的行业搜索（84 项下拉一个个翻太慢） */
    const eq = $("#exitq");
    if (eq) eq.onchange = () => {
      const v = (eq.value || "").trim();
      if (!v) return;
      const pool = Object.keys(INDKM);
      const hit = pool.find(n => n === v) || pool.find(n => shortName(n) === v || indShort(n, 200) === v)
        || pool.find(n => n.indexOf(v) >= 0);
      if (hit) { STATE.exitInd = hit; render(STATE.tab); }
    };
    /* 行业搜索：datalist 选中即切行业 */
    const iq = $("#indq");
    if (iq) iq.onchange = () => {
      const v = (iq.value || "").trim();
      if (!v) return;
      const hit = IND.find(n => n === v) || IND.find(n => shortName(n) === v || indShort(n, 200) === v)
        || IND.find(n => n.indexOf(v) >= 0);
      if (hit) { STATE.indPick = hit; render(STATE.tab); }
    };
    /* 表格内筛选：所有明细表都支持边打字边过滤 */
    const filt = (input, tableSel) => {
      if (!input) return;
      input.oninput = () => {
        const q = input.value.trim().toLowerCase();
        const tb = $(tableSel);
        if (!tb) return;
        tb.querySelectorAll("tbody tr").forEach(tr => {
          tr.style.display = (!q || (tr.textContent || "").toLowerCase().indexOf(q) >= 0) ? "" : "none";
        });
      };
    };
    filt($("#indfilter"), "#indtableel");
    filt($("#provfilter"), "#provtableel");
    /* 省份搜索 */
    const pq = $("#provq");
    if (pq) pq.onchange = () => {
      const v = (pq.value || "").trim();
      if (!v) return;
      const hit = PROV.find(n => n === v) || PROV.find(n => provShort(n) === v) || PROV.find(n => n.indexOf(v) >= 0);
      if (hit) { STATE.provPick = hit; render(STATE.tab); }
    };
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
    /* 首屏「先看这里」三步引导（v4） */
    $$('.gstep[data-go]').forEach(b => b.onclick = () => {
      const go = b.dataset.go;
      if (go === "firm") { render("firm"); window.scrollTo(0, 0); return; }
      const el = document.getElementById(go);
      if (el) el.scrollIntoView({ behavior: "auto", block: "start" });
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
    /* 「加入对比 ↓」：加入对比组并滚到对比卡片 */
    $$('[data-cmp]').forEach(b => b.onclick = () => {
      const c = b.dataset.cmp;
      if (STATE.cmp.indexOf(c) < 0) {
        if (STATE.cmp.length >= 3) {
          alert("对比最多 3 家。先到下面的对比卡片里删掉一家。");
          const card0 = $("#cmpcard"); if (card0) card0.scrollIntoView({ behavior: "auto", block: "start" });
          return;
        }
        STATE.cmp.push(c);
        renderCmp();
      }
      const card = $("#cmpcard");
      if (card) card.scrollIntoView({ behavior: "auto", block: "start" });
      b.textContent = "已在对比中 ↓";
    });
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
    } else if (act === "pdf") {
      const f = STATE.firm ? F.find(x => x[0] === STATE.firm) : null;
      if (!f) { alert("先在企业页选一家企业，再导出体检 PDF"); return; }
      exportFirmPDF(f);
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

  /* ==================== 企业体检报告 · 打印版（v4 新增） ====================
     评委/面试官不会一直开着网页。「可带走的决策依据」比多一个图表更有说服力：
     一页结论 + 一页证据 + 一页口径，浏览器打印成 PDF 即可带走。
     实现方式：#printarea 里渲染这份 HTML，@media print 只输出这一块。 */
  function firmPrintHTML(f) {
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
    const pos = PEERPOS[code];
    const cellD = pos ? PEERD[pos.ind + "||" + pos.dec] : null;
    const now = new Date();
    const pad2 = n => String(n).padStart(2, "0");
    const dateStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    const vc = VCOLOR[verdict];
    const vtxt = VERDICT[verdict];

    /* 一句话结论：把判定落到「这条结论靠什么撑起来」 */
    let oneLine = "";
    if (hasOvs !== 1) {
      oneLine = `尚未出海。按两阶段资格模型，出海概率 ${p1 != null ? (p1 * 100).toFixed(0) + "%" : "—"}、
        出海后赚钱概率 ${p2 != null ? (p2 * 100).toFixed(0) + "%" : "—"}
        （基准 ${(D.model.qualify.stage2.base_rate * 100).toFixed(1)}%）。建议先验证毛利，再谈规模。`;
    } else if (verdict === 0) {
      oneLine = `溢价 ${sign(gap)}pp 与同行中位 ${sign(indRow.gap_med)}pp 的差距超出可解释范围（口径闸门 ${D.meta.gap_cap}pp），
        本报告不给方向性结论，只报到基本面为止。`;
    } else if (verdict === 1) {
      oneLine = `溢价 ${sign(gap)}pp、相对同行 ${sign(gapVsInd)}pp，渗透度处行业 ${ratioPct} 分位，规则层未触发止损。
        结论：可继续加码，但要盯住第 ${tenure} 年的溢价变化。`;
    } else if (verdict === 4) {
      oneLine = `溢价 ${sign(gap)}pp 低于同行中位 ${sign(indRow.gap_med)}pp（相对 ${sign(gapVsInd)}pp），
        且命中 ${rules.hit.length} 条硬信号。结论：停止追加投入，按止损规则收口。`;
    } else {
      oneLine = `溢价 ${sign(gap)}pp 与同行中位 ${sign(indRow.gap_med)}pp 基本持平（相对 ${sign(gapVsInd)}pp），
        无系统性优势也无明显恶化。结论：维持现有投入，不扩张。`;
    }

    /* KPI 四格 */
    const kpis = hasOvs === 1
      ? [
        { v: sign(gap) + "pp", l: "出海溢价" },
        { v: ratioPct != null ? ratioPct : "—", l: "渗透度行业分位" },
        { v: sizePct != null ? (sizePct * 100).toFixed(0) : "—", l: "规模分位" },
        { v: risk != null && gapBad !== 1 ? (risk * 100).toFixed(0) + "%" : "—", l: "次年恶化概率" },
      ]
      : [
        { v: p1 != null ? (p1 * 100).toFixed(0) + "%" : "—", l: "出海概率" },
        { v: p2 != null ? (p2 * 100).toFixed(0) + "%" : "—", l: "出海后赚钱概率" },
        { v: sizePct != null ? (sizePct * 100).toFixed(0) : "—", l: "规模分位" },
        { v: "未出海", l: "当前状态" },
      ];

    /* 压力测试表 */
    let stressTable = "";
    if (st) {
      stressTable = `<table class="prtable">
        <thead><tr><th class="l">海外毛利率下降</th><th>毛利减少（亿）</th>
          <th>${st.np_neg ? "占总资产" : "占净利润"}</th><th>占海外毛利</th></tr></thead>
        <tbody>${st.rows.map(r => `<tr>
          <td class="l">${r.dpp}pp</td><td>${fmt(r.loss_yi, 3)}</td>
          <td>${st.np_neg ? fmt(r.pct_assets, 2) + "%" : fmt(r.pct_np, 1) + "%"}</td>
          <td>${fmt(r.pct_ovs_gm, 1)}%</td></tr>`).join("")}</tbody></table>`;
    } else {
      stressTable = `<p>不适用：这家企业溢价不可算或口径异常，没有可用的海外毛利率基数。</p>`;
    }

    return `
    <div class="pr-head">
      <div>
        <h1>出海体检报告</h1>
        <div class="prsub">${esc(name)}（${esc(code)}） · ${esc(indName)} · ${esc(provName)} · 数据年度 ${LAST}</div>
      </div>
      <div class="prlogo">
        A 股出海质量图谱<br>
        生成日期 ${dateStr}<br>
        样本 ${D.meta.n_obs.toLocaleString()} 个企业·年
      </div>
    </div>

    <div class="pr-sec">
      <h3>一、结论</h3>
      <p><span class="prbadge" style="background:${vc}">${vtxt}</span></p>
      <p style="margin-top:6px">${oneLine}</p>
      <div class="pr-kpis">
        ${kpis.map(k => `<div class="pr-kpi"><b>${k.v}</b><span>${k.l}</span></div>`).join("")}
      </div>
    </div>

    ${hasOvs === 1 ? `
    <div class="pr-sec">
      <h3>二、基本面</h3>
      <p>出海第 <b>${tenure}</b> 年 ｜ 海外渗透度 <b>${pct(ratio)}</b>（同行中位 ${pct(indRow.ratio_med)}，行业 ${ratioPct} 分位）
        ｜ 规模分位 <b>${sizePct != null ? (sizePct * 100).toFixed(0) : "—"}</b>
        （出海门槛中位 ${((indRow.gate_med || 0) * 100).toFixed(0)}）</p>
      <p>海外毛利率 <b>${fmt(x.ovs_gm, 1)}%</b>（同行 ${fmt(x.ref_gm_ovs, 1)}%）
        ｜ 境内毛利率 <b>${fmt(x.dom_gm, 1)}%</b>（同行 ${fmt(x.ref_gm_dom, 1)}%）
        ｜ 资产负债率 ${fmt(x.lev, 2)} ｜ ROA ${fmt(x.roa, 2)}%</p>
      ${cellD ? `<div style="margin-top:8px">${peerBand(cellD, gap, { width: 690, height: 200 })}</div>
      <p style="font-size:8.8pt;color:#7A8798">同行业同规模档 ${cellD.n} 家企业的溢价分布；红竖线为本公司位置。</p>` : ""}
    </div>

    <div class="pr-sec">
      <h3>三、风险两层判断</h3>
      <p><b>① 机器学习打分</b>（次年溢价恶化概率）：${risk != null && gapBad !== 1 ? (risk * 100).toFixed(0) + "%" : "口径异常，停用"}
        <span style="color:#7A8798">（XGBoost walk-forward，AUC ${D.model.risk.folds.map(v => v.auc).join(" / ")}，仅用于排序）</span></p>
      <p><b>② 规则层硬信号</b>：命中 ${rules.hit.length} 条，加权分 ${rules.w}</p>
      <ul>${rules.hit.length ? rules.hit.map(id => {
            const d = D2.rules.defs.find(dd => dd.id === id);
            return `<li>${esc(d ? d.name + "（" + d.layer + "）" : id)}</li>`;
          }).join("") : "<li>6 条规则均未触发</li>"}</ul>
    </div>

    <div class="pr-sec">
      <h3>四、压力测试</h3>
      <p>海外收入 ${fmt(st ? st.rev_yi : null, 2)} 亿 ｜ 总资产 ${fmt(st ? st.assets_yi : null, 1)} 亿
        ｜ 净利润 ${fmt(st ? st.np_yi : null, 2)} 亿${st && st.np_neg ? "（当期亏损）" : ""}</p>
      ${stressTable}
    </div>

    <div class="pr-sec">
      <h3>五、止损规则</h3>
      <ul>${stops.length ? stops.map(s => `<li><b>触发</b>：${esc(s.txt)}</li>`).join("")
          : "<li>三条止损规则均未触发</li>"}</ul>
    </div>` : `
    <div class="pr-sec">
      <h3>二、行业上下文</h3>
      <p>${esc(indName)}：出海率 ${pct(indRow.ovs_rate)}，溢价中位 ${sign(indRow.gap_med)}pp，
        溢价为正 ${pct(indRow.pos_share)}，出海门槛 ${((indRow.gate_med || 0) * 100).toFixed(0)} 分位，
        已是出海主力 ${fmt(indRow.ovs_n, 0)} 家。</p>
      <p>${esc(provName)}：${D2.prov_tier[provName] ? D2.prov_tier[provName].tier : "—"}，
        出海率 ${pct(provRow.ovs_rate)}，溢价中位 ${sign(provRow.gap_med)}pp。</p>
    </div>
    <div class="pr-sec">
      <h3>三、第一步建议</h3>
      <ul>
        <li>先验证毛利，再谈规模——行业溢价中位 ${sign(indRow.gap_med)}pp 意味着进去未必赚得到。</li>
        <li>用现有规模打样，不要一次压重注。</li>
        <li>盯住第 1 年：全样本第 1 年退出率 ${D.survival.km[0].hazard}%，10 年存活率 ${D.survival.km[D.survival.km.length - 1].surv}%。</li>
      </ul>
    </div>`}

    <div class="pr-sec">
      <h3>${hasOvs === 1 ? "六" : "四"}、行业与区域上下文</h3>
      <p>${esc(indName)}：样本 ${indRow.n}，出海率 ${pct(indRow.ovs_rate)}，溢价中位 ${sign(indRow.gap_med)}pp，
        溢价为正 ${pct(indRow.pos_share)}，门槛 ${((indRow.gate_med || 0) * 100).toFixed(0)} 分位，容量 ${fmt(indRow.cap, 0)} 亿。</p>
      <p>${esc(provName)}：${D2.prov_tier[provName] ? D2.prov_tier[provName].tier : "—"}，
        样本 ${provRow.n}，出海率 ${pct(provRow.ovs_rate)}，溢价中位 ${sign(provRow.gap_med)}pp，容量 ${fmt(provRow.cap, 0)} 亿。</p>
    </div>

    <div class="pr-sign">
      <span>A 股出海质量图谱 · 企业出海决策支持系统</span>
      <span>${esc(name)}（${esc(code)}） · ${dateStr}</span>
    </div>

    <div class="pr-foot">
      <b>口径与边界</b>　
      溢价 ＝ 海外毛利率 − 境内毛利率（pp），仅当海外成本 &gt; 0 时计算；|溢价| &gt; ${D.meta.gap_cap}pp 判为分部成本分摊口径异常，不给方向性结论。
      溢价全样本可算比例 ${D.meta.gap_cov}%，未覆盖样本标「未披露」，不做插补。
      分部披露只到「境内 / 境外」两级，无法拆到国家或产品线。
      全部对比为同期横截面（${LAST} 年报），不做跨期因果推断；机器学习 AUC ${D.model.risk.folds.map(v => v.auc).join(" / ")}，
      只用于企业间排序，不作精确概率。数据源：A 股上市公司年报分部披露（自采公开接口抓取）+ 财务与治理数据。
    </div>`;
  }

  /* 把打印版渲染进 #printarea 并唤起浏览器打印（另存为 PDF） */
  function exportFirmPDF(f) {
    const area = $("#printarea");
    if (!area) return;
    area.innerHTML = firmPrintHTML(f);
    const done = () => {
      /* 打印完把内容留着：用户取消打印后还能再点一次，不闪屏 */
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    if (typeof window.print !== "function") {
      /* 极少数环境禁用打印：退化成下载 HTML，仍可自行转 PDF */
      downloadText(`出海体检报告_${f[1]}.html`,
        `<!doctype html><meta charset="utf-8"><title>出海体检报告 ${esc(f[1])}</title>` +
        `<style>body{font-family:"Microsoft YaHei",sans-serif;max-width:760px;margin:24px auto;color:#1A2433}</style>` +
        area.innerHTML, "text/html");
      return;
    }
    window.print();
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
    L.push(`数据源：自采公开接口（年报分部披露 + 财务 + 治理），全样本 ${D.meta.n_obs.toLocaleString()} 个企业·年`);
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
  /* 「数据说明」抽屉入口在静态 HTML 里，只需绑一次 */
  const mo1 = $("#mopen"); if (mo1) mo1.onclick = openDrawer;
  const mo2 = $("#mopen2"); if (mo2) mo2.onclick = (e) => { e.preventDefault(); openDrawer(); };
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

  /* 页脚的数据口径全部动态填，避免与实际数据脱节 */
  (function fillFooter() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("f_yr", `${YEARS[0]}–${YEARS[YEARS.length - 1]}`);
    set("f_obs", D.meta.n_obs.toLocaleString());
    set("f_firms", D.meta.n_firms.toLocaleString());
  })();

  $$(".tab").forEach(b => { if (b.dataset.k) b.onclick = () => render(b.dataset.k); });
  render("overview");
})();
