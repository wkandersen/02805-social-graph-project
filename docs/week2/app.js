const COLORS = {
  marvel: "#ffb703",
  random: "#2ec4b6",
  smallWorld: "#7b8cff",
  preferential: "#ff5d73",
};

const DIM = "#7f95a3";

const MODEL_INFO = {
  marvel: {
    name: "Marvel",
    code: "SPECIMEN M",
    recipe:
      "The observed 277-character giant component. Editorial attention, decades of fictional history, and human writing choices are all tangled together in here.",
  },
  random: {
    name: "Erdős–Rényi",
    code: "SPECIMEN ER",
    recipe:
      "Same n and m as Marvel, but every pair of characters was equally likely. Short paths appear for free; dense neighbourhoods and hubs do not.",
  },
  smallWorld: {
    name: "Watts–Strogatz",
    code: "SPECIMEN WS",
    recipe:
      "A degree-10 ring lattice with 20% of its links rewired. Local order supplies the triangles while a handful of shortcuts collapse the distances.",
  },
  preferential: {
    name: "Barabási–Albert",
    code: "SPECIMEN BA",
    recipe:
      "A growing network where every newcomer prefers already-popular nodes. Growth plus preference manufactures hubs and a heavy tail — and little else.",
  },
};

const state = {
  data: null,
  model: "marvel",
  compareAll: true,
  simulations: {},
  game: { rounds: [], index: 0, score: 0, streak: 0, hint: false, answered: false, over: false },
  friends: { friendWins: 0, personWins: 0, draws: 0 },
  sequence: null,
};

async function loadData() {
  const response = await fetch("data/week2.json");
  if (!response.ok) throw new Error("Could not load the Week 2 model data.");
  state.data = await response.json();
}

function format(value, digits = 2) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

function shuffle(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[pick]] = [copy[pick], copy[index]];
  }
  return copy;
}

function renderForceGraph(key, selector, graph, options = {}) {
  if (state.simulations[key]) state.simulations[key].stop();
  const element = document.querySelector(selector);
  const width = element.clientWidth || 720;
  const height = element.clientHeight || options.height || 480;
  const svg = d3.select(element);
  svg.selectAll("*").remove();

  const nodes = graph.nodes.map((node) => ({ ...node }));
  const links = graph.links.map(([source, target]) => ({ source, target }));
  const root = svg.append("g");

  if (options.zoom) {
    svg.call(
      d3.zoom().scaleExtent([0.4, 6]).on("zoom", (event) => root.attr("transform", event.transform)),
    );
  }

  const link = root
    .append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke", options.linkColor || "rgba(126,166,187,.16)")
    .attr("stroke-width", 0.65);

  const node = root
    .append("g")
    .selectAll("circle")
    .data(nodes)
    .join("circle")
    .attr("r", (item) => (options.compact ? 1.4 + Math.sqrt(item.degree) * 0.28 : 2 + Math.sqrt(item.degree) * 0.5))
    .attr("fill", options.color || COLORS.marvel)
    .attr("stroke", "#060a0e")
    .attr("stroke-width", 0.7);

  node.append("title").text((item) => `${item.name}\n${item.degree} connections`);

  const simulation = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((item) => item.id).distance(options.compact ? 13 : 19).strength(0.13))
    .force("charge", d3.forceManyBody().strength(options.compact ? -14 : -26))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius((item) => 2 + Math.sqrt(item.degree) * 0.5))
    .alphaDecay(options.fast ? 0.07 : 0.035)
    .on("tick", () => {
      link
        .attr("x1", (item) => item.source.x)
        .attr("y1", (item) => item.source.y)
        .attr("x2", (item) => item.target.x)
        .attr("y2", (item) => item.target.y);
      node.attr("cx", (item) => item.x).attr("cy", (item) => item.y);
    });

  if (options.drag) {
    node.call(
      d3
        .drag()
        .on("start", (event, item) => {
          if (!event.active) simulation.alphaTarget(0.2).restart();
          item.fx = item.x;
          item.fy = item.y;
        })
        .on("drag", (event, item) => {
          item.fx = event.x;
          item.fy = event.y;
        })
        .on("end", (event, item) => {
          if (!event.active) simulation.alphaTarget(0);
          item.fx = null;
          item.fy = null;
        }),
    );
  }

  state.simulations[key] = simulation;
}

