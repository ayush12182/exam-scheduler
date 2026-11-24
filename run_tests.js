/*
 * Node test runner — uses the SAME engine.js as the website.
 *   node tests/run_tests.js            (human-readable)
 *   node tests/run_tests.js --json     (machine-readable results)
 */
const fs = require('fs');
const path = require('path');
const E = require('../js/engine.js');
const D = p => fs.readFileSync(path.join(__dirname, '..', 'data', p), 'utf8');
const json = process.argv.includes('--json');
const out = { instances: [], edgeCases: [] };
let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  ✗ FAIL: ' + msg); } else if (!json) console.log('  ✓ ' + msg); };

function splitGraphFile(txt) {
  const v = txt.split(/VERTICES:/)[1].split(/EDGES:/)[0];
  const e = txt.split(/EDGES:/)[1];
  return [v, e];
}

function analyse(name, g, students) {
  const row = { name, V: g.n, E: g.m, isolated: g.degree.filter(d => d === 0).length, algorithms: {} };
  for (const key of ['greedy', 'wp', 'dsatur', 'exact']) {
    const r = E.runTimed(key, g, 50);
    const ver = E.verify(g, r.colors);
    row.algorithms[key] = { label: r.label, colors: r.k, valid: ver.valid, conflicts: ver.conflicts.length, ms: +r.ms.toFixed(4),
                            classes: E.colorClasses(g, r.colors), order: r.order.map(v => g.labels[v]) };
    if (key === 'exact') Object.assign(row.algorithms[key], { chi: r.chi, proved: r.proved, lowerBound: r.lowerBound,
                            clique: r.clique.map(v => g.labels[v]), nodes: r.nodes, method: r.method });
    if (students) row.algorithms[key].timetable = E.buildTimetable(g, r.colors, students);
  }
  row.degrees = Object.fromEntries(g.labels.map((l, i) => [l, g.degree[i]]));
  row.edges = g.edges.map(([a, b]) => [g.labels[a], g.labels[b]]);
  if (g.witnesses) row.witnesses = Object.fromEntries(g.witnesses);
  out.instances.push(row);
  if (!json) {
    console.log(`\n=== ${name} ===  |V|=${g.n}  |E|=${g.m}`);
    for (const [k, a] of Object.entries(row.algorithms))
      console.log(`  ${a.label.padEnd(26)} colours=${a.colors}  valid=${a.valid}  time=${a.ms} ms` + (k === 'exact' ? `  χ=${a.chi} proved=${a.proved} ω=${a.lowerBound} [${a.method}]` : ''));
  }
  for (const a of Object.values(row.algorithms)) assert(a.valid, `${name}: ${a.label} colouring is proper`);
  const ex = row.algorithms.exact;
  for (const a of Object.values(row.algorithms)) assert(a.colors >= ex.colors, `${name}: ${a.label} uses ≥ χ colours`);
  if (students) for (const a of Object.values(row.algorithms)) assert(a.timetable.clashes.length === 0, `${name}: ${a.label} timetable has no student clash`);
  return row;
}

// (i) supplied dataset
const r1 = E.parseRegistrations(D('sample_registrations.csv'));
if (!json) console.log('Supplied dataset: students=' + r1.students.size + ' courses=' + r1.courses.length + ' errors=' + r1.errors.length + ' warnings=' + r1.warnings.length);
assert(r1.errors.length === 0, 'supplied dataset parses without errors');
const g1 = E.buildConflictGraph(r1.students);
if (!json) console.log('pair checks=' + g1.pairChecks + ' distinct edges=' + g1.m + ' repeated conflicts=' + g1.repeatedConflicts);
const row1 = analyse('(i) Supplied 20-student dataset', g1, r1.students);
row1.pairChecks = g1.pairChecks; row1.repeated = g1.repeatedConflicts; row1.students = r1.students.size;

// (ii) modified dataset
const r2 = E.parseRegistrations(D('modified_registrations.csv'));
assert(r2.errors.length === 0, 'modified dataset parses without errors');
const g2 = E.buildConflictGraph(r2.students);
const row2 = analyse('(ii) Modified registration dataset', g2, r2.students);
row2.pairChecks = g2.pairChecks; row2.repeated = g2.repeatedConflicts; row2.students = r2.students.size; row2.warnings = r2.warnings;
// edge diff
const k1 = new Set(row1.edges.map(e => e.join('|'))), k2 = new Set(row2.edges.map(e => e.join('|')));
row2.newEdges = [...k2].filter(k => !k1.has(k)); row2.newVertices = g2.labels.filter(l => !g1.labels.includes(l));
if (!json) console.log('  new vertices:', row2.newVertices, ' new edges:', row2.newEdges);

