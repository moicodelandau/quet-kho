(function () {
'use strict';
var A = window.AirSim, PRESETS = window.AirPresets;
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
function el(tag, attrs, kids) {
  var e = document.createElement(tag), k;
  for (k in (attrs || {})) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else e.setAttribute(k, attrs[k]); }
  (kids || []).forEach(function (c) { e.appendChild(c); });
  return e;
}
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function fmt(x, d) { return x.toFixed(d).replace('.', ','); }
function fmtInt(x) { return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function mmss(t) { var m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + (s < 10 ? '0' : '') + s; }

/* ---------- trạng thái ---------- */
var cfg = A.defaultCfg();
var sim = new A.Sim(cfg);
var H, RW, RH, NXI, NYI, DEPTH;
function dims() { H = sim.H; RW = sim.RW; RH = sim.RH; NXI = sim.NXI; NYI = sim.NYI; DEPTH = cfg.depth; }
dims();
var ui = { playing: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, speed: 24, layer: 'T', trails: true, view: '2d', chart: 'T' };
var SPEEDS = [[3, '×3'], [6, '×6'], [24, '×24'], [72, '×72'], [180, '×180']];
var fanSeq = 1, devSeq = 1, hover = null, V3 = { on: false, ok: false, dirty: true };
var engDirty = true;
function changed() { sim.rebuild(); V3.dirty = true; engDirty = true; }

/* ---------- màu theo giao diện ---------- */
var TOK = {}, DARK = false;
function readTokens() {
  var cs = getComputedStyle(document.documentElement), names = ['ink', 'muted', 'line', 'surface', 'stage', 'accent', 'good', 'warn', 'bad'];
  names.forEach(function (n) { TOK[n] = cs.getPropertyValue('--' + n).trim(); });
  var dt = document.documentElement.getAttribute('data-theme');
  DARK = dt === 'dark' || (dt !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  buildLegend(); V3.dirty = true;
}
var RAMPS = {
  T: { lo: 16, hi: 36, title: 'Nhiệt độ không khí (°C)', ticks: [16, 20, 24, 28, 32, 36],
       light: [[16, 38, 70, 170], [20, 57, 150, 214], [23, 160, 214, 226], [26, 240, 244, 240], [29, 250, 205, 120], [32, 238, 120, 70], [36, 170, 35, 50]],
       dark:  [[16, 30, 50, 140], [20, 35, 95, 170], [23, 40, 105, 125], [26, 58, 72, 80], [29, 150, 110, 50], [32, 200, 90, 55], [36, 190, 40, 60]] },
  H: { lo: 30, hi: 100, title: 'Độ ẩm tương đối (%)', ticks: [30, 40, 50, 60, 70, 80, 90, 100],
       light: [[30, 246, 238, 214], [45, 214, 236, 226], [60, 170, 215, 205], [70, 232, 222, 140], [85, 232, 150, 90], [100, 150, 55, 110]],
       dark:  [[30, 80, 66, 44], [45, 40, 85, 80], [60, 40, 110, 110], [70, 130, 115, 50], [85, 190, 100, 55], [100, 150, 55, 110]] },
  C: { lo: 400, hi: 1800, title: 'CO₂ (ppm)', ticks: [400, 800, 1200, 1600],
       light: [[420, 245, 247, 240], [800, 240, 226, 150], [1200, 214, 160, 70], [1800, 120, 60, 40]],
       dark:  [[420, 40, 52, 58], [800, 90, 85, 50], [1200, 140, 95, 45], [1800, 170, 70, 60]] },
  V: { lo: 0, hi: 1.5, title: 'Tốc độ gió (m/s)', ticks: [0, 0.3, 0.6, 0.9, 1.2],
       light: [[0, 244, 247, 248], [0.3, 170, 215, 230], [0.8, 60, 150, 190], [1.5, 10, 60, 110]],
       dark:  [[0, 38, 48, 54], [0.3, 40, 90, 110], [0.8, 50, 150, 180], [1.5, 140, 225, 240]] }
};
function rampColor(key, v, out) {
  var st = RAMPS[key][DARK ? 'dark' : 'light'], i = 0;
  if (v <= st[0][0]) { out[0] = st[0][1]; out[1] = st[0][2]; out[2] = st[0][3]; return; }
  while (i < st.length - 1 && v > st[i + 1][0]) i++;
  if (i >= st.length - 1) { var l = st[st.length - 1]; out[0] = l[1]; out[1] = l[2]; out[2] = l[3]; return; }
  var a = st[i], b = st[i + 1], t = (v - a[0]) / (b[0] - a[0]);
  out[0] = a[1] + (b[1] - a[1]) * t; out[1] = a[2] + (b[2] - a[2]) * t; out[2] = a[3] + (b[3] - a[3]) * t;
}
function rampCss(key, v) { var o = [0, 0, 0]; rampColor(key, v, o); return 'rgb(' + Math.round(o[0]) + ',' + Math.round(o[1]) + ',' + Math.round(o[2]) + ')'; }
function buildLegend() {
  var r = RAMPS[ui.layer], st = r[DARK ? 'dark' : 'light'], stops = st.map(function (s) {
    return 'rgb(' + s[1] + ',' + s[2] + ',' + s[3] + ') ' + ((s[0] - r.lo) / (r.hi - r.lo) * 100).toFixed(1) + '%';
  });
  $('#legend-bar').style.background = 'linear-gradient(90deg,' + stops.join(',') + ')';
  $('#legend-title').textContent = r.title;
  var tk = $('#legend-ticks'); tk.innerHTML = '';
  r.ticks.forEach(function (v) { tk.appendChild(el('span', { text: String(v).replace('.', ','), style: 'left:' + ((v - r.lo) / (r.hi - r.lo) * 100).toFixed(1) + '%' })); });
}
function surfTemps() { return { roof: cfg.tOut + A.ROOF_D[cfg.sun], sun: cfg.tOut + A.WALL_D[cfg.sun], shade: cfg.tOut }; }

/* ---------- canvas 2D ---------- */
var cv = $('#view'), ctx = cv.getContext('2d');
var PAD = { l: 0.55, r: 0.55, t: 0.55, b: 0.2 }, WW = 5.9, WH = 3.5;
var sc = 100, dpr = 1;
var off = document.createElement('canvas'), offCtx = off.getContext('2d'), img;
function X(x) { return (PAD.l + x) * sc; }
function Y(y) { return (PAD.t + RH - y) * sc; }
function resize() {
  WW = RW + PAD.l + PAD.r; WH = RH + PAD.t + PAD.b;
  off.width = NXI; off.height = NYI; img = offCtx.createImageData(NXI, NYI);
  var w = cv.parentNode.clientWidth || 700; dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(w * dpr); cv.height = Math.round(w * dpr * WH / WW);
  sc = cv.width / WW;
  var ch = $('#chart'), cw = ch.clientWidth || 600;
  ch.width = Math.round(cw * dpr); ch.height = Math.round(160 * dpr);
  resize3D();
}

/* hạt vệt gió */
var NP = 520, TR = 6;
var pp = { x: new Float32Array(NP), y: new Float32Array(NP), z: new Float32Array(NP), life: new Float32Array(NP), tr: new Float32Array(NP * TR * 2) };
function spawnPoint(k) {
  var r = Math.random(), i, p;
  pp.z[k] = DEPTH * (0.08 + 0.84 * Math.random());
  if (r < 0.35) {
    var pts = [];
    sim.units.forEach(function (u) { u.outs.forEach(function (o) { pts.push([(o.i - 0.5) * H, (o.j - 0.5) * H, 1]); }); });
    sim.fanList.forEach(function (f) { pts.push(f.kind === 'stand' ? [f.x + f.dir * 0.25, f.y, 1] : [f.x + (Math.random() - 0.5), RH - 0.35, 0]); });
    if (pts.length) {
      p = pts[(Math.random() * pts.length) | 0];
      pp.x[k] = p[0] + (Math.random() - 0.5) * 0.08; pp.y[k] = p[1] + (Math.random() - 0.5) * 0.08; pp.life[k] = 2 + Math.random() * 3;
      if (p[2]) pp.z[k] = DEPTH / 2 + (Math.random() - 0.5) * 0.9;
      return;
    }
  }
  for (i = 0; i < 12; i++) {
    var x = Math.random() * RW, y = Math.random() * RH, c = sim.idx(sim.ci(x), sim.cj(y));
    if (sim.s[c]) { pp.x[k] = x; pp.y[k] = y; pp.life[k] = 3 + Math.random() * 6; return; }
  }
  pp.x[k] = RW / 2; pp.y[k] = RH / 2; pp.life[k] = 3;
}
function initParticles() {
  for (var k = 0; k < NP; k++) { spawnPoint(k); pp.life[k] *= Math.random(); for (var t = 0; t < TR; t++) { pp.tr[(k * TR + t) * 2] = pp.x[k]; pp.tr[(k * TR + t) * 2 + 1] = pp.y[k]; } }
}
function vel(x, y, out) {
  var sx = x + H, sy = y + H;
  out[0] = sim.sample(sim.u, sx, sy, 0, H / 2); out[1] = sim.sample(sim.v, sx, sy, H / 2, 0);
}
var _v = [0, 0];
function stepParticles(dtv) {
  for (var k = 0; k < NP; k++) {
    for (var t = TR - 1; t > 0; t--) { pp.tr[(k * TR + t) * 2] = pp.tr[(k * TR + t - 1) * 2]; pp.tr[(k * TR + t) * 2 + 1] = pp.tr[(k * TR + t - 1) * 2 + 1]; }
    pp.tr[k * TR * 2] = pp.x[k]; pp.tr[k * TR * 2 + 1] = pp.y[k];
    vel(pp.x[k], pp.y[k], _v);
    pp.x[k] += _v[0] * dtv; pp.y[k] += _v[1] * dtv; pp.life[k] -= dtv;
    var c = sim.idx(sim.ci(pp.x[k]), sim.cj(pp.y[k]));
    if (pp.life[k] <= 0 || pp.x[k] < 0 || pp.x[k] > RW || pp.y[k] < 0 || pp.y[k] > RH || !sim.s[c]) {
      spawnPoint(k);
      for (var t2 = 0; t2 < TR; t2++) { pp.tr[(k * TR + t2) * 2] = pp.x[k]; pp.tr[(k * TR + t2) * 2 + 1] = pp.y[k]; }
    }
  }
}

var spin = 0;
function layerValue(c) {
  if (ui.layer === 'T') return sim.T[c];
  if (ui.layer === 'C') return sim.C[c];
  if (ui.layer === 'H') return sim.cellRH(c) * 100;
  return sim.cellSpeed(c);
}
function fillField() {
  var i, j, px = img.data, col = [0, 0, 0];
  for (j = 1; j <= NYI; j++) for (i = 1; i <= NXI; i++) {
    var c = sim.idx(i, j), o = ((NYI - j) * NXI + (i - 1)) * 4;
    rampColor(ui.layer, layerValue(c), col);
    px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
  }
  offCtx.putImageData(img, 0, 0);
}
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
var HIT = [];
function draw() {
  var W = cv.width, Hh = cv.height, k;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = TOK.stage; ctx.fillRect(0, 0, W, Hh);
  drawOutside();
  fillField();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off, X(0), Y(RH), RW * sc, RH * sc);
  if (ui.trails) {
    ctx.lineCap = 'round';
    var rgb = DARK ? '225,242,250' : '10,28,38';
    for (k = 0; k < NP; k++) {
      vel(pp.x[k], pp.y[k], _v);
      var sp = Math.sqrt(_v[0] * _v[0] + _v[1] * _v[1]);
      if (sp < 0.03) continue;
      var al = Math.min(0.75, 0.12 + sp * 0.9) * Math.min(1, pp.life[k] * 2);
      ctx.strokeStyle = 'rgba(' + rgb + ',' + al.toFixed(3) + ')'; ctx.lineWidth = Math.max(1, sc * 0.012);
      ctx.beginPath(); ctx.moveTo(X(pp.x[k]), Y(pp.y[k]));
      for (var t = 0; t < TR; t++) ctx.lineTo(X(pp.tr[(k * TR + t) * 2]), Y(pp.tr[(k * TR + t) * 2 + 1]));
      ctx.stroke();
    }
  }
  drawWalls();
  HIT.length = 0;
  drawDevices(); drawAC(); drawPeople(); drawFans();
  if (hover) drawProbe();
}
/* mặt ngoài của phòng: mái, tường và nhiệt độ ngoài trời */
function drawOutside() {
  var st = surfTemps(), th = 0.13, lw = sc * th;
  var sunL = cfg.sunSide === 'L';
  ctx.fillStyle = rampCss('T', st.roof); ctx.fillRect(X(-th), Y(RH + th), (RW + 2 * th) * sc, lw);
  ctx.fillStyle = rampCss('T', sunL ? st.sun : st.shade); ctx.fillRect(X(-th), Y(RH), lw, RH * sc);
  ctx.fillStyle = rampCss('T', sunL ? st.shade : st.sun); ctx.fillRect(X(RW), Y(RH), lw, RH * sc);
  ctx.font = '600 ' + Math.round(sc * 0.1) + 'px IBM Plex Mono, monospace'; ctx.fillStyle = TOK.muted; ctx.textAlign = 'center';
  ctx.fillText('Mái ' + Math.round(st.roof) + '°C', X(RW / 2), Y(RH + th) - sc * 0.07);
  ctx.textAlign = 'left'; ctx.fillText('Ngoài trời ' + Math.round(cfg.tOut) + '°C · ẩm ' + Math.round(cfg.rhOut) + '%', X(-0.45), Y(RH + th) - sc * 0.07);
  if (cfg.sun > 0) {
    var sx = sunL ? X(-0.3) : X(RW + 0.3), sy = Y(RH + 0.22), len = sc * (cfg.sun === 2 ? 0.2 : 0.16);
    ctx.fillStyle = '#f2b632'; ctx.beginPath(); ctx.arc(sx, sy - sc * 0.12, sc * 0.09, 0, 6.283); ctx.fill();
    ctx.strokeStyle = '#f2b632'; ctx.lineWidth = Math.max(1.5, sc * 0.012);
    for (var r = 0; r < 8; r++) { var a = r * 0.785; ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * sc * 0.12, sy - sc * 0.12 + Math.sin(a) * sc * 0.12); ctx.lineTo(sx + Math.cos(a) * len, sy - sc * 0.12 + Math.sin(a) * len); ctx.stroke(); }
  }
}
function drawWalls() {
  var lw = Math.max(3, sc * 0.045), k;
  ctx.lineWidth = lw; ctx.strokeStyle = TOK.ink; ctx.lineCap = 'butt';
  function seg(x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(X(x0), Y(y0)); ctx.lineTo(X(x1), Y(y1)); ctx.stroke(); }
  seg(-lw / sc / 2, 0, RW + lw / sc / 2, 0);
  var roofGaps = [];
  for (k in sim.openDefs) if (cfg.open[k] && sim.openDefs[k].wall === 'T') roofGaps.push([sim.openDefs[k].x0, sim.openDefs[k].x1]);
  roofGaps.sort(function (a, b) { return a[0] - b[0]; });
  var xx = -lw / sc / 2;
  roofGaps.forEach(function (g) { if (g[0] > xx) seg(xx, RH, g[0], RH); xx = Math.max(xx, g[1]); });
  seg(xx, RH, RW + lw / sc / 2, RH);
  roofGaps.forEach(function (g) {
    ctx.save(); ctx.strokeStyle = TOK.accent; ctx.lineWidth = Math.max(2, sc * 0.02); ctx.setLineDash([sc * 0.05, sc * 0.04]);
    ctx.beginPath(); ctx.moveTo(X(g[0]), Y(RH)); ctx.lineTo(X(g[1]), Y(RH)); ctx.stroke(); ctx.restore();
  });
  ['L', 'R'].forEach(function (wall) {
    var xs = wall === 'L' ? 0 : RW, ranges = [];
    for (k in sim.openDefs) if (cfg.open[k] && sim.openDefs[k].wall === wall) ranges.push([sim.openDefs[k].y0, sim.openDefs[k].y1]);
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var y = 0;
    ranges.forEach(function (r) { if (r[0] > y) seg(xs, y, xs, r[0]); y = Math.max(y, r[1]); });
    if (y < RH) seg(xs, y, xs, RH);
    ranges.forEach(function (r) {
      ctx.save(); ctx.strokeStyle = TOK.accent; ctx.lineWidth = Math.max(2, sc * 0.02); ctx.setLineDash([sc * 0.05, sc * 0.04]);
      ctx.beginPath(); ctx.moveTo(X(xs), Y(r[0])); ctx.lineTo(X(xs), Y(r[1])); ctx.stroke(); ctx.restore();
    });
  });
}
function drawAC() {
  sim.units.forEach(function (u) {
    ctx.fillStyle = TOK.surface; ctx.strokeStyle = TOK.ink; ctx.lineWidth = Math.max(1.5, sc * 0.015);
    var bb = null;
    u.rects.forEach(function (r) {
      rr(X(r.x0), Y(r.y1), (r.x1 - r.x0) * sc, (r.y1 - r.y0) * sc, sc * 0.03); ctx.fill(); ctx.stroke();
      if (!bb) bb = { x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1 };
      else { bb.x0 = Math.min(bb.x0, r.x0); bb.x1 = Math.max(bb.x1, r.x1); bb.y0 = Math.min(bb.y0, r.y0); bb.y1 = Math.max(bb.y1, r.y1); }
    });
    u.outs.forEach(function (o) {
      var cx = (o.i - 0.5) * H, cy = (o.j - 0.5) * H, L = 0.2;
      arrow(cx, cy, cx + o.dx * L, cy + o.dy * L, TOK.accent);
    });
    var ac = null; cfg.acs.forEach(function (a) { if (a.on && a.type === u.type) ac = a; });
    if (ac && bb) {
      HIT.push({ kind: 'ac', ref: ac, x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2, rx: Math.max(0.3, (bb.x1 - bb.x0) / 2 + 0.1), ry: Math.max(0.3, (bb.y1 - bb.y0) / 2 + 0.1) });
      if (bb.x1 - bb.x0 > 0.45) {
        ctx.fillStyle = TOK.ink; ctx.font = '600 ' + Math.round(sc * 0.085) + 'px Archivo, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(fmt(u.power / 2640, 1) + ' HP', X((bb.x0 + bb.x1) / 2), Y((bb.y0 + bb.y1) / 2) + sc * 0.03);
      }
    }
  });
}
function arrow(x0, y0, x1, y1, color) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(2, sc * 0.022);
  ctx.beginPath(); ctx.moveTo(X(x0), Y(y0)); ctx.lineTo(X(x1), Y(y1)); ctx.stroke();
  var a = Math.atan2(Y(y1) - Y(y0), X(x1) - X(x0)), s = sc * 0.045;
  ctx.beginPath(); ctx.moveTo(X(x1), Y(y1)); ctx.lineTo(X(x1) - s * Math.cos(a - 0.45), Y(y1) - s * Math.sin(a - 0.45)); ctx.lineTo(X(x1) - s * Math.cos(a + 0.45), Y(y1) - s * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill();
}
function drawPeople() {
  cfg.people.forEach(function (p) {
    var x = p.x;
    ctx.fillStyle = TOK.ink; ctx.strokeStyle = TOK.ink; ctx.lineWidth = Math.max(2, sc * 0.03); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.82;
    ctx.beginPath(); ctx.moveTo(X(x - 0.16), Y(0.46)); ctx.lineTo(X(x + 0.2), Y(0.46)); ctx.moveTo(X(x - 0.12), Y(0.46)); ctx.lineTo(X(x - 0.12), Y(0)); ctx.moveTo(X(x + 0.16), Y(0.46)); ctx.lineTo(X(x + 0.16), Y(0)); ctx.stroke();
    ctx.lineWidth = Math.max(4, sc * 0.09);
    ctx.beginPath(); ctx.moveTo(X(x - 0.06), Y(0.52)); ctx.lineTo(X(x - 0.04), Y(0.92)); ctx.stroke();
    ctx.lineWidth = Math.max(3, sc * 0.06);
    ctx.beginPath(); ctx.moveTo(X(x - 0.06), Y(0.52)); ctx.lineTo(X(x + 0.3), Y(0.52)); ctx.lineTo(X(x + 0.3), Y(0.06)); ctx.stroke();
    ctx.beginPath(); ctx.arc(X(x - 0.03), Y(1.04), sc * 0.075, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;
    HIT.push({ kind: 'person', ref: p, x: x + 0.1, y: 0.6, rx: 0.35, ry: 0.6 });
  });
}
function drawDevices() {
  (cfg.devices || []).forEach(function (d) {
    var kd = A.DEVICE_KINDS[d.kind];
    ctx.fillStyle = TOK.surface; ctx.strokeStyle = TOK.warn; ctx.lineWidth = Math.max(1.5, sc * 0.018);
    rr(X(d.x - kd.sw / 2), Y(d.y + kd.sh), kd.sw * sc, kd.sh * sc, sc * 0.02); ctx.globalAlpha = d.on ? 0.92 : 0.4; ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = TOK.ink; ctx.font = '600 ' + Math.round(sc * 0.075) + 'px Archivo, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(d.w + ' W', X(d.x), Y(d.y + kd.sh) - sc * 0.03);
    if (d.on) HIT.push({ kind: 'dev', ref: d, x: d.x, y: d.y + kd.sh / 2, rx: Math.max(0.25, kd.sw / 2 + 0.05), ry: Math.max(0.2, kd.sh / 2 + 0.05) });
  });
}
function fanLabel(f, x, y) {
  var lvl = clamp(f.speed | 0, 1, 5);
  ctx.font = '600 ' + Math.round(sc * 0.1) + 'px Archivo, sans-serif'; ctx.textAlign = 'center';
  var tx = 'Số ' + lvl, w = ctx.measureText(tx).width + sc * 0.1;
  ctx.globalAlpha = 0.85; ctx.fillStyle = TOK.surface; rr(X(x) - w / 2, Y(y) - sc * 0.09, w, sc * 0.15, sc * 0.03); ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = TOK.ink; ctx.fillText(tx, X(x), Y(y) + sc * 0.025);
}
function drawFans() {
  spin += 0.35;
  cfg.fans.forEach(function (f) {
    if (!f.on) return;
    ctx.strokeStyle = TOK.ink; ctx.fillStyle = TOK.surface; ctx.lineWidth = Math.max(2, sc * 0.024); ctx.lineCap = 'round';
    if (f.kind === 'stand') {
      var el_ = f.elev * Math.PI / 180, dx = f.dir * Math.cos(el_), dy = Math.sin(el_);
      ctx.beginPath(); ctx.moveTo(X(f.x), Y(0.02)); ctx.lineTo(X(f.x), Y(f.y - 0.1)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(f.x - 0.16), Y(0.02)); ctx.lineTo(X(f.x + 0.16), Y(0.02)); ctx.stroke();
      ctx.save(); ctx.translate(X(f.x), Y(f.y)); ctx.rotate(-Math.atan2(dy, dx));
      rr(-sc * 0.03, -sc * 0.17, sc * 0.08, sc * 0.34, sc * 0.03); ctx.fill(); ctx.stroke();
      for (var b = 0; b < 3; b++) { ctx.beginPath(); ctx.moveTo(sc * 0.09, 0); var yy = Math.sin(spin * (0.5 + f.speed * 0.25) + b * 2.09) * sc * 0.13; ctx.lineTo(sc * 0.13, yy); ctx.stroke(); }
      ctx.restore();
      fanLabel(f, f.x, f.y + 0.3);
      HIT.push({ kind: 'fan', ref: f, x: f.x, y: f.y, rx: 0.3, ry: 0.3 });
    } else if (f.kind === 'ceiling') {
      var fy = RH - 0.3;
      ctx.beginPath(); ctx.moveTo(X(f.x), Y(RH)); ctx.lineTo(X(f.x), Y(fy + 0.08)); ctx.stroke();
      rr(X(f.x) - sc * 0.07, Y(fy + 0.08), sc * 0.14, sc * 0.1, sc * 0.02); ctx.fill(); ctx.stroke();
      var wv = Math.abs(Math.cos(spin * (0.3 + f.speed * 0.12)));
      ctx.lineWidth = Math.max(3, sc * 0.03);
      ctx.beginPath(); ctx.moveTo(X(f.x - 0.5 * (0.35 + 0.65 * wv)), Y(fy)); ctx.lineTo(X(f.x + 0.5 * (0.35 + 0.65 * wv)), Y(fy)); ctx.stroke();
      var d = f.mode === 'up' ? 1 : -1;
      [-0.25, 0.25].forEach(function (ox) { arrow(f.x + ox, fy - 0.1, f.x + ox, fy - 0.1 + d * 0.2, TOK.accent); });
      fanLabel(f, f.x, fy - 0.42);
      HIT.push({ kind: 'fan', ref: f, x: f.x, y: fy, rx: 0.55, ry: 0.25 });
    } else if (f.kind === 'exhaust') {
      var xs = f.side === 'L' ? 0.0 : RW, sg = f.side === 'L' ? 1 : -1;
      ctx.beginPath(); ctx.arc(X(xs + sg * 0.1), Y(f.y), sc * 0.14, 0, 6.283); ctx.fill(); ctx.stroke();
      for (var q = 0; q < 3; q++) { var a = spin * (0.5 + f.ach / 12) + q * 2.09; ctx.beginPath(); ctx.moveTo(X(xs + sg * 0.1), Y(f.y)); ctx.lineTo(X(xs + sg * 0.1) + Math.cos(a) * sc * 0.12, Y(f.y) + Math.sin(a) * sc * 0.12); ctx.stroke(); }
      arrow(xs + sg * 0.1, f.y, xs - sg * 0.2, f.y, TOK.accent);
      HIT.push({ kind: 'fan', ref: f, x: xs + sg * 0.1, y: f.y, rx: 0.3, ry: 0.3 });
    } else if (f.kind === 'hrv') {
      var xi = f.side === 'L' ? 0.0 : RW, sgi = f.side === 'L' ? 1 : -1, xo = f.side === 'L' ? RW : 0.0, sgo = -sgi;
      ctx.fillStyle = TOK.surface;
      rr(X(xi) - (sgi > 0 ? 0 : sc * 0.2), Y(f.y + 0.16), sc * 0.2, sc * 0.32, sc * 0.03); ctx.fill(); ctx.stroke();
      arrow(xi - sgi * 0.28, f.y, xi + sgi * 0.2, f.y, TOK.good);
      rr(X(xo) - (sgo > 0 ? 0 : sc * 0.2), Y(RH - 0.5 + 0.16), sc * 0.2, sc * 0.32, sc * 0.03); ctx.fill(); ctx.stroke();
      arrow(xo + sgo * 0.2, RH - 0.5, xo - sgo * 0.28, RH - 0.5, TOK.warn);
      ctx.fillStyle = TOK.ink; ctx.font = '600 ' + Math.round(sc * 0.085) + 'px Archivo, sans-serif'; ctx.textAlign = f.side === 'L' ? 'left' : 'right';
      ctx.fillText('Gió tươi ' + f.ach + '/giờ', X(xi) + sgi * sc * 0.25, Y(f.y + 0.24));
      HIT.push({ kind: 'fan', ref: f, x: xi + sgi * 0.1, y: f.y, rx: 0.3, ry: 0.3 });
    }
  });
}
function drawProbe() {
  var c = sim.idx(sim.ci(hover.x), sim.cj(hover.y)); if (!sim.s[c]) return;
  ctx.strokeStyle = TOK.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(hover.x), Y(hover.y), sc * 0.05, 0, 6.283); ctx.stroke();
  var pr = $('#probe'); pr.hidden = false;
  pr.textContent = fmt(sim.T[c], 1) + ' °C · ' + Math.round(sim.cellRH(c) * 100) + '% · ' + Math.round(sim.C[c]) + ' ppm · ' + fmt(sim.cellSpeed(c), 2) + ' m/s';
}

/* ---------- di chuyển thiết bị (dùng chung cho 2D và 3D) ---------- */
function moveDevice(h, x, y) {
  var r = h.ref;
  if (h.kind === 'fan') {
    if (r.kind === 'stand') { r.x = clamp(x, 0.3, RW - 0.3); r.y = clamp(y, 0.2, Math.min(1.6, RH - 0.5)); }
    else if (r.kind === 'ceiling') r.x = clamp(x, 0.6, RW - 0.6);
    else if (r.kind === 'hrv') { r.y = clamp(y, 0.3, RH - 0.9); r.side = x < RW / 2 ? 'L' : 'R'; }
    else { r.y = clamp(y, 0.4, RH - 0.3); r.side = x < RW / 2 ? 'L' : 'R'; }
  } else if (h.kind === 'person') r.x = clamp(x - 0.1, 0.3, RW - 0.4);
  else if (h.kind === 'dev') { var kd = A.DEVICE_KINDS[r.kind]; r.x = clamp(x, kd.sw / 2, RW - kd.sw / 2); r.y = clamp(y - kd.sh / 2, 0, Math.max(0, RH - kd.sh)); }
  else if (h.kind === 'ac') {
    if (r.type === 'ceil') r.x = clamp(x, 0.6, RW - 0.6);
    else if (r.type === 'wallL' || r.type === 'wallR') r.y = clamp(y + 0.2, 1.6, RH - 0.1);
  }
  changed();
}

/* ---------- khối 3D (three.js) ---------- */
function resize3D() {
  if (!V3.ok) return;
  var w = $('#view3d').parentNode.clientWidth || 700, h = Math.round(w * 10 / 16);
  V3.renderer.setSize(w, h, false); V3.camera.aspect = w / h; V3.camera.updateProjectionMatrix();
}
function init3D() {
  var b3 = $$('#seg-view button')[1];
  if (!window.THREE) { b3.disabled = true; b3.title = 'Không tải được thư viện 3D'; return; }
  try {
    var T = THREE;
    V3.renderer = new T.WebGLRenderer({ canvas: $('#view3d'), antialias: true });
    V3.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    V3.scene = new T.Scene();
    V3.camera = new T.PerspectiveCamera(38, 1.6, 0.1, 200);
    V3.scene.add(new T.AmbientLight(0xffffff, 0.85));
    var dl = new T.DirectionalLight(0xffffff, 0.5); dl.position.set(3, 8, 6); V3.scene.add(dl);
    V3.group = new T.Group(); V3.scene.add(V3.group);
    V3.az = 0.55; V3.el = 0.32; V3.zoom = 1; V3.pick = []; V3.ray = new T.Raycaster();
    V3.sliceTex = new T.CanvasTexture(off);
    V3.floorCv = document.createElement('canvas'); V3.floorCv.width = 60; V3.floorCv.height = 1;
    V3.ceilCv = document.createElement('canvas'); V3.ceilCv.width = 60; V3.ceilCv.height = 1;
    V3.floorTex = new T.CanvasTexture(V3.floorCv); V3.ceilTex = new T.CanvasTexture(V3.ceilCv);
    [V3.sliceTex, V3.floorTex, V3.ceilTex].forEach(function (t) { t.minFilter = T.LinearFilter; t.magFilter = T.LinearFilter; t.generateMipmaps = false; });
    var nSeg = NP * (TR - 1);
    V3.lineGeo = new T.BufferGeometry();
    V3.linePos = new Float32Array(nSeg * 2 * 3);
    V3.lineGeo.setAttribute('position', new T.BufferAttribute(V3.linePos, 3));
    V3.lines = new T.LineSegments(V3.lineGeo, new T.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
    V3.lines.frustumCulled = false; V3.scene.add(V3.lines);
    V3.spinners = [];
    var cv3 = $('#view3d'), pts = {}, drag = null;
    function ndc(e) { var r = cv3.getBoundingClientRect(); return new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
    function hitAt(e) {
      V3.ray.setFromCamera(ndc(e), V3.camera);
      var res = V3.ray.intersectObjects(V3.pick, true);
      if (!res.length) return null;
      var o = res[0].object; while (o && !o.userData.hit) o = o.parent;
      return o ? { hit: o.userData.hit, z: res[0].point.z } : null;
    }
    cv3.addEventListener('pointerdown', function (e) {
      cv3.setPointerCapture(e.pointerId); pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(pts).length === 1) { var h = hitAt(e); if (h) drag = h; }
    });
    cv3.addEventListener('pointermove', function (e) {
      var p = pts[e.pointerId];
      if (!p) { cv3.style.cursor = hitAt(e) ? 'grab' : 'default'; return; }
      var ids = Object.keys(pts);
      if (drag && ids.length === 1) {
        V3.ray.setFromCamera(ndc(e), V3.camera);
        var plane = new T.Plane(new T.Vector3(0, 0, 1), -drag.z), pt = new T.Vector3();
        if (V3.ray.ray.intersectPlane(plane, pt)) moveDevice(drag.hit, pt.x, pt.y);
        cv3.style.cursor = 'grabbing';
      } else if (ids.length === 1) {
        V3.az -= (e.clientX - p.x) * 0.008; V3.el = clamp(V3.el + (e.clientY - p.y) * 0.006, -0.1, 1.45);
      } else if (ids.length === 2) {
        var o = pts[ids[0] === String(e.pointerId) ? ids[1] : ids[0]];
        var d0 = Math.hypot(p.x - o.x, p.y - o.y), d1 = Math.hypot(e.clientX - o.x, e.clientY - o.y);
        if (d0 > 0) V3.zoom = clamp(V3.zoom * d0 / d1, 0.4, 2.2);
      }
      p.x = e.clientX; p.y = e.clientY;
    });
    function up(e) { delete pts[e.pointerId]; if (drag && !Object.keys(pts).length) { drag = null; cv3.style.cursor = 'default'; renderAC(); renderFans(); renderPeople(); renderDevices(); } }
    cv3.addEventListener('pointerup', up); cv3.addEventListener('pointercancel', up);
    cv3.addEventListener('wheel', function (e) { e.preventDefault(); V3.zoom = clamp(V3.zoom * (e.deltaY > 0 ? 1.08 : 0.92), 0.4, 2.2); }, { passive: false });
    V3.ok = true; resize3D();
  } catch (err) { V3.ok = false; b3.disabled = true; b3.title = 'Trình duyệt không hỗ trợ WebGL'; }
}
function disposeGroup(g) {
  for (var i = g.children.length - 1; i >= 0; i--) {
    var c = g.children[i]; disposeGroup(c); g.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      var mp = c.material.map;
      if (mp && mp !== V3.sliceTex && mp !== V3.floorTex && mp !== V3.ceilTex) mp.dispose();
      if (c.material.dispose) c.material.dispose();
    }
  }
}
function label3D(text, color, w) {
  var T = THREE, c = document.createElement('canvas'); c.width = 512; c.height = 96;
  var x = c.getContext('2d');
  x.font = '600 44px Archivo, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = color; x.fillText(text, 256, 48);
  var sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, depthTest: false }));
  sp.scale.set(w, w * 96 / 512, 1); return sp;
}
function build3D() {
  var T = THREE, g = V3.group, Dp = DEPTH;
  disposeGroup(g); V3.spinners = []; V3.pick = [];
  var ink = new T.Color(TOK.ink), accent = new T.Color(TOK.accent), surf = new T.Color(TOK.surface), warn = new T.Color(TOK.warn);
  function lam(c, o) { return new T.MeshLambertMaterial(Object.assign({ color: c }, o || {})); }
  function box(w, h, d, m, x, y, z) { var b = new T.Mesh(new T.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b; }
  function edges(mesh, color) { var l = new T.LineSegments(new T.EdgesGeometry(mesh.geometry), new T.LineBasicMaterial({ color: color })); mesh.add(l); }
  function pickable(grp, hit) { grp.userData.hit = hit; V3.pick.push(grp); g.add(grp); return grp; }
  var room = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(RW, RH, Dp)), new T.LineBasicMaterial({ color: ink }));
  room.position.set(RW / 2, RH / 2, Dp / 2); g.add(room);
  var back = new T.Mesh(new T.PlaneGeometry(RW, RH), new T.MeshBasicMaterial({ map: V3.sliceTex }));
  back.position.set(RW / 2, RH / 2, 0.002); g.add(back);
  var mid = new T.Mesh(new T.PlaneGeometry(RW, RH), new T.MeshBasicMaterial({ map: V3.sliceTex, transparent: true, opacity: 0.5, side: T.DoubleSide, depthWrite: false }));
  mid.position.set(RW / 2, RH / 2, Dp / 2); g.add(mid);
  var floor = new T.Mesh(new T.PlaneGeometry(RW, Dp), new T.MeshBasicMaterial({ map: V3.floorTex }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(RW / 2, 0.003, Dp / 2); g.add(floor);
  var ceil = new T.Mesh(new T.PlaneGeometry(RW, Dp), new T.MeshBasicMaterial({ map: V3.ceilTex, transparent: true, opacity: 0.4, side: T.DoubleSide, depthWrite: false }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(RW / 2, RH - 0.003, Dp / 2); g.add(ceil);
  [0, RW].forEach(function (x) {
    var w = new T.Mesh(new T.PlaneGeometry(Dp, RH), new T.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.05, side: T.DoubleSide, depthWrite: false }));
    w.rotation.y = Math.PI / 2; w.position.set(x, RH / 2, Dp / 2); g.add(w);
  });
  // mặt ngoài: mái, tường chịu nắng, nhiệt độ ngoài trời
  var st = surfTemps(), sunL = cfg.sunSide === 'L', th = 0.1;
  function surfMat(t) { var o = [0, 0, 0]; rampColor('T', t, o); return new T.MeshBasicMaterial({ color: new T.Color(o[0] / 255, o[1] / 255, o[2] / 255), transparent: true, opacity: 0.92 }); }
  g.add(box(RW + 2 * th, th, Dp + th, surfMat(st.roof), RW / 2, RH + th / 2, Dp / 2));
  g.add(box(th, RH, Dp + th, surfMat(sunL ? st.sun : st.shade), -th / 2, RH / 2, Dp / 2));
  g.add(box(th, RH, Dp + th, surfMat(sunL ? st.shade : st.sun), RW + th / 2, RH / 2, Dp / 2));
  var l1 = label3D('Mái ' + Math.round(st.roof) + ' °C', TOK.ink, 1.3); l1.position.set(RW / 2, RH + 0.4, Dp / 2); g.add(l1);
  var l2 = label3D('Ngoài trời ' + Math.round(cfg.tOut) + ' °C · ẩm ' + Math.round(cfg.rhOut) + '%', TOK.muted, 2.2); l2.position.set(RW / 2, RH + 0.75, Dp / 2); g.add(l2);
  var l3 = label3D('Tường ' + Math.round(st.sun) + ' °C', TOK.ink, 1.1); l3.position.set(sunL ? -0.55 : RW + 0.55, RH * 0.55, Dp / 2); g.add(l3);
  if (cfg.sun > 0) {
    var sun = new T.Mesh(new T.SphereGeometry(0.22, 16, 12), new T.MeshBasicMaterial({ color: 0xf2b632 }));
    sun.position.set(sunL ? -1.3 : RW + 1.3, RH + 1.0, Dp * 0.4); g.add(sun);
    var rays = new T.LineSegments(new T.BufferGeometry().setFromPoints([
      sun.position.clone(), new T.Vector3(sunL ? 0 : RW, RH, Dp * 0.4), sun.position.clone(), new T.Vector3(sunL ? -0.05 : RW + 0.05, RH * 0.6, Dp * 0.4)]),
      new T.LineBasicMaterial({ color: 0xf2b632, transparent: true, opacity: cfg.sun === 2 ? 0.9 : 0.5 }));
    g.add(rays);
  }
  // lỗ thông khí và cửa
  Object.keys(sim.openDefs).forEach(function (k) {
    if (!cfg.open[k]) return;
    var o = sim.openDefs[k], m, mat = new T.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.4, side: T.DoubleSide, depthWrite: false });
    if (o.wall === 'T') {
      m = new T.Mesh(new T.PlaneGeometry(o.x1 - o.x0, Dp), mat); m.rotation.x = Math.PI / 2; m.position.set((o.x0 + o.x1) / 2, RH + 0.004, Dp / 2);
    } else {
      m = new T.Mesh(new T.PlaneGeometry(Dp, o.y1 - o.y0), mat); m.rotation.y = Math.PI / 2; m.position.set(o.wall === 'L' ? 0 : RW, (o.y0 + o.y1) / 2, Dp / 2);
    }
    g.add(m);
    var ln = new T.LineSegments(new T.EdgesGeometry(m.geometry), new T.LineBasicMaterial({ color: accent })); ln.rotation.copy(m.rotation); ln.position.copy(m.position); g.add(ln);
  });
  // dàn lạnh
  sim.units.forEach(function (u) {
    var ac = null; cfg.acs.forEach(function (a) { if (a.on && a.type === u.type) ac = a; });
    var f = Math.sqrt(u.power / 3520), wz = (u.type.indexOf('wall') === 0 ? 0.9 : (u.type === 'ceil' ? 0.7 : 0.55)) * clamp(f, 0.8, 2.2), grp = new T.Group();
    u.rects.forEach(function (r) {
      var b = box(r.x1 - r.x0, r.y1 - r.y0, wz, lam(surf), (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, Dp / 2); edges(b, ink); grp.add(b);
    });
    u.outs.forEach(function (o) {
      [-wz * 0.3, 0, wz * 0.3].forEach(function (dz) {
        var dir = new T.Vector3(o.dx, o.dy, 0).normalize();
        grp.add(new T.ArrowHelper(dir, new T.Vector3((o.i - 0.5) * H, (o.j - 0.5) * H, Dp / 2 + dz), 0.5, accent.getHex(), 0.14, 0.08));
      });
    });
    if (ac) pickable(grp, { kind: 'ac', ref: ac }); else g.add(grp);
  });
  // thiết bị tỏa nhiệt
  (cfg.devices || []).forEach(function (d, k) {
    var kd = A.DEVICE_KINDS[d.kind], z = Dp * (0.2 + 0.12 * (k % 5)), grp = new T.Group();
    var b = box(kd.sw, kd.sh, d.kind === 'fridge' || d.kind === 'server' ? 0.6 : 0.4, lam(warn, { transparent: true, opacity: d.on ? 0.9 : 0.35 }), d.x, d.y + kd.sh / 2, z); edges(b, ink); grp.add(b);
    var lb = label3D(d.w + ' W', TOK.ink, 0.7); lb.position.set(d.x, d.y + kd.sh + 0.15, z); grp.add(lb);
    if (d.on) pickable(grp, { kind: 'dev', ref: d }); else g.add(grp);
  });
  // quạt
  function fanHead(r, dirv, level) {
    var h = new T.Group();
    var ring = new T.Mesh(new T.TorusGeometry(r, 0.012, 8, 28), lam(ink)); ring.rotation.x = Math.PI / 2; h.add(ring);
    var disc = new T.Mesh(new T.CircleGeometry(r, 24), new T.MeshBasicMaterial({ color: surf, transparent: true, opacity: 0.18, side: T.DoubleSide })); disc.rotation.x = Math.PI / 2; h.add(disc);
    var bl = new T.Group();
    for (var i = 0; i < 3; i++) { var b = box(r * 0.9, 0.01, r * 0.35, lam(ink), r * 0.5, 0, 0); var pv = new T.Group(); pv.rotation.y = i * 2.094; pv.add(b); bl.add(pv); }
    h.add(bl); V3.spinners.push({ o: bl, s: 0.15 + level * 0.12 });
    h.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dirv.clone().normalize());
    return h;
  }
  cfg.fans.forEach(function (f, k) {
    if (!f.on) return;
    var grp = new T.Group();
    if (f.kind === 'stand') {
      var el_ = f.elev * Math.PI / 180, d = new T.Vector3(f.dir * Math.cos(el_), Math.sin(el_), 0), z = Dp * 0.5 + (k % 3 - 1) * 0.5;
      var pole = new T.Mesh(new T.CylinderGeometry(0.015, 0.015, f.y, 8), lam(ink)); pole.position.set(f.x, f.y / 2, z); grp.add(pole);
      var base = new T.Mesh(new T.CylinderGeometry(0.17, 0.17, 0.03, 20), lam(ink)); base.position.set(f.x, 0.015, z); grp.add(base);
      var head = fanHead(0.17, d, f.speed); head.position.set(f.x, f.y, z); grp.add(head);
      var lb = label3D('Số ' + f.speed, TOK.ink, 0.5); lb.position.set(f.x, f.y + 0.3, z); grp.add(lb);
    } else if (f.kind === 'ceiling') {
      var fy = RH - 0.3, zc = Dp / 2;
      var rod = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.3, 8), lam(ink)); rod.position.set(f.x, RH - 0.15, zc); grp.add(rod);
      var mot = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 0.08, 16), lam(ink)); mot.position.set(f.x, fy, zc); grp.add(mot);
      var bl = new T.Group(); bl.position.set(f.x, fy - 0.02, zc);
      for (var i = 0; i < 4; i++) { var pv = new T.Group(); pv.rotation.y = i * Math.PI / 2; pv.add(box(0.5, 0.012, 0.12, lam(ink), 0.33, 0, 0)); bl.add(pv); }
      grp.add(bl); V3.spinners.push({ o: bl, s: (0.1 + f.speed * 0.1) * (f.mode === 'down' ? 1 : -1) });
      grp.add(new T.ArrowHelper(new T.Vector3(0, f.mode === 'up' ? 1 : -1, 0), new T.Vector3(f.x, fy - 0.25, zc), 0.45, accent.getHex(), 0.14, 0.08));
      var lc = label3D('Số ' + f.speed, TOK.ink, 0.5); lc.position.set(f.x, fy - 0.55, zc); grp.add(lc);
    } else if (f.kind === 'exhaust') {
      var sg = f.side === 'L' ? 1 : -1, xs = f.side === 'L' ? 0.03 : RW - 0.03;
      var eh = fanHead(0.15, new T.Vector3(-sg, 0, 0), 3); eh.position.set(xs, f.y, Dp / 2); grp.add(eh);
      grp.add(new T.ArrowHelper(new T.Vector3(-sg, 0, 0), new T.Vector3(xs, f.y + 0.28, Dp / 2), 0.4, accent.getHex(), 0.12, 0.07));
    } else if (f.kind === 'hrv') {
      var si = f.side === 'L' ? 1 : -1, xi = f.side === 'L' ? 0.1 : RW - 0.1, xo = f.side === 'L' ? RW - 0.1 : 0.1;
      var gi = box(0.2, 0.32, 0.5, lam(surf), xi, f.y, Dp / 2); edges(gi, ink); grp.add(gi);
      grp.add(new T.ArrowHelper(new T.Vector3(si, 0, 0), new T.Vector3(xi - si * 0.45, f.y, Dp / 2), 0.5, new T.Color(TOK.good).getHex(), 0.14, 0.08));
      var go = box(0.2, 0.32, 0.5, lam(surf), xo, RH - 0.5, Dp / 2); edges(go, ink); grp.add(go);
      grp.add(new T.ArrowHelper(new T.Vector3(si, 0, 0), new T.Vector3(xo + si * 0.1, RH - 0.5, Dp / 2), 0.4, warn.getHex(), 0.14, 0.08));
      var lh = label3D('Gió tươi ' + f.ach + '/giờ', TOK.ink, 1.2); lh.position.set(xi + si * 0.5, f.y + 0.3, Dp / 2); grp.add(lh);
    }
    pickable(grp, { kind: 'fan', ref: f });
  });
  // người
  cfg.people.forEach(function (p, k) {
    var z = Dp * [0.42, 0.6, 0.5, 0.3, 0.72, 0.36, 0.64, 0.5][k % 8], m = lam(ink), grp = new T.Group();
    grp.add(box(0.2, 0.46, 0.28, m, p.x - 0.05, 0.76, z));
    var hd = new T.Mesh(new T.SphereGeometry(0.1, 14, 10), m); hd.position.set(p.x - 0.03, 1.08, z); grp.add(hd);
    [-0.09, 0.09].forEach(function (dz) {
      grp.add(box(0.36, 0.12, 0.12, m, p.x + 0.12, 0.52, z + dz));
      grp.add(box(0.11, 0.46, 0.11, m, p.x + 0.3, 0.26, z + dz));
    });
    var cm = lam(ink, { transparent: true, opacity: 0.6 });
    grp.add(box(0.42, 0.04, 0.42, cm, p.x, 0.46, z));
    [[-0.16, -0.17], [-0.16, 0.17], [0.16, -0.17], [0.16, 0.17]].forEach(function (o) { grp.add(box(0.03, 0.44, 0.03, cm, p.x + o[0], 0.22, z + o[1])); });
    pickable(grp, { kind: 'person', ref: p });
  });
  V3.lines.material.color.set(DARK ? 0xe1f2fa : 0x0a1c26);
  V3.dirty = false;
}
function update3D() {
  if (V3.dirty) build3D();
  var T = THREE, i, j, k;
  fillField();
  var fc = V3.floorCv.getContext('2d'), cc2 = V3.ceilCv.getContext('2d');
  var fr = fc.createImageData(NXI, 1), cr = cc2.createImageData(NXI, 1);
  fr.data.set(img.data.subarray((NYI - 1) * NXI * 4, NYI * NXI * 4)); cr.data.set(img.data.subarray(0, NXI * 4));
  fc.putImageData(fr, 0, 0); cc2.putImageData(cr, 0, 0);
  V3.sliceTex.needsUpdate = true; V3.floorTex.needsUpdate = true; V3.ceilTex.needsUpdate = true;
  V3.spinners.forEach(function (s) { s.o.rotation.y += s.s; });
  var P = V3.linePos, n = 0;
  for (k = 0; k < NP; k++) {
    vel(pp.x[k], pp.y[k], _v);
    var show = ui.trails && (_v[0] * _v[0] + _v[1] * _v[1]) > 0.0009;
    for (j = 0; j < TR - 1; j++) {
      var a = (k * TR + j) * 2, b = (k * TR + j + 1) * 2;
      if (show) {
        P[n++] = pp.tr[a]; P[n++] = pp.tr[a + 1]; P[n++] = pp.z[k];
        P[n++] = pp.tr[b]; P[n++] = pp.tr[b + 1]; P[n++] = pp.z[k];
      } else { for (i = 0; i < 6; i++) P[n++] = 0; }
    }
  }
  V3.lineGeo.attributes.position.needsUpdate = true;
  var tx = RW / 2, ty = RH * 0.5, tz = DEPTH / 2, dist = Math.max(RW + 1.2, RH * 1.6, DEPTH) * 1.3 * V3.zoom;
  V3.camera.position.set(tx + dist * Math.sin(V3.az) * Math.cos(V3.el), ty + dist * Math.sin(V3.el), tz + dist * Math.cos(V3.az) * Math.cos(V3.el));
  V3.camera.lookAt(tx, ty, tz);
  V3.renderer.setClearColor(new T.Color(TOK.stage), 1);
  V3.renderer.render(V3.scene, V3.camera);
}
function setView(v) {
  ui.view = v; V3.on = v === '3d' && V3.ok;
  $('#view').hidden = V3.on; $('#view3d').hidden = !V3.on; $('#cap3d').hidden = !V3.on;
  if (V3.on) { $('#probe').hidden = true; resize3D(); V3.dirty = true; }
}

