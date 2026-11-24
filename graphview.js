/*
 * graphview.js — minimal SVG graph renderer (no external library).
 * Circular layout for small graphs, deterministic force-directed layout for larger ones.
 * Positions are remembered per label so a dynamic update keeps the picture stable.
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const W = 800, H = 520;
  const PALETTE = ['#2f6db5', '#e8862a', '#3d9a52', '#d6454a', '#8e63b8', '#d9b42c', '#2aa3a0', '#e77fae', '#8a6447', '#6b7a8f', '#9bbb2f', '#c0507d'];
  function colorOf(c) {
    if (!c) return '#e5e7eb';
    if (c <= PALETTE.length) return PALETTE[c - 1];
    return `hsl(${(c * 137.508) % 360},60%,48%)`;
  }
  function textOn(hex) {
    if (!hex.startsWith('#')) return '#fff';
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 165 ? '#1f2937' : '#fff';
  }
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

  function GraphView(svg) {
    this.svg = svg; this.pos = new Map(); this.graph = null; this.state = {};
  }

  GraphView.prototype.radius = function () {
    const g = this.graph; const maxLen = Math.max(1, ...g.labels.map(l => l.length));
    const base = maxLen > 5 ? 31 : maxLen > 2 ? 22 : 18;
    return g.n > 30 ? base * 0.72 : g.n > 16 ? base * 0.85 : base;
  };

  GraphView.prototype.layout = function (g) {
    const known = g.labels.filter(l => this.pos.has(l)).length;
    if (known === g.n && g.n > 0) return;                       // keep existing picture
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 50;
    const fresh = new Map();
    if (g.n <= 14 || known > 0) {
      // circular layout (new vertices of a dynamic update are slotted onto the circle)
      g.labels.forEach((l, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / g.n;
        fresh.set(l, this.pos.get(l) || { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
      });
      if (known > 0) {
        // place newly added vertices on free circle positions
        g.labels.forEach((l, i) => { if (!this.pos.has(l)) { const a = -Math.PI / 2 + (2 * Math.PI * i) / g.n + 0.18; fresh.set(l, { x: cx + (R + 8) * Math.cos(a), y: cy + (R + 8) * Math.sin(a) }); } });
      }
    } else {
      // Fruchterman–Reingold, deterministic start on a circle
      const P = g.labels.map((l, i) => { const a = (2 * Math.PI * i) / g.n; return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), dx: 0, dy: 0 }; });
      const k = Math.sqrt((W * H) / Math.max(1, g.n)) * 0.75;
      let t = 60;
      for (let it = 0; it < 400; it++) {
        P.forEach(p => { p.dx = 0; p.dy = 0; });
        for (let i = 0; i < g.n; i++) for (let j = i + 1; j < g.n; j++) {
          let dx = P[i].x - P[j].x, dy = P[i].y - P[j].y; const d = Math.max(0.01, Math.hypot(dx, dy));
          const f = (k * k) / d; dx /= d; dy /= d;
          P[i].dx += dx * f; P[i].dy += dy * f; P[j].dx -= dx * f; P[j].dy -= dy * f;
        }
        for (const [a, b] of g.edges) {
          let dx = P[a].x - P[b].x, dy = P[a].y - P[b].y; const d = Math.max(0.01, Math.hypot(dx, dy));
          const f = (d * d) / k; dx /= d; dy /= d;
          P[a].dx -= dx * f; P[a].dy -= dy * f; P[b].dx += dx * f; P[b].dy += dy * f;
        }
        P.forEach(p => {
          p.dx += (cx - p.x) * 0.06; p.dy += (cy - p.y) * 0.06;      // gravity keeps components on screen
          const d = Math.max(0.01, Math.hypot(p.dx, p.dy));
          p.x += (p.dx / d) * Math.min(d, t); p.y += (p.dy / d) * Math.min(d, t);
          p.x = Math.min(W - 30, Math.max(30, p.x)); p.y = Math.min(H - 30, Math.max(30, p.y));
        });
        t = Math.max(1, t * 0.985);
      }
      g.labels.forEach((l, i) => fresh.set(l, { x: P[i].x, y: P[i].y }));
    }
    this.pos = fresh;
  };

  GraphView.prototype.setGraph = function (g, opts) {
    if (opts && opts.resetLayout) this.pos = new Map();
    this.graph = g; this.layout(g); this.state = {}; this.render();
  };

  // state: { colors:[], active: vertexIndex, conflicts:Set(edgeKey) }
  GraphView.prototype.update = function (state) { this.state = state || {}; this.render(); };

  GraphView.prototype.render = function () {
    const svg = this.svg, g = this.graph, st = this.state;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!g) return;
    const r = this.radius();
    const P = g.labels.map(l => this.pos.get(l));
    const eg = el('g', { class: 'edges' }), ng = el('g', { class: 'nodes' });
    g.edges.forEach(([a, b]) => {
      const key = a + '-' + b;
      const bad = st.conflicts && st.conflicts.has(key);
      const hot = st.active != null && (a === st.active || b === st.active);
      const line = el('line', { x1: P[a].x, y1: P[a].y, x2: P[b].x, y2: P[b].y, class: 'edge' + (bad ? ' bad' : '') + (hot ? ' hot' : '') });
      const t = el('title', {});
      const w = g.witnesses && g.witnesses.get(root.ColoringEngine.edgeKey(g.labels[a], g.labels[b]));
      t.textContent = `${g.labels[a]} — ${g.labels[b]}` + (w ? `\nShared by: ${w.join(', ')}` : '') + (bad ? '\n✗ same colour on both ends!' : '');
      line.appendChild(t); eg.appendChild(line);
    });
    g.labels.forEach((l, v) => {
      const c = st.colors ? st.colors[v] : 0;
      const fill = colorOf(c);
      const grp = el('g', { class: 'node' + (v === st.active ? ' active' : ''), transform: `translate(${P[v].x},${P[v].y})` });
      if (v === st.active) grp.appendChild(el('circle', { r: r + 7, class: 'halo' }));
      grp.appendChild(el('circle', { r, fill, class: 'disc' + (c ? '' : ' blank') }));
      const fs = Math.max(9, Math.min(14, (r * 2.3) / Math.max(2, l.length) * 1.25));
      const tx = el('text', { 'text-anchor': 'middle', dy: '0.35em', 'font-size': fs.toFixed(1), fill: c ? textOn(fill) : '#374151' });
      tx.textContent = l; grp.appendChild(tx);
      if (c) { const b = el('text', { 'text-anchor': 'middle', y: r + 13, class: 'cbadge' }); b.textContent = (st.badge || 'colour') + ' ' + c; if (!st.hideBadges) grp.appendChild(b); }
      const tt = el('title', {}); tt.textContent = `${l}\ndegree ${g.degree[v]}` + (c ? `\ncolour ${c}` : ''); grp.appendChild(tt);
      this.drag(grp, l);
      ng.appendChild(grp);
    });
    svg.appendChild(eg); svg.appendChild(ng);
  };

  GraphView.prototype.drag = function (node, label) {
    const svg = this.svg, self = this;
    node.addEventListener('pointerdown', ev => {
      ev.preventDefault(); node.setPointerCapture(ev.pointerId);
      const move = e => {
        const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        const p = pt.matrixTransform(svg.getScreenCTM().inverse());
        self.pos.set(label, { x: Math.min(W - 20, Math.max(20, p.x)), y: Math.min(H - 20, Math.max(20, p.y)) });
        self.render();
      };
      const up = () => { node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); svg.removeEventListener('pointermove', move); };
      svg.addEventListener('pointermove', move); node.addEventListener('pointerup', up); svg.addEventListener('pointerup', up, { once: true });
    });
  };

  GraphView.colorOf = colorOf; GraphView.textOn = textOn;
  root.GraphView = GraphView;
})(typeof self !== 'undefined' ? self : this);
