const palette = [
  "#d5ff46",
  "#ff5c35",
  "#6f63ff",
  "#4de1c1",
  "#ffca3a",
  "#f17cff",
  "#6eb5ff",
  "#ff8d71",
];

const state = {
  degree: "in",
  log: false,
  binned: false,
  powerLaw: false,
  filter: "giant",
  insights: null,
  network: null,
  simulation: null,
  zoom: null,
};

async function loadData() {
  const [insightsResponse, networkResponse] = await Promise.all([
    fetch("data/insights.json"),
    fetch("data/network.json"),
  ]);

  if (!insightsResponse.ok || !networkResponse.ok) {
    throw new Error("Could not load the generated Week 1 data.");
  }

  state.insights = await insightsResponse.json();
  state.network = await networkResponse.json();
}

function fillStory() {
  const data = state.insights;
  const format = new Intl.NumberFormat("en-US");
  const stats = {
    nodes: format.format(data.nodes),
    directedEdges: format.format(data.directedEdges),
    density: `${(data.density * 100).toFixed(1)}%`,
    isolates: data.isolates,
    correlation: `r = ${data.inOutCorrelation.toFixed(2)}`,
  };

  Object.entries(stats).forEach(([key, value]) => {
    document.querySelector(`[data-stat="${key}"]`).textContent = value;
  });

  const comparison = data.topInOutDifference;
  const characters = {
    topInName: comparison.in.name,
    topInIn: comparison.in.inDegree,
    topInOut: comparison.in.outDegree,
    topOutName: comparison.out.name,
    topOutIn: comparison.out.inDegree,
    topOutOut: comparison.out.outDegree,
  };

  Object.entries(characters).forEach(([key, value]) => {
    document.querySelector(`[data-character="${key}"]`).textContent = value;
  });

  document.querySelector("#island-names").replaceChildren(
    ...data.island.map((character) => {
      const label = document.createElement("span");
      label.textContent = character.name;
      return label;
    }),
  );
}