/* ---------- đồ thị ---------- */
var ch = $('#chart'), cc = ch.getContext('2d');
var CHARTS = {
  T: { title: 'Nhiệt độ theo thời gian', keys: [['var(--accent)', 'Tại người'], ['var(--muted)', 'Cả vùng sinh hoạt'], ['var(--good)', 'Mục tiêu']] },
  C: { title: 'CO₂ theo thời gian', keys: [['var(--accent)', 'CO₂ tại người'], ['var(--warn)', '1.000 ppm'], ['var(--bad)', '2.000 ppm và 5.000 ppm']] },
  H: { title: 'Độ ẩm tương đối theo thời gian', keys: [['var(--accent)', 'RH tại người'], ['var(--good)', 'Vùng thoải mái 40 đến 60%'], ['var(--bad)', '70% nguy cơ nấm mốc']] }
};
function drawChart() {
  var W = ch.width, Hh = ch.height, ser = sim.series, padL = 44 * dpr, padB = 20 * dpr, padT = 8 * dpr, padR = 8 * dpr;
  cc.setTransform(1, 0, 0, 1, 0, 0); cc.clearRect(0, 0, W, Hh);
  var tmax = Math.max(1200, sim.t), ymin, ymax, step, i;
  if (ui.chart === 'T') { ymin = 18; ymax = Math.ceil(Math.max(cfg.tStart + 1, 30) / 2) * 2; step = 2; }
  else if (ui.chart === 'C') { var mxc = 2200; ser.forEach(function (s) { mxc = Math.max(mxc, s.c); }); mxc = Math.max(mxc, cfg.cStart); ymin = 400; ymax = Math.ceil(mxc * 1.05 / 200) * 200; step = ymax > 4000 ? 1000 : 400; }
  else { ymin = 20; ymax = 100; step = 10; }
  function px(t) { return padL + (t / tmax) * (W - padL - padR); }
  function py(v) { return padT + (1 - (v - ymin) / (ymax - ymin)) * (Hh - padT - padB); }
  cc.font = (10.5 * dpr) + 'px IBM Plex Mono, monospace'; cc.textBaseline = 'middle'; cc.textAlign = 'right';
  cc.strokeStyle = TOK.line; cc.fillStyle = TOK.muted; cc.lineWidth = 1 * dpr;
  for (var v = ymin; v <= ymax + 1e-6; v += step) {
    cc.beginPath(); cc.moveTo(padL, py(v)); cc.lineTo(W - padR, py(v)); cc.stroke();
    if (ui.chart !== 'T' || (v - ymin) % 4 === 0) cc.fillText(fmtInt(v), padL - 5 * dpr, py(v));
  }
  cc.textAlign = 'center'; cc.textBaseline = 'top';
  for (var m = 0; m * 300 <= tmax; m++) cc.fillText(String(m * 5) + "'", px(m * 300), Hh - padB + 4 * dpr);
  function hline(val, color, dash) {
    if (val < ymin || val > ymax) return;
    cc.setLineDash(dash ? [5 * dpr, 4 * dpr] : []); cc.strokeStyle = color; cc.lineWidth = 1.5 * dpr;
    cc.beginPath(); cc.moveTo(padL, py(val)); cc.lineTo(W - padR, py(val)); cc.stroke(); cc.setLineDash([]);
  }
  function line(k, color, w, startV) {
    if (ser.length < 2) return;
    cc.strokeStyle = color; cc.lineWidth = w * dpr; cc.lineJoin = 'round'; cc.beginPath();
    cc.moveTo(px(0), py(clamp(startV, ymin, ymax)));
    for (i = 0; i < ser.length; i++) cc.lineTo(px(ser[i].t), py(clamp(ser[i][k], ymin, ymax)));
    cc.stroke();
  }
  if (ui.chart === 'T') {
    hline(cfg.target, TOK.good, true); line('tz', TOK.muted, 1.6, cfg.tStart); line('tp', TOK.accent, 2.4, cfg.tStart);
    if (sim.tReach !== null) { cc.fillStyle = TOK.accent; cc.beginPath(); cc.arc(px(sim.tReach), py(cfg.target), 4 * dpr, 0, 6.283); cc.fill(); }
  } else if (ui.chart === 'C') {
    hline(1000, TOK.warn, true); hline(2000, TOK.bad, true); hline(5000, TOK.bad, false);
    line('c', TOK.accent, 2.4, cfg.cStart);
  } else {
    cc.globalAlpha = 0.14; cc.fillStyle = TOK.good; cc.fillRect(padL, py(60), W - padL - padR, py(40) - py(60)); cc.globalAlpha = 1;
    hline(70, TOK.bad, true);
    line('rh', TOK.accent, 2.4, cfg.rhStart);
  }
}
function renderChartKeys() {
  var c = CHARTS[ui.chart]; $('#chart-title').textContent = c.title;
  var k = $('#chart-keys'); k.innerHTML = '';
  c.keys.forEach(function (x) { k.appendChild(el('span', { class: 'key', html: '<i style="background:' + x[0] + '"></i>' + x[1] })); });
}

