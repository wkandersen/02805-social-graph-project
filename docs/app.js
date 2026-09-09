const COLORS = {
  marvel: "#d5ff46",
  random: "#4de1c1",
  smallWorld: "#6f63ff",
  preferential: "#ff5c35",
};

const MODEL_INFO = {
  marvel: {
    name: "Marvel",
    code: "SPECIMEN M",
    recipe: "The observed 277-character giant component. Editorial attention, fictional history, and human choices are all mixed together.",
  },
  random: {
    name: "Erdős–Rényi",
    code: "SPECIMEN ER",
    recipe: "Same n and m as Marvel, but every pair is equally likely. Short paths appear; hubs and dense neighbourhoods do not.",
  },
  smallWorld: {
    name: "Watts–Strogatz",
    code: "SPECIMEN WS",
    recipe: "A degree-10 ring lattice with 20% of links rewired. Local order keeps triangles while shortcuts collapse paths.",
  },
  preferential: {
    name: "Barabási–Albert",
    code: "SPECIMEN BA",
    recipe: "A growing network where each newcomer prefers popular nodes. Growth plus preference creates hubs and a heavy tail.",
  },
};

const state = {
  data: null,
  model: "marvel",
  modelSimulation: null,
  heroSimulation: null,
  shuffleSimulation: null,
  compareAll: true,
  game: { rounds: [], index: 0, score: 0, streak: 0, hint: false, answered: false },
  friends: { friendWins: 0, personWins: 0, draws: 0 },
};

async function loadData() {
  const response = await fetch("data/week2.json");
  if (!response.ok) throw new Error("Could not load Week 2 model data.");
  state.data = await response.json();
}

function format(value, digits = 2) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

function shuffled(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function graphSize(selector, fallbackHeight) {
  const element = document.querySelector(selector);
  return {
    element,
    width: element.clientWidth || 800,
    height: element.clientHeight || fallbackHeight,
  };
}

function renderForceGraph(selector, graph, options = {}) {
  const { element, width, height } = graphSize(selector, options.height || 600);
  const svg = d3.select(element);
  svg.selectAll("*").remove();
  const nodes = graph.nodes.map((node) => ({ ...node }));
  const links = graph.links.map(([source, target]) => ({ source, target }));
  const root = svg.append("g");

  if (options.zoom) {
    svg.call(
      d3.zoom().scaleExtent([0.45, 6]).on("zoom", (event) => {
        root.attr("transform", event.transform);
      }),
    );
  }

  const link = root
    .append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke", options.linkColor || "rgba(243,239,231,.11)")
    .attr("stroke-width", options.linkWidth || 0.65);

  const node = root
    .append("g")
    .selectAll("circle")
    .data(nodes)
    .join("circle")
    .attr("r", (item) => options.compact ? 1.3 + Math.sqrt(item.degree) * 0.25 : 2 + Math.sqrt(item.degree) * 0.52)
    .attr("fill", (item) => options.color || (item.rank < 6 ? "#ff5c35" : "#d5ff46"))
    .attr("stroke", "#11100f")
    .attr("stroke-width", 0.7);

  node.append("title").text((item) => `${item.name}\n${item.degree} connections`);

  const simulation = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((item) => item.id).distance(options.compact ? 12 : 19).strength(0.13))
    .force("charge", d3.forceManyBody().strength(options.compact ? -13 : -25))
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
      d3.drag()
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
  return simulation;
}

function renderHero() {
  if (state.heroSimulation) state.heroSimulation.stop();
  state.heroSimulation = renderForceGraph(
    "#hero-network",
    state.data.models.marvel.graph,
    { compact: true, fast: true, color: "#d5ff46", linkColor: "rgba(213,255,70,.12)", height: 440 },
  );
}

