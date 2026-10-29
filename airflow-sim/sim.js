/* Lõi mô phỏng luồng gió 2D (mặt cắt đứng của phòng).
 * Lưới MAC, giải tích phân bán-Lagrange + chiếu áp suất (Gauss-Seidel), nổi do nhiệt (Boussinesq),
 * thêm trường nhiệt độ, độ ẩm, CO2 và khối nhiệt (tường/đồ đạc), bức xạ nắng lên mái/tường.
 * Kích thước phòng đổi được: lưới luôn 60 cột, cạnh ô = chiều rộng / 60.
 * Đây là mô hình định tính: 2D không tái hiện được dòng bám trần (Coanda) hay luồng ngang theo chiều sâu phòng. */
(function (root) {
  'use strict';

  var NXI = 60;                 // số cột bên trong, cố định
  var DT = 0.1, ITER = 18, OVR = 1.8;
  var RHO_CP = 1.2 * 1005;      // J/(m3 K)
  var RHO_AIR = 1.2, HFG = 2.45e6, P_ATM = 1013;
  var SHR = 0.75;               // tỉ lệ nhiệt hiện của dàn lạnh (phần còn lại là khử ẩm)
  var G_BETA = 9.81 / 303;
  var TAU_A = 240, R_MASS = 8, TAU_ENV = 5000;   // trao đổi không khí <-> khối nhiệt, và khối nhiệt <-> ngoài trời
  var DRAG = 0.05, KDIFF = 0.05;
  var C_OUT = 420;
  var JET = [0.5, 0.7, 0.9, 1.1, 1.3];                 // vận tốc gió ra dàn lạnh theo 5 mức (m/s)
  var STAND_V = [1.0, 1.8, 2.6, 3.4, 4.2];             // quạt đứng
  var CEIL_V = [0.4, 0.7, 1.0, 1.3, 1.6];              // quạt trần
  var REF_VOL = 4.8 * 2.8 * 4.0;                       // thể tích chuẩn để quy đổi CO2 (m3)
  var ROOF_D = [0, 8, 15], WALL_D = [0, 5, 10];        // độ tăng nhiệt bề mặt ngoài do nắng (K), giả định
  var ENV_K = [0.6, 1, 1.7];                           // hệ số truyền nhiệt vỏ nhà: tốt / thường / kém

  /* hoạt động của người: nhiệt hiện, nhiệt ẩn (W), ước lượng theo bảng nhiệt thải của người */
  var ACTS = [
    { n: 'Nghỉ ngơi', s: 65, l: 40 },
    { n: 'Làm việc', s: 75, l: 55 },
    { n: 'Vận động nhẹ', s: 110, l: 110 },
    { n: 'Tập luyện', s: 190, l: 290 }
  ];
  /* thiết bị tỏa nhiệt: công suất tỏa (W), kích thước (m), độ cao đáy mặc định */
  var DEVICE_KINDS = {
    laptop: { n: 'Laptop', w: 60, wmax: 150, sw: 0.35, sh: 0.05, y: 0.75 },
    pc:     { n: 'Máy tính + màn hình', w: 200, wmax: 600, sw: 0.5, sh: 0.45, y: 0.75 },
    tv:     { n: 'TV', w: 120, wmax: 300, sw: 0.9, sh: 0.55, y: 1.0 },
    fridge: { n: 'Tủ lạnh', w: 150, wmax: 400, sw: 0.7, sh: 1.7, y: 0 },
    server: { n: 'Máy chủ / switch', w: 500, wmax: 2000, sw: 0.6, sh: 1.0, y: 0 },
    stove:  { n: 'Bếp điện', w: 1500, wmax: 3000, sw: 0.6, sh: 0.1, y: 0.9 },
    light:  { n: 'Cụm đèn', w: 80, wmax: 400, sw: 0.5, sh: 0.1, y: 2.4 }
  };

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  /* hơi nước: công thức Magnus, w = tỉ số ẩm (kg/kg khô) */
  function psat(T) { return 6.112 * Math.exp(17.62 * T / (243.12 + T)); }
  function wSat(T) { var ps = psat(T); return 0.622 * ps / (P_ATM - ps); }
  function wFromRH(T, rh) { var pv = clamp(rh, 0, 1) * psat(T); return 0.622 * pv / (P_ATM - pv); }
  function pvFromW(w) { return w * P_ATM / (0.622 + w); }
  function rhFrom(T, w) { return clamp(pvFromW(w) / psat(T), 0, 1.2); }
  function dewPoint(w) { var pv = Math.max(pvFromW(w), 0.01), g = Math.log(pv / 6.112); return 243.12 * g / (17.62 - g); }
  function humidex(T, w) { return T + 0.5555 * (pvFromW(w) - 10); }
  /* chỉ số ngột ngạt 0-100 (kinh nghiệm): 50% CO2, 30% nóng ẩm (humidex), 20% khí tù đọng */
  function stuffiness(T, hx, co2, v) {
    var a = clamp((co2 - 800) / 1200, 0, 1) * 50, b = clamp((hx - 28) / 12, 0, 1) * 30;
    var c = clamp((0.15 - v) / 0.15, 0, 1) * 20 * clamp((T - 24) / 4, 0, 1);
    return a + b + c;
  }

  function openings(rh, rw) {
    var x0 = Math.min(rw - 0.6, rw * 0.72);
    return {
      winL:  { wall: 'L', y0: 1.0, y1: Math.min(1.9, rh - 0.4), n: 'Cửa sổ tường trái' },
      ventL: { wall: 'L', y0: rh - 0.7, y1: rh - 0.2, n: 'Lỗ thông khí tường trái (trên cao)' },
      ventR: { wall: 'R', y0: rh - 0.7, y1: rh - 0.2, n: 'Ô thoáng tường phải (trên cao)' },
      doorR: { wall: 'R', y0: 0.0, y1: 0.5, n: 'Khe cửa ra vào (sát sàn)' },
      roofV: { wall: 'T', x0: x0, x1: x0 + 0.5, n: 'Lỗ thông khí trên mái' }
    };
  }

  function defaultCfg() {
    return {
      roomW: 4.8, roomH: 2.8, depth: 4.0,
      tOut: 33, rhOut: 70, tStart: 32, rhStart: 70, target: 26, cStart: 1000,
      sun: 1, sunSide: 'R', env: 1,
      cap: 3520, acSpeed: 2, supplyT: 14, setT: 22,
      acs: [
        { type: 'wallL',  on: true,  angle: 25, y: 2.6, x: 2.4 },
        { type: 'wallR',  on: false, angle: 25, y: 2.6, x: 2.4 },
        { type: 'ceil',   on: false, angle: 20, y: 2.6, x: 2.4 },
        { type: 'floorL', on: false, angle: 60, y: 0, x: 0 },
        { type: 'floorR', on: false, angle: 60, y: 0, x: 0 }
      ],
      fans: [],
      open: { winL: false, ventL: false, ventR: false, doorR: false, roofV: false },
      people: [{ x: 1.7, act: 1 }, { x: 3.3, act: 1 }],
      devices: []
    };
  }

  function Sim(cfg) {
    var H = cfg.roomW / NXI, NYI = Math.max(16, Math.round(cfg.roomH / H));
    this.H = H; this.NXI = NXI; this.NYI = NYI; this.NX = NXI + 2; this.NY = NYI + 2; this.N = this.NX * this.NY;
    this.RW = NXI * H; this.RH = NYI * H; this.AREA = this.RW * this.RH; this.depth = cfg.depth;
    this.openDefs = openings(this.RH, this.RW);
    var N = this.N;
    this.u = new Float32Array(N); this.v = new Float32Array(N);
    this.nu = new Float32Array(N); this.nv = new Float32Array(N);
    this.s = new Uint8Array(N); this.open = new Uint8Array(N);
    this.T = new Float32Array(N); this.nT = new Float32Array(N);
    this.C = new Float32Array(N); this.nC = new Float32Array(N);
    this.W = new Float32Array(N); this.nW = new Float32Array(N);
    this.Tm = new Float32Array(N);
    this.envAdd = new Float32Array(N);
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
    this.W.fill(wFromRH(cfg.tStart, cfg.rhStart / 100));
    this.t = 0; this.stepN = 0;
    this.series = [];
    this.tReach = null; this.snap10 = null;
    this.draftSum = 0; this.draftN = 0; this.achSum = 0; this.achN = 0;
    this.m = null;
    this.tCtl = cfg.tStart; this.pf = 1;
  };

  /* Dựng lại hình học, nguồn/bể từ cấu hình (giữ nguyên các trường đang chạy). */
  Sim.prototype.rebuild = function () {
    var cfg = this.cfg, s = this.s, open = this.open, src = this.src, i, j, c, k;
    var H = this.H, NX = this.NX, NY = this.NY, NXI = this.NXI, NYI = this.NYI;
    function idx(a, b) { return a * NY + b; }
    s.fill(1); open.fill(0); src.fill(0);
    for (i = 0; i < NX; i++) for (j = 0; j < NY; j++) {
      if (i === 0 || i === NX - 1 || j === 0 || j === NY - 1) s[idx(i, j)] = 0;
    }
    this.hasOpen = false;
    for (k in this.openDefs) {
      if (!cfg.open[k]) continue;
      var o = this.openDefs[k];
      if (o.wall === 'T') {
        for (i = this.ci(o.x0); i <= this.ci(o.x1 - 1e-6); i++) { c = idx(i, NY - 1); s[c] = 1; open[c] = 1; }
      } else {
        var j0 = this.cj(o.y0), j1 = this.cj(o.y1 - 1e-6), ii = o.wall === 'L' ? 0 : NX - 1;
        for (j = j0; j <= j1; j++) { c = idx(ii, j); s[c] = 1; open[c] = 1; }
      }
      this.hasOpen = true;
    }

    this.units = []; this.fanList = []; this.exhaust = []; this.hrvs = [];
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
      } else if (f.kind === 'hrv') {
        // máy thông gió thu hồi nhiệt: mô hình trộn đều (khí tươi hòa vào toàn phòng), cân bằng năng lượng chính xác
        this.hrvs.push({ ach: f.ach, eta: f.eta == null ? 0.6 : f.eta });
      } else this.fanList.push(f);
    }

    // nguồn nhiệt / CO2 / hơi ẩm: người và thiết bị. Quy đổi để mức tăng trung bình toàn phòng đúng với công suất thật.
    var vol = this.AREA * cfg.depth, nAll = NXI * NYI;
    this.pcells = []; this.srcCells = [];
    function addRect(self, x0, x1, y0, y1, list) {
      for (var a = self.ci(x0); a <= self.ci(x1 - 1e-6); a++) for (var b = self.cj(y0); b <= self.cj(Math.max(y0 + 1e-3, y1 - 1e-6)); b++) if (s[idx(a, b)]) list.push(idx(a, b));
    }
    cfg.people.forEach(function (p) {
      var ac = ACTS[p.act == null ? 1 : clamp(p.act | 0, 0, 3)], cells = [];
      addRect(this, p.x - 0.22, p.x + 0.22, 0.30, 1.15, cells);
      if (!cells.length) return;
      var sc = nAll / cells.length;
      var h = ac.s / (vol * RHO_CP) * sc, co = 0.085 * REF_VOL / vol * ((ac.s + ac.l) / 130) * sc, w = (ac.l / HFG) / (RHO_AIR * vol) * sc;
      cells.forEach(function (cc) { this.pcells.push(cc); this.srcCells.push({ c: cc, h: h, co: co, w: w }); }, this);
    }, this);
    (cfg.devices || []).forEach(function (d) {
      if (!d.on) return;
      var kd = DEVICE_KINDS[d.kind], cells = [];
      addRect(this, d.x - kd.sw / 2, d.x + kd.sw / 2, d.y, d.y + kd.sh, cells);
      if (!cells.length) return;
      var h = d.w / (vol * RHO_CP) * nAll / cells.length;
      cells.forEach(function (cc) { this.srcCells.push({ c: cc, h: h, co: 0, w: 0 }); }, this);
    }, this);

    // vùng sinh hoạt 0.1 - 1.8 m
    this.zone = [];
    var za = this.cj(0.1), zb = this.cj(Math.min(1.8, this.RH - 0.3));
    for (i = 1; i <= NXI; i++) for (j = za; j <= zb; j++) if (s[idx(i, j)]) this.zone.push(idx(i, j));

    // bức xạ nắng: nhiệt độ mục tiêu của khối nhiệt gần mái và tường hướng nắng cao hơn nhiệt độ ngoài trời
    var ea = this.envAdd, roofD = ROOF_D[clamp(cfg.sun | 0, 0, 2)], wallD = WALL_D[clamp(cfg.sun | 0, 0, 2)], wts = [1, 0.6, 0.3];
    ea.fill(0);
    for (i = 1; i <= NXI; i++) for (j = 1; j <= NYI; j++) {
      var add = 0;
      if (NYI - j < 3) add += roofD * wts[NYI - j];
      var d2 = cfg.sunSide === 'L' ? i - 1 : NXI - i;
      if (d2 < 3) add += wallD * wts[d2];
      ea[idx(i, j)] = add;
    }
    this.tauEnv = TAU_ENV / ENV_K[clamp(cfg.env | 0, 0, 2)];
    this.roofDelta = roofD; this.wallDelta = wallD;

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
    var psens = power * SHR;
    // dàn lớn thì cửa gió ra rộng hơn để lưu lượng tăng theo công suất (chênh nhiệt gió ra ~ 11 K ở tốc độ danh định)
    var nWant = clamp(Math.round((psens / this.depth) / (RHO_CP * 11 * 0.9 * H)), 1, 10);
    var outs = [], ins = [], a = ac.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), i, j, jt, k;
    var M = function (iL) { return NXI + 1 - iL; };
    switch (ac.type) {
      case 'wallL': case 'wallR':
        var bd = mc(0.25 * Math.sqrt(power / 3520), 2), bh = mc(0.32, 3), nn = nWant;
        bd = Math.min(bd, 8);
        jt = clamp(this.cj(ac.y - 1e-6), bh + nn + 3, NYI);
        var R = ac.type === 'wallR', dx = R ? -ca : ca;
        this.solidRect(R ? M(bd) : 1, R ? M(1) : bd, jt - bh + 1, jt);
        if (bd > 1) this.solidRect(R ? M(bd - 1) : 1, R ? M(1) : bd - 1, jt - bh - nn + 1, jt - bh);     // vỏ máy kéo dài xuống; cửa gió ra nằm ở mép trước
        for (k = 0; k < nn; k++) outs.push({ i: R ? M(bd) : bd, j: jt - bh - k, dx: dx, dy: -sa });
        // hồi gió ở mặt trên dàn lạnh (nếu sát trần thì lấy ở mặt trước phía trên)
        if (jt + 1 <= NYI) {
          for (i = 1; i <= bd; i++) { ins.push({ i: R ? M(i) : i, j: jt + 1 }); if (jt + 2 <= NYI) ins.push({ i: R ? M(i) : i, j: jt + 2 }); }
        } else for (k = 0; k < Math.max(2, nn); k++) ins.push({ i: R ? M(bd + 1) : bd + 1, j: jt - k });
        break;
      case 'ceil':
        var bw = clamp(mc(0.36 * Math.sqrt(power / 3520), 3), 3, 12), ic = clamp(this.ci(ac.x), bw + 2, NXI - bw - 1);
        var ns = Math.max(1, Math.round(nWant / 2)), nb = Math.max(2, ns + 1);
        this.solidRect(ic - bw, ic + bw, NYI - nb + 1, NYI);
        for (k = 0; k < ns; k++) outs.push({ i: ic - bw - 1, j: NYI - k, dx: -ca, dy: -sa }, { i: ic + bw + 1, j: NYI - k, dx: ca, dy: -sa });
        var wi = Math.max(1, Math.round(bw / 3));
        for (i = ic - wi; i <= ic + wi; i++) ins.push({ i: i, j: NYI - nb });
        break;
      case 'floorL': case 'floorR':
        var Rr = ac.type === 'floorR', dxf = Rr ? -ca : ca, fd = clamp(nWant + 2, 3, 12), fh = clamp(mc(1.6, 6), 6, NYI - 4);
        this.solidRect(Rr ? M(fd) : 1, Rr ? M(1) : fd, 1, fh);
        this.solidRect(Rr ? M(1) : 1, Rr ? M(1) : 1, fh + 1, fh + 1);
        for (i = 2; i <= fd - 1; i++) outs.push({ i: Rr ? M(i) : i, j: fh + 1, dx: dxf, dy: sa });
        for (j = mc(0.25, 2); j <= Math.min(fh - 1, mc(0.25, 2) + Math.max(3, 2 * nWant)); j++) ins.push({ i: Rr ? M(fd + 1) : fd + 1, j: j });
        break;
    }
    var nOut = outs.length, nIn = ins.length, w = nOut * H;
    // độ chênh nhiệt gió ra - hồi gió để công suất lạnh hiện = SHR * P / depth trên mỗi mét sâu
    var dTs = (psens / this.depth) / (RHO_CP * w * vjet);
    var latP = (power - psens) / this.depth;
    for (var o = 0; o < nOut; o++) { outs[o].c = outs[o].i * NY + outs[o].j; this.src[outs[o].c] += vjet; }
    for (var n = 0; n < nIn; n++) { ins[n].c = ins[n].i * NY + ins[n].j; this.src[ins[n].c] -= nOut * vjet / nIn; }
    this.units.push({ outs: outs, ins: ins, dTs: dTs, latP: latP, v: vjet, rects: this._rects, type: ac.type, power: power });
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
    var s = this.s, open = this.open, T = this.T, C = this.C, W = this.W, i, j, c, sum, sc, sw, n, NX = this.NX, NY = this.NY;
    var tout = this.cfg.tOut, wout = wFromRH(tout, this.cfg.rhOut / 100);
    for (i = 0; i < NX; i++) for (j = 0; j < NY; j++) {
      c = i * NY + j;
      if (open[c]) { T[c] = tout; C[c] = C_OUT; W[c] = wout; continue; }
      if (s[c]) continue;
      sum = 0; sc = 0; sw = 0; n = 0;
      if (i > 0 && s[c - NY]) { sum += T[c - NY]; sc += C[c - NY]; sw += W[c - NY]; n++; }
      if (i < NX - 1 && s[c + NY]) { sum += T[c + NY]; sc += C[c + NY]; sw += W[c + NY]; n++; }
      if (j > 0 && s[c - 1]) { sum += T[c - 1]; sc += C[c - 1]; sw += W[c - 1]; n++; }
      if (j < NY - 1 && s[c + 1]) { sum += T[c + 1]; sc += C[c + 1]; sw += W[c + 1]; n++; }
      if (n) { T[c] = sum / n; C[c] = sc / n; W[c] = sw / n; }
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
    var T = this.T, C = this.C, W = this.W, nT = this.nT, nC = this.nC, nW = this.nW;
    nT.set(T); nC.set(C); nW.set(W);
    for (i = 1; i <= NXI; i++) for (j = 1; j <= NYI; j++) {
      c = i * NY + j;
      if (!s[c]) continue;
      uu = (u[c] + u[c + NY]) * 0.5; vv = (v[c] + v[c + 1]) * 0.5;
      x = (i + 0.5) * h - dt * uu; y = (j + 0.5) * h - dt * vv;
      nT[c] = this.sample(T, x, y, h2, h2);
      nC[c] = this.sample(C, x, y, h2, h2);
      nW[c] = this.sample(W, x, y, h2, h2);
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
      a = s[c - NY] ? nW[c - NY] : nW[c]; b = s[c + NY] ? nW[c + NY] : nW[c];
      d = s[c - 1] ? nW[c - 1] : nW[c]; e = s[c + 1] ? nW[c + 1] : nW[c];
      W[c] = nW[c] + KDIFF * (a + b + d + e - 4 * nW[c]);
    }
  };

  Sim.prototype.thermal = function (dt) {
    var s = this.s, T = this.T, Tm = this.Tm, C = this.C, W = this.W, i, j, c, k, tout = this.cfg.tOut, NY = this.NY, NXI = this.NXI, NYI = this.NYI;
    var ea = this.envAdd, tauEnv = this.tauEnv;
    for (i = 1; i <= NXI; i++) for (j = 1; j <= NYI; j++) {
      c = i * NY + j;
      if (!s[c]) continue;
      var a = (Tm[c] - T[c]) / TAU_A;
      T[c] += dt * a;
      var ws = wSat(T[c]); if (W[c] > ws) W[c] = ws;      // quá bão hòa thì ngưng tụ
      Tm[c] += -dt * a / R_MASS + dt * (tout + ea[c] - Tm[c]) / tauEnv;
    }
    for (k = 0; k < this.srcCells.length; k++) { var sc = this.srcCells[k]; T[sc.c] += dt * sc.h; C[sc.c] += dt * sc.co; W[sc.c] += dt * sc.w; }

    // Dàn lạnh: khối khí hồi ở cửa hút được đưa ra cửa thổi lạnh hơn dTs (cân bằng năng lượng theo mỗi mét sâu).
    // Máy inverter: chạy hết công suất khi phòng còn cách nhiệt độ cài đặt xa, giảm dần khi tới gần.
    // Phần nhiệt ẩn (1 - SHR) được dùng để ngưng tụ hơi nước, nhưng không thể xuống dưới độ ẩm bão hòa ở nhiệt độ gió ra.
    var ts = this.cfg.supplyT, setT = this.cfg.setT;
    this.pf = clamp((this.tCtl - setT + 0.3) / 4, 0, 1);
    for (k = 0; k < this.units.length; k++) {
      var un = this.units[k], tr = 0, cr = 0, wr = 0, n = un.ins.length, o;
      for (o = 0; o < n; o++) { tr += T[un.ins[o].c]; cr += C[un.ins[o].c]; wr += W[un.ins[o].c]; }
      tr /= n; cr /= n; wr /= n;
      var tinj = Math.max(ts, tr - un.dTs * this.pf), beta = Math.min(1.6, un.v * dt / this.H);
      var q = un.outs.length * this.H * un.v;
      var dW = un.latP * this.pf / (HFG * RHO_AIR * q);
      var wFloor = Math.min(wSat(tinj - 1.5), wr), winj = Math.max(wFloor, wr - dW);
      for (o = 0; o < un.outs.length; o++) {
        c = un.outs[o].c;
        T[c] = Math.max(ts, T[c] + beta * (tinj - T[c]));
        C[c] += beta * (cr - C[c]);
        W[c] += beta * (winj - W[c]);
      }
    }
    // Máy thông gió thu hồi nhiệt: khí tươi hòa vào phòng, được làm mát/khử ẩm một phần nhờ trao đổi với khí thải
    if (this.hrvs.length) {
      var tb = 0, wb = 0, nb = 0;
      for (i = 1; i <= NXI; i++) for (j = 1; j <= NYI; j++) { c = i * NY + j; if (s[c]) { tb += T[c]; wb += W[c]; nb++; } }
      tb /= nb; wb /= nb;
      var wout = wFromRH(tout, this.cfg.rhOut / 100);
      for (k = 0; k < this.hrvs.length; k++) {
        var hv = this.hrvs[k], r = hv.ach / 3600 * dt;
        var tin = tout - hv.eta * (tout - tb), win = wout - hv.eta * 0.8 * (wout - wb);
        for (i = 1; i <= NXI; i++) for (j = 1; j <= NYI; j++) {
          c = i * NY + j;
          if (!s[c]) continue;
          T[c] += r * (tin - T[c]); W[c] += r * (win - W[c]); C[c] += r * (C_OUT - C[c]);
        }
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
  Sim.prototype.cellRH = function (c) { return rhFrom(this.T[c], this.W[c]); };

  Sim.prototype.inflowACH = function () {
    var q = 0, j, i, NY = this.NY, NX = this.NX;
    for (j = 1; j <= this.NYI; j++) {
      if (this.open[j]) q += Math.max(0, this.u[NY + j]);
      if (this.open[(NX - 1) * NY + j]) q += Math.max(0, -this.u[(NX - 1) * NY + j]);
    }
    for (i = 1; i <= this.NXI; i++) if (this.open[i * NY + NY - 1]) q += Math.max(0, -this.v[i * NY + NY - 1]);
    // khí tươi do máy thông gió cấp vào cũng được tính
    var ach = q * this.H * 3600 / this.AREA;
    this.hrvs.forEach(function (h) { ach += h.ach; });
    return ach;
  };

  Sim.prototype.sampleMetrics = function () {
    var m = this.computeMetrics();
    this.m = m; this.tCtl = m.tZone;
    this.series.push({ t: this.t, tp: m.tPeople, tz: m.tZone, c: m.cPeople, rh: m.rhPeople * 100 });
    if (this.tReach === null && m.tPeople <= this.cfg.target) this.tReach = this.t;
    if (!this.snap10 && this.t >= 600) this.snap10 = { tp: m.tPeople, tz: m.tZone };
    if (this.t > 60) {
      this.draftSum += m.vPeople; this.draftN++;
      this.achSum += m.ach; this.achN++;
    }
  };

  Sim.prototype.computeMetrics = function () {
    var z = this.zone, T = this.T, C = this.C, W = this.W, k, c, sum = 0, sq = 0, cs = 0, ws = 0, mn = 1e9, mx = -1e9;
    for (k = 0; k < z.length; k++) { c = z[k]; var t = T[c]; sum += t; sq += t * t; cs += C[c]; ws += W[c]; if (t < mn) mn = t; if (t > mx) mx = t; }
    var n = z.length || 1, mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
    var tp = mean, cp = cs / n, wp = ws / n, vp = 0, pc = this.pcells;
    if (pc.length) {
      tp = 0; cp = 0; wp = 0; vp = 0;
      for (k = 0; k < pc.length; k++) { c = pc[k]; tp += T[c]; cp += C[c]; wp += W[c]; vp += this.cellSpeed(c); }
      tp /= pc.length; cp /= pc.length; wp /= pc.length; vp /= pc.length;
    }
    var rh = rhFrom(tp, wp), hx = humidex(tp, wp);
    return {
      t: this.t, tZone: mean, tStd: sd, tMin: mn, tMax: mx, cZone: cs / n, wZone: ws / n,
      tPeople: tp, cPeople: cp, wPeople: wp, vPeople: vp, rhPeople: rh, dewPeople: dewPoint(wp), humidex: hx,
      stuff: stuffiness(tp, hx, cp, vp), ach: this.inflowACH()
    };
  };

  Sim.prototype.summary = function () {
    var m = this.computeMetrics();
    return {
      t: this.t, tReach: this.tReach, tp10: this.snap10 ? this.snap10.tp : null, tz10: this.snap10 ? this.snap10.tz : null,
      tPeople: m.tPeople, tZone: m.tZone, tStd: m.tStd, rhPeople: m.rhPeople, humidex: m.humidex, stuff: m.stuff,
      cPeople: m.cPeople, draft: this.draftN ? this.draftSum / this.draftN : m.vPeople,
      ach: this.achN ? this.achSum / this.achN : m.ach
    };
  };

  root.AirSim = {
    Sim: Sim, defaultCfg: defaultCfg, DT: DT, NXI: NXI, JET: JET, STAND_V: STAND_V, CEIL_V: CEIL_V, openings: openings,
    ACTS: ACTS, DEVICE_KINDS: DEVICE_KINDS, ROOF_D: ROOF_D, WALL_D: WALL_D, ENV_K: ENV_K, SHR: SHR,
    psat: psat, wSat: wSat, wFromRH: wFromRH, rhFrom: rhFrom, dewPoint: dewPoint, humidex: humidex, stuffiness: stuffiness
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AirSim;
})(typeof window !== 'undefined' ? window : globalThis);
