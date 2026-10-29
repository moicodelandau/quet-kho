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
function mmss(t) { var m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + (s < 10 ? '0' : '') + s; }

/* ---------- trạng thái ---------- */
var cfg = A.defaultCfg();
var sim = new A.Sim(cfg);
var H, RW, RH, NXI, NYI, DEPTH;
function dims() { H = sim.H; RW = sim.RW; RH = sim.RH; NXI = sim.NXI; NYI = sim.NYI; DEPTH = cfg.depth; }
dims();
var ui = { playing: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, speed: 24, layer: 'T', trails: true, view: '2d' };
var SPEEDS = [[3, '×3'], [6, '×6'], [24, '×24'], [72, '×72'], [180, '×180']];
var fanSeq = 1, hover = null, V3 = { on: false, ok: false, dirty: true };
function changed() { sim.rebuild(); V3.dirty = true; }

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
function buildLegend() {
  var r = RAMPS[ui.layer], st = r[DARK ? 'dark' : 'light'], stops = st.map(function (s) {
    return 'rgb(' + s[1] + ',' + s[2] + ',' + s[3] + ') ' + ((s[0] - r.lo) / (r.hi - r.lo) * 100).toFixed(1) + '%';
  });
  $('#legend-bar').style.background = 'linear-gradient(90deg,' + stops.join(',') + ')';
  $('#legend-title').textContent = r.title;
  var tk = $('#legend-ticks'); tk.innerHTML = '';
  r.ticks.forEach(function (v) { tk.appendChild(el('span', { text: String(v).replace('.', ','), style: 'left:' + ((v - r.lo) / (r.hi - r.lo) * 100).toFixed(1) + '%' })); });
}

/* ---------- canvas 2D ---------- */
var cv = $('#view'), ctx = cv.getContext('2d');
var PAD = { l: 0.5, r: 0.5, t: 0.2, b: 0.2 }, WW = 5.8, WH = 3.2;
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
  ch.width = Math.round(cw * dpr); ch.height = Math.round(150 * dpr);
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
  drawAC(); drawPeople(); drawFans();
  if (hover) drawProbe();
}
function drawWalls() {
  var lw = Math.max(3, sc * 0.045), k;
  ctx.lineWidth = lw; ctx.strokeStyle = TOK.ink; ctx.lineCap = 'butt';
  function seg(x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(X(x0), Y(y0)); ctx.lineTo(X(x1), Y(y1)); ctx.stroke(); }
  seg(-lw / sc / 2, 0, RW + lw / sc / 2, 0); seg(-lw / sc / 2, RH, RW + lw / sc / 2, RH);
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
      ctx.fillStyle = TOK.muted; ctx.font = Math.round(sc * 0.095) + 'px IBM Plex Mono, monospace';
      ctx.textAlign = wall === 'L' ? 'right' : 'left';
      ctx.fillText(Math.round(cfg.tOut) + '°', X(xs) + (wall === 'L' ? -sc * 0.1 : sc * 0.1), Y((r[0] + r[1]) / 2) + sc * 0.03);
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
    if (ac && bb) HIT.push({ kind: 'ac', ref: ac, x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2, rx: Math.max(0.3, (bb.x1 - bb.x0) / 2 + 0.1), ry: Math.max(0.3, (bb.y1 - bb.y0) / 2 + 0.1) });
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
function fanLabel(f, x, y) {
  var lvl = clamp(f.speed | 0, 1, 5);
  ctx.fillStyle = TOK.ink; ctx.font = '600 ' + Math.round(sc * 0.1) + 'px Archivo, sans-serif'; ctx.textAlign = 'center';
  var tx = 'Số ' + lvl; var w = ctx.measureText(tx).width + sc * 0.1;
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
    } else {
      var xs = f.side === 'L' ? 0.0 : RW, sg = f.side === 'L' ? 1 : -1;
      ctx.beginPath(); ctx.arc(X(xs + sg * 0.1), Y(f.y), sc * 0.14, 0, 6.283); ctx.fill(); ctx.stroke();
      for (var q = 0; q < 3; q++) { var a = spin * (0.5 + f.ach / 12) + q * 2.09; ctx.beginPath(); ctx.moveTo(X(xs + sg * 0.1), Y(f.y)); ctx.lineTo(X(xs + sg * 0.1) + Math.cos(a) * sc * 0.12, Y(f.y) + Math.sin(a) * sc * 0.12); ctx.stroke(); }
      arrow(xs + sg * 0.1, f.y, xs - sg * 0.2, f.y, TOK.accent);
      HIT.push({ kind: 'fan', ref: f, x: xs + sg * 0.1, y: f.y, rx: 0.3, ry: 0.3 });
    }
  });
}
function drawProbe() {
  var c = sim.idx(sim.ci(hover.x), sim.cj(hover.y)); if (!sim.s[c]) return;
  ctx.strokeStyle = TOK.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(hover.x), Y(hover.y), sc * 0.05, 0, 6.283); ctx.stroke();
  var pr = $('#probe'); pr.hidden = false;
  pr.textContent = fmt(sim.T[c], 1) + ' °C · ' + Math.round(sim.C[c]) + ' ppm · ' + fmt(sim.cellSpeed(c), 2) + ' m/s';
}

