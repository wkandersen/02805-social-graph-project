"use strict";

const TYPES = ["foe", "ally", "family", "romance"];
const ALL_LABELS = [...TYPES, "mixed", "none", "unfound"];
const TYPE_COLOR = {
  foe: "#e8384f",
  ally: "#17a57a",
  family: "#f29f05",
  romance: "#c13ad6",
  mixed: "#5a6ee0",
  none: "#9c93a6",
  unfound: "#6b5d78",
};
const COMM_COLOR = ["#8fb8ff", "#ffcf7a", "#8fe3bf", "#f59fc4", "#c1adff", "#f2e27a", "#86dcef", "#ffae94", "#b6d884"];
const NULL_PERMS = 1000;
const JUDGE_KEY = "gn-week5-judge-v1";

const $ = (sel) => document.querySelector(sel);
const fmt = (x, d = 0) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (x, d = 1) => `${fmt(100 * x, d)}%`;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let D;
const state = {
  lex: {},
  mode: "lemma",
  window: null,
  labels: [],
  stats: null,
  edgeMode: "plain",
  solo: null,
  showCommLabels: false,
  selNode: null,
  selEdge: null,
  tapeDir: "out",
  foughtSort: "count",
  wordHits: {},
};

// ------------------------------------------------------------------ labelling
// Mirrors label_edge() in analyse_week5.py exactly.

function tokenKey(sent, i) {
  if (state.mode === "lemma") return sent.l[i] || sent.w[i].toLowerCase();
  return sent.w[i].toLowerCase();
}

function distanceToSpans(i, spans) {
  let best = Infinity;
  for (const [a, b] of spans) {
    const d = i >= a && i <= b ? 0 : i < a ? a - i : i - b;
    if (d < best) best = d;
  }
  return best;
}

function labelEdge(edge, countHits) {
  if (!edge.ev.length) return "unfound";
  const votes = { foe: 0, ally: 0, family: 0, romance: 0 };
  for (const [sid, spans] of edge.ev) {
    const sent = D.sentences[sid];
    const hit = new Set();
    for (let i = 0; i < sent.w.length; i++) {
      if (sent.k[i]) continue;
      if (state.window !== null && distanceToSpans(i, spans) > state.window) continue;
      const key = tokenKey(sent, i);
      for (const t of TYPES) {
        if (state.lex[t].has(key)) {
          hit.add(t);
          if (countHits) state.wordHits[`${t}|${key}`] = (state.wordHits[`${t}|${key}`] || 0) + 1;
        }
      }
    }
    for (const t of hit) votes[t] += 1;
  }
  const top = Math.max(...TYPES.map((t) => votes[t]));
  if (top === 0) return "none";
  const winners = TYPES.filter((t) => votes[t] === top);
  return winners.length === 1 ? winners[0] : "mixed";
}

function relabel() {
  state.wordHits = {};
  state.labels = D.edges.map((e) => labelEdge(e, true));
  state.stats = withinStats(state.labels);
}

// ------------------------------------------------------------------ statistics

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withinStats(labels) {
  const idx = [];
  const same = [];
  D.edges.forEach((e, i) => {
    if (labels[i] === "unfound") return;
    idx.push(i);
    same.push(D.nodes[e.s].c === D.nodes[e.t].c && D.nodes[e.s].c >= 0 ? 1 : 0);
  });
  const labs = idx.map((i) => labels[i]);
  const observed = {};
  for (const t of TYPES) {
    let n = 0;
    let w = 0;
    labs.forEach((l, j) => {
      if (l === t) {
        n += 1;
        w += same[j];
      }
    });
    observed[t] = { n, within: w, share: n ? w / n : NaN };
  }
  const draws = Object.fromEntries(TYPES.map((t) => [t, []]));
  const rand = mulberry32(5);
  const shuffled = labs.slice();
  for (let p = 0; p < NULL_PERMS; p++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const n = { foe: 0, ally: 0, family: 0, romance: 0 };
    const w = { foe: 0, ally: 0, family: 0, romance: 0 };
    for (let j = 0; j < shuffled.length; j++) {
      const l = shuffled[j];
      if (l in n) {
        n[l] += 1;
        w[l] += same[j];
      }
    }
    for (const t of TYPES) if (n[t]) draws[t].push(w[t] / n[t]);
  }
  const out = {};
  for (const t of TYPES) {
    const d = draws[t].sort((a, b) => a - b);
    const mean = d.reduce((a, b) => a + b, 0) / (d.length || 1);
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / (d.length || 1));
    out[t] = {
      ...observed[t],
      mean,
      sd,
      lo: d[Math.floor(0.025 * d.length)] ?? NaN,
      hi: d[Math.floor(0.975 * d.length)] ?? NaN,
      z: sd ? (observed[t].share - mean) / sd : 0,
    };
  }
  const overall = same.reduce((a, b) => a + b, 0) / same.length;
  return { types: out, overall, found: idx.length };
}

function kappa(pairs) {
  const n = pairs.length;
  if (!n) return NaN;
  const agree = pairs.filter(([a, b]) => a === b).length / n;
  const left = {};
  const right = {};
  for (const [a, b] of pairs) {
    left[a] = (left[a] || 0) + 1;
    right[b] = (right[b] || 0) + 1;
  }
  let chance = 0;
  for (const k of new Set([...Object.keys(left), ...Object.keys(right)])) chance += ((left[k] || 0) * (right[k] || 0)) / n / n;
  return chance < 1 ? (agree - chance) / (1 - chance) : NaN;
}

// ------------------------------------------------------------------ sentences

function renderTokens(sent, spans, { highlight = true, from = 0, to = sent.w.length } = {}) {
  let html = "";
  for (let i = from; i < to; i++) {
    const w = esc(sent.w[i]);
    const inSpan = spans.some(([a, b]) => i >= a && i <= b);
    let piece = w;
    if (inSpan) piece = `<span class="who">${w}</span>`;
    else if (sent.k[i]) piece = `<span class="nm">${w}</span>`;
    else if (highlight) {
      const key = tokenKey(sent, i);
      const t = TYPES.find((type) => state.lex[type].has(key));
      if (t) {
        const far = state.window !== null && distanceToSpans(i, spans) > state.window;
        piece = `<span class="hit ${t}${far ? " far" : ""}" title="${t}${far ? " · outside window" : ""}">${w}</span>`;
      }
    }
    html += piece;
    if (sent.ws[i] && i < to - 1) {
      const nextIn = spans.some(([a, b]) => i + 1 >= a && i + 1 <= b) && inSpan;
      html += nextIn ? `<span class="who"> </span>` : " ";
    }
  }
  return html;
}

