/* Các phương án bố trí để so sánh. Mọi phương án dùng chung tổng công suất lạnh. */
(function (root) {
  'use strict';
  var A = root.AirSim;

  function make(patch, base) {
    var c = A.defaultCfg();
    if (base) { c.roomW = base.roomW; c.roomH = base.roomH; c.depth = base.depth; }
    c.acs.forEach(function (a) { a.y = c.roomH - 0.2; a.x = c.roomW / 2; });
    patch(c);
    return c;
  }
  function ac(c, type, extra) {
    c.acs.forEach(function (a) { if (a.type === type) { a.on = true; for (var k in extra) a[k] = extra[k]; } });
  }
  function off(c, type) { c.acs.forEach(function (a) { if (a.type === type) a.on = false; }); }
  var fid = 100;
  function fan(c, o) { o.id = ++fid; o.on = true; c.fans.push(o); }

  var PRESETS = [
    {
      id: 'wall', name: 'Treo tường, đóng kín',
      desc: 'Dàn lạnh treo cao ở tường trái, hướng gió xuống 25°. Làm mốc so sánh.',
      cfg: function (b) { return make(function () {}, b); }
    },
    {
      id: 'stand-back', name: 'Treo tường + quạt đứng thổi ngược về dàn lạnh',
      desc: 'Quạt đứng đặt sát sàn ở cuối phòng, hướng về phía dàn lạnh, nghiêng lên 20°.',
      cfg: function (b) { return make(function (c) { fan(c, { kind: 'stand', x: c.roomW - 0.5, y: 0.55, dir: -1, elev: 20, speed: 3 }); }, b); }
    },
    {
      id: 'stand-with', name: 'Treo tường + quạt đứng thổi cùng chiều gió lạnh',
      desc: 'Quạt đặt gần dàn lạnh, thổi theo hướng gió lạnh để đẩy xa hơn.',
      cfg: function (b) { return make(function (c) { fan(c, { kind: 'stand', x: 0.9, y: 0.6, dir: 1, elev: 0, speed: 3 }); }, b); }
    },
    {
      id: 'ceil-up', name: 'Treo tường + quạt trần chạy chiều đẩy lên',
      desc: 'Quạt trần ở giữa phòng hút gió lên, trộn khí mà không thổi thẳng vào người.',
      cfg: function (b) { return make(function (c) { fan(c, { kind: 'ceiling', x: c.roomW / 2, y: c.roomH - 0.3, speed: 3, mode: 'up' }); }, b); }
    },
    {
      id: 'ceil-down', name: 'Treo tường + quạt trần chạy chiều thổi xuống',
      desc: 'Quạt trần ở giữa phòng thổi xuống, tạo luồng gió trực tiếp lên người bên dưới.',
      cfg: function (b) { return make(function (c) { fan(c, { kind: 'ceiling', x: c.roomW / 2, y: c.roomH - 0.3, speed: 3, mode: 'down' }); }, b); }
    },
    {
      id: 'dual', name: 'Hai dàn lạnh đối diện (chia đôi công suất)',
      desc: 'Hai dàn treo tường ở hai đầu phòng, mỗi dàn một nửa công suất.',
      cfg: function (b) { return make(function (c) { ac(c, 'wallR', { angle: 25 }); }, b); }
    },
    {
      id: 'cassette', name: 'Âm trần giữa phòng',
      desc: 'Dàn âm trần thổi hai bên dọc theo trần, hút ở giữa.',
      cfg: function (b) { return make(function (c) { off(c, 'wallL'); ac(c, 'ceil', { x: c.roomW / 2, angle: 20 }); }, b); }
    },
    {
      id: 'tower', name: 'Tủ đứng đặt góc phòng',
      desc: 'Tủ đứng ở tường trái, thổi lên chếch về phía phòng, hút ở thấp.',
      cfg: function (b) { return make(function (c) { off(c, 'wallL'); ac(c, 'floorL', { angle: 55 }); }, b); }
    },
    {
      id: 'vent', name: 'Treo tường + quạt hút và hé cửa',
      desc: 'Thêm quạt hút ở tường phải, hé cửa sổ bên trái và khe cửa để bù gió. Phòng thoáng hơn nhưng hút nhiệt từ ngoài vào.',
      cfg: function (b) { return make(function (c) {
        c.open.winL = true; c.open.doorR = true;
        fan(c, { kind: 'exhaust', side: 'R', y: c.roomH - 0.5, ach: 6 });
      }, b); }
    }
  ];
  root.AirPresets = PRESETS;
  if (typeof module !== 'undefined' && module.exports) module.exports = PRESETS;
})(typeof window !== 'undefined' ? window : globalThis);