function renderHero() {
  renderForceGraph("hero", "#hero-network", state.data.models.marvel.graph, {
    compact: true,
    fast: true,
    color: COLORS.marvel,
    linkColor: "rgba(255,183,3,.12)",
  });
}

function renderModel() {
  const model = state.data.models[state.model];
  const info = MODEL_INFO[state.model];
  document.querySelector("#model-code").textContent = info.code;
  document.querySelector("#model-name").textContent = info.name;
  document.querySelector("#model-recipe").textContent = info.recipe;
  document.querySelector("#model-metrics").innerHTML = [
    ["mean path length", model.metrics.averageDistance, 2],
    ["clustering C", model.metrics.clustering, 3],
    ["largest hub", model.metrics.maxDegree, 0],
    ["degree variance", model.metrics.degreeVariance, 1],
    ["links m", model.metrics.edges, 0],
  ]
    .map(([label, value, digits]) => `<div class="gauge"><span>${label}</span><strong>${format(value, digits)}</strong></div>`)
    .join("");

  renderForceGraph("model", "#model-network", model.graph, {
    zoom: true,
    drag: true,
    color: COLORS[state.model],
  });
  renderCcdf();
}

function renderCcdf() {
  const host = document.querySelector("#ccdf-chart");
  host.replaceChildren();
  const width = Math.max(host.clientWidth, 300);
  const height = window.innerWidth < 600 ? 320 : 420;
  const margin = { top: 22, right: 22, bottom: 50, left: 60 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const keys = state.compareAll ? Object.keys(MODEL_INFO) : [state.model];
  const points = keys.flatMap((key) => state.data.models[key].ccdf.filter((point) => point.degree > 0));

  const x = d3.scaleLog().domain([1, d3.max(points, (point) => point.degree)]).range([0, innerWidth]).nice();
  const y = d3.scaleLog().domain([1 / 300, 1]).range([innerHeight, 0]);
  const svg = d3.select(host).append("svg").attr("viewBox", `0 0 ${width} ${height}`);
  const plot = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  plot
    .append("g")
    .attr("class", "grid")
    .call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""))
    .call((group) => group.select(".domain").remove());
  plot
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(6, "~g"));
  plot.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5, "~g"));

  keys.forEach((key) => {
    plot
      .append("path")
      .datum(state.data.models[key].ccdf.filter((point) => point.degree > 0))
      .attr("fill", "none")
      .attr("stroke", COLORS[key])
      .attr("stroke-width", key === state.model ? 3 : 1.5)
      .attr("opacity", key === state.model ? 1 : 0.5)
      .attr("d", d3.line().curve(d3.curveStepAfter).x((point) => x(point.degree)).y((point) => y(point.probability)));
  });

  svg
    .append("text")
    .attr("x", margin.left + innerWidth / 2)
    .attr("y", height - 8)
    .attr("text-anchor", "middle")
    .attr("fill", DIM)
    .attr("font-family", "JetBrains Mono")
    .attr("font-size", 9)
    .text("degree k · logarithmic");
  svg
    .append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + innerHeight / 2))
    .attr("y", 13)
    .attr("text-anchor", "middle")
    .attr("fill", DIM)
    .attr("font-family", "JetBrains Mono")
    .attr("font-size", 9)
    .text("P(K ≥ k) · logarithmic");

  document.querySelector("#ccdf-legend").innerHTML = keys
    .map((key) => `<span class="legend-item" style="--legend:${COLORS[key]}">${MODEL_INFO[key].name}</span>`)
    .join("");
}