function cropped(sent, spans, radius = 14) {
  const a = Math.max(0, spans[0][0] - radius);
  const b = Math.min(sent.w.length, spans[0][1] + radius + 1);
  return `${a > 0 ? "… " : ""}${renderTokens(sent, spans, { from: a, to: b })}${b < sent.w.length ? " …" : ""}`;
}

function chip(label) {
  return `<span class="type-chip" style="background:${TYPE_COLOR[label]}">${label}</span>`;
}

// ------------------------------------------------------------------ tape

function edgeIndex(s, t) {
  return D.edgeLookup.get(`${s}>${t}`);
}

function showNode(ni) {
  state.selNode = ni;
  state.selEdge = null;
  renderTape();
  drawMap();
}

function showEdge(ei) {
  state.selEdge = ei;
  state.selNode = null;
  renderTape();
  drawMap();
}

function clearSelection() {
  state.selNode = null;
  state.selEdge = null;
  renderTape();
  drawMap();
}

function renderTape() {
  const body = $("#tape-body");
  const title = $("#tape-title");
  $("#tape-clear").hidden = state.selNode === null && state.selEdge === null;
  $(".stage").classList.toggle("tape-open", !$("#tape-clear").hidden);

  if (state.selEdge !== null) {
    const e = D.edges[state.selEdge];
    const A = D.nodes[e.s];
    const B = D.nodes[e.t];
    const lab = state.labels[state.selEdge];
    title.innerHTML = `${esc(A.name)} → ${esc(B.name)} ${chip(lab)}`;
    const back = edgeIndex(e.t, e.s);
    let html = `<div class="kwic"><div class="kwic-tag"><button data-node="${e.s}">${esc(A.name)}'s page</button><span class="score-sub">${e.ev.length} sentence${e.ev.length === 1 ? "" : "s"} · weight ${e.w}</span></div><div>`;
    if (!e.ev.length) html += `<p class="kwic-line">No sentence on this page names ${esc(B.name)} with an alias we could use. The link probably sits in a list, caption or piped name.</p>`;
    for (const [sid, spans] of e.ev) html += `<p class="kwic-line">${renderTokens(D.sentences[sid], spans)}</p>`;
    html += `</div></div>`;
    if (back !== undefined) {
      html += `<div class="kwic"><div class="kwic-tag"><button data-edge="${back}">${esc(B.name)} says</button>${chip(state.labels[back])}</div><div><p class="kwic-line">The link back exists. Click to read ${esc(B.name)}'s side.</p></div></div>`;
    }
    body.innerHTML = html;
    return;
  }

  if (state.selNode !== null) {
    const n = D.nodes[state.selNode];
    const list = state.tapeDir === "out" ? D.out[state.selNode] : D.in[state.selNode];
    const counts = {};
    list.forEach((ei) => (counts[state.labels[ei]] = (counts[state.labels[ei]] || 0) + 1));
    title.innerHTML = `${esc(n.name)} <span class="seg seg-small" style="margin:0 0 0 8px;color:var(--butter)"><button type="button" data-dir="out" class="${state.tapeDir === "out" ? "on" : ""}">says about others · ${D.out[state.selNode].length}</button><button type="button" data-dir="in" class="${state.tapeDir === "in" ? "on" : ""}">others say · ${D.in[state.selNode].length}</button></span>`;
    const sorted = list.slice().sort((a, b) => ALL_LABELS.indexOf(state.labels[a]) - ALL_LABELS.indexOf(state.labels[b]));
    let html = `<p class="score-sub" style="margin:6px 0">${ALL_LABELS.filter((l) => counts[l]).map((l) => `${l} ${counts[l]}`).join(" · ") || "no links"}</p>`;
    for (const ei of sorted) {
      const e = D.edges[ei];
      const other = state.tapeDir === "out" ? D.nodes[e.t] : D.nodes[e.s];
      const first = e.ev[0];
      html += `<div class="kwic"><div class="kwic-tag"><button data-edge="${ei}">${esc(other.name)}</button>${chip(state.labels[ei])}</div><div>`;
      html += first ? `<p class="kwic-line">${cropped(D.sentences[first[0]], first[1])}</p>` : `<p class="kwic-line" style="opacity:.6">not named in the prose</p>`;
      if (e.ev.length > 1) html += `<button class="kwic-more" data-edge="${ei}">+${e.ev.length - 1} more sentence${e.ev.length > 2 ? "s" : ""}</button>`;
      html += `</div></div>`;
    }
    body.innerHTML = html;
    return;
  }

  title.textContent = "click a character on the map";
  body.innerHTML = `<p class="tape-empty">Every link from A to B carries the sentences on A's page that name B. Pick a character to read them. Relationship words are highlighted in their type's colour, the linked character is underlined, and other names are dimmed and never count.</p>`;
}

document.addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-edge],[data-node],[data-dir],[data-focus]");
  if (!t) return;
  if (t.dataset.edge !== undefined) showEdge(+t.dataset.edge);
  else if (t.dataset.node !== undefined) showNode(+t.dataset.node);
  else if (t.dataset.dir) {
    state.tapeDir = t.dataset.dir;
    renderTape();
    drawMap();
  } else if (t.dataset.focus) {
    const ni = D.nodeIndex.get(t.dataset.focus);
    if (ni !== undefined) showNode(ni);
  }
});

// ------------------------------------------------------------------ map

const map = { canvas: null, ctx: null, w: 0, h: 0, px: [], hover: null };

