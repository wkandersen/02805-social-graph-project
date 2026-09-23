const COLORS = [
  "#8e2735", "#315aa8", "#d59b25", "#789377", "#75558d",
  "#d16d3b", "#327d83", "#b34e72", "#69635b", "#4f7545",
];

const state = { data: null, selected: 0 };
const fmt = (value, digits = 2) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);

async function loadData() {
  const response = await fetch("data/week4.json");
  if (!response.ok) throw new Error("Could not load the Week 4 evidence file.");
  state.data = await response.json();
}

function fillSummary() {
  document.querySelectorAll("[data-value]").forEach((element) => {
    const key = element.dataset.value;
    const digits = key.toLowerCase().includes("nmi") ? 3 : 0;
    element.textContent = fmt(state.data.summary[key], digits);
  });
  const aristotle = state.data.weighted.find((group) => group.name === "Aristotle");
  document.querySelector("#aristotle-size").textContent = fmt(aristotle.size, 0);
}

function ribbonPath(x0, x1, source, target) {
  const bend = (x1 - x0) * 0.43;
  return [
    `M${x0},${source[0]}`,
    `C${x0 + bend},${source[0]} ${x1 - bend},${target[0]} ${x1},${target[0]}`,
    `L${x1},${target[1]}`,
    `C${x1 - bend},${target[1]} ${x0 + bend},${source[1]} ${x0},${source[1]}`,
    "Z",
  ].join(" ");
}

function drawAlluvial() {
  const data = state.data;
  const width = 1200;
  const height = 620;
  const top = 24;
  const bottom = 24;
  const gap = 8;
  const xLeft = 215;
  const xRight = 965;
  const blockWidth = 18;
  const total = data.summary.nodes;
  const inner = height - top - bottom - gap * (data.unweighted.length - 1);
  const scale = inner / total;

  const place = (groups) => {
    let cursor = top;
    return groups.map((group) => {
      const placed = { ...group, y0: cursor, y1: cursor + group.size * scale };
      cursor = placed.y1 + gap;
      return placed;
    });
  };
  const left = place(data.unweighted);
  const right = place(data.weighted);
  const sourceOffset = left.map((group) => group.y0);
  const targetOffset = right.map((group) => group.y0);
  const flows = [...data.transitions]
    .sort((a, b) => a.source - b.source || a.target - b.target)
    .map((flow) => {
      const thickness = flow.count * scale;
      const result = {
        ...flow,
        sourceRange: [sourceOffset[flow.source], sourceOffset[flow.source] + thickness],
        targetRange: [targetOffset[flow.target], targetOffset[flow.target] + thickness],
      };
      sourceOffset[flow.source] += thickness;
      targetOffset[flow.target] += thickness;
      return result;
    });

  const svg = d3.select("#alluvial").append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Flows between unweighted and weighted Louvain communities");

  const flowSelection = svg.append("g").selectAll("path")
    .data(flows)
    .join("path")
    .attr("class", "flow")
    .attr("d", (d) => ribbonPath(
      xLeft + blockWidth,
      xRight,
      d.sourceRange,
      d.targetRange,
    ))
    .attr("fill", (d) => COLORS[d.source % COLORS.length])
    .attr("fill-opacity", .42);

  const groups = [
    ...left.map((group) => ({ ...group, side: "left", x: xLeft })),
    ...right.map((group) => ({ ...group, side: "right", x: xRight })),
  ];
  const blockSelection = svg.append("g").selectAll("rect")
    .data(groups)
    .join("rect")
    .attr("class", "block")
    .attr("x", (d) => d.x)
    .attr("y", (d) => d.y0)
    .attr("width", blockWidth)
    .attr("height", (d) => Math.max(1, d.y1 - d.y0))
    .attr("fill", (d) => d.side === "left" ? COLORS[d.id % COLORS.length] : "#171715");

  svg.append("g").selectAll("text")
    .data(groups)
    .join("text")
    .attr("class", "block-label")
    .attr("x", (d) => d.side === "left" ? d.x - 9 : d.x + blockWidth + 9)
    .attr("y", (d) => (d.y0 + d.y1) / 2 - 2)
    .attr("text-anchor", (d) => d.side === "left" ? "end" : "start")
    .text((d) => d.name)
    .append("tspan")
    .attr("x", (d) => d.side === "left" ? d.x - 9 : d.x + blockWidth + 9)
    .attr("dy", 14)
    .attr("font-weight", 400)
    .attr("fill", "#6e6a61")
    .text((d) => `${d.size} people`);

  const caption = d3.select("#flow-caption");
  flowSelection
    .on("mouseenter", (_, d) => {
      flowSelection.attr("fill-opacity", (flow) => flow === d ? .78 : .07);
      blockSelection.attr("opacity", (group) =>
        (group.side === "left" && group.id === d.source) ||
        (group.side === "right" && group.id === d.target) ? 1 : .3
      );
      caption.text(
        `${d.count} philosophers: ${left[d.source].name} → ${right[d.target].name}`
      );
    })
    .on("mouseleave", () => {
      flowSelection.attr("fill-opacity", .42);
      blockSelection.attr("opacity", 1);
      caption.text("Hover the map to read a transition.");
    });

  blockSelection
    .on("mouseenter", (_, d) => {
      flowSelection.attr("fill-opacity", (flow) => {
        const match = d.side === "left" ? flow.source === d.id : flow.target === d.id;
        return match ? .72 : .05;
      });
      caption.text(
        `${d.name} group: ${d.size} philosophers · leading names: ${d.leaders.join(", ")}`
      );
    })
    .on("mouseleave", () => {
      flowSelection.attr("fill-opacity", .42);
      caption.text("Hover the map to read a transition.");
    });
}

