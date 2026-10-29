/* Lõi mô phỏng luồng gió 2D (mặt cắt đứng của phòng).
 * Lưới MAC, giải tích phân bán-Lagrange + chiếu áp suất (Gauss-Seidel), nổi do nhiệt (Boussinesq),
 * thêm trường nhiệt độ, CO2 và khối nhiệt (tường/đồ đạc).
 * Kích thước phòng đổi được: lưới luôn 60 cột, cạnh ô = chiều rộng / 60.
 * Đây là mô hình định tính: 2D không tái hiện được dòng bám trần (Coanda) hay luồng ngang theo chiều sâu phòng. */
(function (root) {
  'use strict';

  var NXI = 60;                 // số cột bên trong, cố định
  var DT = 0.1, ITER = 18, OVR = 1.8;
  var RHO_CP = 1.2 * 1005;      // J/(m3 K)
  var G_BETA = 9.81 / 303;
  var TAU_A = 240, R_MASS = 8, TAU_ENV = 5000;   // trao đổi không khí <-> khối nhiệt, và khối nhiệt <-> ngoài trời
  var DRAG = 0.05, KDIFF = 0.05;
  var C_OUT = 420;
  var JET = [0.5, 0.7, 0.9, 1.1, 1.3];                 // vận tốc gió ra dàn lạnh theo 5 mức (m/s)
  var STAND_V = [1.0, 1.8, 2.6, 3.4, 4.2];             // quạt đứng
  var CEIL_V = [0.4, 0.7, 1.0, 1.3, 1.6];              // quạt trần
  var REF_VOL = 4.8 * 2.8 * 4.0;                       // thể tích chuẩn để quy đổi CO2 (m3)

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }

  function openings(rh) {
    return {
      winL:  { wall: 'L', y0: 1.0, y1: Math.min(1.9, rh - 0.4) },
      ventR: { wall: 'R', y0: rh - 0.7, y1: rh - 0.2 },
      doorR: { wall: 'R', y0: 0.0, y1: 0.5 }
    };
  }

  function defaultCfg() {
    return {
      roomW: 4.8, roomH: 2.8, depth: 4.0,
      tOut: 33, tStart: 32, target: 26, cStart: 1000,
      cap: 3520, acSpeed: 2, supplyT: 14, setT: 22,
      acs: [
        { type: 'wallL',  on: true,  angle: 25, y: 2.6, x: 2.4 },
        { type: 'wallR',  on: false, angle: 25, y: 2.6, x: 2.4 },
        { type: 'ceil',   on: false, angle: 20, y: 2.6, x: 2.4 },
        { type: 'floorL', on: false, angle: 60, y: 0, x: 0 },
        { type: 'floorR', on: false, angle: 60, y: 0, x: 0 }
      ],
      fans: [],
      open: { winL: false, ventR: false, doorR: false },
      people: [{ x: 1.7 }, { x: 3.3 }]
    };
  }

  function Sim(cfg) {
    var H = cfg.roomW / NXI, NYI = Math.max(16, Math.round(cfg.roomH / H));
    this.H = H; this.NXI = NXI; this.NYI = NYI; this.NX = NXI + 2; this.NY = NYI + 2; this.N = this.NX * this.NY;
    this.RW = NXI * H; this.RH = NYI * H; this.AREA = this.RW * this.RH; this.depth = cfg.depth;
    this.openDefs = openings(this.RH);
    var N = this.N;
    this.u = new Float32Array(N); this.v = new Float32Array(N);
    this.nu = new Float32Array(N); this.nv = new Float32Array(N);
    this.s = new Uint8Array(N); this.open = new Uint8Array(N);
    this.T = new Float32Array(N); this.nT = new Float32Array(N);
    this.C = new Float32Array(N); this.nC = new Float32Array(N);
    this.Tm = new Float32Array(N);
    this.src = new Float32Array(N);
    this.cfg = cfg;
    this.rebuild();
    this.reset();
  }

  Sim.prototype.idx = function (i, j) { return i * this.NY + j; };
  Sim.prototype.ci = function (x) { return clamp(Math.floor(x / this.H) + 1, 1, this.NXI); };
  Sim.prototype.cj = function (y) { return clamp(Math.floor(y / this.H) + 1, 1, this.NYI); };

  Sim.prototype.reset = function () {
    var cfg = this.cfg;
    this.u.fill(0); this.v.fill(0);
    this.T.fill(cfg.tStart); this.Tm.fill(cfg.tStart - 0.5); this.C.fill(cfg.cStart);
    this.t = 0; this.stepN = 0;
    this.series = [];
    this.tReach = null; this.snap10 = null;
    this.draftSum = 0; this.draftN = 0; this.achSum = 0; this.achN = 0;
    this.m = null;
    this.tCtl = cfg.tStart;
  };

  /* Dựng lại hình học, nguồn/bể từ cấu hình (giữ nguyên các trường đang chạy). */
  Sim.prototype.rebuild = function () {
    var cfg = this.cfg, s = this.s, open = this.open, src = this.src, i, j, c, k;
    var H = this.H, NX = this.NX, NY = this.NY, NXI = this.NXI, NYI = this.NYI, self = this;
    function idx(a, b) { return a * NY + b; }
    s.fill(1); open.fill(0); src.fill(0);
    for (i = 0; i < NX; i++) for (j = 0; j < NY; j++) {
      if (i === 0 || i === NX - 1 || j === 0 || j === NY - 1) s[idx(i, j)] = 0;
    }
    this.hasOpen = false;
    for (k in this.openDefs) {
      if (!cfg.open[k]) continue;
      var o = this.openDefs[k], j0 = this.cj(o.y0), j1 = this.cj(o.y1 - 1e-6), ii = o.wall === 'L' ? 0 : NX - 1;
      for (j = j0; j <= j1; j++) { c = idx(ii, j); s[c] = 1; open[c] = 1; }
      this.hasOpen = true;
    }

    this.units = []; this.fanList = []; this.exhaust = [];
    var active = cfg.acs.filter(function (a) { return a.on; });
    var vjet = JET[clamp(cfg.acSpeed | 0, 0, 4)];
    for (k = 0; k < active.length; k++) this.addUnit(active[k], cfg.cap / active.length, vjet);

    for (k = 0; k < cfg.fans.length; k++) {
      var f = cfg.fans[k];
      if (!f.on) continue;
      if (f.kind === 'exhaust') {
        var ie = f.side === 'L' ? 1 : NXI, ja = this.cj(f.y - 0.12), jb = this.cj(f.y + 0.12), cells = [];
        for (j = ja; j <= jb; j++) if (s[idx(ie, j)]) cells.push(idx(ie, j));
        var q = f.ach * this.AREA / 3600;   // m2/s trên mỗi mét sâu
        for (var e = 0; e < cells.length; e++) src[cells[e]] -= q / H / cells.length;
        this.exhaust.push({ cells: cells });
      } else this.fanList.push(f);
    }

    // người: ô nhiệt + CO2 + vùng đo
    var vol = this.AREA * cfg.depth, nCells = NXI * NYI;
    this.pcells = [];
    for (k = 0; k < cfg.people.length; k++) {
      var px = cfg.people[k].x, ia = this.ci(px - 0.22), ib = this.ci(px + 0.22), j2 = this.cj(0.30), j3 = this.cj(1.15);
      for (i = ia; i <= ib; i++) for (j = j2; j <= j3; j++) if (s[idx(i, j)]) this.pcells.push(idx(i, j));
    }
    var personHeat = 100 / (vol * RHO_CP), personCO2 = 0.085 * REF_VOL / vol;   // trung bình toàn phòng cho mỗi người
    this.pHeat = this.pcells.length ? personHeat * cfg.people.length * nCells / this.pcells.length : 0;
    this.pCO2 = this.pcells.length ? personCO2 * cfg.people.length * nCells / this.pcells.length : 0;

    // vùng sinh hoạt 0.1 - 1.8 m
    this.zone = [];
    var za = this.cj(0.1), zb = this.cj(Math.min(1.8, this.RH - 0.3));
    for (i = 1; i <= NXI; i++) for (j = za; j <= zb; j++) if (s[idx(i, j)]) this.zone.push(idx(i, j));

    // nếu phòng kín thì bỏ phần dư khối lượng của nguồn/bể
    if (!this.hasOpen) {
      var net = 0, nf = 0;
      for (i = 1; i <= NXI; i++) for (j = 1; j <= NYI; j++) { c = idx(i, j); if (s[c]) { net += src[c]; nf++; } }
      if (nf) { var mean = net / nf; for (i = 1; i <= NXI; i++) for (j = 1; j <= NYI; j++) { c = idx(i, j); if (s[c]) src[c] -= mean; } }
    }
  };

  Sim.prototype.solidRect = function (i0, i1, j0, j1) {
    var H = this.H, NY = this.NY;
    if (this._rects) this._rects.push({ x0: (i0 - 1) * H, x1: i1 * H, y0: (j0 - 1) * H, y1: j1 * H });
    for (var i = i0; i <= i1; i++) for (var j = j0; j <= j1; j++) {
      if (i >= 1 && i <= this.NXI && j >= 1 && j <= this.NYI) this.s[i * NY + j] = 0;
    }
  };

  Sim.prototype.addUnit = function (ac, power, vjet) {
    var H = this.H, NY = this.NY, NXI = this.NXI, NYI = this.NYI;
    function mc(m, min) { return Math.max(min, Math.round(m / H)); }   // mét -> số ô
    this._rects = [];
    var outs = [], ins = [], a = ac.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), i, j, jt;
    var M = function (iL) { return NXI + 1 - iL; };
    switch (ac.type) {
      case 'wallL': case 'wallR':
        var bd = mc(0.25, 2), bh = mc(0.32, 3);
        jt = clamp(this.cj(ac.y - 1e-6), bh + 3, NYI);
        var R = ac.type === 'wallR', dx = R ? -ca : ca;
        this.solidRect(R ? M(bd) : 1, R ? M(1) : bd, jt - bh + 1, jt);
        this.solidRect(R ? M(bd - 1) : 1, R ? M(1) : bd - 1, jt - bh, jt - bh);     // máng dẫn gió: ô gió ra ở góc dưới phía trước
        outs.push({ i: R ? M(bd) : bd, j: jt - bh, dx: dx, dy: -sa });
        // hồi gió ở mặt trên dàn lạnh (nếu sát trần thì lấy ở mặt trước phía trên)
        if (jt + 1 <= NYI) {
          for (i = 1; i <= bd; i++) { ins.push({ i: R ? M(i) : i, j: jt + 1 }); if (jt + 2 <= NYI) ins.push({ i: R ? M(i) : i, j: jt + 2 }); }
        } else ins.push({ i: R ? M(bd + 1) : bd + 1, j: jt }, { i: R ? M(bd + 1) : bd + 1, j: jt - 1 });
        break;
      case 'ceil':
        var bw = mc(0.36, 3), ic = clamp(this.ci(ac.x), bw + 2, NXI - bw - 1);
        this.solidRect(ic - bw, ic + bw, NYI - 1, NYI);
        outs.push({ i: ic - bw - 1, j: NYI, dx: -ca, dy: -sa }, { i: ic + bw + 1, j: NYI, dx: ca, dy: -sa });
        for (i = ic - 1; i <= ic + 1; i++) ins.push({ i: i, j: NYI - 2 });
        break;
      case 'floorL': case 'floorR':
        var Rr = ac.type === 'floorR', dxf = Rr ? -ca : ca, fd = mc(0.32, 3), fh = clamp(mc(1.6, 6), 6, NYI - 4);
        this.solidRect(Rr ? M(fd) : 1, Rr ? M(1) : fd, 1, fh);
        this.solidRect(Rr ? M(1) : 1, Rr ? M(1) : 1, fh + 1, fh + 1);
        for (i = 2; i <= fd - 1; i++) outs.push({ i: Rr ? M(i) : i, j: fh + 1, dx: dxf, dy: sa });
        for (j = mc(0.25, 2); j <= mc(0.5, 4); j++) ins.push({ i: Rr ? M(fd + 1) : fd + 1, j: j });
        break;
    }
    var nOut = outs.length, nIn = ins.length, w = nOut * H;
    // độ chênh nhiệt gió ra - hồi gió để công suất lạnh = P/depth trên mỗi mét sâu
    var dTs = (power / this.depth) / (RHO_CP * w * vjet);
    for (var o = 0; o < nOut; o++) { outs[o].c = outs[o].i * NY + outs[o].j; this.src[outs[o].c] += vjet; }
    for (var n = 0; n < nIn; n++) { ins[n].c = ins[n].i * NY + ins[n].j; this.src[ins[n].c] -= nOut * vjet / nIn; }
    this.units.push({ outs: outs, ins: ins, dTs: dTs, v: vjet, rects: this._rects, type: ac.type, power: power });
    this._rects = null;
  };

  Sim.prototype.sample = function (f, x, y, dx, dy) {
    var n = this.NY, h = this.H, h1 = 1 / h, NX = this.NX, NY = this.NY;
    x = Math.max(Math.min(x, NX * h), h); y = Math.max(Math.min(y, NY * h), h);
    var x0 = Math.min(Math.floor((x - dx) * h1), NX - 1), tx = ((x - dx) - x0 * h) * h1, x1 = Math.min(x0 + 1, NX - 1);
    var y0 = Math.min(Math.floor((y - dy) * h1), NY - 1), ty = ((y - dy) - y0 * h) * h1, y1 = Math.min(y0 + 1, NY - 1);
    var sx = 1 - tx, sy = 1 - ty;
    return sx * sy * f[x0 * n + y0] + tx * sy * f[x1 * n + y0] + tx * ty * f[x1 * n + y1] + sx * ty * f[x0 * n + y1];
  };

  /* kéo vận tốc các mặt trong vùng (toạ độ thế giới, m) về vận tốc đích */
  Sim.prototype.relax = function (x0, x1, y0, y1, tx, ty, k, round, cx, cy, r) {
    var s = this.s, u = this.u, v = this.v, i, j, c, w, xw, yw, H = this.H, NY = this.NY;
    var ia = Math.max(1, Math.floor(x0 / H) + 1), ib = Math.min(this.NXI + 1, Math.floor(x1 / H) + 2);
    var ja = Math.max(1, Math.floor(y0 / H) + 1), jb = Math.min(this.NYI + 1, Math.floor(y1 / H) + 2);
    for (i = ia; i <= ib; i++) for (j = ja; j <= jb; j++) {
      c = i * NY + j;
      if (s[c] && s[c - NY]) {          // mặt u: (i-1)H, (j-0.5)H
        xw = (i - 1) * H; yw = (j - 0.5) * H;
        w = this.wgt(xw, yw, x0, x1, y0, y1, round, cx, cy, r);
        if (w > 0) u[c] += (tx - u[c]) * k * w;
      }
      if (s[c] && s[c - 1]) {           // mặt v: (i-0.5)H, (j-1)H
        xw = (i - 0.5) * H; yw = (j - 1) * H;
        w = this.wgt(xw, yw, x0, x1, y0, y1, round, cx, cy, r);
        if (w > 0) v[c] += (ty - v[c]) * k * w;
      }
    }
  };
  Sim.prototype.wgt = function (x, y, x0, x1, y0, y1, round, cx, cy, r) {
    if (round) { var d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)); return d < r ? 1 - d / r : 0; }
    return (x >= x0 && x <= x1 && y >= y0 && y <= y1) ? 1 : 0;
  };

  Sim.prototype.forces = function (dt) {
    var s = this.s, v = this.v, u = this.u, T = this.T, i, j, c, k, tref = 0, nf = 0, NY = this.NY, NXI = this.NXI, NYI = this.NYI;
    for (i = 1; i <= NXI; i++) for (j = 1; j <= NYI; j++) { c = i * NY + j; if (s[c]) { tref += T[c]; nf++; } }
    tref /= nf;
    for (i = 1; i <= NXI; i++) for (j = 2; j <= NYI; j++) {
      c = i * NY + j;
      if (s[c] && s[c - 1]) v[c] += dt * G_BETA * ((T[c] + T[c - 1]) * 0.5 - tref);
    }
    // quạt
    var fl = this.fanList, lvl;
    for (k = 0; k < fl.length; k++) {
      var f = fl[k];
      lvl = clamp((f.speed | 0) - 1, 0, 4);
      if (f.kind === 'stand') {
        var el = f.elev * Math.PI / 180, dx = f.dir * Math.cos(el), dy = Math.sin(el), vf = STAND_V[lvl];
        var cx = f.x + dx * 0.25, cy = f.y + dy * 0.25, r = 0.24;
        this.relax(cx - r, cx + r, cy - r, cy + r, dx * vf, dy * vf, 0.3, true, cx, cy, r);
      } else if (f.kind === 'ceiling') {
        var vc = CEIL_V[lvl] * (f.mode === 'up' ? 1 : -1);
        this.relax(f.x - 0.5, f.x + 0.5, this.RH - 0.5, this.RH - 0.18, 0, vc, 0.25, false);
      }
    }
    // gió ra dàn lạnh
    for (k = 0; k < this.units.length; k++) {
      var un = this.units[k];
      for (var o = 0; o < un.outs.length; o++) {
        var oc = un.outs[o], cc = oc.c;
        if (s[cc + NY]) u[cc + NY] += (oc.dx * un.v - u[cc + NY]) * 0.9;
        if (s[cc - NY]) u[cc] += (oc.dx * un.v - u[cc]) * 0.9;
        if (s[cc + 1]) v[cc + 1] += (oc.dy * un.v - v[cc + 1]) * 0.9;
        if (s[cc - 1]) v[cc] += (oc.dy * un.v - v[cc]) * 0.9;
      }
    }
    var dr = 1 - DRAG * dt, n2 = u.length;
    for (c = 0; c < n2; c++) { u[c] *= dr; v[c] *= dr; }
  };

  Sim.prototype.project = function () {
    var s = this.s, u = this.u, v = this.v, src = this.src, i, j, c, it, NX = this.NX, NY = this.NY, NXI = this.NXI, NYI = this.NYI;
    for (i = 0; i < NX; i++) for (j = 0; j < NY; j++) {
      c = i * NY + j;
      if (!s[c]) { u[c] = 0; if (i + 1 < NX) u[c + NY] = 0; v[c] = 0; if (j + 1 < NY) v[c + 1] = 0; }
    }
    for (it = 0; it < ITER; it++) {
      for (i = 1; i <= NXI; i++) for (j = 1; j <= NYI; j++) {
        c = i * NY + j;
        if (!s[c]) continue;
        var sx0 = s[c - NY], sx1 = s[c + NY], sy0 = s[c - 1], sy1 = s[c + 1], ss = sx0 + sx1 + sy0 + sy1;
        if (!ss) continue;
        var div = u[c + NY] - u[c] + v[c + 1] - v[c] - src[c];
        var p = -div / ss * OVR;
        u[c] -= sx0 * p; u[c + NY] += sx1 * p; v[c] -= sy0 * p; v[c + 1] += sy1 * p;
      }
    }
  };

  Sim.prototype.fillSolid = function () {
    var s = this.s, open = this.open, T = this.T, C = this.C, i, j, c, sum, sc, n, NX = this.NX, NY = this.NY;
    var tout = this.cfg.tOut;
    for (i = 0; i < NX; i++) for (j = 0; j < NY; j++) {
      c = i * NY + j;
      if (open[c]) { T[c] = tout; C[c] = C_OUT; continue; }
      if (s[c]) continue;
      sum = 0; sc = 0; n = 0;
      if (i > 0 && s[c - NY]) { sum += T[c - NY]; sc += C[c - NY]; n++; }
      if (i < NX - 1 && s[c + NY]) { sum += T[c + NY]; sc += C[c + NY]; n++; }
      if (j > 0 && s[c - 1]) { sum += T[c - 1]; sc += C[c - 1]; n++; }
      if (j < NY - 1 && s[c + 1]) { sum += T[c + 1]; sc += C[c + 1]; n++; }
      if (n) { T[c] = sum / n; C[c] = sc / n; }
    }
  };

  Sim.prototype.advect = function (dt) {
    var s = this.s, u = this.u, v = this.v, nu = this.nu, nv = this.nv, i, j, c, x, y, uu, vv, h = this.H, h2 = 0.5 * h;
    var NX = this.NX, NY = this.NY, NXI = this.NXI, NYI = this.NYI;
    this.fillSolid();
    nu.set(u); nv.set(v);
    for (i = 1; i < NX; i++) for (j = 1; j < NY; j++) {
      c = i * NY + j;
      if (s[c] && s[c - NY] && j < NY - 1) {
        x = i * h; y = j * h + h2; uu = u[c];
        vv = (v[c - NY] + v[c] + v[c - NY + 1] + v[c + 1]) * 0.25;
        nu[c] = this.sample(u, x - dt * uu, y - dt * vv, 0, h2);
      }
      if (s[c] && s[c - 1] && i < NX - 1) {
        x = i * h + h2; y = j * h; vv = v[c];
        uu = (u[c - 1] + u[c + NY - 1] + u[c] + u[c + NY]) * 0.25;
        nv[c] = this.sample(v, x - dt * uu, y - dt * vv, h2, 0);
      }
    }
    u.set(nu); v.set(nv);
    var T = this.T, C = this.C, nT = this.nT, nC = this.nC;
    nT.set(T); nC.set(C);
    for (i = 1; i <= NXI; i++) for (j = 1; j <= NYI; j++) {
      c = i * NY + j;
      if (!s[c]) continue;
      uu = (u[c] + u[c + NY]) * 0.5; vv = (v[c] + v[c + 1]) * 0.5;
      x = (i + 0.5) * h - dt * uu; y = (j + 0.5) * h - dt * vv;
      nT[c] = this.sample(T, x, y, h2, h2);
      nC[c] = this.sample(C, x, y, h2, h2);
    }
    // khuếch tán nhẹ (xáo trộn rối dưới lưới)
    for (i = 1; i <= NXI; i++) for (j = 1; j <= NYI; j++) {
      c = i * NY + j;
      if (!s[c]) continue;
      var a = s[c - NY] ? nT[c - NY] : nT[c], b = s[c + NY] ? nT[c + NY] : nT[c],
          d = s[c - 1] ? nT[c - 1] : nT[c], e = s[c + 1] ? nT[c + 1] : nT[c];
      T[c] = nT[c] + KDIFF * (a + b + d + e - 4 * nT[c]);
      a = s[c - NY] ? nC[c - NY] : nC[c]; b = s[c + NY] ? nC[c + NY] : nC[c];
      d = s[c - 1] ? nC[c - 1] : nC[c]; e = s[c + 1] ? nC[c + 1] : nC[c];
      C[c] = nC[c] + KDIFF * (a + b + d + e - 4 * nC[c]);
    }
  };

  Sim.prototype.thermal = function (dt) {
    var s = this.s, T = this.T, Tm = this.Tm, C = this.C, i, j, c, k, tout = this.cfg.tOut, NY = this.NY, NXI = this.NXI, NYI = this.NYI;
    for (i = 1; i <= NXI; i++) for (j = 1; j <= NYI; j++) {
      c = i * NY + j;
      if (!s[c]) continue;
      var a = (Tm[c] - T[c]) / TAU_A;
      T[c] += dt * a;
      Tm[c] += -dt * a / R_MASS + dt * (tout - Tm[c]) / TAU_ENV;
    }
    for (k = 0; k < this.pcells.length; k++) { c = this.pcells[k]; T[c] += dt * this.pHeat; C[c] += dt * this.pCO2; }
    // Dàn lạnh: khối khí hồi ở cửa hút được đưa ra cửa thổi lạnh hơn dTs (cân bằng năng lượng theo mỗi mét sâu).
    // Máy inverter: chạy hết công suất khi phòng còn cách nhiệt độ cài đặt xa, giảm dần khi tới gần.
    var ts = this.cfg.supplyT, setT = this.cfg.setT;
    this.pf = clamp((this.tCtl - setT + 0.3) / 4, 0, 1);
    for (k = 0; k < this.units.length; k++) {
      var un = this.units[k], tr = 0, cr = 0, n = un.ins.length, o;
      for (o = 0; o < n; o++) { tr += T[un.ins[o].c]; cr += C[un.ins[o].c]; }
      tr /= n; cr /= n;
      var tinj = Math.max(ts, tr - un.dTs * this.pf), beta = Math.min(1.6, un.v * dt / this.H);
      for (o = 0; o < un.outs.length; o++) {
        c = un.outs[o].c;
        T[c] = Math.max(ts, T[c] + beta * (tinj - T[c]));
        C[c] += beta * (cr - C[c]);
      }
    }
  };

  Sim.prototype.step = function () {
    this.forces(DT);
    this.project();
    this.advect(DT);
    this.thermal(DT);
    this.t += DT; this.stepN++;
    if (this.stepN % 20 === 0) this.sampleMetrics();
  };

  Sim.prototype.cellSpeed = function (c) {
    var uu = (this.u[c] + this.u[c + this.NY]) * 0.5, vv = (this.v[c] + this.v[c + 1]) * 0.5;
    return Math.sqrt(uu * uu + vv * vv);
  };

  Sim.prototype.inflowACH = function () {
    var q = 0, j, i, NY = this.NY, NX = this.NX;
    for (j = 1; j <= this.NYI; j++) {
      if (this.open[j]) q += Math.max(0, this.u[NY + j]);
      if (this.open[(NX - 1) * NY + j]) q += Math.max(0, -this.u[(NX - 1) * NY + j]);
    }
    for (i = 1; i <= this.NXI; i++) if (this.open[i * NY + NY - 1]) q += Math.max(0, -this.v[i * NY + NY - 1]);
    return q * this.H * 3600 / this.AREA;
  };

  Sim.prototype.sampleMetrics = function () {
    var m = this.computeMetrics();
    this.m = m; this.tCtl = m.tZone;
    this.series.push({ t: this.t, tp: m.tPeople, tz: m.tZone, c: m.cPeople });
    if (this.tReach === null && m.tPeople <= this.cfg.target) this.tReach = this.t;
    if (!this.snap10 && this.t >= 600) this.snap10 = { tp: m.tPeople, tz: m.tZone };
    if (this.t > 60) {
      this.draftSum += m.vPeople; this.draftN++;
      this.achSum += m.ach; this.achN++;
    }
  };

  Sim.prototype.computeMetrics = function () {
    var z = this.zone, T = this.T, C = this.C, k, c, sum = 0, sq = 0, cs = 0, mn = 1e9, mx = -1e9;
    for (k = 0; k < z.length; k++) { c = z[k]; var t = T[c]; sum += t; sq += t * t; cs += C[c]; if (t < mn) mn = t; if (t > mx) mx = t; }
    var n = z.length || 1, mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
    var tp = mean, cp = cs / n, vp = 0, pc = this.pcells;
    if (pc.length) {
      tp = 0; cp = 0; vp = 0;
      for (k = 0; k < pc.length; k++) { c = pc[k]; tp += T[c]; cp += C[c]; vp += this.cellSpeed(c); }
      tp /= pc.length; cp /= pc.length; vp /= pc.length;
    }
    return { t: this.t, tZone: mean, tStd: sd, tMin: mn, tMax: mx, cZone: cs / n, tPeople: tp, cPeople: cp, vPeople: vp, ach: this.inflowACH() };
  };

  Sim.prototype.summary = function () {
    var m = this.computeMetrics();
    return {
      t: this.t, tReach: this.tReach, tp10: this.snap10 ? this.snap10.tp : null, tz10: this.snap10 ? this.snap10.tz : null,
      tPeople: m.tPeople, tZone: m.tZone, tStd: m.tStd,
      cPeople: m.cPeople, draft: this.draftN ? this.draftSum / this.draftN : m.vPeople,
      ach: this.achN ? this.achSum / this.achN : m.ach
    };
  };

  root.AirSim = { Sim: Sim, defaultCfg: defaultCfg, DT: DT, NXI: NXI, JET: JET, STAND_V: STAND_V, CEIL_V: CEIL_V, openings: openings };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AirSim;
})(typeof window !== 'undefined' ? window : globalThis);