function setupMap() {
  map.canvas = $("#map");
  map.ctx = map.canvas.getContext("2d");
  const resize = () => {
    const r = map.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    map.w = r.width;
    map.h = r.height;
    map.canvas.width = Math.round(r.width * dpr);
    map.canvas.height = Math.round(r.height * dpr);
    map.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = 44;
    const xs = D.nodes.map((n) => n.x);
    const ys = D.nodes.map((n) => n.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s = Math.min((map.w - 2 * pad) / (x1 - x0 || 1), (map.h - 2 * pad - 24) / (y1 - y0 || 1));
    const ox = (map.w - s * (x1 - x0)) / 2;
    const oy = (map.h - 24 - s * (y1 - y0)) / 2 + 10;
    map.px = D.nodes.map((n) => [ox + s * (n.x - x0), oy + s * (n.y - y0)]);
    drawMap();
  };
  new ResizeObserver(resize).observe(map.canvas);

  map.canvas.addEventListener("mousemove", (ev) => {
    const r = map.canvas.getBoundingClientRect();
    const hit = nearest(ev.clientX - r.left, ev.clientY - r.top);
    const tip = $("#map-hover");
    if (hit !== map.hover) {
      map.hover = hit;
      drawMap();
    }
    if (hit === null) {
      tip.hidden = true;
      return;
    }
    const n = D.nodes[hit];
    const foes = D.in[hit].filter((ei) => state.labels[ei] === "foe").length;
    tip.hidden = false;
    tip.style.left = `${map.px[hit][0]}px`;
    tip.style.top = `${map.px[hit][1] - 6}px`;
    tip.innerHTML = `<b>${esc(n.name)}</b><br>in ${n.kin} · out ${n.kout} · ${fmt(n.chars)} chars<br>${foes} foe link${foes === 1 ? "" : "s"} in · ${n.c >= 0 ? `community ${n.c + 1}` : "isolate"}`;
  });
  map.canvas.addEventListener("mouseleave", () => {
    map.hover = null;
    $("#map-hover").hidden = true;
    drawMap();
  });
  map.canvas.addEventListener("click", (ev) => {
    const r = map.canvas.getBoundingClientRect();
    const hit = nearest(ev.clientX - r.left, ev.clientY - r.top);
    if (hit === null) clearSelection();
    else showNode(hit);
  });
}

function nodeRadius(n) {
  return 1.3 + Math.sqrt(n.kin) * 0.5;
}

function nearest(x, y) {
  let best = null;
  let bd = 144;
  map.px.forEach(([px, py], i) => {
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

function edgeStyle(ei) {
  const lab = state.labels[ei];
  const e = D.edges[ei];
  const sel = state.selNode;
  if (state.selEdge !== null) {
    const f = D.edges[state.selEdge];
    const on = ei === state.selEdge || (e.s === f.t && e.t === f.s);
    return on ? [TYPE_COLOR[lab], 1, 3] : ["#fbf5dc", 0.03, 0.6];
  }
  if (sel !== null) {
    const isOut = e.s === sel;
    const isIn = e.t === sel;
    const focus = state.tapeDir === "out" ? isOut : isIn;
    if (focus) return [TYPE_COLOR[lab], 0.95, 1.8];
    if (isOut || isIn) return [TYPE_COLOR[lab], 0.25, 0.8, true];
    return ["#fbf5dc", 0.025, 0.6];
  }
  if (state.edgeMode === "plain") return ["#fbf5dc", 0.1, 0.6];
  if (state.edgeMode === "coverage") return lab === "unfound" ? ["#ff5a6e", 0.9, 1.3] : ["#fbf5dc", 0.13, 0.6];
  if (state.edgeMode === "recip" && edgeIndex(e.t, e.s) === undefined) return ["#fbf5dc", 0.02, 0.5];
  if (state.solo) return lab === state.solo ? [TYPE_COLOR[lab], 0.85, 1.3] : ["#fbf5dc", 0.035, 0.5];
  if (lab === "none" || lab === "unfound") return ["#fbf5dc", 0.06, 0.5];
  return [TYPE_COLOR[lab], 0.42, 0.8];
}

function drawMap() {
  if (!map.ctx || !map.px.length) return;
  const ctx = map.ctx;
  ctx.clearRect(0, 0, map.w, map.h);

  // community halos
  D.nodes.forEach((n, i) => {
    if (n.c < 0) return;
    const [x, y] = map.px[i];
    const g = ctx.createRadialGradient(x, y, 0, x, y, 26);
    g.addColorStop(0, `${COMM_COLOR[n.c % COMM_COLOR.length]}${state.showCommLabels ? "1c" : "0e"}`);
    g.addColorStop(1, `${COMM_COLOR[n.c % COMM_COLOR.length]}00`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fill();
  });

  // edges: faint first, strong last
  const order = D.edges.map((_, i) => [i, edgeStyle(i)]).sort((a, b) => a[1][1] - b[1][1]);
  for (const [ei, [color, alpha, width, dashed]] of order) {
    const e = D.edges[ei];
    const [x1, y1] = map.px[e.s];
    const [x2, y2] = map.px[e.t];
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dashed ? [3, 3] : []);
    ctx.beginPath();
    const mx = (x1 + x2) / 2 + (y2 - y1) * 0.08;
    const my = (y1 + y2) / 2 - (x2 - x1) * 0.08;
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(mx, my, x2, y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // nodes
  const related = new Set();
  if (state.selNode !== null) {
    related.add(state.selNode);
    D.out[state.selNode].forEach((ei) => related.add(D.edges[ei].t));
    D.in[state.selNode].forEach((ei) => related.add(D.edges[ei].s));
  }
  if (state.selEdge !== null) {
    related.add(D.edges[state.selEdge].s);
    related.add(D.edges[state.selEdge].t);
  }
  D.nodes.forEach((n, i) => {
    const [x, y] = map.px[i];
    const dim = related.size && !related.has(i);
    ctx.globalAlpha = dim ? 0.25 : 1;
    ctx.fillStyle = n.c >= 0 ? COMM_COLOR[n.c % COMM_COLOR.length] : "#6b5d78";
    ctx.beginPath();
    ctx.arc(x, y, nodeRadius(n), 0, Math.PI * 2);
    ctx.fill();
    if (i === state.selNode || i === map.hover) {
      ctx.strokeStyle = "#fbf5dc";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
  ctx.globalAlpha = 1;

  // labels
  ctx.font = "600 11px 'Bricolage Grotesque', sans-serif";
  ctx.textAlign = "center";
  const label = (i, strong) => {
    const [x, y] = map.px[i];
    const name = D.nodes[i].name;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(27,18,36,.9)";
    ctx.fillStyle = strong ? "#fbf5dc" : "rgba(251,245,220,.7)";
    ctx.strokeText(name, x, y - nodeRadius(D.nodes[i]) - 4);
    ctx.fillText(name, x, y - nodeRadius(D.nodes[i]) - 4);
  };
  if (related.size) related.forEach((i) => (D.nodes[i].kin >= 25 || i === state.selNode || state.selEdge !== null) && label(i, i === state.selNode));
  else D.nodes.forEach((n, i) => n.kin >= 45 && label(i, false));

  if (state.showCommLabels && !related.size) {
    ctx.font = "800 13px 'Bricolage Grotesque', sans-serif";
    D.communities.forEach((c) => {
      const members = D.nodes.map((n, i) => [n, i]).filter(([n]) => n.c === c.id);
      const cx = members.reduce((a, [, i]) => a + map.px[i][0], 0) / members.length;
      const cy = members.reduce((a, [, i]) => a + map.px[i][1], 0) / members.length;
      ctx.fillStyle = COMM_COLOR[c.id % COMM_COLOR.length];
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(27,18,36,.85)";
      ctx.strokeText(`${c.id + 1}`, cx, cy + 22);
      ctx.fillText(`${c.id + 1}`, cx, cy + 22);
    });
  }
}

function renderKeys() {
  const counts = {};
  state.labels.forEach((l) => (counts[l] = (counts[l] || 0) + 1));
  $("#map-keys").innerHTML = [...TYPES, "mixed", "none"]
    .map(
      (t) =>
        `<button type="button" class="key${state.solo === t ? " solo" : ""}${state.solo && state.solo !== t ? " off" : ""}" data-solo="${t}"><i style="background:${TYPE_COLOR[t]}"></i>${t}<em>${fmt(counts[t] || 0)}</em></button>`,
    )
    .join("");
}

$("#map-keys")?.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-solo]");
  if (!b) return;
  state.solo = state.solo === b.dataset.solo ? null : b.dataset.solo;
  if (state.edgeMode !== "typed" && state.edgeMode !== "recip") state.edgeMode = "typed";
  renderKeys();
  drawMap();
});

// ------------------------------------------------------------------ beats

const BEATS = {
  intro: { edgeMode: "plain", solo: null, comm: false, caption: "303 pages · 1,784 links · positions are decoration" },
  represent: { edgeMode: "plain", solo: null, comm: true, caption: "halos = 9 Louvain communities (seed 5, Q = 0.395)" },
  coverage: { edgeMode: "coverage", solo: null, comm: false, caption: "red = links whose target is never named in the prose" },
  lexicon: { edgeMode: "typed", solo: null, comm: false, caption: "each link coloured by the type its sentences vote for" },
  question: { edgeMode: "typed", solo: "foe", comm: true, caption: "foe links only · do they jump between halos?" },
  window: { edgeMode: "typed", solo: "foe", comm: true, caption: "foe links under your current settings" },
  recip: { edgeMode: "recip", solo: null, comm: false, caption: "only pairs that link both ways · 350 pairs" },
  fought: { edgeMode: "typed", solo: "foe", comm: false, caption: "foe links · click a hub, then “others say”" },
  check: { edgeMode: "typed", solo: null, comm: false, caption: "every typed link · read one before you trust it" },
  close: { edgeMode: "typed", solo: "family", comm: true, caption: "family links · the signal that survived every setting" },
};

function setBeat(name) {
  const b = BEATS[name];
  if (!b) return;
  state.edgeMode = b.edgeMode;
  state.solo = b.solo;
  state.showCommLabels = b.comm;
  $("#stage-caption").textContent = b.caption;
  document.querySelectorAll(".beat").forEach((el) => el.classList.toggle("is-live", el.dataset.beat === name));
  renderKeys();
  drawMap();
}

function setupBeats() {
  const io = new IntersectionObserver(
    (entries) => entries.forEach((en) => en.isIntersecting && setBeat(en.target.dataset.beat)),
    { rootMargin: "-40% 0px -55% 0px" },
  );
  document.querySelectorAll(".beat").forEach((el) => io.observe(el));
}

// ------------------------------------------------------------------ lexicon editor

function renderLexicon() {
  const box = $("#lexbox");
  box.innerHTML = TYPES.map((t) => {
    const words = [...state.lex[t]];
    const pub = new Set(D.lexicon[t]);
    return `<div class="lex" style="--lex-c:${TYPE_COLOR[t]}">
      <div class="lex-head"><b>${t}</b><span>${words.length} words · click to drop</span></div>
      <div class="lex-words">${words
        .map((w) => `<button type="button" class="word${pub.has(w) ? "" : " added"}" data-type="${t}" data-word="${esc(w)}">${esc(w)}<sup>${state.wordHits[`${t}|${w}`] || 0}</sup></button>`)
        .join("")}<input class="lex-add" data-type="${t}" placeholder="+ add word" /></div>
    </div>`;
  }).join("");
  const size = TYPES.reduce((a, t) => a + state.lex[t].size, 0);
  document.querySelectorAll('[data-k="lexsize"]').forEach((el) => (el.textContent = size));
}

function setupLexicon() {
  const box = $("#lexbox");
  box.addEventListener("click", (ev) => {
    const b = ev.target.closest(".word");
    if (!b) return;
    state.lex[b.dataset.type].delete(b.dataset.word);
    update();
  });
  box.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || !ev.target.classList.contains("lex-add")) return;
    const word = ev.target.value.trim().toLowerCase();
    if (word) {
      state.lex[ev.target.dataset.type].add(word);
      update();
      box.querySelector(`.lex-add[data-type="${ev.target.dataset.type}"]`)?.focus();
    }
  });
  $("#mode-seg").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    state.mode = b.dataset.mode;
    $("#mode-seg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    update();
  });
  $("#window-seg").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    state.window = b.dataset.window === "" ? null : +b.dataset.window;
    $("#window-seg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    update();
  });
  $("#reset-lex").addEventListener("click", () => {
    resetLexicon();
    $("#mode-seg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.mode === "lemma"));
    $("#window-seg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.window === ""));
    update();
  });
}

function resetLexicon() {
  state.lex = Object.fromEntries(TYPES.map((t) => [t, new Set(D.lexicon[t])]));
  state.mode = "lemma";
  state.window = null;
}

function isPublished() {
  return (
    state.mode === "lemma" &&
    state.window === null &&
    TYPES.every((t) => state.lex[t].size === D.lexicon[t].length && D.lexicon[t].every((w) => state.lex[t].has(w)))
  );
}

function renderLabelStrip() {
  const counts = {};
  state.labels.forEach((l) => (counts[l] = (counts[l] || 0) + 1));
  $("#label-strip").innerHTML = ALL_LABELS.map(
    (l) => `<div style="flex-grow:${counts[l] || 0.0001};background:${TYPE_COLOR[l]}" title="${l}: ${counts[l] || 0}">${l}<small>${fmt(counts[l] || 0)}</small></div>`,
  ).join("");
  const parity = $("#parity");
  const published = D.label_counts;
  if (isPublished()) {
    const same = ALL_LABELS.every((l) => (counts[l] || 0) === (published[l] || 0));
    const moved = state.labels.filter((l, i) => l !== D.edges[i].lab).length;
    parity.className = `parity ${same && moved === 0 ? "ok" : "bad"}`;
    parity.textContent = same && moved === 0
      ? `browser labels match analyse_week5.py link for link (${fmt(state.labels.length)} links, 0 differences)`
      : `mismatch with analyse_week5.py: ${moved} links differ`;
  } else {
    const moved = state.labels.filter((l, i) => l !== D.edges[i].lab).length;
    parity.className = "parity changed";
    parity.textContent = `your settings: ${fmt(moved)} links changed type compared with the published run`;
  }
}

// ------------------------------------------------------------------ figures

const NS = "http://www.w3.org/2000/svg";
function svg(w, h, inner) {
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="${NS}" role="img">${inner}</svg>`;
}

function renderWithin() {
  const S = state.stats;
  const W = 640;
  const rowH = 58;
  const top = 26;
  const H = top + rowH * TYPES.length + 30;
  const x0 = 150;
  const x1 = W - 70;
  const lo = 0.3;
  const hi = 0.85;
  const X = (v) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);
  let g = "";
  for (let v = 0.3; v <= 0.851; v += 0.1) {
    g += `<line x1="${X(v)}" x2="${X(v)}" y1="${top - 8}" y2="${H - 26}" stroke="#2a2030" stroke-opacity=".08"/>`;
    g += `<text x="${X(v)}" y="${H - 10}" text-anchor="middle">${Math.round(v * 100)}%</text>`;
  }
  g += `<line x1="${X(S.overall)}" x2="${X(S.overall)}" y1="${top - 14}" y2="${H - 26}" stroke="#2a2030" stroke-dasharray="3 3"/>`;
  g += `<text x="${X(S.overall)}" y="${top - 16}" text-anchor="middle">all read links ${pct(S.overall)}</text>`;
  TYPES.forEach((t, i) => {
    const r = S.types[t];
    const y = top + rowH * i + rowH / 2;
    g += `<text class="lbl" x="0" y="${y - 2}" style="fill:${TYPE_COLOR[t]}">${t}</text>`;
    g += `<text x="0" y="${y + 13}">n = ${fmt(r.n)} links</text>`;
    if (!r.n) return;
    g += `<rect x="${X(r.lo)}" y="${y - 9}" width="${Math.max(1, X(r.hi) - X(r.lo))}" height="18" rx="9" fill="#2a2030" fill-opacity=".1"/>`;
    g += `<line x1="${X(r.mean)}" x2="${X(r.mean)}" y1="${y - 9}" y2="${y + 9}" stroke="#2a2030" stroke-opacity=".45"/>`;
    g += `<line x1="${X(r.mean)}" x2="${X(r.share)}" y1="${y}" y2="${y}" stroke="${TYPE_COLOR[t]}" stroke-width="2"/>`;
    g += `<circle cx="${X(r.share)}" cy="${y}" r="8" fill="${TYPE_COLOR[t]}" stroke="#fff" stroke-width="2"/>`;
    g += `<text class="val" x="${x1 + 10}" y="${y - 2}">${pct(r.share)}</text>`;
    g += `<text x="${x1 + 10}" y="${y + 12}">z ${r.z >= 0 ? "+" : "−"}${fmt(Math.abs(r.z), 2)}</text>`;
  });
  $("#fig-within").innerHTML = svg(W, H, g);
  $("#within-caption").innerHTML = `Share of each type's links that stay inside one Louvain community (dot) against ${fmt(NULL_PERMS)} label shuffles (grey band = middle 95%, tick = mean). ${isPublished() ? "Published settings." : "<b>Your edited settings.</b>"} Left of the band = crosses borders more than chance, right = stays home.`;

  $("#verdict").innerHTML = TYPES.map((t) => {
    const r = S.types[t];
    const word = !r.n ? "no links" : r.z <= -2 ? "crosses borders" : r.z >= 2 ? "stays home" : "no clear signal";
    return `<div style="background:${TYPE_COLOR[t]}"><span>${t}</span><b>z ${r.z >= 0 ? "+" : "−"}${fmt(Math.abs(r.z), 1)}</b><span>${word}</span></div>`;
  }).join("");
}

function renderSeedNote() {
  const s = D.per_seed;
  const foe = s.map((r) => r.foe);
  const ally = s.map((r) => r.ally);
  const fam = s.map((r) => r.family);
  const below = s.filter((r) => r.foe < r.ally).length;
  $("#seed-note").innerHTML = `Robustness to the partition: across all 20 Louvain seeds (Q ${fmt(Math.min(...s.map((r) => r.q)), 3)}–${fmt(Math.max(...s.map((r) => r.q)), 3)}), the foe within-share ranged ${pct(Math.min(...foe))}–${pct(Math.max(...foe))}, ally ${pct(Math.min(...ally))}–${pct(Math.max(...ally))} and family ${pct(Math.min(...fam))}–${pct(Math.max(...fam))}. Foes sat below allies in ${below} of 20 partitions. The ordering is stable, so the fragility comes from the text side, not the communities.`;
}

function renderWindowFig() {
  const W = 640;
  const H = 280;
  const pad = { l: 44, r: 90, t: 16, b: 34 };
  const windows = [null, 10, 5, 3];
  const X = (i) => pad.l + (i / (windows.length - 1)) * (W - pad.l - pad.r);
  const zmin = -3;
  const zmax = 5;
  const Y = (z) => pad.t + ((zmax - z) / (zmax - zmin)) * (H - pad.t - pad.b);
  let g = `<rect x="${pad.l}" y="${Y(2)}" width="${W - pad.l - pad.r}" height="${Y(-2) - Y(2)}" fill="#2a2030" fill-opacity=".06"/>`;
  for (let z = zmin; z <= zmax; z++) {
    g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(z)}" y2="${Y(z)}" stroke="#2a2030" stroke-opacity="${z === 0 ? 0.35 : 0.06}"/>`;
    g += `<text x="${pad.l - 8}" y="${Y(z) + 3}" text-anchor="end">${z > 0 ? "+" : ""}${z}</text>`;
  }
  windows.forEach((w, i) => (g += `<text x="${X(i)}" y="${H - 12}" text-anchor="middle">${w === null ? "whole sentence" : `±${w} tokens`}</text>`));
  for (const mode of ["lemma", "surface"]) {
    for (const t of TYPES) {
      const pts = windows.map((w, i) => {
        const v = D.variants.find((r) => r.mode === mode && r.window === w);
        return [X(i), Y(v.result[t].z)];
      });
      g += `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${TYPE_COLOR[t]}" stroke-width="${mode === "lemma" ? 2.5 : 1.5}" stroke-dasharray="${mode === "lemma" ? "" : "5 4"}"/>`;
      pts.forEach(([x, y]) => (g += `<circle cx="${x}" cy="${y}" r="${mode === "lemma" ? 3.5 : 2.5}" fill="${mode === "lemma" ? TYPE_COLOR[t] : "#fff"}" stroke="${TYPE_COLOR[t]}"/>`));
      if (mode === "lemma") g += `<text class="lbl" x="${W - pad.r + 10}" y="${pts[3][1] + 4}" style="fill:${TYPE_COLOR[t]}">${t}</text>`;
    }
  }
  g += `<text x="${pad.l + 6}" y="${Y(2) + 14}">|z| &lt; 2 · indistinguishable from shuffled labels</text>`;
  g += `<text x="${pad.l + 6}" y="${Y(4.6)}">stays home ↑</text><text x="${pad.l + 6}" y="${Y(-2.7)}">crosses borders ↓</text>`;
  $("#fig-window").innerHTML = svg(W, H, g);
}

function renderLoo() {
  const rows = D.leave_one_out.slice(0, 12);
  const W = 640;
  const rowH = 22;
  const H = rows.length * rowH + 34;
  const mid = 300;
  const scale = 5200;
  let g = `<line x1="${mid}" x2="${mid}" y1="4" y2="${H - 22}" stroke="#2a2030" stroke-opacity=".4"/>`;
  rows.forEach((r, i) => {
    const y = 8 + i * rowH;
    const w = r.delta * scale;
    g += `<text class="lbl" x="${mid - 12 - Math.max(0, -w)}" y="${y + 12}" text-anchor="end" style="font-size:12px;fill:${TYPE_COLOR[r.kind]}">−${r.word}</text>`;
    g += `<rect x="${Math.min(mid, mid + w)}" y="${y + 2}" width="${Math.abs(w)}" height="13" rx="3" fill="${TYPE_COLOR[r.kind]}"/>`;
    g += `<text x="${mid + Math.max(0, w) + 8}" y="${y + 12}">${r.delta > 0 ? "+" : "−"}${fmt(Math.abs(100 * r.delta), 1)} pp · ${r.moved} links retyped</text>`;
  });
  g += `<text x="${mid}" y="${H - 6}" text-anchor="middle">change in (foe − ally) within-community share, percentage points · published gap ${fmt(100 * (D.headline.foe.share - D.headline.ally.share), 1)} pp</text>`;
  $("#fig-loo").innerHTML = svg(W, H, g);
}

function renderRecip() {
  const M = D.reciprocal.matrix;
  const cell = 70;
  const off = 70;
  const W = off + cell * 4 + 10;
  const H = off + cell * 4 + 10;
  const max = Math.max(...TYPES.flatMap((a) => TYPES.map((b) => M[a][b])));
  let g = "";
  TYPES.forEach((a, i) => {
    g += `<text class="lbl" x="${off - 8}" y="${off + i * cell + cell / 2 + 4}" text-anchor="end" style="fill:${TYPE_COLOR[a]}">${a}</text>`;
    g += `<text class="lbl" x="${off + i * cell + cell / 2}" y="${off - 10}" text-anchor="middle" style="fill:${TYPE_COLOR[a]}">${a}</text>`;
    TYPES.forEach((b, j) => {
      if (j < i) return;
      const v = M[a][b];
      const diag = i === j;
      g += `<rect x="${off + j * cell + 2}" y="${off + i * cell + 2}" width="${cell - 4}" height="${cell - 4}" rx="10" fill="${diag ? TYPE_COLOR[a] : "#2a2030"}" fill-opacity="${0.08 + 0.8 * (v / max)}"/>`;
      g += `<text x="${off + j * cell + cell / 2}" y="${off + i * cell + cell / 2 + 6}" text-anchor="middle" style="font-size:16px;font-weight:600;fill:${v / max > 0.45 ? "#fff" : "#2a2030"}">${v}</text>`;
    });
  });
  g += `<text x="${off}" y="${H}" style="font-size:9px">one page says (row) · the other says (column)</text>`;
  $("#fig-recip").innerHTML = svg(W, H + 6, g);

  $("#frenemies").innerHTML = D.reciprocal.frenemies
    .slice(0, 18)
    .map((f) => {
      const a = D.nodeIndex.get(f.a);
      const b = D.nodeIndex.get(f.b);
      const ei = edgeIndex(a, b);
      return `<li><button type="button" data-edge="${ei}">${esc(D.nodes[a].name)} <span style="color:${TYPE_COLOR[f.a_says]}">${f.a_says}</span> / <span style="color:${TYPE_COLOR[f.b_says]}">${f.b_says}</span> ${esc(D.nodes[b].name)}</button></li>`;
    })
    .join("");
}

function renderFought() {
  const foeIn = D.nodes.map(() => 0);
  D.edges.forEach((e, i) => state.labels[i] === "foe" && (foeIn[e.t] += 1));
  let rows = D.nodes.map((n, i) => ({ i, n, c: foeIn[i], s: n.kin ? foeIn[i] / n.kin : 0 }));
  if (state.foughtSort === "count") rows.sort((a, b) => b.c - a.c || b.n.kin - a.n.kin);
  else rows = rows.filter((r) => r.n.kin >= 10).sort((a, b) => b.s - a.s || b.c - a.c);
  rows = rows.slice(0, 12);
  const max = Math.max(...rows.map((r) => (state.foughtSort === "count" ? r.c : r.s)), 1e-9);
  $("#fought").innerHTML = rows
    .map(
      (r) =>
        `<li><button type="button" data-fought="${r.i}">${esc(r.n.name)}</button><span class="bar"><i style="width:${(100 * (state.foughtSort === "count" ? r.c : r.s)) / max}%"></i></span><em>${r.c} / ${r.n.kin} · ${pct(r.s, 0)}</em></li>`,
    )
    .join("");
}

function setupFought() {
  $("#fought-seg").addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    state.foughtSort = b.dataset.sort;
    $("#fought-seg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    renderFought();
  });
  $("#fought").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-fought]");
    if (!b) return;
    state.tapeDir = "in";
    showNode(+b.dataset.fought);
  });
}