/* ---------- khối 3D (three.js) ---------- */
function resize3D() {
  if (!V3.ok) return;
  var w = $('#view3d').parentNode.clientWidth || 700, h = Math.round(w * 10 / 16);
  V3.renderer.setSize(w, h, false); V3.camera.aspect = w / h; V3.camera.updateProjectionMatrix();
}
function init3D() {
  if (!window.THREE) { $$('#seg-view button')[1].disabled = true; $$('#seg-view button')[1].title = 'Không tải được thư viện 3D'; return; }
  try {
    var T = THREE;
    V3.renderer = new T.WebGLRenderer({ canvas: $('#view3d'), antialias: true });
    V3.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    V3.scene = new T.Scene();
    V3.camera = new T.PerspectiveCamera(38, 1.6, 0.1, 200);
    V3.scene.add(new T.AmbientLight(0xffffff, 0.85));
    var dl = new T.DirectionalLight(0xffffff, 0.5); dl.position.set(3, 8, 6); V3.scene.add(dl);
    V3.group = new T.Group(); V3.scene.add(V3.group);
    V3.az = 0.55; V3.el = 0.32; V3.zoom = 1;
    V3.sliceTex = new T.CanvasTexture(off);
    V3.floorCv = document.createElement('canvas'); V3.floorCv.width = 60; V3.floorCv.height = 1;
    V3.ceilCv = document.createElement('canvas'); V3.ceilCv.width = 60; V3.ceilCv.height = 1;
    V3.floorTex = new T.CanvasTexture(V3.floorCv); V3.ceilTex = new T.CanvasTexture(V3.ceilCv);
    [V3.sliceTex, V3.floorTex, V3.ceilTex].forEach(function (t) { t.minFilter = T.LinearFilter; t.magFilter = T.LinearFilter; t.generateMipmaps = false; });
    // đường vệt gió
    var nSeg = NP * (TR - 1);
    V3.lineGeo = new T.BufferGeometry();
    V3.linePos = new Float32Array(nSeg * 2 * 3);
    V3.lineGeo.setAttribute('position', new T.BufferAttribute(V3.linePos, 3));
    V3.lines = new T.LineSegments(V3.lineGeo, new T.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
    V3.lines.frustumCulled = false; V3.scene.add(V3.lines);
    V3.spinners = [];
    var cv3 = $('#view3d'), pts = {}, last = null;
    cv3.addEventListener('pointerdown', function (e) { cv3.setPointerCapture(e.pointerId); pts[e.pointerId] = { x: e.clientX, y: e.clientY }; last = null; });
    cv3.addEventListener('pointermove', function (e) {
      var p = pts[e.pointerId]; if (!p) return;
      var ids = Object.keys(pts);
      if (ids.length === 1) {
        V3.az -= (e.clientX - p.x) * 0.008; V3.el = clamp(V3.el + (e.clientY - p.y) * 0.006, -0.1, 1.45);
      } else if (ids.length === 2) {
        var o = pts[ids[0] === String(e.pointerId) ? ids[1] : ids[0]];
        var d0 = Math.hypot(p.x - o.x, p.y - o.y), d1 = Math.hypot(e.clientX - o.x, e.clientY - o.y);
        if (d0 > 0) V3.zoom = clamp(V3.zoom * d0 / d1, 0.4, 2.2);
      }
      p.x = e.clientX; p.y = e.clientY;
    });
    function up(e) { delete pts[e.pointerId]; }
    cv3.addEventListener('pointerup', up); cv3.addEventListener('pointercancel', up);
    cv3.addEventListener('wheel', function (e) { e.preventDefault(); V3.zoom = clamp(V3.zoom * (e.deltaY > 0 ? 1.08 : 0.92), 0.4, 2.2); }, { passive: false });
    V3.ok = true; resize3D();
  } catch (err) { V3.ok = false; var b = $$('#seg-view button')[1]; b.disabled = true; b.title = 'Trình duyệt không hỗ trợ WebGL'; }
}
function disposeGroup(g) {
  for (var i = g.children.length - 1; i >= 0; i--) {
    var c = g.children[i]; disposeGroup(c); g.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) { if (c.material.dispose) c.material.dispose(); }
  }
}
function build3D() {
  var T = THREE, g = V3.group, Dp = DEPTH;
  disposeGroup(g); V3.spinners = [];
  var ink = new T.Color(TOK.ink), accent = new T.Color(TOK.accent), surf = new T.Color(TOK.surface);
  function lam(c, o) { return new T.MeshLambertMaterial(Object.assign({ color: c }, o || {})); }
  function box(w, h, d, m, x, y, z) { var b = new T.Mesh(new T.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b; }
  function edges(mesh, color) { var l = new T.LineSegments(new T.EdgesGeometry(mesh.geometry), new T.LineBasicMaterial({ color: color })); mesh.add(l); }
  // khung phòng
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
  // tường bên (kính mờ) và cửa
  [0, RW].forEach(function (x) {
    var w = new T.Mesh(new T.PlaneGeometry(Dp, RH), new T.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.05, side: T.DoubleSide, depthWrite: false }));
    w.rotation.y = Math.PI / 2; w.position.set(x, RH / 2, Dp / 2); g.add(w);
  });
  Object.keys(sim.openDefs).forEach(function (k) {
    if (!cfg.open[k]) return;
    var o = sim.openDefs[k], x = o.wall === 'L' ? 0 : RW;
    var m = new T.Mesh(new T.PlaneGeometry(Dp, o.y1 - o.y0), new T.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.35, side: T.DoubleSide, depthWrite: false }));
    m.rotation.y = Math.PI / 2; m.position.set(x, (o.y0 + o.y1) / 2, Dp / 2); g.add(m);
    var ln = new T.LineSegments(new T.EdgesGeometry(m.geometry), new T.LineBasicMaterial({ color: accent })); ln.rotation.copy(m.rotation); ln.position.copy(m.position); g.add(ln);
  });
  // dàn lạnh
  sim.units.forEach(function (u) {
    var wz = u.type.indexOf('wall') === 0 ? 0.9 : (u.type === 'ceil' ? 0.7 : 0.55);
    u.rects.forEach(function (r) {
      var b = box(r.x1 - r.x0, r.y1 - r.y0, wz, lam(surf), (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, Dp / 2); edges(b, ink); g.add(b);
    });
    u.outs.forEach(function (o) {
      [-wz * 0.3, 0, wz * 0.3].forEach(function (dz) {
        var dir = new T.Vector3(o.dx, o.dy, 0).normalize();
        g.add(new T.ArrowHelper(dir, new T.Vector3((o.i - 0.5) * H, (o.j - 0.5) * H, Dp / 2 + dz), 0.5, accent.getHex(), 0.14, 0.08));
      });
    });
  });
  // quạt
  function fanHead(r, dirv, level, grp) {
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
    if (f.kind === 'stand') {
      var el_ = f.elev * Math.PI / 180, d = new T.Vector3(f.dir * Math.cos(el_), Math.sin(el_), 0), z = Dp * 0.5 + (k % 3 - 1) * 0.5;
      var pole = new T.Mesh(new T.CylinderGeometry(0.015, 0.015, f.y, 8), lam(ink)); pole.position.set(f.x, f.y / 2, z); g.add(pole);
      var base = new T.Mesh(new T.CylinderGeometry(0.17, 0.17, 0.03, 20), lam(ink)); base.position.set(f.x, 0.015, z); g.add(base);
      var head = fanHead(0.17, d, f.speed, g); head.position.set(f.x, f.y, z); g.add(head);
    } else if (f.kind === 'ceiling') {
      var fy = RH - 0.3, zc = Dp / 2;
      var rod = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.3, 8), lam(ink)); rod.position.set(f.x, RH - 0.15, zc); g.add(rod);
      var mot = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 0.08, 16), lam(ink)); mot.position.set(f.x, fy, zc); g.add(mot);
      var bl = new T.Group(); bl.position.set(f.x, fy - 0.02, zc);
      for (var i = 0; i < 4; i++) { var pv = new T.Group(); pv.rotation.y = i * Math.PI / 2; pv.add(box(0.5, 0.012, 0.12, lam(ink), 0.33, 0, 0)); bl.add(pv); }
      g.add(bl); V3.spinners.push({ o: bl, s: (0.1 + f.speed * 0.1) * (f.mode === 'down' ? 1 : -1) });
      var d2 = f.mode === 'up' ? 1 : -1;
      g.add(new T.ArrowHelper(new T.Vector3(0, d2, 0), new T.Vector3(f.x, fy - 0.25, zc), 0.45, accent.getHex(), 0.14, 0.08));
    } else {
      var sg = f.side === 'L' ? 1 : -1, xs = f.side === 'L' ? 0.03 : RW - 0.03;
      var eh = fanHead(0.15, new T.Vector3(-sg, 0, 0), 3, g); eh.position.set(xs, f.y, Dp / 2); g.add(eh);
      g.add(new T.ArrowHelper(new T.Vector3(-sg, 0, 0), new T.Vector3(xs, f.y + 0.28, Dp / 2), 0.4, accent.getHex(), 0.12, 0.07));
    }
  });
  // người
  cfg.people.forEach(function (p, k) {
    var z = Dp * [0.42, 0.6, 0.5][k % 3], m = lam(ink);
    g.add(box(0.2, 0.46, 0.28, m, p.x - 0.05, 0.76, z));
    var hd = new T.Mesh(new T.SphereGeometry(0.1, 14, 10), m); hd.position.set(p.x - 0.03, 1.08, z); g.add(hd);
    [-0.09, 0.09].forEach(function (dz) {
      g.add(box(0.36, 0.12, 0.12, m, p.x + 0.12, 0.52, z + dz));
      g.add(box(0.11, 0.46, 0.11, m, p.x + 0.3, 0.26, z + dz));
    });
    var cm = lam(ink, { transparent: true, opacity: 0.6 });
    g.add(box(0.42, 0.04, 0.42, cm, p.x, 0.46, z));
    [[-0.16, -0.17], [-0.16, 0.17], [0.16, -0.17], [0.16, 0.17]].forEach(function (o) { g.add(box(0.03, 0.44, 0.03, cm, p.x + o[0], 0.22, z + o[1])); });
  });
  V3.lines.material.color.set(DARK ? 0xe1f2fa : 0x0a1c26);
  V3.dirty = false;
}
function update3D() {
  if (V3.dirty) build3D();
  var T = THREE, i, j, k;
  fillField();
  // hàng sàn và trần
  var fc = V3.floorCv.getContext('2d'), cc2 = V3.ceilCv.getContext('2d');
  var fr = fc.createImageData(NXI, 1), cr = cc2.createImageData(NXI, 1);
  fr.data.set(img.data.subarray((NYI - 1) * NXI * 4, NYI * NXI * 4)); cr.data.set(img.data.subarray(0, NXI * 4));
  fc.putImageData(fr, 0, 0); cc2.putImageData(cr, 0, 0);
  V3.sliceTex.needsUpdate = true; V3.floorTex.needsUpdate = true; V3.ceilTex.needsUpdate = true;
  V3.spinners.forEach(function (s) { s.o.rotation.y += s.s; });
  // vệt gió
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
  // camera
  var tx = RW / 2, ty = RH * 0.45, tz = DEPTH / 2, dist = Math.max(RW, RH * 1.5, DEPTH) * 1.3 * V3.zoom;
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
function drawChart() {
  var W = ch.width, Hh = ch.height, ser = sim.series, padL = 34 * dpr, padB = 20 * dpr, padT = 8 * dpr, padR = 8 * dpr;
  cc.setTransform(1, 0, 0, 1, 0, 0); cc.clearRect(0, 0, W, Hh);
  var tmax = Math.max(1200, sim.t), ymin = 18, ymax = Math.ceil(Math.max(cfg.tStart + 1, 30) / 2) * 2;
  function px(t) { return padL + (t / tmax) * (W - padL - padR); }
  function py(v) { return padT + (1 - (v - ymin) / (ymax - ymin)) * (Hh - padT - padB); }
  cc.font = (10.5 * dpr) + 'px IBM Plex Mono, monospace'; cc.textBaseline = 'middle'; cc.textAlign = 'right';
  cc.strokeStyle = TOK.line; cc.fillStyle = TOK.muted; cc.lineWidth = 1 * dpr;
  for (var v = ymin; v <= ymax; v += 2) { cc.beginPath(); cc.moveTo(padL, py(v)); cc.lineTo(W - padR, py(v)); cc.stroke(); if ((v - ymin) % 4 === 0) cc.fillText(String(v), padL - 5 * dpr, py(v)); }
  cc.textAlign = 'center'; cc.textBaseline = 'top';
  for (var m = 0; m * 300 <= tmax; m++) cc.fillText(String(m * 5) + "'", px(m * 300), Hh - padB + 4 * dpr);
  cc.setLineDash([5 * dpr, 4 * dpr]); cc.strokeStyle = TOK.good; cc.lineWidth = 1.5 * dpr;
  cc.beginPath(); cc.moveTo(padL, py(cfg.target)); cc.lineTo(W - padR, py(cfg.target)); cc.stroke(); cc.setLineDash([]);
  function line(key, color, w) {
    if (ser.length < 2) return;
    cc.strokeStyle = color; cc.lineWidth = w * dpr; cc.lineJoin = 'round'; cc.beginPath();
    cc.moveTo(px(0), py(cfg.tStart));
    for (var i = 0; i < ser.length; i++) cc.lineTo(px(ser[i].t), py(clamp(ser[i][key], ymin, ymax)));
    cc.stroke();
  }
  line('tz', TOK.muted, 1.6); line('tp', TOK.accent, 2.4);
  if (sim.tReach !== null) { cc.fillStyle = TOK.accent; cc.beginPath(); cc.arc(px(sim.tReach), py(cfg.target), 4 * dpr, 0, 6.283); cc.fill(); }
}

/* ---------- chỉ số ---------- */
function tile(k, v, unit, sub) { return el('div', { class: 'tile' }, [el('div', { class: 'k', text: k }), el('div', { class: 'v', html: v + (unit ? '<small>' + unit + '</small>' : '') }), el('div', { class: 's', html: sub || '&nbsp;' })]); }
function pill(cls, txt) { return '<span class="pill ' + cls + '">' + txt + '</span>'; }
function renderMetrics() {
  var m = sim.computeMetrics(), box = $('#metrics'); box.innerHTML = '';
  var hasP = cfg.people.length > 0;
  box.appendChild(tile(hasP ? 'Nhiệt độ tại người' : 'Nhiệt độ vùng sinh hoạt', fmt(m.tPeople, 1), '°C', 'Cả vùng sinh hoạt ' + fmt(m.tZone, 1) + ' °C'));
  var reach = sim.tReach !== null ? pill('good', 'Đã đạt') : pill('idle', 'Đang chờ');
  box.appendChild(tile('Đạt ' + cfg.target + ' °C sau', sim.tReach !== null ? mmss(sim.tReach) : '—', sim.tReach !== null ? 'phút' : '', reach));
  box.appendChild(tile('Chênh nhiệt trong phòng', '±' + fmt(m.tStd, 1), '°C', 'Lạnh nhất ' + fmt(m.tMin, 1) + ', nóng nhất ' + fmt(m.tMax, 1)));
  var v = m.vPeople, vp = v < 0.2 ? pill('good', 'Êm') : (v <= 0.5 ? pill('warn', 'Gió nhẹ') : pill('bad', 'Dễ bị lùa'));
  box.appendChild(tile('Gió lên người', fmt(v, 2), 'm/s', hasP ? vp : 'Chưa có người'));
  var c = m.cPeople, cp = c < 800 ? pill('good', 'Thoáng') : (c <= 1200 ? pill('warn', 'Hơi ngột') : pill('bad', 'Ngột'));
  box.appendChild(tile('CO₂ tại người', String(Math.round(c)), 'ppm', cp));
  box.appendChild(tile('Khí ngoài vào', fmt(m.ach, 1), 'lần/giờ', m.ach > 0.2 ? 'Mang theo nhiệt từ ngoài' : 'Phòng kín'));
  var load = Math.round((sim.pf == null ? 1 : sim.pf) * 100);
  box.appendChild(tile('Máy lạnh đang chạy', String(load), '% công suất', 'Cài đặt ' + cfg.setT + ' °C'));
}

/* ---------- vòng lặp ---------- */
var last = performance.now(), acc = 0, lastUi = 0, simPerReal = 0;
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
  return f;
}
var FAN_NAMES = { stand: 'Quạt đứng', ceiling: 'Quạt trần', exhaust: 'Quạt hút' };
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
    } else {
      s.appendChild(segment([['L', 'Tường trái'], ['R', 'Tường phải']], f.side, function (v) { f.side = v; changed(); }, 'Vị trí quạt hút'));
      s.appendChild(slider('Độ cao', 0.4, RH - 0.3, 0.05, clamp(f.y, 0.4, RH - 0.3), 'm', function (v) { f.y = v; changed(); }, 2));
      s.appendChild(slider('Lưu lượng hút', 2, 20, 1, f.ach, 'lần/giờ', function (v) { f.ach = v; changed(); }));
    }
    box.appendChild(s);
  });
}
function noteSetT() {
  $('#note-setT').textContent = 'Máy chạy hết công suất khi phòng còn cao hơn mức này khoảng 4 °C, rồi giảm dần và dừng ở ' + cfg.setT + ' °C. Đặt cao hơn mục tiêu ' + cfg.target + ' °C thì phòng sẽ không bao giờ xuống tới mục tiêu.';
}
function roomInfo() {
  $('#room-info').textContent = 'Diện tích sàn ' + fmt(cfg.roomW * cfg.depth, 1) + ' m², thể tích ' + fmt(sim.RW * sim.RH * cfg.depth, 1) + ' m³. Chiều cao được làm tròn theo ô lưới (' + fmt(sim.RH, 2) + ' m).';
}
function syncStatic() {
  $('#sel-cap').value = String(cfg.cap);
  $('#rng-acspeed').value = cfg.acSpeed + 1; $('#val-acspeed').textContent = 'Số ' + (cfg.acSpeed + 1) + ' · gió ra ' + fmt(A.JET[cfg.acSpeed], 1) + ' m/s';
  $('#rng-setT').value = cfg.setT; $('#val-setT').textContent = cfg.setT + ' °C'; noteSetT();
  $('#rng-tOut').value = cfg.tOut; $('#val-tOut').textContent = cfg.tOut + ' °C';
  $('#rng-tStart').value = cfg.tStart; $('#val-tStart').textContent = cfg.tStart + ' °C';
  $('#rng-target').value = cfg.target; $('#val-target').textContent = cfg.target + ' °C';
  $('#rng-roomW').value = cfg.roomW; $('#val-roomW').textContent = fmt(cfg.roomW, 1) + ' m';
  $('#rng-roomH').value = cfg.roomH; $('#val-roomH').textContent = fmt(cfg.roomH, 1) + ' m';
  $('#rng-depth').value = cfg.depth; $('#val-depth').textContent = fmt(cfg.depth, 1) + ' m';
  roomInfo();
  $$('[data-open]').forEach(function (c) { c.checked = !!cfg.open[c.getAttribute('data-open')]; });
  $('#p-count').textContent = cfg.people.length;
}
function syncAll() { syncStatic(); renderAC(); renderFans(); }