function renderModel() {
  if (state.modelSimulation) state.modelSimulation.stop();
  const model = state.data.models[state.model];
  const info = MODEL_INFO[state.model];
  document.querySelector("#model-code").textContent = info.code;
  document.querySelector("#model-name").textContent = info.name;
  document.querySelector("#model-recipe").textContent = info.recipe;
  document.querySelector("#model-metrics").innerHTML = [
    ["average path", model.metrics.averageDistance, 2],
    ["clustering C", model.metrics.clustering, 3],
    ["largest hub", model.metrics.maxDegree, 0],
    ["degree variance", model.metrics.degreeVariance, 1],
    ["isolates", model.metrics.isolates, 0],
  ].map(([label, value, digits]) => `
    <div class="metric-row"><span>${label}</span><strong>${format(value, digits)}</strong></div>
  `).join("");
  state.modelSimulation = renderForceGraph("#model-network", model.graph, {
    zoom: true,
    drag: true,
    color: COLORS[state.model],
    height: 660,
  });
  renderCcdf();
}

function renderCcdf() {
  const host = document.querySelector("#ccdf-chart");
  host.replaceChildren();
  const width = Math.max(host.clientWidth, 320);
  const height = window.innerWidth < 600 ? 340 : 430;
  const margin = { top: 25, right: 25, bottom: 54, left: 62 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const keys = state.compareAll ? Object.keys(MODEL_INFO) : [state.model];
  const allPoints = keys.flatMap((key) => state.data.models[key].ccdf.filter((point) => point.degree > 0));
  const x = d3.scaleLog().domain([1, d3.max(allPoints, (point) => point.degree)]).range([0, innerWidth]).nice();
  const y = d3.scaleLog().domain([1 / 300, 1]).range([innerHeight, 0]);
  const svg = d3.select(host).append("svg").attr("viewBox", `0 0 ${width} ${height}`);
  const plot = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  plot.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat("")).call((group) => group.select(".domain").remove());
  plot.append("g").attr("class", "axis").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(6, "~g"));
  plot.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5, "~g"));

  keys.forEach((key) => {
    const points = state.data.models[key].ccdf.filter((point) => point.degree > 0);
    plot.append("path")
      .datum(points)
      .attr("fill", "none")
      .attr("stroke", COLORS[key])
      .attr("stroke-width", key === state.model ? 3.5 : 1.8)
      .attr("opacity", key === state.model ? 1 : 0.55)
      .attr("d", d3.line().curve(d3.curveStepAfter).x((point) => x(point.degree)).y((point) => y(point.probability)));
  });
  svg.append("text").attr("x", margin.left + innerWidth / 2).attr("y", height - 8).attr("text-anchor", "middle").attr("fill", "#756f66").attr("font-family", "DM Mono").attr("font-size", 9).text("degree k · logarithmic");
  svg.append("text").attr("transform", "rotate(-90)").attr("x", -(margin.top + innerHeight / 2)).attr("y", 12).attr("text-anchor", "middle").attr("fill", "#756f66").attr("font-family", "DM Mono").attr("font-size", 9).text("P(K ≥ k) · logarithmic");
  document.querySelector("#ccdf-legend").innerHTML = keys.map((key) => `<span class="legend-item" style="--legend:${COLORS[key]}">${MODEL_INFO[key].name}</span>`).join("");
}