function renderWeights() {
  const by = {};
  D.edges.forEach((e, i) => {
    const l = state.labels[i];
    (by[l] = by[l] || []).push(e.w);
  });
  const rows = ALL_LABELS.filter((l) => by[l]).map((l) => [l, by[l].length, by[l].reduce((a, b) => a + b, 0) / by[l].length]);
  const max = Math.max(...rows.map((r) => r[2]));
  $("#wtable").innerHTML =
    `<thead><tr><th>type</th><th>links</th><th>mean weight</th><th></th></tr></thead><tbody>` +
    rows
      .map(
        ([l, n, m]) =>
          `<tr><td>${chip(l)}</td><td>${fmt(n)}</td><td>${fmt(m, 2)}</td><td><div class="wbar" style="width:${(100 * m) / max}%;background:${TYPE_COLOR[l]}"></div></td></tr>`,
      )
      .join("") +
    `</tbody>`;
}

// ------------------------------------------------------------------ human check

const judge = { answers: {}, reveal: null };

function loadJudge() {
  try {
    judge.answers = JSON.parse(localStorage.getItem(JUDGE_KEY) || "{}");
  } catch {
    judge.answers = {};
  }
}
function saveJudge() {
  localStorage.setItem(JUDGE_KEY, JSON.stringify(judge.answers));
}