/* ---------- chỉ số và cảnh báo ---------- */
function tile(k, v, unit, sub) { return el('div', { class: 'tile' }, [el('div', { class: 'k', text: k }), el('div', { class: 'v', html: v + (unit ? '<small>' + unit + '</small>' : '') }), el('div', { class: 's', html: sub || '&nbsp;' })]); }
function pill(cls, txt) { return '<span class="pill ' + cls + '">' + txt + '</span>'; }
function rhLabel(rh) { return rh < 0.3 ? pill('warn', 'Khô') : (rh <= 0.6 ? pill('good', 'Thoải mái') : (rh <= 0.7 ? pill('warn', 'Hơi ẩm') : pill('bad', 'Ẩm, dễ mốc'))); }
function humidexLabel(h) { return h < 30 ? pill('good', 'Dễ chịu') : (h < 35 ? pill('warn', 'Hơi khó chịu') : (h < 40 ? pill('warn', 'Khó chịu nhiều') : (h < 46 ? pill('bad', 'Rất khó chịu') : pill('bad', 'Nguy hiểm')))); }
function stuffLabel(s) { return s < 25 ? pill('good', 'Thoáng') : (s < 50 ? pill('warn', 'Hơi ngột') : (s < 75 ? pill('bad', 'Ngột') : pill('bad', 'Rất ngột'))); }
var CO2_LEVELS = [
  [30000, 4, 'crit', 'Cực kỳ nguy hiểm', 'CO₂ từ 30.000 ppm (3%) trở lên, vượt giới hạn tiếp xúc 15 phút. Rời phòng ngay và thông gió cưỡng bức.'],
  [5000, 3, 'crit', 'Nguy hiểm', 'CO₂ từ 5.000 ppm, vượt giới hạn tiếp xúc nghề nghiệp 8 giờ. Mở cửa, bật quạt hút, rời phòng nếu có chóng mặt hoặc khó thở.'],
  [2000, 2, 'bad', 'Báo động', 'CO₂ từ 2.000 ppm: dễ buồn ngủ, đau đầu, giảm tập trung. Cần thông gió ngay.'],
  [1500, 1, 'warn', 'Cảnh báo', 'CO₂ từ 1.500 ppm: chất lượng không khí kém. Tăng lượng gió tươi.'],
  [1000, 0, 'warn', 'Lưu ý', 'CO₂ từ 1.000 ppm: vượt mức khuyến nghị thông gió thường dùng.']
];
function co2Level(c) { for (var i = 0; i < CO2_LEVELS.length; i++) if (c >= CO2_LEVELS[i][0]) return CO2_LEVELS[i]; return null; }
var lastAlarmRank = -1, audioCtx = null, lvlState = {}, co2S = null, curCo2Lv = null;
var CO2_TH = [1000, 1500, 2000, 5000, 30000];
function resetAlarms() { lastAlarmRank = -1; lvlState = {}; co2S = null; curCo2Lv = null; }
/* mức cảnh báo có độ trễ: vào mức khi vượt ngưỡng, chỉ thoát khi giảm xuống dưới ngưỡng trừ một khoảng đệm, để cảnh báo không nhấp nháy */
function stepLevel(key, val, th, marg, isFrac) {
  var cur = lvlState[key] == null ? -1 : lvlState[key];
  while (cur + 1 < th.length && val >= th[cur + 1]) cur++;
  while (cur >= 0 && val < th[cur] - (isFrac ? marg * th[cur] : marg)) cur--;
  lvlState[key] = cur; return cur;
}
function beep(rank) {
  if (!$('#chk-beep').checked) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    var n = rank >= 3 ? 3 : (rank >= 2 ? 2 : 1);
    for (var i = 0; i < n; i++) {
      var o = audioCtx.createOscillator(), g = audioCtx.createGain(), t0 = audioCtx.currentTime + i * 0.28;
      o.frequency.value = rank >= 3 ? 920 : 660; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.15, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.connect(g); g.connect(audioCtx.destination); o.start(t0); o.stop(t0 + 0.24);
    }
  } catch (e) {}
}
function co2Slope() {   // ppm trên giây, theo khoảng hai phút mô phỏng gần nhất
  var s = sim.series, n = s.length; if (n < 8) return 0;
  var a = s[n - 1], b = s[Math.max(0, n - 60)];
  return a.t > b.t ? (a.c - b.c) / (a.t - b.t) : 0;
}
function renderAlarms(m) {
  var box = $('#alarms'), items = [], rank = -1, i;
  co2S = co2S == null ? m.cPeople : co2S * 0.85 + m.cPeople * 0.15;       // làm mượt dao động cục bộ
  var li = stepLevel('co2', co2S, CO2_TH, 0.07, true), lv = li >= 0 ? CO2_LEVELS[CO2_LEVELS.length - 1 - li] : null;
  curCo2Lv = lv;
  var sl = co2Slope();
  if (lv) {
    var pred = '';
    if (li + 1 < CO2_TH.length && sl > 0.002) { var mins = (CO2_TH[li + 1] - co2S) / sl / 60; if (mins < 600) pred = ' Với tốc độ hiện tại sẽ chạm ' + fmtInt(CO2_TH[li + 1]) + ' ppm sau khoảng ' + (mins < 1 ? 'dưới 1' : Math.round(mins)) + ' phút.'; }
    items.push({ cls: lv[2], t: lv[3] + ': CO₂ ' + fmtInt(co2S) + ' ppm', d: lv[4] + pred });
    rank = lv[1];
  } else if (stepLevel('co2pre', co2S, [850], 40) >= 0 && sl > 0.001) {
    var mn = (1000 - co2S) / sl / 60; if (mn < 600) items.push({ cls: 'warn', t: 'CO₂ ' + fmtInt(co2S) + ' ppm đang tăng', d: 'Sẽ chạm 1.000 ppm sau khoảng ' + Math.max(1, Math.round(mn)) + ' phút nếu không tăng thông gió.' });
  }
  var hl = stepLevel('hx', m.humidex, [35, 40, 46], 1.5);
  if (hl >= 0) items.push({ cls: hl >= 2 ? 'crit' : (hl === 1 ? 'bad' : 'warn'), t: 'Nóng ẩm khó chịu: humidex ' + Math.round(m.humidex), d: hl >= 2 ? 'Mức nguy hiểm với người ở lâu. Hạ nhiệt độ và độ ẩm ngay.' : 'Mồ hôi khó bay hơi. Cần giảm nhiệt độ hoặc khử ẩm.' });
  var rl = stepLevel('rh', m.rhPeople, [0.75, 0.85], 0.04);
  if (rl >= 0) items.push({ cls: rl >= 1 ? 'bad' : 'warn', t: 'Độ ẩm cao ' + Math.round(m.rhPeople * 100) + '%', d: 'Dễ đọng sương và nấm mốc nếu kéo dài. Giữ RH dưới 60 đến 70%.' });
  var dl = cfg.people.length ? stepLevel('dr', m.vPeople, [0.5], 0.08) : -1;
  if (dl >= 0) items.push({ cls: 'warn', t: 'Gió thổi thẳng vào người ' + fmt(m.vPeople, 2) + ' m/s', d: 'Dễ bị lùa gió. Đổi hướng quạt hoặc góc thổi.' });
  box.innerHTML = '';
  items.forEach(function (it) { box.appendChild(el('div', { class: 'alarm ' + it.cls, role: it.cls === 'crit' || it.cls === 'bad' ? 'alert' : 'status' }, [el('b', { text: it.t }), el('span', { text: it.d })])); });
  if (rank > lastAlarmRank && rank >= 1) beep(rank);
  lastAlarmRank = rank;
}
function renderMetrics() {
  var m = sim.computeMetrics(), box = $('#metrics'); box.innerHTML = '';
  renderAlarms(m);
  var hasP = cfg.people.length > 0;
  box.appendChild(tile(hasP ? 'Nhiệt độ tại người' : 'Nhiệt độ vùng sinh hoạt', fmt(m.tPeople, 1), '°C', 'Cả vùng sinh hoạt ' + fmt(m.tZone, 1) + ' °C'));
  var reach = sim.tReach !== null ? pill('good', 'Đã đạt') : pill('idle', 'Đang chờ');
  box.appendChild(tile('Đạt ' + cfg.target + ' °C sau', sim.tReach !== null ? mmss(sim.tReach) : '—', sim.tReach !== null ? 'phút' : '', reach));
  box.appendChild(tile('Độ ẩm tại người', String(Math.round(m.rhPeople * 100)), '% RH', rhLabel(m.rhPeople) + ' <span class="note">Điểm sương ' + fmt(m.dewPeople, 1) + ' °C</span>'));
  box.appendChild(tile('Ẩm khó chịu (humidex)', String(Math.round(m.humidex)), '', humidexLabel(m.humidex)));
  box.appendChild(tile('Mức ngột ngạt', String(Math.round(m.stuff)), '/ 100', stuffLabel(m.stuff)));
  var lv = curCo2Lv;
  box.appendChild(tile('CO₂ tại người', fmtInt(co2S == null ? m.cPeople : co2S), 'ppm', lv ? pill(lv[2] === 'warn' ? 'warn' : 'bad', lv[3]) : pill('good', 'Thoáng')));
  var v = m.vPeople, vp = v < 0.2 ? pill('good', 'Êm') : (v <= 0.5 ? pill('warn', 'Gió nhẹ') : pill('bad', 'Dễ bị lùa'));
  box.appendChild(tile('Gió lên người', fmt(v, 2), 'm/s', hasP ? vp : 'Chưa có người'));
  box.appendChild(tile('Chênh nhiệt trong phòng', '±' + fmt(m.tStd, 1), '°C', 'Lạnh nhất ' + fmt(m.tMin, 1) + ', nóng nhất ' + fmt(m.tMax, 1)));
  box.appendChild(tile('Khí ngoài vào', fmt(m.ach, 1), 'lần/giờ', m.ach > 0.2 ? 'Mang theo nhiệt và ẩm từ ngoài' : 'Phòng kín'));
  var load = Math.round((sim.pf == null ? 1 : sim.pf) * 100);
  box.appendChild(tile('Máy lạnh đang chạy', String(load), '% công suất', 'Cài đặt ' + cfg.setT + ' °C'));
}