function gameRounds() {
  const models = state.data.models;
  return shuffle([
    {
      type: "Clue · hub forensics",
      question: "One node here holds 106 neighbours. Which specimen is it?",
      answer: "marvel",
      visual: { kind: "figure", value: "106", caption: "largest hub" },
      hint: "Preferential attachment builds hubs too — but its biggest one in this run reaches only 61.",
      explain:
        "Spider-Man reaches 106 neighbours. Even the Barabási–Albert run tops out at 61, so a hub this dominant is a fingerprint of the real network.",
    },
    {
      type: "Clue · pure chance",
      question: "Short paths, almost no triangles, and nobody far above average. Name the mechanism.",
      answer: "random",
      visual: {
        kind: "gauges",
        rows: [
          ["mean path", models.random.metrics.averageDistance, 2],
          ["clustering", models.random.metrics.clustering, 3],
          ["largest hub", models.random.metrics.maxDegree, 0],
        ],
      },
      hint: "Every possible pair was handed exactly the same probability.",
      explain:
        "Erdős–Rényi gets short paths for free, but its clustering sits at the density (0.038) and the Poisson tail dies long before hubs appear.",
    },
    {
      type: "Clue · local order",
      question: "Triangles as dense as Marvel's, yet the paths are the longest in the lab. Who?",
      answer: "smallWorld",
      visual: {
        kind: "gauges",
        rows: [
          ["mean path", models.smallWorld.metrics.averageDistance, 2],
          ["clustering", models.smallWorld.metrics.clustering, 3],
          ["largest hub", models.smallWorld.metrics.maxDegree, 0],
        ],
      },
      hint: "It starts life as a ring where every node knows its neighbours' neighbours.",
      explain:
        "Watts–Strogatz reaches C = 0.345, slightly over Marvel, because the lattice supplies triangles by construction. What it cannot fake is a hub: its maximum degree is 14.",
    },
    {
      type: "Clue · rich get richer",
      question: "This tail was grown by newcomers choosing whoever was already popular. Whose is it?",
      answer: "preferential",
      visual: { kind: "bars", values: models.preferential.ccdf.filter((point) => point.degree > 1).slice(0, 30) },
      hint: "Growth on its own is not enough; the attachment probability has to depend on degree.",
      explain:
        "Barabási–Albert produces the heavy tail through growth plus preferential attachment. Its clustering, though, is only 0.103 — the triangles were never part of the recipe.",
    },
    {
      type: "Clue · the null test",
      question: "Its clustering sits 18σ beyond degree-preserving chance. Which specimen refuses to be shuffled away?",
      answer: "marvel",
      visual: { kind: "figure", value: `${format(state.data.null.zScore, 1)}σ`, caption: "beyond the null" },
      hint: "The null keeps every hub in place, so whatever remains cannot be a story about degree.",
      explain:
        "Marvel's triangles are not explained by its degree sequence alone. Something about who appears in whose story survives after hubs are controlled for.",
    },
  ]);
}

function renderEvidence(visual) {
  const host = document.querySelector("#clue-visual");
  if (visual.kind === "figure") {
    host.innerHTML = `<div><div class="big-figure">${visual.value}</div><p class="kicker">${visual.caption}</p></div>`;
    return;
  }
  if (visual.kind === "gauges") {
    host.innerHTML = `<div style="width:100%">${visual.rows
      .map(([label, value, digits]) => `<div class="gauge"><span>${label}</span><strong>${format(value, digits)}</strong></div>`)
      .join("")}</div>`;
    return;
  }
  const max = d3.max(visual.values, (point) => point.probability);
  host.innerHTML = `<div class="bar-field">${visual.values
    .map((point) => `<i style="height:${Math.max(3, (point.probability / max) * 100)}%" title="k = ${point.degree}"></i>`)
    .join("")}</div>`;
}

function syncScore() {
  document.querySelector("#score").textContent = state.game.score;
  document.querySelector("#streak").textContent = state.game.streak;
  document.querySelector("#rail-score").textContent = state.game.score;
}