function gameRounds() {
  const m = state.data.models;
  return shuffled([
    {
      type: "HUB FORENSICS",
      question: "This specimen has one hero with 106 neighbours. Who is it?",
      answer: "marvel",
      visual: { kind: "number", value: "106", suffix: "MAX DEGREE" },
      hint: "Preferential attachment makes hubs too—but this exact record belongs to a named hero.",
      explain: "Spider-Man reaches 106 neighbours. None of these single seeded model runs grows a hub that large.",
    },
    {
      type: "PURE CHANCE",
      question: "Short paths, almost no triangles, and a narrow degree range. Name the model.",
      answer: "random",
      visual: { kind: "metrics", values: [m.random.metrics.averageDistance, m.random.metrics.clustering, m.random.metrics.maxDegree] },
      hint: "Every possible pair was given the same probability.",
      explain: "Erdős–Rényi gets short paths for free, but C stays near density and its Poisson tail dies before hubs appear.",
    },
    {
      type: "LOCAL ORDER",
      question: "Which imitation keeps triangles while a few rewired links shorten the paths?",
      answer: "smallWorld",
      visual: { kind: "metrics", values: [m.smallWorld.metrics.averageDistance, m.smallWorld.metrics.clustering, m.smallWorld.metrics.maxDegree] },
      hint: "It begins as a ring lattice.",
      explain: "Watts–Strogatz combines local lattice structure with long-range shortcuts. It matches clustering and distance surprisingly well.",
    },
    {
      type: "RICH GET RICHER",
      question: "This tail grew from newcomers choosing already-popular nodes. Who made it?",
      answer: "preferential",
      visual: { kind: "bars", values: m.preferential.ccdf.filter((point) => point.degree > 1).slice(0, 28) },
      hint: "Growth alone is not enough; attachment must depend on degree.",
      explain: "Barabási–Albert creates the heavy tail through growth plus preferential attachment, but it does not reproduce Marvel’s clustering.",
    },
    {
      type: "NULL TEST",
      question: "Its clustering sits 18σ beyond degree-preserving chance. Which specimen refuses to be shuffled away?",
      answer: "marvel",
      visual: { kind: "number", value: `${format(state.data.null.zScore, 1)}σ`, suffix: "FROM THE NULL" },
      hint: "The null keeps every hub, so the remaining signal must be who connects to whom.",
      explain: "Marvel’s triangles are not explained by its degree sequence alone. Narrative and editorial structure remain after hubs are controlled for.",
    },
  ]);
}

function renderClueVisual(visual) {
  const host = document.querySelector("#clue-visual");
  if (visual.kind === "number") {
    host.innerHTML = `<div><div class="clue-number">${visual.value}</div><p class="micro-label">${visual.suffix}</p></div>`;
    return;
  }
  if (visual.kind === "metrics") {
    const [distance, clustering, maxDegree] = visual.values;
    host.innerHTML = `
      <div class="metric-stack" style="width:90%">
        <div class="metric-row"><span>mean path</span><strong>${format(distance, 2)}</strong></div>
        <div class="metric-row"><span>clustering</span><strong>${format(clustering, 3)}</strong></div>
        <div class="metric-row"><span>max degree</span><strong>${format(maxDegree, 0)}</strong></div>
      </div>`;
    return;
  }
  const max = d3.max(visual.values, (point) => point.probability);
  host.innerHTML = `<div class="clue-bars">${visual.values.map((point) => `<i style="height:${Math.max(3, point.probability / max * 100)}%" title="k=${point.degree}"></i>`).join("")}</div>`;
}

function renderRound() {
  const round = state.game.rounds[state.game.index];
  state.game.hint = false;
  state.game.answered = false;
  document.querySelector("#round-count").textContent = `${state.game.index + 1} / ${state.game.rounds.length}`;
  document.querySelector("#score").textContent = state.game.score;
  document.querySelector("#streak").textContent = state.game.streak;
  document.querySelector("#clue-type").textContent = round.type;
  document.querySelector("#clue-question").textContent = round.question;
  document.querySelector("#hint-text").hidden = true;
  document.querySelector("#hint-text").textContent = round.hint;
  document.querySelector("#hint-button").disabled = false;
  document.querySelector("#hint-button").textContent = "Use hint −25 pts";
  document.querySelector("#verdict").hidden = true;
  document.querySelector("#next-round").hidden = true;
  document.querySelector("#game-progress-bar").style.width = `${((state.game.index + 1) / state.game.rounds.length) * 100}%`;
  renderClueVisual(round.visual);

  document.querySelector("#suspects").innerHTML = shuffled(Object.keys(MODEL_INFO)).map((key, index) => `
    <button class="suspect" data-answer="${key}">
      <span>SUSPECT ${String.fromCharCode(65 + index)}</span>
      <strong>${MODEL_INFO[key].name}</strong>
    </button>
  `).join("");
  document.querySelectorAll(".suspect").forEach((button) => {
    button.addEventListener("click", () => answerRound(button.dataset.answer));
  });
}