function renderPerson(index) {
  state.selected = index;
  const person = state.data.movers[index];
  const from = state.data.unweighted[person.from];
  const to = state.data.weighted[person.to];
  document.querySelectorAll(".mover-list button").forEach((button, i) => {
    button.classList.toggle("active", i === index);
  });
  document.querySelector("#person-card").innerHTML = `
    <p class="card-kicker">Selected border case</p>
    <h3>${person.name}</h3>
    <p>${person.description}</p>
    <div class="route">
      <small>unweighted → weighted</small>
      <strong>${from.name} → ${to.name}</strong>
    </div>
    <dl>
      <div><dt>degree</dt><dd>${fmt(person.degree, 0)}</dd></div>
      <div><dt>strength</dt><dd>${fmt(person.strength, 0)}</dd></div>
      <div><dt>group overlap</dt><dd>${fmt(person.overlap * 100, 1)}%</dd></div>
    </dl>
    <p>
      This is an algorithmic border case, not proof of a historical change.
      Repeated Wikipedia links can reflect real intellectual ties, editorial
      habits, or both.
    </p>
    <a href="${person.url}" target="_blank" rel="noreferrer">Inspect the article ↗</a>
  `;
}

function buildMovers() {
  const movers = state.data.movers.slice(0, 12);
  document.querySelector("#mover-list").innerHTML = movers.map((person, index) => `
    <li>
      <button type="button" data-index="${index}">
        <small>${String(index + 1).padStart(2, "0")}</small>
        <strong>${person.name}</strong>
        <small>k ${person.degree}</small>
      </button>
    </li>
  `).join("");
  document.querySelectorAll(".mover-list button").forEach((button) => {
    button.addEventListener("click", () => renderPerson(Number(button.dataset.index)));
  });
  renderPerson(0);
}