function renderRound() {
  const round = state.game.rounds[state.game.index];
  state.game.hint = false;
  state.game.answered = false;
  document.querySelector("#round-count").textContent = `${state.game.index + 1} / ${state.game.rounds.length}`;
  syncScore();
  document.querySelector("#clue-type").textContent = round.type;
  document.querySelector("#clue-question").textContent = round.question;

  const hint = document.querySelector("#hint-text");
  hint.hidden = true;
  hint.textContent = round.hint;
  const hintButton = document.querySelector("#hint-button");
  hintButton.disabled = false;
  hintButton.hidden = false;
  hintButton.textContent = "unlock hint −25";

  document.querySelector("#verdict").hidden = true;
  document.querySelector("#next-round").hidden = true;
  document.querySelector("#game-progress-bar").style.width = `${((state.game.index + 1) / state.game.rounds.length) * 100}%`;
  renderEvidence(round.visual);

  document.querySelector("#suspects").innerHTML = shuffle(Object.keys(MODEL_INFO))
    .map(
      (key, index) => `
      <button class="key" data-answer="${key}" data-index="${index + 1}">
        <span>key ${index + 1}</span>
        <strong>${MODEL_INFO[key].name}</strong>
      </button>`,
    )
    .join("");
  document.querySelectorAll(".key").forEach((button) => {
    button.addEventListener("click", () => accuse(button.dataset.answer));
  });
}

function accuse(answer) {
  if (state.game.answered || state.game.over) return;
  state.game.answered = true;
  document.querySelector("#hint-button").disabled = true;

  const round = state.game.rounds[state.game.index];
  const correct = answer === round.answer;
  if (correct) {
    state.game.streak += 1;
    state.game.score += (state.game.hint ? 75 : 100) + Math.max(0, state.game.streak - 1) * 20;
  } else {
    state.game.streak = 0;
  }
  syncScore();

  document.querySelectorAll(".key").forEach((button) => {
    button.disabled = true;
    if (button.dataset.answer === round.answer) button.classList.add("correct");
    if (button.dataset.answer === answer && !correct) button.classList.add("wrong");
  });

  const verdict = document.querySelector("#verdict");
  verdict.hidden = false;
  verdict.innerHTML = `<strong>${correct ? "Case cracked." : `It was ${MODEL_INFO[round.answer].name}.`}</strong>${round.explain}`;

  const next = document.querySelector("#next-round");
  next.hidden = false;
  next.textContent = state.game.index === state.game.rounds.length - 1 ? "see final score →" : "next clue →";
}

function nextRound() {
  if (state.game.index < state.game.rounds.length - 1) {
    state.game.index += 1;
    renderRound();
    return;
  }

  state.game.over = true;
  const best = 700;
  const share = state.game.score / best;
  document.querySelector("#clue-type").textContent = "Case closed";
  document.querySelector("#clue-question").textContent =
    share >= 0.65 ? "You can read a network's fingerprints." : "The models fooled you — this time.";
  document.querySelector("#clue-visual").innerHTML = `<div><div class="big-figure">${state.game.score}</div><p class="kicker">detective points of ${best}</p></div>`;
  document.querySelector("#hint-button").hidden = true;
  document.querySelector("#hint-text").hidden = true;
  document.querySelector("#suspects").innerHTML = "";
  document.querySelector("#next-round").hidden = true;
  const verdict = document.querySelector("#verdict");
  verdict.hidden = false;
  verdict.innerHTML =
    "<strong>The scientific verdict</strong>Erdős–Rényi buys short paths, Watts–Strogatz buys paths and triangles, Barabási–Albert buys hubs. No single mechanism on this page buys all three at once — which is exactly why the null model, not the model, settles the argument.";
}

function restartGame() {
  state.game = { rounds: gameRounds(), index: 0, score: 0, streak: 0, hint: false, answered: false, over: false };
  renderRound();
}