/* ---------- đánh giá kỹ thuật ---------- */
var CAP_OPTS = [[1, 9000], [1.5, 12000], [2, 18000], [2.5, 24000], [3, 28000], [4, 36000], [5, 45000], [5.5, 50000]];
function hEnth(T, w) { return 1.006 * T + w * (2501 + 1.86 * T); }   // kJ/kg khô
function engineering() {
  var A_ = cfg.roomW * cfg.depth, Vv = A_ * RH, N = cfg.people.length, i;
  var qPeople = 0; cfg.people.forEach(function (p) { var a = A.ACTS[p.act == null ? 1 : p.act]; qPeople += a.s + a.l; });
  var qEquip = 0; (cfg.devices || []).forEach(function (d) { if (d.on) qEquip += d.w; });
  var qLight = 8 * A_;
  var envW = 50 * A.ENV_K[cfg.env] + [0, 20, 45][cfg.sun], qEnv = A_ * envW;
  var faReq = (2.5 * N + 0.3 * A_) / 1000;                    // m3/s theo công thức ASHRAE 62.1 cho văn phòng
  var hrv = cfg.fans.filter(function (f) { return f.kind === 'hrv' && f.on; })[0];
  var wOut = A.wFromRH(cfg.tOut, cfg.rhOut / 100), wIn = A.wFromRH(26, 0.5);
  var dh = Math.max(0, hEnth(cfg.tOut, wOut) - hEnth(26, wIn));
  var qVent = 1.2 * faReq * dh * 1000 * (hrv ? (1 - (hrv.eta == null ? 0.6 : hrv.eta) * 0.9) : 1);
  var total = qPeople + qEquip + qLight + qEnv + qVent;
  var need = total * 1.1, capSel = cfg.cap;
  var rec = CAP_OPTS[CAP_OPTS.length - 1], recFound = false;
  for (i = 0; i < CAP_OPTS.length; i++) if (CAP_OPTS[i][1] * 0.2931 >= need) { rec = CAP_OPTS[i]; recFound = true; break; }
  var ratio = capSel / total;
  var rows = [['Vỏ nhà và nắng', qEnv], ['Người', qPeople], ['Thiết bị', qEquip], ['Chiếu sáng', qLight], ['Gió tươi' + (hrv ? ' (có thu hồi nhiệt)' : ''), qVent]];
  var maxRow = Math.max.apply(null, rows.map(function (r) { return r[1]; })) || 1;
  var tbl = '<table><tbody>' + rows.map(function (r) {
    return '<tr><td>' + r[0] + '</td><td style="text-align:right;font-family:var(--mono)">' + fmtInt(r[1]) + ' W</td><td style="width:90px"><span class="bar2" style="width:' + Math.max(2, r[1] / maxRow * 80) + 'px"></span></td></tr>';
  }).join('') + '<tr><td><b>Tổng tải lạnh</b></td><td style="text-align:right;font-family:var(--mono)"><b>' + fmtInt(total) + ' W</b></td><td></td></tr></tbody></table>';
  var verdict, vcls;
  if (ratio < 1) { verdict = 'Thiếu công suất'; vcls = 'bad'; } else if (ratio > 1.8) { verdict = 'Dư công suất nhiều'; vcls = 'warn'; } else if (ratio < 1.1) { verdict = 'Vừa đủ, không còn dự phòng'; vcls = 'warn'; } else { verdict = 'Công suất phù hợp'; vcls = 'good'; }
  var left = '<div class="verdict" style="color:var(--' + vcls + ')">' + verdict + '</div>' +
    '<p class="note" style="margin-bottom:8px">Máy đang chọn ' + fmtInt(capSel) + ' W (' + fmtInt(capSel / 0.2931) + ' BTU/h, ' + fmt(capSel / 2640, 1) + ' HP) so với tải ước tính ' + fmtInt(total) + ' W (' + fmtInt(total * 3.412) + ' BTU/h). Gợi ý: ' + (recFound ? fmt(rec[0], 1) + ' HP (' + fmtInt(rec[1]) + ' BTU/h) có dự phòng 10%' : 'trên 5,5 HP, nên chia thành nhiều máy') + '.</p>' + tbl;
  var L = [], m = sim.m || sim.computeMetrics(), nOn = cfg.acs.filter(function (a) { return a.on; });
  var freshLs = m.ach * Vv / 3600 * 1000;
  if (N > 0 && freshLs < faReq * 1000) L.push(['bad', 'Thiếu gió tươi', 'Cần khoảng ' + fmt(faReq * 1000, 0) + ' L/s (2,5 L/s mỗi người cộng 0,3 L/s mỗi m²), hiện chỉ ' + fmt(freshLs, 0) + ' L/s. Thêm máy gió tươi thu hồi nhiệt (HRV/ERV): lấy đủ gió sạch mà không hút cả nhiệt ngoài trời vào.']);
  else if (N > 0) L.push(['good', 'Đủ gió tươi', 'Lưu lượng khí ngoài ' + fmt(freshLs, 0) + ' L/s, đạt mức tối thiểu ' + fmt(faReq * 1000, 0) + ' L/s.']);
  var opened = Object.keys(cfg.open).filter(function (k) { return cfg.open[k]; }).length;
  if (opened && cfg.tOut > 28 && !hrv) L.push(['warn', 'Mở lỗ thông khí khi ngoài trời nóng', 'Mỗi lỗ mở đưa nhiệt và hơi ẩm vào phòng đang chạy lạnh. Dùng gió tươi qua bộ thu hồi nhiệt, hoặc chỉ mở khi ngoài trời mát hơn trong phòng.']);
  var hasEx = cfg.fans.some(function (f) { return f.kind === 'exhaust' && f.on; });
  if (hasEx && !opened) L.push(['bad', 'Quạt hút không có đường bù gió', 'Phòng kín nên quạt hút chỉ tạo áp âm, gần như không đổi được khí. Mở một lỗ phía đối diện, thấp hơn quạt hút.']);
  if (ratio > 1.8) L.push(['warn', 'Dàn quá lớn so với tải', 'Máy đạt nhiệt độ rất nhanh rồi ngắt, khử ẩm kém và dễ ẩm lạnh. Chọn công suất sát tải hoặc dùng máy inverter nhiều tốc độ.']);
  if (ratio < 1 && nOn.length) L.push(['bad', 'Tải lạnh vượt công suất máy', 'Phòng sẽ không xuống tới nhiệt độ mong muốn lúc nóng nhất. Tăng công suất, cách nhiệt mái và tường nắng, hoặc giảm thiết bị tỏa nhiệt.']);
  if (m.rhPeople > 0.7) L.push(['warn', 'Độ ẩm cao', 'RH ' + Math.round(m.rhPeople * 100) + '%. Chạy chế độ khử ẩm, giảm gió tươi ẩm, kiểm tra thoát nước ngưng và giữ dàn lạnh sạch.']);
  if (cfg.sun >= 2 || cfg.env === 2) L.push(['warn', 'Vỏ nhà đang cho nhiệt vào nhiều', 'Tải vỏ nhà ' + fmtInt(qEnv) + ' W. Ưu tiên cách nhiệt mái hoặc mái thông gió, che nắng tường hướng ' + (cfg.sunSide === 'R' ? 'phải' : 'trái') + ' bằng lam hoặc cây, kính low-E. Giảm 1 W vỏ nhà rẻ hơn tăng 1 W công suất lạnh.']);
  if (m.vPeople > 0.5 && N) L.push(['warn', 'Gió thổi thẳng vào người', 'Đổi góc thổi, nâng cửa gió, hoặc dùng quạt trần chiều hút lên để trộn khí không thổi trực tiếp.']);
  if (nOn.some(function (a) { return (a.type === 'wallL' && cfg.sunSide === 'L') || (a.type === 'wallR' && cfg.sunSide === 'R'); })) L.push(['good', 'Dàn lạnh đặt về phía tường nắng', 'Gió lạnh ngay vùng nóng nhất, bù nhiệt từ tường. Chú ý nước ngưng và độ bền dàn nóng khi đặt phía nắng.']);
  if (cfg.devices.some(function (d) { return d.on && d.w >= 400; })) L.push(['warn', 'Thiết bị công suất lớn trong phòng', 'Máy chủ hay bếp nên đặt gần miệng hút hoặc có hút khí thải riêng, tránh để nhiệt lan khắp phòng.']);
  if (!L.length) L.push(['good', 'Chưa phát hiện vấn đề lớn', 'Bố trí hiện tại cân đối. Thử chạy so sánh phương án để tìm cách bố trí tốt hơn.']);
  var right = '<ul>' + L.map(function (x) { return '<li class="' + x[0] + '"><b>' + x[1] + '.</b> <span>' + x[2] + '</span></li>'; }).join('') + '</ul>';
  $('#eng').innerHTML = '<div class="grid"><div>' + left + '</div><div>' + right + '</div></div>' +
    '<p class="note" style="margin-top:10px">Giả định: vỏ nhà ' + fmt(envW, 0) + ' W/m² sàn, chiếu sáng 8 W/m², thông gió theo ASHRAE 62.1, nhiệt độ thiết kế trong phòng 26 °C và 50% RH. Đây là ước lượng nhanh, không thay thế tính tải lạnh chính thức.</p>';
  engDirty = false;
}