function drawStability() {
  const width = 620;
  const height = 210;
  const margin = { top: 22, right: 24, bottom: 42, left: 105 };
  const sets = [
    { label: "unweighted", y: 65, color: COLORS[1], ...state.data.stability.unweighted },
    { label: "weighted", y: 130, color: COLORS[0], ...state.data.stability.weighted },
  ];
  const x = d3.scaleLinear().domain([.6, .86]).range([margin.left, width - margin.right]);
  const svg = d3.select("#stability-chart").append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  svg.append("g")
    .attr("class", "chart-axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format(".2f")));
  svg.append("text")
    .attr("x", width - margin.right)
    .attr("y", height - 8)
    .attr("text-anchor", "end")
    .attr("font-size", 10)
    .text("NMI between two seeds");

  sets.forEach((set) => {
    svg.append("text")
      .attr("x", margin.left - 15)
      .attr("y", set.y + 4)
      .attr("text-anchor", "end")
      .attr("font-size", 11)
      .attr("font-weight", 700)
      .text(set.label);
    svg.append("line")
      .attr("x1", x(set.minimum)).attr("x2", x(set.maximum))
      .attr("y1", set.y).attr("y2", set.y)
      .attr("stroke", set.color).attr("stroke-width", 4);
    svg.selectAll(`.dot-${set.label}`)
      .data(set.values)
      .join("circle")
      .attr("cx", (d) => x(d))
      .attr("cy", (_, i) => set.y + ((i % 5) - 2) * 3)
      .attr("r", 3)
      .attr("fill", set.color)
      .attr("fill-opacity", .45);
    svg.append("circle")
      .attr("cx", x(set.mean)).attr("cy", set.y).attr("r", 7)
      .attr("fill", set.color).attr("stroke", "#f8f4e9").attr("stroke-width", 2);
  });
}

function drawNull() {
  const values = state.data.null.nmi;
  const observed = state.data.summary.crossNmi;
  const width = 620;
  const height = 210;
  const margin = { top: 22, right: 24, bottom: 42, left: 35 };
  const domain = d3.extent([...values, observed]);
  const x = d3.scaleLinear()
    .domain([domain[0] - .015, domain[1] + .015])
    .range([margin.left, width - margin.right]);
  const bins = d3.bin().domain(x.domain()).thresholds(10)(values);
  const y = d3.scaleLinear()
    .domain([0, d3.max(bins, (d) => d.length)])
    .range([height - margin.bottom, margin.top]);
  const svg = d3.select("#null-chart").append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  svg.append("g").selectAll("rect")
    .data(bins)
    .join("rect")
    .attr("x", (d) => x(d.x0) + 1)
    .attr("y", (d) => y(d.length))
    .attr("width", (d) => Math.max(0, x(d.x1) - x(d.x0) - 2))
    .attr("height", (d) => y(0) - y(d.length))
    .attr("fill", "#b9b2a5");
  svg.append("line")
    .attr("x1", x(observed)).attr("x2", x(observed))
    .attr("y1", margin.top).attr("y2", height - margin.bottom)
    .attr("stroke", COLORS[0]).attr("stroke-width", 4);
  svg.append("text")
    .attr("x", x(observed) - 7).attr("y", margin.top + 9)
    .attr("text-anchor", "end").attr("font-size", 11).attr("font-weight", 700)
    .attr("fill", COLORS[0]).text(`observed ${fmt(observed, 3)}`);
  svg.append("g")
    .attr("class", "chart-axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format(".2f")));
  svg.append("text")
    .attr("x", width - margin.right).attr("y", height - 8)
    .attr("text-anchor", "end").attr("font-size", 10)
    .text("NMI with unweighted partition");
}

function fillVerdict() {
  const summary = state.data.summary;
  const qZ = (summary.weightedQ - summary.nullQMean) / summary.nullQStd;
  const nmiZ = (summary.crossNmi - summary.nullNmiMean) / summary.nullNmiStd;
  document.querySelector("#checks-verdict").textContent =
    `The weighted partition is not “the answer”: its ten-run stability averages ` +
    `${fmt(state.data.stability.weighted.mean, 3)} NMI. But the placement of real ` +
    `weights is informative. It yields Q = ${fmt(summary.weightedQ, 3)}, ` +
    `${fmt(qZ, 1)}σ above weight permutations, and stays ${fmt(nmiZ, 1)}σ closer ` +
    `to the unweighted map than shuffled weights do. Strong ties redraw borders ` +
    `without erasing the network’s broad historical structure.`;
}

async function init() {
  await loadData();
  fillSummary();
  drawAlluvial();
  buildMovers();
  drawStability();
  drawNull();
  fillVerdict();
}

init().catch((error) => {
  console.error(error);
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<p style="padding:1rem;background:#8e2735;color:white">${error.message}</p>`,
  );
});
