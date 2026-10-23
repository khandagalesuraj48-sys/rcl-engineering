/* THE ROAD FROM ITS KML (the drawing exported from AutoCAD Civil 3D / Plex-Earth): read in the browser, nothing is sent but the
 * result – the chainage line: for every chainage label (8+000, 8+020 …) the place on the road where it is (longitude, latitude).
 * The place is the middle of the station's major tick line on the centre line (the short line across the road at that chainage –
 * folder "…STAN-MAJR"); when a label has no tick near it, the label's own point is used. Works in the page (window.RclKml) and in
 * node (the unit test). */
(function (root) {
  'use strict';
  const CH = /^\s*(?:CH\.?\s*)?(\d{1,4})\s*\+\s*(\d{1,3}(?:\.\d+)?)\s*$/i;
  const coords = s => String(s || '').replace(/\s*,\s*/g, ',').trim().split(/\s+/).map(p => p.split(',').map(Number)).filter(p => p.length >= 2 && isFinite(p[0]) && isFinite(p[1]));
  const unXml = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  // metres between two points (small distances – a flat earth is near enough)
  const metres = (a, b) => { const k = Math.PI / 180, x = (b[0] - a[0]) * k * Math.cos((a[1] + b[1]) / 2 * k), y = (b[1] - a[1]) * k; return Math.sqrt(x * x + y * y) * 6371000; };
  function parse(text) {
    text = String(text || '');
    if (!/<kml[\s>]/i.test(text)) throw new Error('This is not a KML file.');
    const name = unXml((/<Document>\s*<name>([\s\S]*?)<\/name>/i.exec(text) || [])[1] || '');
    // the placemarks with the top folder they are in
    const labels = [], ticks = [], all2 = [], lines = [], stack = [];
    const re = /<Folder>|<\/Folder>|<name>([\s\S]*?)<\/name>|<Placemark>([\s\S]*?)<\/Placemark>/g;
    let m, waitName = false;
    while ((m = re.exec(text))) {
      const t = m[0];
      if (t === '<Folder>') { stack.push(''); waitName = true; continue; }
      if (t === '</Folder>') { stack.pop(); waitName = false; continue; }
      if (m[1] !== undefined) { if (waitName && stack.length) { stack[stack.length - 1] = unXml(m[1]); waitName = false; } continue; }
      waitName = false;
      const body = m[2] || '', top = stack[0] || '';
      const nm = unXml((/<name>([\s\S]*?)<\/name>/.exec(body) || [])[1] || '');
      const pt = /<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/.exec(body);
      if (pt) { const c = coords(pt[1])[0], k = CH.exec(nm); if (c && k) labels.push({ ch: Number(k[1]) * 1000 + Number(k[2]), p: c }); continue; }
      const ln = /<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/.exec(body);
      if (ln) {
        const c = coords(ln[1]);
        if (c.length === 2) { const mid = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2]; (/MAJR/i.test(top) ? ticks : all2).push(mid); }
        else if (c.length > 2) lines.push({ top: top, c: c });
      }
    }
    if (labels.length < 2) throw new Error('This KML has no chainage labels (8+000, 8+020 …) – export it with the chainages.');
    /* THE CENTRE LINE (the alignment – a folder named …ALIGN… / …CNTR…, else the longest line): the drawing has a major tick on
     * it for every station and more ticks beside it (other edges); a label takes the tick on the centre line next to it */
    const centre = (lines.filter(l => /ALIGN|CNTR|CENTRE|CENTER/i.test(l.top)).sort((a, b) => b.c.length - a.c.length)[0] || lines.sort((a, b) => b.c.length - a.c.length)[0] || { c: [] }).c;
    // a point's distance from the centre line and how far along it its foot is (metres)
    const cum = [0]; for (let q = 1; q < centre.length; q++) cum.push(cum[q - 1] + metres(centre[q - 1], centre[q]));
    const toLine = p => {
      if (centre.length < 2) return { d: 0, at: 0 };
      const k = Math.PI / 180, cx = Math.cos(p[1] * k) * 6371000 * k, cy = 6371000 * k;
      let best = Infinity, at = 0;
      for (let q = 1; q < centre.length; q++) {
        const ax = (centre[q - 1][0] - p[0]) * cx, ay = (centre[q - 1][1] - p[1]) * cy, bx = (centre[q][0] - p[0]) * cx, by = (centre[q][1] - p[1]) * cy;
        const dx = bx - ax, dy = by - ay; let u = -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1); u = Math.max(0, Math.min(1, u));
        const x = ax + u * dx, y = ay + u * dy, d = x * x + y * y; if (d < best) { best = d; at = cum[q - 1] + u * (cum[q] - cum[q - 1]); }
      }
      return { d: Math.sqrt(best), at: at };
    };
    labels.sort((x, y) => x.ch - y.ch);
    const fix = x => [Math.round(x[0] * 1000) / 1000, Math.round(x[1] * 1e7) / 1e7, Math.round(x[2] * 1e7) / 1e7];
    let out = null, onTick = 0;
    /* the usual drawing (Civil 3D): the major ticks come set by set in station order – one set on the centre line, others on the
     * edges – each with one tick for every label. The set nearest the centre line is paired with the labels in order (a label
     * written a little ahead of its tick still gets its own); kept only when nearly every label is close to its tick. */
    const n = labels.length;
    if (ticks.length >= n && ticks.length % n === 0) {
      let bestSet = -1, bestD = Infinity;
      for (let k = 0; k < ticks.length / n; k++) {
        let sum = 0, cnt = 0; for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 60))) { sum += toLine(ticks[k * n + i]).d; cnt++; }
        if (sum / cnt < bestD) { bestD = sum / cnt; bestSet = k; }
      }
      const set = ticks.slice(bestSet * n, bestSet * n + n);
      const fwd = metres(labels[0].p, set[0]) + metres(labels[n - 1].p, set[n - 1]) <= metres(labels[0].p, set[n - 1]) + metres(labels[n - 1].p, set[0]);
      const T = fwd ? set : set.slice().reverse();
      const close = labels.filter((l, i) => metres(l.p, T[i]) <= 80).length;
      if (close >= n * 0.95) { out = labels.map((l, i) => [l.ch, T[i][0], T[i][1]]); onTick = n; }
    }
    // otherwise: each label takes the nearest tick (within 60 m) – the one nearest to the centre line – or its own point
    if (!out) {
      const pool = ticks, G = {}, cell = 0.001, seen = {};
      const key = (x, y) => Math.floor(x / cell) + ':' + Math.floor(y / cell);
      pool.forEach((p, i) => { (G[key(p[0], p[1])] = G[key(p[0], p[1])] || []).push(i); });
      out = labels.map(l => {
        const near = [], cx = Math.floor(l.p[0] / cell), cy = Math.floor(l.p[1] / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) (G[(cx + dx) + ':' + (cy + dy)] || []).forEach(i => { const d = metres(l.p, pool[i]); if (d <= 60) near.push({ i: i, d: d }); });
        if (!near.length) return [l.ch, l.p[0], l.p[1]];
        near.forEach(n => { if (seen[n.i] === undefined) seen[n.i] = toLine(pool[n.i]).d; n.c = seen[n.i]; });
        const low = Math.min(...near.map(n => n.c)), pick = near.filter(n => n.c <= low + 1).sort((x, y) => x.d - y.d)[0];
        onTick++; return [l.ch, pool[pick.i][0], pool[pick.i][1]];
      });
    }
    out = out.filter((x, i, arr) => i === 0 || x[0] > arr[i - 1][0] + 0.0001).map(fix);
    // the length along the line (to check the chainages against the drawing)
    let along = 0; for (let i = 1; i < out.length; i++) along += metres([out[i - 1][1], out[i - 1][2]], [out[i][1], out[i][2]]);
    return { name: name, stations: out, from: out[0][0], to: out[out.length - 1][0], labels: labels.length, onTick: onTick, along: Math.round(along) };
  }
  const api = { parse: parse, metres: metres };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RclKml = api;
})(typeof window !== 'undefined' ? window : this);