/* ---------- vòng lặp ---------- */
var last = performance.now(), acc = 0, lastUi = 0, lastEng = 0, simPerReal = 0;
function frame(now) {
  var dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (ui.playing) {
    acc += ui.speed * dt / A.DT;
    var t0 = performance.now(), n = 0;
    while (acc >= 1 && performance.now() - t0 < 14) { sim.step(); acc -= 1; n++; }
    if (acc > 20) acc = 20;
    simPerReal = n * A.DT / Math.max(dt, 1e-3);
  }
  if (ui.trails || V3.on) stepParticles(Math.min(dt, 0.05) * 3);
  if (V3.on) update3D(); else draw();
  $('#clock').textContent = mmss(sim.t) + ' · ' + (ui.playing ? '×' + Math.round(simPerReal) : 'dừng');
  if (now - lastUi > 250) { lastUi = now; renderMetrics(); drawChart(); }
  if (now - lastEng > 1000 && (engDirty || ui.playing)) { lastEng = now; engineering(); }
  requestAnimationFrame(frame);
}

/* ---------- điều khiển ---------- */
var AC_NAMES = { wallL: 'Treo tường trái', wallR: 'Treo tường phải', ceil: 'Âm trần giữa', floorL: 'Tủ đứng trái', floorR: 'Tủ đứng phải' };
function slider(label, min, max, step, value, unit, onInput, dec) {
  var id = 'r' + Math.random().toString(36).slice(2, 8), val = el('span', { class: 'val' }), inp = el('input', { type: 'range', id: id, min: min, max: max, step: step });
  inp.value = value;
  function show() { val.textContent = fmt(+inp.value, dec || 0) + ' ' + unit; }
  show();
  inp.addEventListener('input', function () { show(); onInput(+inp.value); });
  return el('div', { class: 'field' }, [el('div', { class: 'row' }, [el('label', { for: id, text: label }), val]), inp]);
}
function levelSlider(label, value, table, unit, onInput) {
  var id = 'r' + Math.random().toString(36).slice(2, 8), val = el('span', { class: 'val' }), inp = el('input', { type: 'range', id: id, min: 1, max: 5, step: 1 });
  inp.value = value;
  function show() { val.textContent = 'Số ' + inp.value + ' · ' + fmt(table[+inp.value - 1], 1) + ' ' + unit; }
  show();
  inp.addEventListener('input', function () { show(); onInput(+inp.value); });
  return el('div', { class: 'field' }, [el('div', { class: 'row' }, [el('label', { for: id, text: label }), val]), inp]);
}
function segment(options, current, onPick, label) {
  var box = el('div', { class: 'seg', role: 'group', 'aria-label': label || '' });
  options.forEach(function (o) {
    var b = el('button', { type: 'button', text: o[1], 'aria-pressed': String(o[0] === current) });
    b.addEventListener('click', function () { $$('button', box).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true'); onPick(o[0]); });
    box.appendChild(b);
  });
  return box;
}
function renderAC() {
  var chips = $('#ac-chips'); chips.innerHTML = '';
  cfg.acs.forEach(function (a) {
    var b = el('button', { type: 'button', class: 'chip', 'aria-pressed': String(a.on), text: AC_NAMES[a.type] });
    b.addEventListener('click', function () {
      var on = cfg.acs.filter(function (x) { return x.on; });
      if (a.on) { if (on.length === 1) return; a.on = false; }
      else { if (on.length >= 2) on[0].on = false; a.on = true; }
      changed(); renderAC();
    });
    chips.appendChild(b);
  });
  var box = $('#ac-units'); box.innerHTML = '';
  cfg.acs.forEach(function (a) {
    if (!a.on) return;
    var s = el('div', { class: 'sub' }, [el('div', { class: 'hd' }, [el('span', { text: AC_NAMES[a.type] })])]);
    var floor = a.type.indexOf('floor') === 0;
    s.appendChild(slider(floor ? 'Góc thổi lên so với phương ngang' : 'Góc thổi xuống so với phương ngang', floor ? 20 : 0, floor ? 80 : 60, 5, a.angle, '°', function (v) { a.angle = v; changed(); }));
    if (a.type === 'wallL' || a.type === 'wallR') s.appendChild(slider('Độ cao mép trên dàn lạnh', 1.6, RH - 0.1, 0.05, clamp(a.y, 1.6, RH - 0.1), 'm', function (v) { a.y = v; changed(); }, 2));
    if (a.type === 'ceil') s.appendChild(slider('Vị trí ngang', 0.6, RW - 0.6, 0.1, clamp(a.x, 0.6, RW - 0.6), 'm', function (v) { a.x = v; changed(); }, 1));
    box.appendChild(s);
  });
}
function newFan(kind) {
  var f = { id: ++fanSeq, kind: kind, on: true, speed: 3 };
  if (kind === 'stand') { f.x = RW - 0.6; f.y = 0.6; f.dir = -1; f.elev = 15; }
  if (kind === 'ceiling') { f.x = RW / 2; f.y = RH - 0.3; f.mode = 'up'; }
  if (kind === 'exhaust') { f.side = 'R'; f.y = RH - 0.5; f.ach = 6; }
  if (kind === 'hrv') { f.side = 'L'; f.y = 0.5; f.ach = 4; f.eta = 0.6; }
  return f;
}
var FAN_NAMES = { stand: 'Quạt đứng', ceiling: 'Quạt trần', exhaust: 'Quạt hút', hrv: 'Gió tươi thu hồi nhiệt' };
function renderFans() {
  var box = $('#fan-list'); box.innerHTML = '';
  $('#fan-empty').hidden = cfg.fans.length > 0;
  var counts = {};
  cfg.fans.forEach(function (f) {
    counts[f.kind] = (counts[f.kind] || 0) + 1;
    var rm = el('button', { type: 'button', class: 'btn small danger', text: 'Xóa' });
    rm.addEventListener('click', function () { cfg.fans.splice(cfg.fans.indexOf(f), 1); changed(); renderFans(); });
    var s = el('div', { class: 'sub' }, [el('div', { class: 'hd' }, [el('span', { text: FAN_NAMES[f.kind] + ' ' + counts[f.kind] }), rm])]);
    if (f.kind === 'stand') {
      s.appendChild(levelSlider('Tốc độ quạt', f.speed, A.STAND_V, 'm/s', function (v) { f.speed = v; changed(); }));
      s.appendChild(segment([[-1, 'Hướng sang trái'], [1, 'Hướng sang phải']], f.dir, function (v) { f.dir = v; changed(); }, 'Hướng quạt'));
      s.appendChild(slider('Góc nâng đầu quạt', -20, 70, 5, f.elev, '°', function (v) { f.elev = v; changed(); }));
      s.appendChild(slider('Vị trí ngang', 0.3, RW - 0.3, 0.1, clamp(f.x, 0.3, RW - 0.3), 'm', function (v) { f.x = v; changed(); }, 1));
      s.appendChild(slider('Độ cao', 0.2, Math.min(1.6, RH - 0.5), 0.05, clamp(f.y, 0.2, Math.min(1.6, RH - 0.5)), 'm', function (v) { f.y = v; changed(); }, 2));
    } else if (f.kind === 'ceiling') {
      s.appendChild(levelSlider('Tốc độ quạt', f.speed, A.CEIL_V, 'm/s', function (v) { f.speed = v; changed(); }));
      s.appendChild(segment([['down', 'Thổi xuống'], ['up', 'Hút lên']], f.mode, function (v) { f.mode = v; changed(); }, 'Chiều quay'));
      s.appendChild(slider('Vị trí ngang', 0.6, RW - 0.6, 0.1, clamp(f.x, 0.6, RW - 0.6), 'm', function (v) { f.x = v; changed(); }, 1));
    } else if (f.kind === 'exhaust') {
      s.appendChild(segment([['L', 'Tường trái'], ['R', 'Tường phải']], f.side, function (v) { f.side = v; changed(); }, 'Vị trí quạt hút'));
      s.appendChild(slider('Độ cao', 0.4, RH - 0.3, 0.05, clamp(f.y, 0.4, RH - 0.3), 'm', function (v) { f.y = v; changed(); }, 2));
      s.appendChild(slider('Lưu lượng hút', 2, 20, 1, f.ach, 'lần/giờ', function (v) { f.ach = v; changed(); }));
    } else {
      s.appendChild(segment([['L', 'Cấp từ tường trái'], ['R', 'Cấp từ tường phải']], f.side, function (v) { f.side = v; changed(); }, 'Phía cấp gió tươi'));
      s.appendChild(slider('Lưu lượng gió tươi', 1, 12, 1, f.ach, 'lần/giờ', function (v) { f.ach = v; changed(); }));
      s.appendChild(slider('Hiệu suất thu hồi nhiệt', 0, 90, 5, Math.round((f.eta == null ? 0.6 : f.eta) * 100), '%', function (v) { f.eta = v / 100; changed(); }));
      s.appendChild(el('p', { class: 'note', text: 'Khí tươi trao đổi nhiệt và một phần ẩm với khí thải trước khi vào phòng, không cần mở cửa.' }));
    }
    box.appendChild(s);
  });
}
function renderOpenings() {
  var box = $('#open-list'); box.innerHTML = '';
  Object.keys(sim.openDefs).forEach(function (k) {
    var o = sim.openDefs[k], desc = o.wall === 'T' ? 'trên mái, rộng 0,5 m' : 'cao ' + fmt(o.y0, 1) + ' đến ' + fmt(o.y1, 1) + ' m';
    var cb = el('input', { type: 'checkbox' }); cb.checked = !!cfg.open[k];
    cb.addEventListener('change', function () { cfg.open[k] = cb.checked; changed(); });
    box.appendChild(el('label', { class: 'check' }, [cb, el('span', { text: o.n + ' (' + desc + ')' })]));
  });
}
function renderPeople() {
  var box = $('#people-list'); box.innerHTML = '';
  $('#p-count').textContent = cfg.people.length + ' người';
  cfg.people.forEach(function (p, idx) {
    var sel = el('select', { 'aria-label': 'Hoạt động của người ' + (idx + 1), style: 'flex:1;min-width:0' });
    A.ACTS.forEach(function (a, i) { var o = el('option', { value: String(i), text: a.n + ' (' + (a.s + a.l) + ' W)' }); if (i === (p.act == null ? 1 : p.act)) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', function () { p.act = +sel.value; changed(); });
    var rm = el('button', { type: 'button', class: 'btn small danger', text: 'Xóa' });
    rm.addEventListener('click', function () { cfg.people.splice(idx, 1); changed(); renderPeople(); });
    box.appendChild(el('div', { class: 'sub', style: 'flex-direction:row;align-items:center;gap:8px;padding:8px 10px' }, [el('span', { text: 'Người ' + (idx + 1), style: 'font-weight:600;white-space:nowrap;font-size:13px' }), sel, rm]));
  });
}
function renderDevices() {
  var add = $('#dev-add'); add.innerHTML = '';
  Object.keys(A.DEVICE_KINDS).forEach(function (k) {
    var b = el('button', { type: 'button', class: 'btn small', text: '+ ' + A.DEVICE_KINDS[k].n });
    b.addEventListener('click', function () {
      if (cfg.devices.length >= 8) return;
      var kd = A.DEVICE_KINDS[k];
      cfg.devices.push({ id: ++devSeq, kind: k, on: true, w: kd.w, x: clamp(RW * (0.25 + 0.15 * (cfg.devices.length % 5)), kd.sw / 2, RW - kd.sw / 2), y: Math.min(kd.y, Math.max(0, RH - kd.sh)) });
      changed(); renderDevices();
    });
    add.appendChild(b);
  });
  var box = $('#dev-list'); box.innerHTML = '';
  $('#dev-empty').hidden = cfg.devices.length > 0;
  cfg.devices.forEach(function (d) {
    var kd = A.DEVICE_KINDS[d.kind];
    var rm = el('button', { type: 'button', class: 'btn small danger', text: 'Xóa' });
    rm.addEventListener('click', function () { cfg.devices.splice(cfg.devices.indexOf(d), 1); changed(); renderDevices(); });
    var cb = el('input', { type: 'checkbox', 'aria-label': 'Bật ' + kd.n }); cb.checked = d.on;
    cb.addEventListener('change', function () { d.on = cb.checked; changed(); });
    var s = el('div', { class: 'sub' }, [el('div', { class: 'hd' }, [el('label', { class: 'check', style: 'align-items:center' }, [cb, el('span', { text: kd.n })]), rm])]);
    s.appendChild(slider('Công suất tỏa nhiệt', 0, kd.wmax, 10, d.w, 'W', function (v) { d.w = v; changed(); }));
    s.appendChild(slider('Vị trí ngang', kd.sw / 2, RW - kd.sw / 2, 0.1, clamp(d.x, kd.sw / 2, RW - kd.sw / 2), 'm', function (v) { d.x = v; changed(); }, 1));
    s.appendChild(slider('Độ cao đáy thiết bị', 0, Math.max(0.1, RH - kd.sh), 0.05, clamp(d.y, 0, Math.max(0.1, RH - kd.sh)), 'm', function (v) { d.y = v; changed(); }, 2));
    box.appendChild(s);
  });
}
function noteSetT() {
  $('#note-setT').textContent = 'Máy chạy hết công suất khi phòng còn cao hơn mức này khoảng 4 °C, rồi giảm dần và dừng ở ' + cfg.setT + ' °C. Đặt cao hơn mục tiêu ' + cfg.target + ' °C thì phòng sẽ không bao giờ xuống tới mục tiêu.';
}
function roomInfo() {
  $('#room-info').textContent = 'Diện tích sàn ' + fmt(cfg.roomW * cfg.depth, 1) + ' m², thể tích ' + fmt(sim.RW * sim.RH * cfg.depth, 1) + ' m³. Chiều cao được làm tròn theo ô lưới (' + fmt(sim.RH, 2) + ' m).';
  var st = surfTemps();
  $('#surf-info').textContent = 'Nhiệt độ mặt ngoài do nắng: mái ' + Math.round(st.roof) + ' °C, tường hướng nắng ' + Math.round(st.sun) + ' °C, tường còn lại ' + Math.round(st.shade) + ' °C (độ tăng do nắng là giả định).';
}
function syncStatic() {
  var sel = $('#sel-cap');
  if (!sel.options.length) CAP_OPTS.forEach(function (o) { var w = Math.round(o[1] * 0.2931 / 10) * 10; sel.appendChild(el('option', { value: String(w), text: fmt(o[0], 1) + ' HP · ' + fmtInt(o[1]) + ' BTU/h · ' + fmt(w / 1000, 1) + ' kW' })); });
  var best = CAP_OPTS[0], bw = 1e9; CAP_OPTS.forEach(function (o) { var d = Math.abs(o[1] * 0.2931 - cfg.cap); if (d < bw) { bw = d; best = o; } });
  sel.value = String(Math.round(best[1] * 0.2931 / 10) * 10); cfg.cap = +sel.value;
  $('#rng-acspeed').value = cfg.acSpeed + 1; $('#val-acspeed').textContent = 'Số ' + (cfg.acSpeed + 1) + ' · gió ra ' + fmt(A.JET[cfg.acSpeed], 1) + ' m/s';
  $('#rng-setT').value = cfg.setT; $('#val-setT').textContent = cfg.setT + ' °C'; noteSetT();
  [['tOut', ' °C'], ['rhOut', ' %'], ['tStart', ' °C'], ['rhStart', ' %'], ['cStart', ' ppm'], ['target', ' °C']].forEach(function (p) { $('#rng-' + p[0]).value = cfg[p[0]]; $('#val-' + p[0]).textContent = fmtInt(cfg[p[0]]) + p[1]; });
  $('#rng-roomW').value = cfg.roomW; $('#val-roomW').textContent = fmt(cfg.roomW, 1) + ' m';
  $('#rng-roomH').value = cfg.roomH; $('#val-roomH').textContent = fmt(cfg.roomH, 1) + ' m';
  $('#rng-depth').value = cfg.depth; $('#val-depth').textContent = fmt(cfg.depth, 1) + ' m';
  roomInfo();
  [['#seg-sun', cfg.sun], ['#seg-sunside', cfg.sunSide], ['#seg-env', cfg.env]].forEach(function (p) { $$(p[0] + ' button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === String(p[1]))); }); });
}
function syncAll() { syncStatic(); renderAC(); renderFans(); renderOpenings(); renderPeople(); renderDevices(); renderChartKeys(); }

/* đổi kích thước phòng: dựng lại lưới và kẹp lại vị trí thiết bị */
function applyRoom(oldRH) {
  sim = new A.Sim(cfg); dims();
  var dH = RH - oldRH;
  cfg.people.forEach(function (p) { p.x = clamp(p.x, 0.3, RW - 0.4); });
  cfg.acs.forEach(function (a) { a.x = clamp(a.x, 0.6, RW - 0.6); a.y = clamp(a.y + dH, 1.6, RH - 0.1); });
  cfg.devices.forEach(function (d) { var kd = A.DEVICE_KINDS[d.kind]; d.x = clamp(d.x, kd.sw / 2, RW - kd.sw / 2); d.y = clamp(d.y, 0, Math.max(0, RH - kd.sh)); });
  cfg.fans.forEach(function (f) {
    if (f.kind === 'stand') { f.x = clamp(f.x, 0.3, RW - 0.3); f.y = clamp(f.y, 0.2, Math.min(1.6, RH - 0.5)); }
    else if (f.kind === 'ceiling') f.x = clamp(f.x, 0.6, RW - 0.6);
    else f.y = clamp(f.y, 0.3, RH - 0.5);
  });
  sim.rebuild(); warm(); resize(); initParticles(); syncAll(); V3.dirty = true; engDirty = true; resetAlarms();
}

function pickSeg(sel, opts, cur, onPick) {
  var box = $(sel);
  opts.forEach(function (o) {
    var b = el('button', { type: 'button', text: o[1], 'data-v': String(o[0]), 'aria-pressed': String(o[0] === cur) });
    b.addEventListener('click', function () { $$('button', box).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true'); onPick(o[0]); });
    box.appendChild(b);
  });
}

function init() {
  var sp = $('#seg-speed');
  SPEEDS.forEach(function (s) {
    var b = el('button', { type: 'button', text: s[1], 'aria-pressed': String(s[0] === ui.speed) });
    b.addEventListener('click', function () { ui.speed = s[0]; $$('button', sp).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true'); });
    sp.appendChild(b);
  });
  pickSeg('#seg-layer', [['T', 'Nhiệt độ'], ['H', 'Độ ẩm'], ['C', 'CO₂'], ['V', 'Tốc độ gió']], ui.layer, function (v) { ui.layer = v; buildLegend(); });
  pickSeg('#seg-view', [['2d', 'Mặt cắt 2D'], ['3d', 'Khối 3D']], ui.view, setView);
  pickSeg('#seg-chart', [['T', 'Nhiệt độ'], ['H', 'Độ ẩm'], ['C', 'CO₂']], ui.chart, function (v) { ui.chart = v; renderChartKeys(); });
  pickSeg('#seg-sun', [[0, 'Râm'], [1, 'Nắng vừa'], [2, 'Nắng gắt']], cfg.sun, function (v) { cfg.sun = +v; changed(); roomInfo(); });
  pickSeg('#seg-sunside', [['L', 'Tường trái'], ['R', 'Tường phải']], cfg.sunSide, function (v) { cfg.sunSide = v; changed(); roomInfo(); });
  pickSeg('#seg-env', [[0, 'Tốt'], [1, 'Thường'], [2, 'Kém']], cfg.env, function (v) { cfg.env = +v; changed(); });
  $('#chk-trails').addEventListener('change', function (e) { ui.trails = e.target.checked; });
  $('#btn-play').addEventListener('click', function () { ui.playing = !ui.playing; this.textContent = ui.playing ? 'Tạm dừng' : 'Chạy tiếp'; });
  $('#btn-reset').addEventListener('click', function () { sim.reset(); warm(); initParticles(); resetAlarms(); });
  if (!ui.playing) $('#btn-play').textContent = 'Chạy tiếp';

  $('#rng-acspeed').addEventListener('input', function (e) { cfg.acSpeed = +e.target.value - 1; $('#val-acspeed').textContent = 'Số ' + e.target.value + ' · gió ra ' + fmt(A.JET[cfg.acSpeed], 1) + ' m/s'; changed(); });
  $('#sel-cap').addEventListener('change', function (e) { cfg.cap = +e.target.value; changed(); });
  function bindRange(key, unit, onChange) {
    $('#rng-' + key).addEventListener('input', function (e) { cfg[key] = +e.target.value; $('#val-' + key).textContent = fmtInt(cfg[key]) + unit; if (onChange) onChange(); });
  }
  bindRange('setT', ' °C', noteSetT);
  bindRange('tOut', ' °C', function () { V3.dirty = true; engDirty = true; roomInfo(); });
  bindRange('rhOut', ' %', function () { V3.dirty = true; engDirty = true; });
  bindRange('target', ' °C', function () { sim.tReach = null; noteSetT(); });
  var tsT = null;
  function restart() { clearTimeout(tsT); tsT = setTimeout(function () { sim.reset(); warm(); resetAlarms(); }, 250); }
  bindRange('tStart', ' °C', restart); bindRange('rhStart', ' %', restart); bindRange('cStart', ' ppm', restart);
  var tr = null;
  function bindRoom(key) {
    $('#rng-' + key).addEventListener('input', function (e) {
      var oldRH = sim.RH; cfg[key] = +e.target.value; $('#val-' + key).textContent = fmt(cfg[key], 1) + ' m';
      clearTimeout(tr); tr = setTimeout(function () { applyRoom(oldRH); }, 220);
    });
  }
  bindRoom('roomW'); bindRoom('roomH'); bindRoom('depth');
  $$('[data-add]').forEach(function (b) { b.addEventListener('click', function () { if (cfg.fans.length >= 6) return; cfg.fans.push(newFan(b.getAttribute('data-add'))); changed(); renderFans(); }); });
  $('#p-plus').addEventListener('click', function () {
    if (cfg.people.length >= 8) return;
    var best = RW / 2, bd = -1;
    for (var x = 0.5; x <= RW - 0.5; x += 0.1) { var md = 1e9; cfg.people.forEach(function (p) { md = Math.min(md, Math.abs(p.x - x)); }); if (md > bd) { bd = md; best = x; } }
    cfg.people.push({ x: best, act: 1 }); changed(); renderPeople();
  });
  syncAll();
  initDrag();
  initCompare();
}

/* kéo thả trên hình 2D */
function initDrag() {
  var drag = null;
  function world(e) { var r = cv.getBoundingClientRect(), k = cv.width / r.width; return { x: ((e.clientX - r.left) * k) / sc - PAD.l, y: RH - (((e.clientY - r.top) * k) / sc - PAD.t) }; }
  function pick(w) {
    var best = null, bd = 1e9;
    HIT.forEach(function (h) { var dx = (w.x - h.x) / h.rx, dy = (w.y - h.y) / h.ry, d = dx * dx + dy * dy; if (d < 1 && d < bd) { bd = d; best = h; } });
    return best;
  }
  cv.addEventListener('pointerdown', function (e) {
    var w = world(e), h = pick(w);
    if (!h) return;
    drag = h; cv.setPointerCapture(e.pointerId); cv.classList.add('grabbing'); e.preventDefault();
  });
  cv.addEventListener('pointermove', function (e) {
    var w = world(e);
    if (drag) moveDevice(drag, w.x, w.y);
    else {
      cv.classList.toggle('grab', !!pick(w));
      hover = (w.x >= 0 && w.x <= RW && w.y >= 0 && w.y <= RH) ? w : null;
      if (!hover) $('#probe').hidden = true;
    }
  });
  function end() { if (drag) { drag = null; cv.classList.remove('grabbing'); renderAC(); renderFans(); renderPeople(); renderDevices(); } }
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', function () { hover = null; $('#probe').hidden = true; });
}

/* ---------- so sánh phương án ---------- */
var results = {}, running = false;
function cfgForCompare(preset) {
  var c = preset.cfg(cfg);
  ['tOut', 'rhOut', 'tStart', 'rhStart', 'cStart', 'target', 'setT', 'sun', 'sunSide', 'env', 'cap', 'acSpeed'].forEach(function (k) { c[k] = cfg[k]; });
  c.people = cfg.people.map(function (p) { return { x: p.x, act: p.act }; });
  c.devices = cfg.devices.map(function (d) { return JSON.parse(JSON.stringify(d)); });
  return c;
}
function initCompare() { renderCompare(); $('#btn-compare').addEventListener('click', runCompare); }
function best(key, lower) {
  var b = null;
  PRESETS.forEach(function (p) { var r = results[p.id]; if (!r || r[key] === null || r[key] === undefined) return; if (b === null || (lower ? r[key] < results[b][key] : r[key] > results[b][key])) b = p.id; });
  return b;
}
function renderCompare() {
  var body = $('#cmp-body'); body.innerHTML = '';
  var bTime = best('tReach', true), b10 = best('tp10', true), b20 = best('tPeople', true), bC = best('cPeople', true), bS = best('tStd', true), bSt = best('stuff', true);
  var maxT = 20;
  PRESETS.forEach(function (p) {
    var r = results[p.id], tr = el('tr');
    var name = el('td', {}, [el('span', { class: 'nm', text: p.name }), el('span', { class: 'ds', text: p.desc })]);
    var view = el('button', { type: 'button', class: 'btn small', text: 'Xem trên hình', style: 'margin-top:6px' });
    view.addEventListener('click', function () { loadPreset(p); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    name.appendChild(view);
    tr.appendChild(name);
    function td(txt, cls) { return el('td', { class: cls || '', html: txt }); }
    if (!r) { for (var i = 0; i < 9; i++) tr.appendChild(td('—', 'pending')); body.appendChild(tr); return; }
    var reach = r.tReach === null ? '<span class="barcell"><span>không đạt</span><i class="miss" style="width:100px"></i></span>' : '<span class="barcell"><span>' + fmt(r.tReach / 60, 1) + '</span><i style="width:' + Math.max(2, r.tReach / 60 / maxT * 100) + 'px"></i></span>';
    tr.appendChild(td(reach, p.id === bTime ? 'best' : (r.tReach === null ? 'bad' : '')));
    tr.appendChild(td(r.tp10 === null ? '—' : fmt(r.tp10, 1), p.id === b10 ? 'best' : ''));
    tr.appendChild(td(fmt(r.tPeople, 1), p.id === b20 ? 'best' : ''));
    tr.appendChild(td(String(Math.round(r.rhPeople * 100)), r.rhPeople > 0.7 ? 'bad' : ''));
    tr.appendChild(td(fmt(r.draft, 2), r.draft > 0.5 ? 'bad' : ''));
    tr.appendChild(td(fmtInt(r.cPeople), p.id === bC ? 'best' : (r.cPeople > 1500 ? 'bad' : '')));
    tr.appendChild(td(String(Math.round(r.stuff)), p.id === bSt ? 'best' : (r.stuff > 50 ? 'bad' : '')));
    tr.appendChild(td(fmt(r.tStd, 2), p.id === bS ? 'best' : ''));
    tr.appendChild(td(fmt(r.ach, 1), ''));
    body.appendChild(tr);
  });
  var tk = $('#takeaways');
  if (Object.keys(results).length === PRESETS.length) {
    tk.hidden = false; tk.innerHTML = '';
    var nm = function (id) { return id ? PRESETS.filter(function (p) { return p.id === id; })[0].name : 'Không phương án nào đạt'; };
    var add = function (k, id, extra) { tk.appendChild(el('div', { class: 'take' }, [el('div', { class: 'k', text: k }), el('div', { class: 'v', text: nm(id) }), el('div', { class: 'k', text: extra || '' })])); };
    add('Đạt ' + cfg.target + ' °C tại người sớm nhất', bTime, bTime ? fmt(results[bTime].tReach / 60, 1) + ' phút' : '');
    add('Ít ngột ngạt nhất', bSt, bSt ? Math.round(results[bSt].stuff) + ' / 100' : '');
    add('CO₂ thấp nhất', bC, bC ? fmtInt(results[bC].cPeople) + ' ppm' : '');
  } else tk.hidden = true;
}
function loadPreset(p) {
  var c = cfgForCompare(p);
  cfg = c; sim = new A.Sim(c); dims(); warm(); resize(); initParticles(); syncAll(); V3.dirty = true; engDirty = true; resetAlarms();
}
var workers = [];
function runCompare() {
  if (running) return;
  running = true; results = {}; renderCompare();
  var btn = $('#btn-compare'), bar = $('#cmp-bar'), st = $('#cmp-status');
  btn.disabled = true; btn.textContent = 'Đang chạy…';
  var queue = PRESETS.slice(), done = 0, prog = {}, TMAX = 1200;
  function updBar() { var s = done; for (var k in prog) s += prog[k]; bar.style.width = (s / PRESETS.length * 100) + '%'; st.textContent = done + '/' + PRESETS.length + ' phương án'; }
  function terminate() { workers.forEach(function (w) { w.terminate(); }); workers = []; }
  function finish() { running = false; btn.disabled = false; btn.textContent = 'Chạy lại so sánh'; st.textContent = 'Xong'; bar.style.width = '100%'; renderCompare(); terminate(); }
  function runSerial() {
    queue = PRESETS.filter(function (p) { return !results[p.id]; }); done = Object.keys(results).length; prog = {};
    var cur = null, s2 = null;
    function tick() {
      if (!running) return;
      var t0 = performance.now();
      while (performance.now() - t0 < 12) {
        if (!s2) { cur = queue.shift(); if (!cur) { finish(); return; } s2 = new A.Sim(cfgForCompare(cur)); }
        s2.step(); if (s2.stepN % 300 === 0) prog[cur.id] = s2.t / TMAX;
        if (s2.t >= TMAX) { results[cur.id] = s2.summary(); delete prog[cur.id]; done++; s2 = null; renderCompare(); }
      }
      updBar(); setTimeout(tick, 0);
    }
    tick();
  }
  if (typeof Worker !== 'undefined') {
    try {
      var src = document.getElementById('sim-src').textContent +
        ';self.onmessage=function(e){var d=e.data,sim=new AirSim.Sim(d.cfg);while(sim.t<d.tmax){sim.step();if(sim.stepN%300===0)self.postMessage({id:d.id,p:sim.t/d.tmax});}' +
        'self.postMessage({id:d.id,done:1,summary:sim.summary()});};';
      var blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      var n = clamp((navigator.hardwareConcurrency || 4) - 1, 2, 4);
      var next = function (w) { var p = queue.shift(); if (p) w.postMessage({ id: p.id, cfg: cfgForCompare(p), tmax: TMAX }); };
      for (var i = 0; i < n; i++) {
        (function () {
          var w = new Worker(blobUrl); workers.push(w);
          w.onmessage = function (e) {
            var d = e.data;
            if (d.done) { results[d.id] = d.summary; delete prog[d.id]; done++; renderCompare(); updBar(); if (done === PRESETS.length) finish(); else next(w); }
            else { prog[d.id] = d.p; updBar(); }
          };
          w.onerror = function () { terminate(); runSerial(); };
          next(w);
        })();
      }
      return;
    } catch (err) { terminate(); }
  }
  runSerial();
}

/* ---------- khởi động ---------- */
function warm() { for (var i = 0; i < 80; i++) sim.step(); }
readTokens();
new MutationObserver(readTokens).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTokens);
window.addEventListener('resize', resize);
resize();
init();
init3D();
warm(); initParticles();
requestAnimationFrame(frame);
})();