function answerRound(answer) {
  if (state.game.answered) return;
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
  document.querySelector("#score").textContent = state.game.score;
  document.querySelector("#streak").textContent = state.game.streak;
  document.querySelectorAll(".suspect").forEach((button) => {
    button.disabled = true;
    if (button.dataset.answer === round.answer) button.classList.add("correct");
    if (button.dataset.answer === answer && !correct) button.classList.add("wrong");
  });
  const verdict = document.querySelector("#verdict");
  verdict.hidden = false;
  verdict.innerHTML = `<strong>${correct ? "Case cracked." : `It was ${MODEL_INFO[round.answer].name}.`}</strong>${round.explain}`;
  const next = document.querySelector("#next-round");
  next.hidden = false;
  next.textContent = state.game.index === state.game.rounds.length - 1 ? "See final score →" : "Next clue →";
}

function nextRound() {
  if (state.game.index < state.game.rounds.length - 1) {
    state.game.index += 1;
    renderRound();
    return;
  }
  const maximum = 700;
  const percent = Math.round((state.game.score / maximum) * 100);
  document.querySelector("#clue-type").textContent = "CASE CLOSED";
  document.querySelector("#clue-question").textContent = percent >= 65 ? "You can read a network’s fingerprints." : "The models fooled you—for now.";
  document.querySelector("#clue-visual").innerHTML = `<div><div class="clue-number">${state.game.score}</div><p class="micro-label">DETECTIVE POINTS</p></div>`;
  document.querySelector("#suspects").innerHTML = "";
  document.querySelector("#verdict").hidden = false;
  document.querySelector("#verdict").innerHTML = "<strong>The scientific verdict</strong>ER gets short paths, WS gets paths plus clustering, and BA gets hubs. None gets all three at once.";
  document.querySelector("#next-round").hidden = true;
  document.querySelector("#hint-button").hidden = true;
}

function restartGame() {
  state.game = { rounds: gameRounds(), index: 0, score: 0, streak: 0, hint: false, answered: false };
  document.querySelector("#hint-button").hidden = false;
  renderRound();
}

function renderNullChart() {
  const host = document.querySelector("#null-chart");
  host.replaceChildren();
  const width = Math.max(host.clientWidth, 300);
  const height = 330;
  const margin = { top: 28, right: 20, bottom: 48, left: 45 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const values = state.data.null.values;
  const x = d3.scaleLinear().domain([d3.min(values) * 0.94, state.data.null.real * 1.04]).range([0, innerWidth]);
  const bins = d3.bin().domain(x.domain()).thresholds(18)(values);
  const y = d3.scaleLinear().domain([0, d3.max(bins, (bin) => bin.length)]).range([innerHeight, 0]);
  const svg = d3.select(host).append("svg").attr("viewBox", `0 0 ${width} ${height}`);
  const plot = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  plot.selectAll("rect").data(bins).join("rect")
    .attr("x", (bin) => x(bin.x0) + 1)
    .attr("y", (bin) => y(bin.length))
    .attr("width", (bin) => Math.max(0, x(bin.x1) - x(bin.x0) - 2))
    .attr("height", (bin) => innerHeight - y(bin.length))
    .attr("fill", "#6f63ff");
  plot.append("line").attr("x1", x(state.data.null.real)).attr("x2", x(state.data.null.real)).attr("y1", 0).attr("y2", innerHeight).attr("stroke", "#ff5c35").attr("stroke-width", 4);
  plot.append("text").attr("x", x(state.data.null.real) - 5).attr("y", 5).attr("text-anchor", "end").attr("fill", "#ff5c35").attr("font-family", "DM Mono").attr("font-size", 9).text("REAL MARVEL");
  plot.append("g").attr("class", "axis").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".3f")));
  plot.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4));
  document.querySelector("#z-score").textContent = `${format(state.data.null.zScore, 1)}σ`;
  document.querySelector("#p-value").textContent = format(state.data.null.empiricalP, 4);
  document.querySelectorAll('[data-null="real"]').forEach((item) => { item.textContent = format(state.data.null.real, 2); });
  document.querySelectorAll('[data-null="mean"]').forEach((item) => { item.textContent = format(state.data.null.mean, 2); });
  document.querySelectorAll('[data-null="z"]').forEach((item) => { item.textContent = format(state.data.null.zScore, 1); });
}