function renderJudge() {
  const sample = D.check.sample;
  const el = $("#judge");
  const current = judge.reveal ?? sample.find((s) => !(s.e in judge.answers));
  if (!current) {
    el.innerHTML = `<div class="judge-done"><p class="judge-q">done</p><p class="judge-pair">All 60 labelled.</p><p>Export your labels and paste them into <code>data/week5_human_check.tsv</code> (column <code>human_label</code>), then rerun <code>analyse_week5.py</code>. The page will publish the human agreement next to the agent's.</p></div>`;
  } else {
    const e = D.edges[current.e];
    const A = D.nodes[e.s];
    const B = D.nodes[e.t];
    const pos = sample.indexOf(current) + 1;
    let html = `<p class="judge-q">sample ${pos} / ${sample.length} · what does ${esc(A.name)}'s page say about ${esc(B.name)}?</p>`;
    html += `<p class="judge-pair">${esc(A.name)} <span>→</span> ${esc(B.name)}</p><div class="judge-text">`;
    for (const [sid, spans] of e.ev) html += `<p>${renderTokens(D.sentences[sid], spans, { highlight: false })}</p>`;
    html += `</div>`;
    if (judge.reveal) {
      const mine = judge.answers[current.e];
      html += `<div class="judge-reveal">you: ${chip(mine)} · lexicon: ${chip(current.lex)} · agent: ${current.agent ? chip(current.agent) : "—"}${current.note ? `<br><span style="opacity:.7">agent's note: ${esc(current.note)}</span>` : ""}<br><button type="button" class="next" id="judge-next">next →</button></div>`;
    } else {
      html += `<div class="judge-buttons">${[...TYPES, "none"].map((t) => `<button type="button" data-judge="${t}" style="--bc:${TYPE_COLOR[t]}">${t}</button>`).join("")}</div>`;
    }
    el.innerHTML = html;
  }
  renderJudgeScore();
}