function renderNullChart() {
  const host = document.querySelector("#null-chart");
  host.replaceChildren();
  const width = Math.max(host.clientWidth, 280);
  const height = 300;
  const margin = { top: 26, right: 18, bottom: 46, left: 42 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const values = state.data.null.values;

  const x = d3.scaleLinear().domain([d3.min(values) * 0.94, state.data.null.real * 1.04]).range([0, innerWidth]);
  const bins = d3.bin().domain(x.domain()).thresholds(18)(values);
  const y = d3.scaleLinear().domain([0, d3.max(bins, (bin) => bin.length)]).range([innerHeight, 0]);

  const svg = d3.select(host).append("svg").attr("viewBox", `0 0 ${width} ${height}`);
  const plot = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  plot
    .selectAll("rect")
    .data(bins)
    .join("rect")
    .attr("x", (bin) => x(bin.x0) + 1)
    .attr("y", (bin) => y(bin.length))
    .attr("width", (bin) => Math.max(0, x(bin.x1) - x(bin.x0) - 2))
    .attr("height", (bin) => innerHeight - y(bin.length))
    .attr("fill", COLORS.smallWorld)
    .append("title")
    .text((bin) => `${bin.length} shuffles with C in [${format(bin.x0, 3)}, ${format(bin.x1, 3)})`);

  plot
    .append("line")
    .attr("x1", x(state.data.null.real))
    .attr("x2", x(state.data.null.real))
    .attr("y1", 0)
    .attr("y2", innerHeight)
    .attr("stroke", COLORS.marvel)
    .attr("stroke-width", 3);
  plot
    .append("text")
    .attr("x", x(state.data.null.real) - 6)
    .attr("y", 4)
    .attr("text-anchor", "end")
    .attr("fill", COLORS.marvel)
    .attr("font-family", "JetBrains Mono")
    .attr("font-size", 9)
    .text("REAL MARVEL");

  plot
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(4).tickFormat(d3.format(".3f")));
  plot.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4));

  document.querySelector("#z-score").textContent = `${format(state.data.null.zScore, 1)}σ`;
  document.querySelector("#p-value").textContent = format(state.data.null.empiricalP, 4);
  const readouts = {
    real: format(state.data.null.real, 2),
    mean: format(state.data.null.mean, 3),
    z: format(state.data.null.zScore, 1),
  };
  Object.entries(readouts).forEach(([key, value]) => {
    document.querySelectorAll(`[data-null="${key}"]`).forEach((item) => {
      item.textContent = value;
    });
  });
}

function renderShuffle(index) {
  const snapshot = state.data.null.snapshots[index];
  document.querySelector("#swap-count").textContent = `${format(snapshot.swaps, 0)} swaps`;
  document.querySelector("#live-clustering").textContent = format(snapshot.clustering, 3);
  renderForceGraph(
    "shuffle",
    "#shuffle-network",
    { nodes: state.data.models.marvel.graph.nodes, links: snapshot.links },
    { compact: true, fast: true, color: COLORS.marvel, linkColor: "rgba(126,166,187,.14)" },
  );
}

function runSequence() {
  const slider = document.querySelector("#shuffle-slider");
  const button = document.querySelector("#run-sequence");
  if (state.sequence) {
    clearInterval(state.sequence);
    state.sequence = null;
    button.textContent = "▶ run sequence";
    return;
  }
  let step = 0;
  slider.value = 0;
  renderShuffle(0);
  button.textContent = "■ stop";
  state.sequence = setInterval(() => {
    step += 1;
    if (step > Number(slider.max)) {
      clearInterval(state.sequence);
      state.sequence = null;
      button.textContent = "▶ run sequence";
      return;
    }
    slider.value = step;
    renderShuffle(step);
  }, 1400);
}

function adjacency() {
  const map = new Map();
  state.data.models.marvel.graph.nodes.forEach((node) => map.set(node.id, []));
  state.data.models.marvel.graph.links.forEach(([source, target]) => {
    map.get(source).push(target);
    map.get(target).push(source);
  });
  return map;
}

