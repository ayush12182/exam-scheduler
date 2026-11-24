/*
 * engine.js — Shared graph-colouring engine
 * DMGT Group Experiential Learning: Examination Timetable Scheduling
 *
 * Used by BOTH modes of the website (registration mode and general-graph mode)
 * and by the Node test runner (tests/run_tests.js).  No external libraries.
 *
 * Contents
 *   1. Limits & helpers
 *   2. Registration parsing + validation          (Mode 1 input)
 *   3. Conflict-graph construction                 (Mode 1 model)
 *   4. General graph parsing + validation          (Mode 2 input)
 *   5. Colouring algorithms: Greedy, Welsh–Powell, DSATUR
 *   6. Exact method: max-clique lower bound + DSATUR branch-and-bound
 *   7. Verification, colour classes, timetable
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ColoringEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. Limits & helpers
   * ------------------------------------------------------------------ */
  const LIMITS = { maxVertices: 50, maxEdges: 50, minVertices: 1 };
  const COURSE_RE = /^[A-Z0-9][A-Z0-9_]{1,19}$/;     // e.g. 25CS2304
  const STUDENT_RE = /^[A-Za-z0-9_]{1,20}$/;         // e.g. S1
  const LABEL_RE = /^[A-Za-z0-9_.]{1,20}$/;          // general-mode vertex label

  const edgeKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

  // Build the internal graph representation shared by every algorithm.
  // labels: array of unique vertex labels; pairs: array of [labelA, labelB].
  function makeGraph(labels, pairs) {
    const index = new Map(labels.map((l, i) => [l, i]));
    const n = labels.length;
    const adjSets = Array.from({ length: n }, () => new Set());
    const edges = [];
    for (const [a, b] of pairs) {
      const i = index.get(a), j = index.get(b);
      if (i === undefined || j === undefined || i === j || adjSets[i].has(j)) continue;
      adjSets[i].add(j); adjSets[j].add(i);
      edges.push(i < j ? [i, j] : [j, i]);
    }
    const adj = adjSets.map(s => Array.from(s).sort((x, y) => x - y));
    return { n, m: edges.length, labels: labels.slice(), index, adj, adjSets, edges,
             degree: adj.map(a => a.length) };
  }

  function checkLimits(g) {
    const errors = [];
    if (g.n < LIMITS.minVertices) errors.push('The graph has no vertices (need at least 1).');
    if (g.n > LIMITS.maxVertices)
      errors.push(`The graph has ${g.n} vertices; the colouring engine accepts at most ${LIMITS.maxVertices}. No vertices were removed — reduce the input.`);
    if (g.m > LIMITS.maxEdges)
      errors.push(`The graph has ${g.m} edges; the colouring engine accepts at most ${LIMITS.maxEdges}. No edges were removed — reduce the input.`);
    return errors;
  }

  /* ------------------------------------------------------------------ *
   * 2. Registration parsing + validation
   *    Accepted line formats (one student per line):
   *      S1,25CS2304,25CS2101,25CS2203          (CSV)
   *      S1: 25CS2304, 25CS2101, 25CS2203       (colon form)
   *    A header line beginning with "Student" is skipped. '#' starts a comment.
   * ------------------------------------------------------------------ */
  function parseRegistrations(text) {
    const errors = [], warnings = [];
    const students = new Map();          // studentId -> array of distinct courses (insertion order)
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    let dataLines = 0, duplicateRegs = 0;

    lines.forEach((raw, idx) => {
      const ln = idx + 1;
      const line = raw.replace(/#.*$/, '').trim();
      if (!line) return;
      let id, rest;
      const colon = line.indexOf(':');
      if (colon >= 0) { id = line.slice(0, colon); rest = line.slice(colon + 1).split(/[,;\t]/); }
      else { const cells = line.split(/[,;\t]/); id = cells[0]; rest = cells.slice(1); }
      id = id.trim().replace(/^"|"$/g, '');

      if (idx === 0 && /^student/i.test(id)) return;   // header row
      dataLines++;

      if (!id) { errors.push(`Line ${ln}: missing student ID.`); return; }
      if (!STUDENT_RE.test(id)) { errors.push(`Line ${ln}: invalid student ID "${id}" (letters, digits, _ only).`); return; }

      const cells = rest.map(c => c.trim().replace(/^"|"$/g, ''));
      // empty cells: trailing ones are CSV padding (row shorter than header) -> warn; inner ones -> error
      let last = cells.length - 1;
      while (last >= 0 && cells[last] === '') last--;
      const trailingEmpty = cells.length - 1 - last;
      const used = cells.slice(0, last + 1);
      if (trailingEmpty > 0 && used.length > 0)
        warnings.push(`Line ${ln} (${id}): ${trailingEmpty} empty trailing cell(s) — row has fewer courses than other rows.`);

      const courses = [];
      let bad = false;
      used.forEach((c, k) => {
        if (c === '') { errors.push(`Line ${ln} (${id}): missing value in course position ${k + 1}.`); bad = true; return; }
        const code = c.toUpperCase().replace(/\s+/g, '');
        if (!COURSE_RE.test(code)) { errors.push(`Line ${ln} (${id}): invalid course code "${c}".`); bad = true; return; }
        courses.push(code);
      });
      if (bad) return;
      if (courses.length === 0) { errors.push(`Line ${ln} (${id}): missing values — no courses listed.`); return; }

      if (students.has(id))
        warnings.push(`Line ${ln}: student ${id} appears more than once — registrations merged.`);
      const list = students.get(id) || [];
      for (const c of courses) {
        if (list.includes(c)) {
          duplicateRegs++;
          warnings.push(`Line ${ln}: repeated registration ${id}–${c} — counted once (a repeated pair creates no new conflict).`);
        } else list.push(c);
      }
      students.set(id, list);
    });

    if (dataLines === 0) errors.push('No registration data entered.');
    const courseSet = new Set();
    for (const cs of students.values()) cs.forEach(c => courseSet.add(c));
    const courses = Array.from(courseSet).sort();
    return { students, courses, errors, warnings, duplicateRegs,
             registrations: Array.from(students.values()).reduce((s, a) => s + a.length, 0) };
  }

  // Serialise the registration relation back to CSV text (used by the dynamic-update editor).
  function registrationsToText(students) {
    return Array.from(students.entries()).map(([s, cs]) => `${s},${cs.join(',')}`).join('\n');
  }

  /* ------------------------------------------------------------------ *
   * 3. Conflict-graph construction
   *    V = set of distinct courses; {ci,cj} in E iff some student takes both.
   *    For every student every unordered pair of their courses is examined
   *    (k courses -> k(k-1)/2 pairs); a Set of keys collapses repeats so the
   *    graph is simple.  Witness students are recorded for each edge.
   * ------------------------------------------------------------------ */
  function buildConflictGraph(students) {
    const courseSet = new Set();
    for (const cs of students.values()) cs.forEach(c => courseSet.add(c));
    const labels = Array.from(courseSet).sort();
    const witnesses = new Map();   // edgeKey -> [students]
    let pairChecks = 0;
    for (const [s, cs] of students.entries()) {
      for (let i = 0; i < cs.length; i++)
        for (let j = i + 1; j < cs.length; j++) {
          pairChecks++;
          if (cs[i] === cs[j]) continue;                // never a self-loop
          const k = edgeKey(cs[i], cs[j]);
          if (!witnesses.has(k)) witnesses.set(k, []);
          witnesses.get(k).push(s);
        }
    }
    const pairs = Array.from(witnesses.keys()).map(k => k.split('|'));
    const g = makeGraph(labels, pairs);
    g.witnesses = witnesses;
    g.pairChecks = pairChecks;
    g.repeatedConflicts = pairChecks - g.m;
    return g;
  }

  /* ------------------------------------------------------------------ *
   * 4. General graph parsing + validation (Mode 2)
   *    Vertices: labels separated by commas, spaces or new lines.
   *    Edges: one per line, "A B", "A,B", "A-B" or "A--B".
   *    Invalid input is REPORTED, never silently dropped.
   * ------------------------------------------------------------------ */
  function parseGeneralGraph(vText, eText) {
    const errors = [];
    const labels = [];
    const seen = new Set();
    const tokens = String(vText || '').split(/[\s,;]+/).filter(Boolean);
    tokens.forEach(t => {
      if (!LABEL_RE.test(t)) errors.push(`Vertex "${t}": invalid label (use letters, digits, _ or ., max 20 chars; "-" is reserved for edges).`);
      else if (seen.has(t)) errors.push(`Vertex "${t}" is listed more than once.`);
      else { seen.add(t); labels.push(t); }
    });
    if (tokens.length === 0) errors.push('Enter at least one vertex label.');
    if (labels.length > LIMITS.maxVertices)
      errors.push(`${labels.length} vertices entered; the limit is ${LIMITS.maxVertices}.`);

    const pairs = [];
    const edgeLine = new Map();
    const lines = String(eText || '').replace(/\r/g, '').split('\n');
    lines.forEach((raw, idx) => {
      const ln = idx + 1;
      const line = raw.replace(/#.*$/, '').trim();
      if (!line) return;
      const parts = line.split(/\s*(?:--|-|,|\s)\s*/).filter(Boolean);
      if (parts.length !== 2) { errors.push(`Edge line ${ln} "${line}": expected exactly two vertex labels (e.g. "A-B").`); return; }
      const [a, b] = parts;
      let ok = true;
      if (!seen.has(a)) { errors.push(`Edge line ${ln} "${line}": unknown vertex "${a}".`); ok = false; }
      if (!seen.has(b)) { errors.push(`Edge line ${ln} "${line}": unknown vertex "${b}".`); ok = false; }
      if (!ok) return;
      if (a === b) { errors.push(`Edge line ${ln} "${line}": self-loop on "${a}" is not allowed in a simple graph.`); return; }
      const k = edgeKey(a, b);
      if (edgeLine.has(k)) { errors.push(`Edge line ${ln} "${line}": duplicate of edge on line ${edgeLine.get(k)}.`); return; }
      edgeLine.set(k, ln);
      pairs.push([a, b]);
    });
    if (pairs.length > LIMITS.maxEdges)
      errors.push(`${pairs.length} edges entered; the limit is ${LIMITS.maxEdges}.`);

    const graph = errors.length ? null : makeGraph(labels, pairs);
    return { graph, errors, labels, pairs };
  }

  /* ------------------------------------------------------------------ *
   * 5. Colouring algorithms
   *    Every algorithm returns:
   *      { name, colors[] (1-based, index = vertex), k, order[], steps[] }
   *    steps[] drives the step-by-step animation in the UI.
   * ------------------------------------------------------------------ */

  // smallest colour >= 1 not used by an already-coloured neighbour
  function smallestFree(g, colors, v) {
    const used = new Set();
    for (const u of g.adj[v]) if (colors[u]) used.add(colors[u]);
    let c = 1;
    while (used.has(c)) c++;
    return { c, used: Array.from(used).sort((a, b) => a - b) };
  }

  // 5a. Greedy (sequential) colouring in the given vertex order (default: input order).
  function greedy(g, order) {
    order = order || g.labels.map((_, i) => i);
    const colors = new Array(g.n).fill(0), steps = [];
    for (const v of order) {
      const { c, used } = smallestFree(g, colors, v);
      colors[v] = c;
      steps.push({ v, color: c, note: `Next vertex in input order. Neighbour colours {${used.join(', ') || '—'}} → smallest free colour ${c}.` });
    }
    return finish('Greedy', g, colors, order, steps);
  }

  // 5b. Welsh–Powell: sort by degree (descending, ties by input order).
  //     For colour c = 1,2,…: scan the list, give c to every uncoloured vertex
  //     not adjacent to a vertex already coloured c in this pass.
  function welshPowell(g) {
    const order = g.labels.map((_, i) => i).sort((a, b) => g.degree[b] - g.degree[a] || a - b);
    const colors = new Array(g.n).fill(0), steps = [];
    let colored = 0, c = 0;
    while (colored < g.n) {
      c++;
      const inClass = [];
      for (const v of order) {
        if (colors[v]) continue;
        if (g.adj[v].some(u => colors[u] === c)) continue;
        colors[v] = c; inClass.push(v); colored++;
        steps.push({ v, color: c, note: `Pass for colour ${c}: deg(${g.labels[v]}) = ${g.degree[v]}; not adjacent to any vertex already coloured ${c}.` });
      }
    }
    return finish('Welsh–Powell', g, colors, order, steps);
  }

  // 5c. DSATUR (Brélaz 1979): repeatedly pick the uncoloured vertex with the
  //     largest saturation degree (number of DISTINCT colours among its
  //     neighbours); ties -> largest degree in the uncoloured subgraph -> input order.
  function dsatur(g) {
    const colors = new Array(g.n).fill(0), steps = [], order = [];
    const satSets = Array.from({ length: g.n }, () => new Set());
    const uncolDeg = g.degree.slice();
    for (let it = 0; it < g.n; it++) {
      let best = -1;
      for (let v = 0; v < g.n; v++) {
        if (colors[v]) continue;
        if (best < 0 || satSets[v].size > satSets[best].size ||
            (satSets[v].size === satSets[best].size && uncolDeg[v] > uncolDeg[best])) best = v;
      }
      const { c } = smallestFree(g, colors, best);
      const sat = satSets[best].size, ud = uncolDeg[best];
      colors[best] = c; order.push(best);
      for (const u of g.adj[best]) { satSets[u].add(c); uncolDeg[u]--; }
      steps.push({ v: best, color: c, note: `Highest saturation = ${sat} (tie-break: uncoloured-degree ${ud}) → smallest free colour ${c}.` });
    }
    return finish('DSATUR', g, colors, order, steps);
  }

  function finish(name, g, colors, order, steps) {
    const k = g.n ? Math.max(...colors) : 0;
    return { name, colors, k, order, steps };
  }

  /* ------------------------------------------------------------------ *
   * 6. Exact method
   *    6a. Maximum clique (Bron–Kerbosch with pivoting) -> lower bound ω(G) ≤ χ(G)
   *    6b. DSATUR-based branch-and-bound -> exact χ(G) (with node budget)
   * ------------------------------------------------------------------ */
  function maxClique(g) {
    let best = [];
    const N = g.adjSets;
    function bk(R, P, X) {
      if (P.length === 0 && X.length === 0) { if (R.length > best.length) best = R.slice(); return; }
      if (R.length + P.length <= best.length) return;                 // bound
      const pivotPool = P.concat(X);
      let pivot = pivotPool[0], bestCnt = -1;
      for (const u of pivotPool) { let cnt = 0; for (const w of P) if (N[u].has(w)) cnt++; if (cnt > bestCnt) { bestCnt = cnt; pivot = u; } }
      for (const v of P.filter(w => !N[pivot].has(w))) {
        bk(R.concat([v]), P.filter(w => N[v].has(w)), X.filter(w => N[v].has(w)));
        P = P.filter(w => w !== v); X = X.concat([v]);
      }
    }
    bk([], g.labels.map((_, i) => i), []);
    return best.sort((a, b) => a - b);
  }

  function exactChromatic(g, opts) {
    const budget = (opts && opts.nodeLimit) || 5e6;
    if (g.n === 0) return { name: 'Exact (B&B)', colors: [], k: 0, chi: 0, proved: true, lowerBound: 0, clique: [], nodes: 0, method: 'empty graph', steps: [], order: [] };
    const clique = maxClique(g);
    const lb = Math.max(1, clique.length);
    const start = dsatur(g);
    let bestK = start.k, bestColors = start.colors.slice(), nodes = 0, aborted = false;

    if (bestK > lb) {
      const colors = new Array(g.n).fill(0);
      // seed the clique with fixed colours 1..|Q| (symmetry breaking)
      clique.forEach((v, i) => { colors[v] = i + 1; });
      const satCount = Array.from({ length: g.n }, () => new Map()); // colour -> count among neighbours
      const addColor = (v, c) => { for (const u of g.adj[v]) { const m = satCount[u]; m.set(c, (m.get(c) || 0) + 1); } };
      const remColor = (v, c) => { for (const u of g.adj[v]) { const m = satCount[u]; const x = m.get(c) - 1; if (x) m.set(c, x); else m.delete(c); } };
      clique.forEach(v => addColor(v, colors[v]));
      let remaining = g.n - clique.length;

      const search = (maxUsed) => {
        if (aborted) return;
        if (++nodes > budget) { aborted = true; return; }
        if (remaining === 0) { bestK = maxUsed; bestColors = colors.slice(); return; }
        // choose uncoloured vertex with max saturation, tie -> degree
        let v = -1;
        for (let u = 0; u < g.n; u++) {
          if (colors[u]) continue;
          if (v < 0 || satCount[u].size > satCount[v].size ||
              (satCount[u].size === satCount[v].size && g.degree[u] > g.degree[v])) v = u;
        }
        const limit = Math.min(maxUsed + 1, bestK - 1);
        for (let c = 1; c <= limit; c++) {
          if (satCount[v].has(c)) continue;
          colors[v] = c; addColor(v, c); remaining--;
          search(Math.max(maxUsed, c));
          remaining++; remColor(v, c); colors[v] = 0;
          if (bestK === lb || aborted) return;          // cannot do better than the clique bound
        }
      };
      search(clique.length);
    }
    const proved = !aborted;
    return {
      name: 'Exact (B&B)', colors: bestColors, k: bestK, chi: proved ? bestK : null, proved,
      lowerBound: lb, clique, nodes,
      method: bestK === lb && nodes === 0 ? `clique bound: ω(G) = ${lb} equals DSATUR's ${bestK} colours`
             : proved ? `branch-and-bound searched ${nodes} nodes; no ${bestK - 1}-colouring exists` : `node budget (${budget}) exhausted — best found ${bestK}, lower bound ${lb}`,
      order: [], steps: bestColors.map((c, v) => ({ v, color: c, note: 'Colour from exact search.' }))
    };
  }

  /* ------------------------------------------------------------------ *
   * 7. Verification, colour classes, timetable
   * ------------------------------------------------------------------ */
  function verify(g, colors) {
    const conflicts = [], uncolored = [];
    g.labels.forEach((_, v) => { if (!colors[v]) uncolored.push(v); });
    for (const [a, b] of g.edges) if (colors[a] && colors[a] === colors[b]) conflicts.push([a, b, colors[a]]);
    return { valid: conflicts.length === 0 && uncolored.length === 0, edgesChecked: g.m, conflicts, uncolored };
  }

  function colorClasses(g, colors) {
    const k = g.n ? Math.max(0, ...colors) : 0;
    const classes = Array.from({ length: k }, () => []);
    colors.forEach((c, v) => { if (c) classes[c - 1].push(g.labels[v]); });
    return classes;
  }

  // Timetable for registration mode: one slot per colour class.
  // Also re-checks every student's exams directly (independent second check).
  function buildTimetable(g, colors, students) {
    const classes = colorClasses(g, colors);
    const slotOf = new Map(g.labels.map((l, i) => [l, colors[i]]));
    const slots = classes.map((courses, i) => {
      const sitting = new Set();
      for (const [s, cs] of students.entries()) if (cs.some(c => courses.includes(c))) sitting.add(s);
      return { slot: i + 1, courses, students: sitting.size };
    });
    const clashes = [];
    for (const [s, cs] of students.entries()) {
      const bySlot = new Map();
      for (const c of cs) { const t = slotOf.get(c); if (bySlot.has(t)) clashes.push(`${s}: ${bySlot.get(t)} & ${c} both in slot ${t}`); else bySlot.set(t, c); }
    }
    return { slots, clashes };
  }

  // Run an algorithm by key, timing it (median-free mean over repeated runs).
  const ALGORITHMS = {
    greedy: { label: 'Greedy (input order)', fn: g => greedy(g) },
    wp: { label: 'Welsh–Powell', fn: g => welshPowell(g) },
    dsatur: { label: 'DSATUR', fn: g => dsatur(g) },
    exact: { label: 'Exact (branch-and-bound)', fn: g => exactChromatic(g) },
  };
  function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }
  function runTimed(key, g, minMs) {
    const algo = ALGORITHMS[key];
    let reps = 0, t0 = now(), res;
    do { res = algo.fn(g); reps++; } while (now() - t0 < (minMs || 20) && reps < 2000);
    const ms = (now() - t0) / reps;
    res.ms = ms; res.key = key; res.label = algo.label;
    return res;
  }

  return {
    LIMITS, makeGraph, checkLimits, parseRegistrations, registrationsToText, buildConflictGraph,
    parseGeneralGraph, greedy, welshPowell, dsatur, maxClique, exactChromatic,
    verify, colorClasses, buildTimetable, ALGORITHMS, runTimed, edgeKey,
  };
});