function renderJudgeScore() {
  const sample = D.check.sample;
  const done = sample.filter((s) => s.e in judge.answers);
  const pairsLex = done.map((s) => [s.lex, judge.answers[s.e]]);
  const pairsAgent = done.filter((s) => s.agent).map((s) => [s.agent, judge.answers[s.e]]);
  const acc = pairsLex.length ? pairsLex.filter(([a, b]) => a === b).length / pairsLex.length : NaN;
  const accA = pairsAgent.length ? pairsAgent.filter(([a, b]) => a === b).length / pairsAgent.length : NaN;
  $("#judge-score").innerHTML = `
    <div class="score-sub">you vs lexicon</div>
    <div class="score-big">${done.length ? pct(acc, 0) : "—"}</div>
    <div class="score-sub">${done.length} of ${sample.length} labelled · κ ${done.length > 1 ? fmt(kappa(pairsLex), 2) : "—"}</div>
    <div class="dots">${sample.map((s) => `<i class="${s.e in judge.answers ? (judge.answers[s.e] === s.lex ? "y" : "n") : ""}"></i>`).join("")}</div>
    <div class="score-sub">you vs agent: ${pairsAgent.length ? `${pct(accA, 0)} · κ ${pairsAgent.length > 1 ? fmt(kappa(pairsAgent), 2) : "—"}` : "—"}</div>
    <div class="score-actions"><button type="button" id="judge-export">export labels (.tsv)</button><button type="button" id="judge-reset">start over</button></div>`;
}