/* đổi kích thước phòng: dựng lại lưới và kẹp lại vị trí thiết bị */
function applyRoom(oldRH) {
  var dH = null;
  cfg.roomH = +cfg.roomH;
  sim = new A.Sim(cfg); dims();
  dH = RH - oldRH;
  cfg.people.forEach(function (p) { p.x = clamp(p.x, 0.3, RW - 0.4); });
  cfg.acs.forEach(function (a) { a.x = clamp(a.x, 0.6, RW - 0.6); a.y = clamp(a.y + dH, 1.6, RH - 0.1); });
  cfg.fans.forEach(function (f) {
    if (f.kind === 'stand') { f.x = clamp(f.x, 0.3, RW - 0.3); f.y = clamp(f.y, 0.2, Math.min(1.6, RH - 0.5)); }
    else if (f.kind === 'ceiling') f.x = clamp(f.x, 0.6, RW - 0.6);
    else f.y = clamp(f.y, 0.4, RH - 0.3);
  });
  sim.rebuild(); warm(); resize(); initParticles(); syncAll(); V3.dirty = true;
}

function init() {
  var sp = $('#seg-speed');
  SPEEDS.forEach(function (s) {
    var b = el('button', { type: 'button', text: s[1], 'aria-pressed': String(s[0] === ui.speed) });
    b.addEventListener('click', function () { ui.speed = s[0]; $$('button', sp).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true'); });
    sp.appendChild(b);
  });
  var ly = $('#seg-layer');
  [['T', 'Nhiệt độ'], ['C', 'CO₂'], ['V', 'Tốc độ gió']].forEach(function (s) {
    var b = el('button', { type: 'button', text: s[1], 'aria-pressed': String(s[0] === ui.layer) });
    b.addEventListener('click', function () { ui.layer = s[0]; $$('button', ly).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true'); buildLegend(); });
    ly.appendChild(b);
  });
  var vw = $('#seg-view');
  [['2d', 'Mặt cắt 2D'], ['3d', 'Khối 3D']].forEach(function (s) {
    var b = el('button', { type: 'button', text: s[1], 'aria-pressed': String(s[0] === ui.view) });
    b.addEventListener('click', function () { $$('button', vw).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true'); setView(s[0]); });
    vw.appendChild(b);
  });
  $('#chk-trails').addEventListener('change', function (e) { ui.trails = e.target.checked; });
  $('#btn-play').addEventListener('click', function () { ui.playing = !ui.playing; this.textContent = ui.playing ? 'Tạm dừng' : 'Chạy tiếp'; });
  $('#btn-reset').addEventListener('click', function () { sim.reset(); warm(); initParticles(); });
  if (!ui.playing) $('#btn-play').textContent = 'Chạy tiếp';

  $('#rng-acspeed').addEventListener('input', function (e) { cfg.acSpeed = +e.target.value - 1; $('#val-acspeed').textContent = 'Số ' + e.target.value + ' · gió ra ' + fmt(A.JET[cfg.acSpeed], 1) + ' m/s'; changed(); });
  $('#sel-cap').addEventListener('change', function (e) { cfg.cap = +e.target.value; changed(); });
  function bindRange(id, key, valId, onChange) {
    $(id).addEventListener('input', function (e) { cfg[key] = +e.target.value; $(valId).textContent = cfg[key] + ' °C'; if (onChange) onChange(); });
  }
  bindRange('#rng-setT', 'setT', '#val-setT', noteSetT);
  bindRange('#rng-tOut', 'tOut', '#val-tOut');
  bindRange('#rng-target', 'target', '#val-target', function () { sim.tReach = null; noteSetT(); });
  var tsT = null;
  bindRange('#rng-tStart', 'tStart', '#val-tStart', function () { clearTimeout(tsT); tsT = setTimeout(function () { sim.reset(); warm(); }, 250); });
  var tr = null;
  function bindRoom(id, key, valId) {
    $(id).addEventListener('input', function (e) {
      var oldRH = sim.RH; cfg[key] = +e.target.value; $(valId).textContent = fmt(cfg[key], 1) + ' m';
      clearTimeout(tr); tr = setTimeout(function () { applyRoom(oldRH); oldRH = sim.RH; }, 220);
    });
  }
  bindRoom('#rng-roomW', 'roomW', '#val-roomW'); bindRoom('#rng-roomH', 'roomH', '#val-roomH'); bindRoom('#rng-depth', 'depth', '#val-depth');
  $$('[data-open]').forEach(function (c) { c.addEventListener('change', function () { cfg.open[c.getAttribute('data-open')] = c.checked; changed(); }); });
  $$('[data-add]').forEach(function (b) { b.addEventListener('click', function () { if (cfg.fans.length >= 5) return; cfg.fans.push(newFan(b.getAttribute('data-add'))); changed(); renderFans(); }); });
  var DEF_X = [0.35, 0.69, 0.52];
  $('#p-minus').addEventListener('click', function () { if (cfg.people.length) { cfg.people.pop(); changed(); syncStatic(); } });
  $('#p-plus').addEventListener('click', function () { if (cfg.people.length < 3) { cfg.people.push({ x: RW * DEF_X[cfg.people.length] }); changed(); syncStatic(); } });
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
    if (drag) {
      var r = drag.ref;
      if (drag.kind === 'fan') {
        if (r.kind === 'stand') { r.x = clamp(w.x, 0.3, RW - 0.3); r.y = clamp(w.y, 0.2, Math.min(1.6, RH - 0.5)); }
        else if (r.kind === 'ceiling') r.x = clamp(w.x, 0.6, RW - 0.6);
        else { r.y = clamp(w.y, 0.4, RH - 0.3); r.side = w.x < RW / 2 ? 'L' : 'R'; }
      } else if (drag.kind === 'person') r.x = clamp(w.x - 0.1, 0.3, RW - 0.4);
      else if (drag.kind === 'ac') {
        if (r.type === 'ceil') r.x = clamp(w.x, 0.6, RW - 0.6);
        else if (r.type === 'wallL' || r.type === 'wallR') r.y = clamp(w.y + 0.2, 1.6, RH - 0.1);
      }
      changed();
    } else {
      cv.classList.toggle('grab', !!pick(w));
      hover = (w.x >= 0 && w.x <= RW && w.y >= 0 && w.y <= RH) ? w : null;
      if (!hover) $('#probe').hidden = true;
    }
  });
  function end() { if (drag) { drag = null; cv.classList.remove('grabbing'); renderAC(); renderFans(); } }
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', function () { hover = null; $('#probe').hidden = true; });
}

/* ---------- so sánh phương án ---------- */
var results = {}, running = false;
function cfgForCompare(preset) {
  var c = preset.cfg(cfg);
  ['tOut', 'tStart', 'target', 'setT'].forEach(function (k) { c[k] = cfg[k]; });
  c.people = cfg.people.map(function (p) { return { x: p.x }; });
  c.cap = cfg.cap; c.acSpeed = cfg.acSpeed;
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
  var bTime = best('tReach', true), b10 = best('tp10', true), b20 = best('tPeople', true), bC = best('cPeople', true), bS = best('tStd', true);
  var maxT = 20;
  PRESETS.forEach(function (p) {
    var r = results[p.id], tr = el('tr');
    var name = el('td', {}, [el('span', { class: 'nm', text: p.name }), el('span', { class: 'ds', text: p.desc })]);
    var view = el('button', { type: 'button', class: 'btn small', text: 'Xem trên hình', style: 'margin-top:6px' });
    view.addEventListener('click', function () { loadPreset(p); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    name.appendChild(view);
    tr.appendChild(name);
    function td(txt, cls) { return el('td', { class: cls || '', html: txt }); }
    if (!r) { for (var i = 0; i < 7; i++) tr.appendChild(td('—', 'pending')); body.appendChild(tr); return; }
    var reach = r.tReach === null ? '<span class="barcell"><span>không đạt</span><i class="miss" style="width:100px"></i></span>' : '<span class="barcell"><span>' + fmt(r.tReach / 60, 1) + '</span><i style="width:' + Math.max(2, r.tReach / 60 / maxT * 100) + 'px"></i></span>';
    tr.appendChild(td(reach, p.id === bTime ? 'best' : (r.tReach === null ? 'bad' : '')));
    tr.appendChild(td(r.tp10 === null ? '—' : fmt(r.tp10, 1), p.id === b10 ? 'best' : ''));
    tr.appendChild(td(fmt(r.tPeople, 1), p.id === b20 ? 'best' : ''));
    tr.appendChild(td(fmt(r.draft, 2), r.draft > 0.5 ? 'bad' : ''));
    tr.appendChild(td(String(Math.round(r.cPeople)), p.id === bC ? 'best' : (r.cPeople > 1200 ? 'bad' : '')));
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
    add('Nhiệt độ thấp nhất sau 20 phút', b20, b20 ? fmt(results[b20].tPeople, 1) + ' °C' : '');
    add('CO₂ thấp nhất', bC, bC ? Math.round(results[bC].cPeople) + ' ppm' : '');
  } else tk.hidden = true;
}
function loadPreset(p) {
  var c = cfgForCompare(p);
  cfg = c; sim = new A.Sim(c); dims(); warm(); resize(); initParticles(); syncAll(); V3.dirty = true;
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
