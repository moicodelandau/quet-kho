// Ghép sim.js và presets.js vào page.template.html để ra một tệp index.html tự chứa.
const fs = require('fs'), path = require('path');
const d = __dirname;
let t = fs.readFileSync(path.join(d, 'page.template.html'), 'utf8');
t = t.replace('/*SIM*/', () => fs.readFileSync(path.join(d, 'sim.js'), 'utf8'))
     .replace('/*PRESETS*/', () => fs.readFileSync(path.join(d, 'presets.js'), 'utf8'));
fs.writeFileSync(path.join(d, 'index.html'), t);
console.log('index.html', (t.length / 1024).toFixed(1) + ' KB');