function setupJudge() {
  loadJudge();
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-judge]");
    if (b) {
      const current = D.check.sample.find((s) => !(s.e in judge.answers));
      judge.answers[current.e] = b.dataset.judge;
      judge.reveal = current;
      saveJudge();
      renderJudge();
      return;
    }
    if (ev.target.id === "judge-next") {
      judge.reveal = null;
      renderJudge();
    } else if (ev.target.id === "judge-reset") {
      judge.answers = {};
      judge.reveal = null;
      saveJudge();
      renderJudge();
    } else if (ev.target.id === "judge-export") {
      const lines = ["source\ttarget\thuman_label"];
      for (const s of D.check.sample) {
        if (!(s.e in judge.answers)) continue;
        const e = D.edges[s.e];
        lines.push(`${D.nodes[e.s].id}\t${D.nodes[e.t].id}\t${judge.answers[s.e]}`);
      }
      const blob = new Blob([lines.join("\n") + "\n"], { type: "text/tab-separated-values" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "week5_human_labels.tsv";
      a.click();
      URL.revokeObjectURL(a.href);
    }
  });
}

function renderAgentAgree() {
  const cells = [];
  for (const [who, res] of [["agent", D.check.agent], ["human", D.check.human]]) {
    if (!res) {
      cells.push(`<div><b>—</b><span>${who} labels not in yet</span></div>`);
      continue;
    }
    cells.push(`<div><b>${pct(res.accuracy, 0)}</b><span>lexicon = ${who} (${res.n} links)</span></div>`);
    cells.push(`<div><b>${fmt(res.kappa, 2)}</b><span>Cohen's κ, lexicon vs ${who}</span></div>`);
    for (const t of [...TYPES, "none"]) {
      const p = res.precision[t];
      if (p !== null && p !== undefined) cells.push(`<div><b style="color:${TYPE_COLOR[t]}">${pct(p, 0)}</b><span>${t} precision (${who})</span></div>`);
    }
  }
  $("#agent-agree").innerHTML = cells.join("");
}