function renderDegreeChart() {
  const host = document.querySelector("#degree-chart");
  host.replaceChildren();

  const raw = state.insights.distributions[state.degree];
  const data = raw.filter((point) => !state.log || point.probability > 0);
  const bins = state.binned ? state.insights.binned[state.degree] : [];
  const fit = state.insights.powerLaw[state.degree];
  const curve = state.powerLaw && fit ? fit.curve : [];
  const width = Math.max(host.clientWidth, 320);
  const height = window.innerWidth < 560 ? 390 : 480;
  const margin = { top: 24, right: 26, bottom: 55, left: 65 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const svg = d3
    .select(host)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("aria-label", `${state.degree}-degree probability distribution`);
  const plot = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // The binned series already lives in u = k + 1 space; the raw dots and the
  // fitted curve are shifted only when the logarithmic axis needs them to be.
  const xValue = (point) => (state.log ? point.degree + 1 : point.degree);
  const binX = (bin) => (state.log ? bin.center : bin.center - 1);
  const visibleBins = bins.filter((bin) => !state.log || bin.density > 0);
  const maxX = d3.max([
    d3.max(data, xValue),
    d3.max(visibleBins, binX) ?? 0,
    d3.max(curve, xValue) ?? 0,
  ]);
  const maxY = d3.max([
    d3.max(data, (point) => point.probability),
    d3.max(visibleBins, (bin) => bin.density) ?? 0,
  ]);
  const minY = d3.min([
    d3.min(data, (point) => point.probability),
    d3.min(visibleBins, (bin) => bin.density) ?? Infinity,
  ]);
  const x = state.log
    ? d3.scaleLog().domain([1, maxX]).range([0, innerWidth]).nice()
    : d3.scaleLinear().domain([0, maxX]).range([0, innerWidth]).nice();
  const y = state.log
    ? d3
        .scaleLog()
        .domain([Math.max(minY * 0.72, 0.001), maxY * 1.2])
        .range([innerHeight, 0])
        .nice()
    : d3
        .scaleLinear()
        .domain([0, maxY * 1.08])
        .range([innerHeight, 0])
        .nice();

  const yTicks = state.log ? 5 : 6;
  plot
    .append("g")
    .attr("class", "grid")
    .call(d3.axisLeft(y).ticks(yTicks).tickSize(-innerWidth).tickFormat(""))
    .call((group) => group.select(".domain").remove());

  plot
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(width < 600 ? 5 : 9, state.log ? "~g" : "d"));
  plot
    .append("g")
    .attr("class", "axis")
    .call(d3.axisLeft(y).ticks(yTicks, state.log ? "~g" : ".0%"));

  if (curve.length) {
    const [yFloor] = y.domain();
    plot
      .append("path")
      .datum(
        curve.filter(
          (point) => point.probability >= yFloor && xValue(point) <= maxX,
        ),
      )
      .attr("class", "powerlaw-line")
      .attr(
        "d",
        d3
          .line()
          .x((point) => x(xValue(point)))
          .y((point) => y(point.probability)),
      );
  }

  if (visibleBins.length) {
    plot
      .append("path")
      .datum(visibleBins)
      .attr("class", "binned-line")
      .attr(
        "d",
        d3
          .line()
          .x((bin) => x(binX(bin)))
          .y((bin) => y(bin.density)),
      );

    plot
      .selectAll(".binned-marker")
      .data(visibleBins)
      .join("rect")
      .attr("class", "binned-marker")
      .attr("x", (bin) => x(binX(bin)) - 4.5)
      .attr("y", (bin) => y(bin.density) - 4.5)
      .attr("width", 9)
      .attr("height", 9)
      .append("title")
      .text(
        (bin) =>
          `bin u = ${bin.low}${bin.width === 1 ? "" : `–${bin.high}`}\nwidth ${bin.width}\n${bin.count} character${bin.count === 1 ? "" : "s"}\ndensity ${bin.density.toFixed(4)}`,
      );
  }

  plot
    .selectAll(".chart-dot")
    .data(data)
    .join("circle")
    .attr("class", "chart-dot")
    .attr("cx", (point) => x(xValue(point)))
    .attr("cy", (point) => y(point.probability))
    .attr("r", (point) => Math.max(3.5, Math.min(10, Math.sqrt(point.count) * 1.15)))
    .append("title")
    .text(
      (point) =>
        `k = ${point.degree}\n${point.count} character${point.count === 1 ? "" : "s"}\nP(k) = ${point.probability.toFixed(4)}`,
    );

  const labels = {
    in: "incoming links",
    out: "outgoing links",
    undirected: "unique neighbours",
  };
  svg
    .append("text")
    .attr("x", margin.left + innerWidth / 2)
    .attr("y", height - 8)
    .attr("text-anchor", "middle")
    .attr("fill", "#756f66")
    .attr("font-family", "DM Mono")
    .attr("font-size", 10)
    .text(state.log ? `${labels[state.degree]} (k + 1)` : labels[state.degree]);
  svg
    .append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + innerHeight / 2))
    .attr("y", 13)
    .attr("text-anchor", "middle")
    .attr("fill", "#756f66")
    .attr("font-family", "DM Mono")
    .attr("font-size", 10)
    .text("probability P(k)");

  document.querySelector("#axis-note").textContent = state.log
    ? "x = degree k + 1 · y = P(k) · logarithmic axes"
    : "x = degree k · y = P(k) · linear axes";

  document.querySelector(".key-bin").classList.toggle("off", !state.binned);
  document.querySelector(".key-fit").classList.toggle("off", !state.powerLaw);
  updateFitNote(fit);
}

function updateFitNote(fit) {
  const note = document.querySelector("#fit-note");
  if (!state.powerLaw || !fit) {
    note.hidden = true;
    note.replaceChildren();
    return;
  }

  note.hidden = false;
  note.innerHTML = `
    <strong>&alpha; = ${fit.alpha.toFixed(2)}</strong>
    <span>fitted on the ${fit.tailCount} characters with k &ge; ${fit.kMin};
    below that the curve is not straight, so fitting there would invent an
    exponent (KS distance ${fit.ksDistance.toFixed(3)})</span>
  `;
}

function networkData() {
  const visibleNodes =
    state.filter === "giant"
      ? state.network.nodes.filter((node) => node.component === 0)
      : state.network.nodes;
  const ids = new Set(visibleNodes.map((node) => node.id));

  return {
    nodes: visibleNodes.map((node) => ({ ...node })),
    links: state.network.links
      .filter((link) => ids.has(link.source) && ids.has(link.target))
      .map((link) => ({ ...link })),
  };
}