function renderShuffle(index) {
  if (state.shuffleSimulation) state.shuffleSimulation.stop();
  const snapshot = state.data.null.snapshots[index];
  const graph = {
    nodes: state.data.models.marvel.graph.nodes,
    links: snapshot.links,
  };
  document.querySelector("#swap-count").textContent = `${format(snapshot.swaps, 0)} swaps`;
  document.querySelector("#live-clustering").textContent = format(snapshot.clustering, 3);
  state.shuffleSimulation = renderForceGraph("#shuffle-network", graph, {
    compact: true,
    fast: true,
    color: "#d5ff46",
    linkColor: "rgba(243,239,231,.10)",
    height: 470,
  });
}

function buildAdjacency() {
  const adjacency = new Map();
  state.data.models.marvel.graph.nodes.forEach((node) => adjacency.set(node.id, []));
  state.data.models.marvel.graph.links.forEach(([source, target]) => {
    adjacency.get(source).push(target);
    adjacency.get(target).push(source);
  });
  return adjacency;
}

function drawFriend() {
  const graph = state.data.models.marvel.graph;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = buildAdjacency();
  const person = graph.nodes[Math.floor(Math.random() * graph.nodes.length)];
  const neighbours = adjacency.get(person.id);
  const friend = byId.get(neighbours[Math.floor(Math.random() * neighbours.length)]);
  const friendWins = friend.degree >= person.degree;
  state.friends.draws += 1;
  if (friendWins) state.friends.friendWins += 1;
  else state.friends.personWins += 1;

  const fillCard = (selector, node) => {
    const card = document.querySelector(selector);
    card.querySelector("h3").textContent = node.name;
    card.querySelector("strong").textContent = node.degree;
    card.animate([{ transform: "translateY(-8px)", opacity: 0.3 }, { transform: "translateY(0)", opacity: 1 }], { duration: 320 });
  };
  fillCard("#person-card", person);
  fillCard("#friend-card", friend);
  document.querySelector("#friend-wins").textContent = state.friends.friendWins;
  document.querySelector("#person-wins").textContent = state.friends.personWins;
  document.querySelector("#friend-rate").textContent = `${Math.round(state.friends.friendWins / state.friends.draws * 100)}%`;
  document.querySelector("#friend-commentary").textContent = friendWins
    ? `${friend.name} matches or beats ${person.name}: another win for degree-biased sampling.`
    : `${person.name} wins this draw. A paradox is a population pattern, not a promise about every pair.`;
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
    document.querySelector("#hint-button").disabled = true;
    document.querySelector("#hint-button").textContent = "Hint unlocked";
  });
  document.querySelector("#next-round").addEventListener("click", nextRound);
  document.querySelector("#restart-game").addEventListener("click", restartGame);
  document.querySelector("#shuffle-slider").addEventListener("input", (event) => renderShuffle(Number(event.target.value)));
  document.querySelector("#draw-friend").addEventListener("click", drawFriend);

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
  } catch (error) {
    console.error(error);
    document.querySelector("main").insertAdjacentHTML("afterbegin", `<p class="data-error">${error.message} Serve the docs folder over HTTP and try again.</p>`);
  }
}

init();