// ------------------------------------------------------------------ static bindings

function bindNumbers() {
  const m = D.meta;
  const r = D.reciprocal;
  const put = (k, v) => document.querySelectorAll(`[data-k="${k}"]`).forEach((el) => (el.textContent = v));
  put("found", fmt(m.found));
  put("sentences", fmt(m.sentences_shipped));
  put("foundpct", pct(m.found / m.m_directed));
  put("nomention", fmt(m.no_mention));
  put("noalias", fmt(m.no_alias));
  put("seed", m.louvain_seed);
  put("q", fmt(m.louvain_q, 3));
  put("ncomm", D.communities.length);
  put("overall", pct(m.overall_within));
  put("nperm", fmt(NULL_PERMS));
  put("rtyped", r.typed_both);
  put("ragree", r.agree);
  put("rpct", pct(r.agree / r.typed_both, 0));
  put("rkappa", fmt(r.kappa, 2));
  put("checkeach", D.check.sample.length / 5);
  put("checkeligible", fmt(m.check_eligible));

  $("#comm-list").innerHTML = D.communities
    .map((c) => `<li><i style="background:${COMM_COLOR[c.id % COMM_COLOR.length]}"></i>${c.id + 1} · ${esc(c.name)}<span>${c.size}</span></li>`)
    .join("");

  const tot = m.m_directed;
  $("#coverage-bar").innerHTML = [
    [m.found, "#2a2030", "named"],
    [m.no_mention, "#e8384f", "not named"],
    [m.no_alias, "#9c93a6", ""],
  ]
    .map(([v, c, l]) => `<div style="width:${(100 * v) / tot}%;background:${c}" title="${v}">${l}</div>`)
    .join("");

  const names = $("#find-list");
  names.innerHTML = D.nodes.map((n) => `<option value="${esc(n.name)}">`).join("");
  $("#find").addEventListener("change", (ev) => {
    const i = D.nodes.findIndex((n) => n.name.toLowerCase() === ev.target.value.trim().toLowerCase());
    if (i >= 0) {
      state.tapeDir = "out";
      showNode(i);
    }
  });
  $("#tape-clear").addEventListener("click", clearSelection);
}

// ------------------------------------------------------------------ update loop

function update() {
  relabel();
  renderLexicon();
  renderLabelStrip();
  renderKeys();
  renderWithin();
  renderFought();
  renderWeights();
  renderTape();
  drawMap();
}

async function main() {
  const res = await fetch("data/week5.json");
  D = await res.json();
  D.nodeIndex = new Map(D.nodes.map((n, i) => [n.id, i]));
  D.edgeLookup = new Map(D.edges.map((e, i) => [`${e.s}>${e.t}`, i]));
  D.out = D.nodes.map(() => []);
  D.in = D.nodes.map(() => []);
  D.edges.forEach((e, i) => {
    D.out[e.s].push(i);
    D.in[e.t].push(i);
  });
  console.assert(D.nodes.length === 303 && D.edges.length === 1784, "snapshot size");

  resetLexicon();
  bindNumbers();
  setupLexicon();
  setupFought();
  setupJudge();
  setupMap();
  update();
  renderSeedNote();
  renderWindowFig();
  renderLoo();
  renderRecip();
  renderAgentAgree();
  renderJudge();
  setupBeats();
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML("afterbegin", `<p style="padding:20px;background:#e8384f;color:#fff">Could not load data/week5.json: ${esc(String(err))}. Serve docs/ over HTTP.</p>`);
});