function drawPair() {
  const graph = state.data.models.marvel.graph;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const neighbours = state.adjacency || (state.adjacency = adjacency());
  const person = graph.nodes[Math.floor(Math.random() * graph.nodes.length)];
  const list = neighbours.get(person.id);
  const friend = byId.get(list[Math.floor(Math.random() * list.length)]);

  const friendWins = friend.degree >= person.degree;
  state.friends.draws += 1;
  if (friendWins) state.friends.friendWins += 1;
  else state.friends.personWins += 1;

  [["#person-card", person], ["#friend-card", friend]].forEach(([selector, node]) => {
    const card = document.querySelector(selector);
    card.querySelector("h3").textContent = node.name;
    card.querySelector("strong").textContent = node.degree;
    card.animate(
      [{ transform: "translateY(-6px)", opacity: 0.35 }, { transform: "translateY(0)", opacity: 1 }],
      { duration: 300 },
    );
  });

  document.querySelector("#friend-wins").textContent = state.friends.friendWins;
  document.querySelector("#person-wins").textContent = state.friends.personWins;
  document.querySelector("#friend-rate").textContent = `${Math.round((state.friends.friendWins / state.friends.draws) * 100)}%`;
  document.querySelector("#friend-commentary").textContent = friendWins
    ? `${friend.name} matches or beats ${person.name} — another win for degree-biased sampling.`
    : `${person.name} wins this draw. The paradox is a statement about the population, not a promise about every pair.`;
}

function trackRail() {
  const links = new Map(
    [...document.querySelectorAll("[data-nav]")].map((link) => [link.dataset.nav, link]),
  );
  const observer = new IntersectionObserver(
    (entries) => {
      entries
        .filter((entry) => entry.isIntersecting)
        .forEach((entry) => {
          links.forEach((link) => link.classList.remove("active"));
          links.get(entry.target.id)?.classList.add("active");
        });
    },
    { rootMargin: "-25% 0px -65% 0px" },
  );
  document.querySelectorAll(".module").forEach((module) => observer.observe(module));
}

function bindControls() {
  document.querySelectorAll("[data-model]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-model]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.model = button.dataset.model;
      renderModel();
    });
  });

  document.querySelector("#rerun-layout").addEventListener("click", renderModel);
  document.querySelector("#all-models-toggle").addEventListener("change", (event) => {
    state.compareAll = event.target.checked;
    renderCcdf();
  });

  document.querySelector("#hint-button").addEventListener("click", () => {
    state.game.hint = true;
    document.querySelector("#hint-text").hidden = false;
    const button = document.querySelector("#hint-button");
    button.disabled = true;
    button.textContent = "hint unlocked";
  });
  document.querySelector("#next-round").addEventListener("click", nextRound);
  document.querySelector("#restart-game").addEventListener("click", restartGame);

  document.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea")) return;
    if (["1", "2", "3", "4"].includes(event.key)) {
      document.querySelector(`.key[data-index="${event.key}"]`)?.click();
    }
    if (event.key.toLowerCase() === "n") {
      const next = document.querySelector("#next-round");
      if (!next.hidden) next.click();
    }
  });

  document.querySelector("#shuffle-slider").addEventListener("input", (event) => {
    if (state.sequence) {
      clearInterval(state.sequence);
      state.sequence = null;
      document.querySelector("#run-sequence").textContent = "▶ run sequence";
    }
    renderShuffle(Number(event.target.value));
  });
  document.querySelector("#run-sequence").addEventListener("click", runSequence);
  document.querySelector("#draw-friend").addEventListener("click", drawPair);

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderHero();
      renderModel();
      renderNullChart();
      renderShuffle(Number(document.querySelector("#shuffle-slider").value));
    }, 220);
  });
}

async function init() {
  try {
    await loadData();
    renderHero();
    renderModel();
    restartGame();
    renderNullChart();
    renderShuffle(0);
    bindControls();
    trackRail();
  } catch (error) {
    console.error(error);
    document
      .querySelector(".console")
      .insertAdjacentHTML("afterbegin", `<p class="data-error">${error.message} Serve the docs folder over HTTP and try again.</p>`);
  }
}

init();
