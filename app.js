/*
 * app.js — UI controller for both modes. All mathematics lives in engine.js;
 * both modes hand a graph to the SAME colouring engine.
 */
(function () {
  'use strict';
  const E = window.ColoringEngine;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const view = new GraphView($('graphSvg'));

  const ALGO_INFO = {
    greedy: { rule: 'Vertices in input (sorted) order; each gets the smallest colour not used by a coloured neighbour.',
              explain: 'Greedy: visit vertices in the order they are listed and give each the smallest colour that none of its already-coloured neighbours has. Fast, but the result depends on the order.' },
    wp: { rule: 'Sort by degree (high→low). For colour c, sweep the list giving c to every uncoloured vertex not adjacent to one already coloured c.',
          explain: 'Welsh–Powell: sort vertices by decreasing degree. Take colour 1 and sweep down the list, colouring every vertex that is not adjacent to one already given colour 1; repeat with colour 2, 3, … until every vertex is coloured.' },
    dsatur: { rule: 'Pick the uncoloured vertex with most distinct neighbour colours (saturation); ties → highest uncoloured degree.',
              explain: 'DSATUR: at every step choose the uncoloured vertex whose neighbours already use the most DIFFERENT colours (its saturation degree) — the most constrained vertex — and give it the smallest free colour. Ties are broken by degree in the uncoloured part of the graph.' },
    exact: { rule: 'Lower bound ω(G) from a maximum clique; DSATUR-ordered branch-and-bound searches for a colouring with fewer colours.',
             explain: 'Exact: a maximum clique gives a lower bound ω(G) ≤ χ(G). If DSATUR already meets it, the colouring is optimal. Otherwise branch-and-bound tries every way to colour with fewer colours (pruning hopeless branches); if none exists, the minimum is proved.' },
  };

  const S = { mode: 'reg', students: null, graph: null, results: null, sel: 'dsatur', step: 0, timer: null, lastEdges: null };

  /* ---------------- messages ---------------- */
  function msgs(box, errors, warnings, infos) {
    const parts = [];
    (errors || []).forEach(m => parts.push(`<div class="msg err">✗ ${esc(m)}</div>`));
    (warnings || []).forEach(m => parts.push(`<div class="msg warn">⚠ ${esc(m)}</div>`));
    (infos || []).forEach(m => parts.push(`<div class="msg ok">${m}</div>`));
    $(box).innerHTML = parts.join('');
  }

  /* ---------------- mode switching ---------------- */
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));
  function setMode(m) {
    S.mode = m;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.mode === m));
    $('regInput').hidden = m !== 'reg';
    $('regTableCard').hidden = m !== 'reg' || !S.students;
    $('genInput').hidden = m !== 'gen';
    $('solveStep').textContent = m === 'reg' ? '3' : '2';
    $('gTitle').textContent = m === 'reg' ? 'Conflict graph' : 'Graph';
    $('dragHint').textContent = m === 'reg' ? 'Drag vertices to rearrange. Hover an edge to see which students create the conflict.' : 'Drag vertices to rearrange. Hover a vertex or edge for details.';
    clearGraph();
  }

  function clearGraph() {
    stopPlay();
    S.graph = null; S.results = null; S.lastEdges = null;
    view.graph = null; view.render();
    $('emptyState').hidden = false; $('results').hidden = true; $('stepBar').hidden = true; $('stNote').hidden = true;
    $('gStats').textContent = ''; $('legend').innerHTML = ''; $('limitMsg').hidden = true; $('solveBtn').disabled = true;
  }

  /* ---------------- Mode 1: registrations ---------------- */
  $('loadSample').onclick = () => { $('regText').value = window.SAMPLES.registrations; buildFromText(); };
  $('csvFile').onchange = ev => {
    const f = ev.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { $('regText').value = rd.result; buildFromText(); };
    rd.readAsText(f); ev.target.value = '';
  };
  $('buildReg').onclick = buildFromText;

  function buildFromText() {
    const p = E.parseRegistrations($('regText').value);
    if (p.errors.length) {
      msgs('regMsgs', p.errors, p.warnings);
      S.students = null; $('regTableCard').hidden = true; clearGraph(); return;
    }
    S.students = p.students;
    msgs('regMsgs', [], p.warnings, [`✓ ${p.students.size} students, ${p.registrations} registrations, ${p.courses.length} distinct subject codes.`]);
    msgs('updMsgs');
    regenerate({ resetLayout: true });
  }

  function regenerate(opts) {
    const g = E.buildConflictGraph(S.students);
    const prev = S.graph;
    loadGraph(g, opts);
    renderRegTable();
    if (opts && opts.diffFrom) {
      const old = opts.diffFrom;
      const oldE = new Set(old.edges.map(([a, b]) => E.edgeKey(old.labels[a], old.labels[b])));
      const newE = new Set(g.edges.map(([a, b]) => E.edgeKey(g.labels[a], g.labels[b])));
      const addV = g.labels.filter(l => !old.labels.includes(l)), remV = old.labels.filter(l => !g.labels.includes(l));
      const addE = [...newE].filter(k => !oldE.has(k)), remE = [...oldE].filter(k => !newE.has(k));
      const fmt = a => a.map(k => k.replace('|', '–')).join(', ');
      msgs('updMsgs', [], [], [`✓ Graph regenerated: |V| ${old.n} → ${g.n}, |E| ${old.m} → ${g.m}.` +
        (addV.length ? `<br>New vertices: <b>${esc(addV.join(', '))}</b>` : '') + (remV.length ? `<br>Removed vertices: <b>${esc(remV.join(', '))}</b>` : '') +
        (addE.length ? `<br>New edges: <b>${esc(fmt(addE))}</b>` : '') + (remE.length ? `<br>Removed edges: <b>${esc(fmt(remE))}</b>` : '') +
        (!addE.length && !remE.length && !addV.length && !remV.length ? '<br>No change to the graph (the new pairs were already conflicts).' : '')]);
      if (opts.resolve && !E.checkLimits(g).length) solve();
    }
    return prev;
  }

  function renderRegTable() {
    $('regTableCard').hidden = S.mode !== 'reg';
    $('regCount').textContent = `(${S.students.size} students)`;
    $('regTable').querySelector('tbody').innerHTML = Array.from(S.students.entries()).map(([s, cs]) =>
      `<tr><td><b>${esc(s)}</b></td><td>${cs.map(c => `<span class="chip">${esc(c)}</span>`).join(' ')}</td><td><button class="tiny" data-edit="${esc(s)}">edit</button></td></tr>`).join('');
    $('regTable').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
      $('updStudent').value = b.dataset.edit; $('updCourses').value = S.students.get(b.dataset.edit).join(', '); $('updCourses').focus();
    });
  }

  function applyUpdate(remove) {
    if (!S.students) return;
    const id = $('updStudent').value.trim();
    if (!id) return msgs('updMsgs', ['Enter a student ID.']);
    const copy = new Map(S.students);
    if (remove) {
      if (!copy.has(id)) return msgs('updMsgs', [`Student ${id} is not in the registration data.`]);
      copy.delete(id);
      if (copy.size === 0) return msgs('updMsgs', ['Cannot remove the last student — use Reset instead.']);
    } else {
      // validate through the same parser used for full input
      const p = E.parseRegistrations(`${id},${$('updCourses').value.split(/[,;\s]+/).filter(Boolean).join(',')}`);
      if (p.errors.length) return msgs('updMsgs', p.errors.map(e => e.replace(/^Line 1/, 'Update')));
      copy.set(id, p.students.get(id));
      if (p.warnings.length) setTimeout(() => $('updMsgs').insertAdjacentHTML('beforeend', p.warnings.map(w => `<div class="msg warn">⚠ ${esc(w.replace(/^Line 1/, 'Update'))}</div>`).join('')), 0);
    }
    const before = S.graph, hadResults = !!S.results;
    S.students = copy;
    $('regText').value = 'Student,Courses...\n' + E.registrationsToText(copy);
    regenerate({ diffFrom: before, resolve: hadResults });
  }
  $('updApply').onclick = () => applyUpdate(false);
  $('updRemove').onclick = () => applyUpdate(true);

  /* ---------------- Mode 2: general graph ---------------- */
  document.querySelectorAll('.sample').forEach(b => b.onclick = () => {
    const s = window.SAMPLES[b.dataset.sample]; $('genV').value = s.v; $('genE').value = s.e; buildGeneral();
  });
  $('buildGen').onclick = buildGeneral;
  function buildGeneral() {
    const p = E.parseGeneralGraph($('genV').value, $('genE').value);
    if (p.errors.length) { msgs('genMsgs', p.errors.concat(['Graph not built — fix the items above (nothing was discarded automatically).'])); clearGraph(); return; }
    msgs('genMsgs', [], [], [`✓ Valid simple graph: ${p.graph.n} vertices, ${p.graph.m} edges.`]);
    loadGraph(p.graph, { resetLayout: true });
  }

  /* ---------------- shared: graph + solve ---------------- */
  function loadGraph(g, opts) {
    stopPlay();
    S.graph = g; S.results = null;
    $('emptyState').hidden = true; $('results').hidden = true; $('stepBar').hidden = true; $('stNote').hidden = true; $('legend').innerHTML = '';
    const iso = g.degree.filter(d => d === 0).length;
    const comps = components(g);
    $('gStats').innerHTML = `|V| = ${g.n} · |E| = ${g.m}` + (g.pairChecks != null ? ` · ${g.pairChecks} pairs checked, ${g.repeatedConflicts} repeats merged` : '') +
      ` · ${comps} component${comps === 1 ? '' : 's'}` + (iso ? ` · ${iso} isolated` : '');
    const lim = E.checkLimits(g);
    $('limitMsg').hidden = !lim.length;
    $('limitMsg').innerHTML = lim.map(esc).join('<br>');
    $('solveBtn').disabled = lim.length > 0;
    view.setGraph(g, opts);
  }

  function components(g) {
    const seen = new Array(g.n).fill(false); let c = 0;
    for (let s = 0; s < g.n; s++) { if (seen[s]) continue; c++; const st = [s]; seen[s] = true;
      while (st.length) { const v = st.pop(); for (const u of g.adj[v]) if (!seen[u]) { seen[u] = true; st.push(u); } } }
    return c;
  }

  $('algoSel').onchange = () => { S.sel = $('algoSel').value; showExplain(); if (S.results) showResult(); };
  function showExplain() { $('algoExplain').textContent = ALGO_INFO[S.sel].explain; }
  $('solveBtn').onclick = solve;

  function solve() {
    if (!S.graph || E.checkLimits(S.graph).length) return;
    stopPlay();
    const g = S.graph;
    S.results = {};
    for (const k of ['greedy', 'wp', 'dsatur', 'exact']) {
      const r = E.runTimed(k, g, 15);
      r.verify = E.verify(g, r.colors);
      S.results[k] = r;
    }
    $('results').hidden = false;
    showResult();
  }

  function showResult() {
    const g = S.graph, R = S.results, r = R[S.sel], ex = R.exact;
    const chi = ex.proved ? ex.chi : null;
    // comparison table
    $('cmpTable').querySelector('tbody').innerHTML = ['greedy', 'wp', 'dsatur', 'exact'].map(k => {
      const x = R[k];
      const opt = chi != null ? (x.k === chi ? '<span class="yes">Yes — proved</span>' : `<span class="no">No (χ = ${chi})</span>`)
                              : (x.k === ex.lowerBound ? '<span class="yes">Yes — meets ω</span>' : '<span class="muted">not proved</span>');
      return `<tr class="${k === S.sel ? 'selrow' : ''}" data-k="${k}"><td><b>${esc(x.label)}</b></td><td class="rule">${esc(ALGO_INFO[k].rule)}</td><td class="num">${x.k}</td>` +
        `<td>${x.verify.valid ? '<span class="yes">✓ valid</span>' : `<span class="no">✗ ${x.verify.conflicts.length} conflicts</span>`}</td><td class="num">${x.ms.toFixed(4)}</td><td>${opt}</td></tr>`;
    }).join('');
    $('cmpTable').querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => { $('algoSel').value = tr.dataset.k; $('algoSel').onchange(); });

    // optimality box
    const cl = ex.clique.map(v => g.labels[v]);
    $('optBox').innerHTML = `<h3>Optimality analysis</h3>
      <p><b>Lower bound:</b> a maximum clique has ${ex.lowerBound} ${ex.lowerBound === 1 ? 'vertex' : 'vertices'} <span class="mono">{${esc(cl.join(', '))}}</span>. Every pair in it conflicts, so they need ${ex.lowerBound} different ${S.mode === "reg" ? "slots" : "colours"}: χ(G) ≥ ω(G) = ${ex.lowerBound}.</p>
      <p><b>Exact result:</b> ${ex.proved ? `χ(G) = <b>${chi}</b> — ${esc(ex.method)}.` : `not proved within the search budget (${esc(ex.method)}); results are reported as valid colourings only.`}</p>
      <p class="verdict ${r.k === chi ? 'good' : 'meh'}"><b>${esc(r.label)}</b> uses ${r.k} colour${r.k === 1 ? '' : 's'}: ` +
      (chi != null ? (r.k === chi ? 'this is a <b>minimum</b> colouring (optimality proved).' : `a <b>valid</b> colouring, but <b>not optimal</b> — ${r.k - chi} more than χ(G) = ${chi}.`) : 'a valid colouring; optimality not established.') + '</p>';

    // legend
    const k = r.k;
    $('legend').innerHTML = Array.from({ length: k }, (_, i) => `<span class="lg"><i style="background:${GraphView.colorOf(i + 1)}"></i>${S.mode === 'reg' ? 'Slot' : 'Colour'} ${i + 1}</span>`).join('');

    // timetable / colour classes
    const classes = E.colorClasses(g, r.colors);
    if (S.mode === 'reg') {
      $('ttTitle').textContent = `Examination timetable — ${k} slot${k === 1 ? '' : 's'}`;
      const tt = E.buildTimetable(g, r.colors, S.students);
      $('timetable').innerHTML = `<table class="tt"><thead><tr><th>Slot (colour)</th><th>Suggested session</th><th>Courses examined together</th><th>Students sitting</th></tr></thead><tbody>` +
        tt.slots.map(s => `<tr><td><span class="sw" style="background:${GraphView.colorOf(s.slot)}"></span><b>Slot ${s.slot}</b></td><td>${sessionName(s.slot)}</td>` +
          `<td>${s.courses.map(c => `<span class="chip">${esc(c)}</span>`).join(' ')}</td><td class="num">${s.students}</td></tr>`).join('') + '</tbody></table>' +
        `<p class="hint small">Each colour class is an independent set — no two courses in it share a student — so they can be examined in the same slot. Session names are an illustrative mapping (two sessions per day).</p>`;
      $('stuDetails').hidden = false;
      const slotOf = new Map(g.labels.map((l, i) => [l, r.colors[i]]));
      $('stuTable').querySelector('tbody').innerHTML = Array.from(S.students.entries()).map(([s, cs]) => {
        const sl = cs.map(c => slotOf.get(c)); const ok = new Set(sl).size === sl.length;
        return `<tr><td>${esc(s)}</td><td>${cs.map((c, i) => `${esc(c)} → <b>${sl[i]}</b>`).join(', ')}</td><td>${ok ? '<span class="yes">✓</span>' : '<span class="no">✗</span>'}</td></tr>`;
      }).join('');
      S.timetable = tt;
    } else {
      $('ttTitle').textContent = `Vertex colours & colour classes — ${k} colour${k === 1 ? '' : 's'}`;
      $('timetable').innerHTML = `<table class="tt"><thead><tr><th>Colour</th><th>Colour class (independent set)</th><th>Size</th></tr></thead><tbody>` +
        classes.map((cs, i) => `<tr><td><span class="sw" style="background:${GraphView.colorOf(i + 1)}"></span><b>Colour ${i + 1}</b></td><td>${cs.map(c => `<span class="chip">${esc(c)}</span>`).join(' ')}</td><td class="num">${cs.length}</td></tr>`).join('') + '</tbody></table>';
      $('stuDetails').hidden = true; S.timetable = null;
    }

    // verification
    const v = r.verify;
    let stuLine = '';
    if (S.mode === 'reg') {
      const cl2 = S.timetable.clashes;
      stuLine = `<li>${cl2.length === 0 ? '✓' : '✗'} ${S.students.size - new Set(cl2.map(x => x.split(':')[0])).size} / ${S.students.size} students have all their exams in different slots.</li>`;
    }
    $('verifyBox').innerHTML = `<div class="verify ${v.valid ? 'good' : 'bad'}"><div class="big">${v.valid ? '✓ Proper colouring' : '✗ Invalid colouring'}</div><ul>
      <li>${v.edgesChecked} / ${g.m} edges checked: ${v.conflicts.length} with equal colours at both ends.</li>
      <li>${g.n - v.uncolored.length} / ${g.n} vertices coloured.</li>${stuLine}</ul>` +
      (v.conflicts.length ? `<p>Conflicting pairs: ${v.conflicts.map(([a, b, c]) => `${esc(g.labels[a])}–${esc(g.labels[b])} (colour ${c})`).join(', ')}</p>` : '') + '</div>';
    $('edgeTable').querySelector('tbody').innerHTML = g.edges.map(([a, b], i) => {
      const w = g.witnesses ? g.witnesses.get(E.edgeKey(g.labels[a], g.labels[b])) : null;
      const ok = r.colors[a] !== r.colors[b];
      return `<tr><td>${i + 1}</td><td>${esc(g.labels[a])} — ${esc(g.labels[b])}</td><td>${r.colors[a]} ≠ ${r.colors[b]}</td><td>${ok ? '<span class="yes">✓</span>' : '<span class="no">✗</span>'}</td><td class="witcol">${w ? esc(w.join(', ')) : '—'}</td></tr>`;
    }).join('');
    document.querySelectorAll('.witcol').forEach(c => c.hidden = !g.witnesses);
    $('vTable').querySelector('tbody').innerHTML = g.labels.map((l, i) => `<tr><td>${esc(l)}</td><td class="num">${g.degree[i]}</td><td><span class="sw" style="background:${GraphView.colorOf(r.colors[i])}"></span>${r.colors[i]}</td></tr>`).join('');

    // graph + steps
    S.step = r.steps.length;
    $('stepBar').hidden = false;
    const stepping = S.sel !== 'exact';
    ['stFirst', 'stPrev', 'stPlay', 'stNext'].forEach(id => $(id).disabled = !stepping);
    drawStep();
  }

  function sessionName(slot) { const day = Math.ceil(slot / 2); return `Day ${day} · ${slot % 2 ? 'Morning (FN)' : 'Afternoon (AN)'}`; }

  /* ---------------- step-by-step ---------------- */
  function drawStep() {
    const g = S.graph, r = S.results[S.sel];
    const colors = new Array(g.n).fill(0);
    for (let i = 0; i < S.step; i++) colors[r.steps[i].v] = r.steps[i].color;
    const conflicts = new Set();
    for (const [a, b] of g.edges) if (colors[a] && colors[a] === colors[b]) conflicts.add(a + '-' + b);
    const cur = S.step > 0 && S.step <= r.steps.length && S.step < r.steps.length ? r.steps[S.step - 1] : null;
    view.update({ colors, conflicts, active: cur ? cur.v : null, hideBadges: g.n > 20, badge: S.mode === 'reg' ? 'slot' : 'colour' });
    $('stCount').textContent = S.sel === 'exact' ? 'final result (exact search)' : `step ${S.step} / ${r.steps.length}`;
    const note = $('stNote');
    if (S.sel === 'exact') { note.hidden = false; note.innerHTML = 'Exact method: final optimal colouring shown (the search explores many partial colourings, so it is not animated).'; }
    else if (S.step === 0) { note.hidden = false; note.innerHTML = `<b>${esc(r.label)}</b> — vertex order: ${r.order.map(v => esc(g.labels[v])).join(' → ')}. Press ▶ to colour one vertex at a time.`; }
    else if (S.step === r.steps.length) { note.hidden = false; note.innerHTML = `Done: <b>${r.k}</b> colours. ` + (cur ? '' : 'Every vertex coloured; see the correctness check below.'); }
    else { const s = r.steps[S.step - 1]; note.hidden = false; note.innerHTML = `Step ${S.step}: <b>${esc(g.labels[s.v])}</b> ← colour ${s.color}. ${esc(s.note)}`; }
    $('stPlay').textContent = S.timer ? '❚❚ Pause' : '▶ Play';
  }
  function go(n) { const r = S.results && S.results[S.sel]; if (!r) return; S.step = Math.max(0, Math.min(r.steps.length, n)); drawStep(); }
  function stopPlay() { if (S.timer) { clearInterval(S.timer); S.timer = null; } if ($('stPlay')) $('stPlay').textContent = '▶ Play'; }
  $('stFirst').onclick = () => { stopPlay(); go(0); };
  $('stPrev').onclick = () => { stopPlay(); go(S.step - 1); };
  $('stNext').onclick = () => { stopPlay(); go(S.step + 1); };
  $('stLast').onclick = () => { stopPlay(); go(Infinity); };
  $('stPlay').onclick = () => {
    if (S.timer) { stopPlay(); drawStep(); return; }
    const r = S.results[S.sel]; if (S.step >= r.steps.length) S.step = 0;
    const tick = () => { if (S.step >= r.steps.length) { stopPlay(); drawStep(); return; } go(S.step + 1); };
    S.timer = setInterval(tick, 1650 - +$('stSpeed').value); tick();
  };

  /* ---------------- CSV export ---------------- */
  $('dlCsv').onclick = () => {
    const g = S.graph, r = S.results && S.results[S.sel]; if (!r) return;
    const classes = E.colorClasses(g, r.colors);
    const head = S.mode === 'reg' ? 'Slot,Session,Courses' : 'Colour,Vertices';
    const rows = classes.map((cs, i) => S.mode === 'reg' ? `${i + 1},${sessionName(i + 1)},"${cs.join(' ')}"` : `${i + 1},"${cs.join(' ')}"`);
    const blob = new Blob([head + '\n' + rows.join('\n') + '\n'], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (S.mode === 'reg' ? 'exam_timetable_' : 'colouring_') + S.sel + '.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  /* ---------------- reset ---------------- */
  $('resetBtn').onclick = () => {
    ['regText', 'genV', 'genE', 'updStudent', 'updCourses'].forEach(id => $(id).value = '');
    ['regMsgs', 'genMsgs', 'updMsgs'].forEach(id => $(id).innerHTML = '');
    S.students = null; $('regTableCard').hidden = true;
    view.pos = new Map(); clearGraph();
  };

  showExplain();
  // expose for automated screenshots / debugging
  window.__app = { S, solve, go, setMode, buildFromText, buildGeneral, applyUpdate };
})();