function renderNetwork() {
  if (state.simulation) state.simulation.stop();

  const svg = d3.select("#network-graph");
  svg.selectAll("*").remove();
  const element = svg.node();
  const width = element.clientWidth || 1000;
  const height = element.clientHeight || 680;
  const data = networkData();
  const root = svg.append("g");

  state.zoom = d3
    .zoom()
    .scaleExtent([0.35, 7])
    .on("zoom", (event) => root.attr("transform", event.transform));
  svg.call(state.zoom);

  const links = root
    .append("g")
    .selectAll("line")
    .data(data.links)
    .join("line")
    .attr("class", "link")
    .attr("stroke-width", 0.7);

  const nodes = root
    .append("g")
    .selectAll("circle")
    .data(data.nodes)
    .join("circle")
    .attr("class", "node")
    .attr("r", (node) => 2.4 + Math.sqrt(node.degree) * 0.72)
    .attr("fill", (node) =>
      node.component === 0
        ? palette[node.community % palette.length]
        : node.degree === 0
          ? "#756f66"
          : "#f3efe7",
    )
    .on("click", (event, node) => selectNode(node, nodes, links))
    .call(
      d3
        .drag()
        .on("start", (event, node) => {
          if (!event.active) state.simulation.alphaTarget(0.2).restart();
          node.fx = node.x;
          node.fy = node.y;
        })
        .on("drag", (event, node) => {
          node.fx = event.x;
          node.fy = event.y;
        })
        .on("end", (event, node) => {
          if (!event.active) state.simulation.alphaTarget(0);
          node.fx = null;
          node.fy = null;
        }),
    );

  nodes.append("title").text(
    (node) =>
      `${node.name}\n${node.inDegree} in · ${node.outDegree} out · ${node.degree} neighbours`,
  );

  state.simulation = d3
    .forceSimulation(data.nodes)
    .force(
      "link",
      d3
        .forceLink(data.links)
        .id((node) => node.id)
        .distance(22)
        .strength(0.18),
    )
    .force("charge", d3.forceManyBody().strength(-30))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius((node) => 3 + Math.sqrt(node.degree)))
    .on("tick", () => {
      links
        .attr("x1", (link) => link.source.x)
        .attr("y1", (link) => link.source.y)
        .attr("x2", (link) => link.target.x)
        .attr("y2", (link) => link.target.y);
      nodes.attr("cx", (node) => node.x).attr("cy", (node) => node.y);
    });

  const search = document.querySelector("#node-search");
  search.value = "";
  search.oninput = () => {
    const query = search.value.trim().toLowerCase();
    nodes
      .classed("dimmed", (node) => query && !node.name.toLowerCase().includes(query))
      .classed(
        "highlighted",
        (node) => query && node.name.toLowerCase().includes(query),
      );
    links.classed("dimmed", Boolean(query));
  };
}

function selectNode(selected, nodes, links) {
  const neighbours = new Set([selected.id]);
  state.network.links.forEach((link) => {
    if (link.source === selected.id) neighbours.add(link.target);
    if (link.target === selected.id) neighbours.add(link.source);
  });

  nodes
    .classed("dimmed", (node) => !neighbours.has(node.id))
    .classed("highlighted", (node) => node.id === selected.id);
  links.classed("dimmed", (link) => {
    const source = typeof link.source === "object" ? link.source.id : link.source;
    const target = typeof link.target === "object" ? link.target.id : link.target;
    return source !== selected.id && target !== selected.id;
  });

  document.querySelector("#node-detail").innerHTML = `
    <p class="card-kicker">Selected character</p>
    <h3>${escapeHtml(selected.name)}</h3>
    <p>${escapeHtml(selected.description)}</p>
    <div class="node-stats">
      <div><strong>${selected.inDegree}</strong><span>in</span></div>
      <div><strong>${selected.outDegree}</strong><span>out</span></div>
      <div><strong>${selected.degree}</strong><span>neighbours</span></div>
    </div>
    <a href="${selected.url}" target="_blank" rel="noreferrer">Open Wikipedia ↗</a>
  `;
}

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function bindControls() {
  document.querySelectorAll("[data-degree]").forEach((button) => {
    button.addEventListener("click", () => {
      document
        .querySelectorAll("[data-degree]")
        .forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.degree = button.dataset.degree;
      renderDegreeChart();
    });
  });

  const toggles = {
    "#log-toggle": "log",
    "#bin-toggle": "binned",
    "#powerlaw-toggle": "powerLaw",
  };
  Object.entries(toggles).forEach(([selector, key]) => {
    document.querySelector(selector).addEventListener("change", (event) => {
      state[key] = event.target.checked;
      renderDegreeChart();
    });
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      document
        .querySelectorAll("[data-filter]")
        .forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.filter = button.dataset.filter;
      renderNetwork();
    });
  });

  document.querySelector("#reset-network").addEventListener("click", () => {
    renderNetwork();
    document.querySelector("#node-detail").innerHTML = `
      <p class="card-kicker">Select a node</p>
      <h3>The network is yours.</h3>
      <p>Click any hero to inspect its incoming and outgoing links.</p>
    `;
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderDegreeChart();
      renderNetwork();
    }, 180);
  });
}

async function init() {
  try {
    await loadData();
    fillStory();
    renderDegreeChart();
    renderNetwork();
    bindControls();
  } catch (error) {
    console.error(error);
    document.querySelector("main").insertAdjacentHTML(
      "afterbegin",
      `<p class="data-error">The interactive data could not be loaded. Serve the docs folder over HTTP and try again.</p>`,
    );
  }
}

init();