// (iii) general graphs
for (const [file, name] of [['crown_graph.txt', '(iii-a) Crown graph S5 (general mode)'], ['boundary_graph.txt', '(iii-b) 30-vertex / 50-edge graph (general mode)'], ['grotzsch_graph.txt', '(iii-c) Grötzsch graph (general mode)']]) {
  const [v, e] = splitGraphFile(D(file));
  const p = E.parseGeneralGraph(v, e);
  assert(p.errors.length === 0, `${name} parses without errors`);
  analyse(name, p.graph, null);
}

// Edge cases / validation
function ec(name, fn) { const res = fn(); out.edgeCases.push({ name, ...res }); if (!json) console.log(`\n[edge] ${name}: ${JSON.stringify(res)}`); }
ec('Graph with no edges', () => { const p = E.parseGeneralGraph('A B C', ''); const r = E.dsatur(p.graph); const x = E.exactChromatic(p.graph);
  assert(r.k === 1 && x.chi === 1, 'edgeless graph uses 1 colour, χ = 1'); return { colors: r.k, chi: x.chi }; });
ec('Single vertex', () => { const p = E.parseGeneralGraph('X', ''); const x = E.exactChromatic(p.graph); assert(x.chi === 1, 'single vertex χ = 1'); return { chi: x.chi }; });
ec('Invalid general input is rejected', () => { const p = E.parseGeneralGraph('A B C A', 'A-A\nA-B\nB-A\nA-Z\nA B C'); assert(p.graph === null && p.errors.length === 5, 'self-loop, duplicate edge, duplicate vertex, unknown vertex and malformed line all reported'); return { errors: p.errors }; });
ec('Edge limit exceeded', () => { const vs = Array.from({ length: 12 }, (_, i) => 'v' + i); const es = []; for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) es.push(`v${i}-v${j}`);
  const p = E.parseGeneralGraph(vs.join(' '), es.join('\n')); assert(p.graph === null && p.errors.some(x => /limit is 50/.test(x)), 'K12 (66 edges) rejected with limit message'); return { errors: p.errors }; });
ec('Vertex limit exceeded', () => { const p = E.parseGeneralGraph(Array.from({ length: 51 }, (_, i) => 'n' + i).join(','), ''); assert(p.graph === null, '51 vertices rejected'); return { errors: p.errors }; });
ec('Registration validation', () => { const r = E.parseRegistrations('Student,C1,C2,C3\nS1,25CS2101,,25CS2102\n,25CS2101\nS3,25CS2101,25CS2101,25CS2203\nS4,bad code!\nS5\nS3,25CS2203');
  assert(r.errors.length === 4 && r.warnings.length === 3, 'missing value, missing ID, invalid code, empty row → errors; repeated registrations & repeated student → warnings'); return { errors: r.errors, warnings: r.warnings }; });
ec('Registration graph over the limit is reported, not trimmed', () => { const lines = []; for (let i = 0; i < 10; i++) lines.push(`T${i},` + Array.from({ length: 6 }, (_, j) => `C${(i * 3 + j) % 30}X`).join(','));
  const r = E.parseRegistrations(lines.join('\n')); const g = E.buildConflictGraph(r.students); const lim = E.checkLimits(g);
  assert(lim.length > 0, `large registration graph (|V|=${g.n}, |E|=${g.m}) produces a limit message`); return { V: g.n, E: g.m, messages: lim }; });
ec('Greedy is order-dependent (crown graph)', () => { const [v, e] = splitGraphFile(D('crown_graph.txt')); const g = E.parseGeneralGraph(v, e).graph;
  const bad = E.greedy(g).k; const goodOrder = g.labels.map((_, i) => i).sort((a, b) => g.labels[a].localeCompare(g.labels[b])); const good = E.greedy(g, goodOrder).k;
  assert(bad === 5 && good === 2, 'greedy uses 5 colours in alternating order but 2 when all u’s come first'); return { alternatingOrder: bad, uFirstOrder: good }; });

if (json) console.log(JSON.stringify(out, null, 1));
else console.log(`\n${failures ? failures + ' FAILURE(S)' : 'ALL TESTS PASSED'}`);
process.exit(failures ? 1 : 0);
