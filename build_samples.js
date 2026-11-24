// Regenerates js/samples.js from the files in data/ (so the site works offline / from file://).
const fs = require('fs'), p = require('path');
const d = f => fs.readFileSync(p.join(__dirname, '..', 'data', f), 'utf8');
const g = f => { const t = d(f); return { v: t.split('VERTICES:')[1].split('EDGES:')[0].trim(), e: t.split('EDGES:')[1].trim() }; };
const S = { registrations: d('sample_registrations.csv').trim(), modified: d('modified_registrations.csv').trim(),
  crown: g('crown_graph.txt'), grotzsch: g('grotzsch_graph.txt'), boundary: g('boundary_graph.txt'),
  empty: { v: 'A, B, C, D, E', e: '' } };
fs.writeFileSync(p.join(__dirname, '..', 'js', 'samples.js'),
  '/* Sample INPUT data only (auto-generated from data/ by tests/build_samples.js). No graph, colouring or timetable is stored here. */\nwindow.SAMPLES = ' + JSON.stringify(S, null, 1) + ';\n');
