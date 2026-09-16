const COLORS = {
  betweenness: "#d74532",
  degree: "#d4a62a",
  closeness: "#7c4c91",
  random: "#768b87",
};

const state = {
  data: null,
  lens: "betweenness",
  selected: null,
  strategies: new Set(["betweenness", "degree"]),
  removed: 20,
};

const fmt = (value, digits = 2) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);

async function loadData() {
  const response = await fetch("data/week3.json");
  if (!response.ok) throw new Error("Could not load the Week 3 evidence file.");
  state.data = await response.json();
}

function fillSummary() {
  document.querySelectorAll("[data-summary]").forEach((element) => {
    element.textContent = fmt(state.data.summary[element.dataset.summary], 0);
  });
  document.querySelector("#character-list").innerHTML = [...state.data.characters]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((character) => `<option value="${character.name}"></option>`)
    .join("");
}

function scatter() {
  const host = document.querySelector("#broker-scatter");
  host.replaceChildren();
  const width = Math.max(host.clientWidth, 360);
  const height = window.innerWidth < 760 ? 390 : 610;
  const margin = { top: 38, right: 34, bottom: 58, left: 70 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const data = state.data.characters;
  const floor = 0.000005;

  const x = d3
    .scaleLog()
    .domain([1, d3.max(data, (item) => item.degree)])
    .range([0, innerWidth])
    .nice();
  const y =
    state.lens === "betweenness"
      ? d3
          .scaleLog()
          .domain([floor, d3.max(data, (item) => item.betweenness) * 1.25])
          .range([innerHeight, 0])
      : d3
          .scaleLinear()
          .domain(d3.extent(data, (item) => item.zScore))
          .nice()
          .range([innerHeight, 0]);

  const svg = d3.select(host).append("svg").attr("viewBox", `0 0 ${width} ${height}`);
  const plot = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
  plot
    .append("g")
    .attr("class", "grid")
    .call(d3.axisLeft(y).ticks(7).tickSize(-innerWidth).tickFormat(""))
    .call((group) => group.select(".domain").remove());
  plot
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(7, "~g"));
  plot
    .append("g")
    .attr("class", "axis")
    .call(
      state.lens === "betweenness"
        ? d3.axisLeft(y).ticks(7, "~g")
        : d3.axisLeft(y).ticks(7).tickFormat((value) => `${value}σ`),
    );

  if (state.lens === "surprise") {
    plot
      .append("line")
      .attr("x2", innerWidth)
      .attr("y1", y(0))
      .attr("y2", y(0))
      .attr("stroke", "#101d32")
      .attr("stroke-dasharray", "4 4");
  }

  const tooltip = d3.select("body").selectAll(".tooltip").data([null]).join("div").attr("class", "tooltip").style("display", "none");
  plot
    .selectAll("circle")
    .data(data)
    .join("circle")
    .attr("cx", (item) => x(Math.max(1, item.degree)))
    .attr("cy", (item) => y(state.lens === "betweenness" ? Math.max(floor, item.betweenness) : item.zScore))
    .attr("r", (item) => (state.selected?.id === item.id ? 7 : 3.4))
    .attr("fill", (item) => (state.selected?.id === item.id ? "#d74532" : "#3d70aa"))
    .attr("fill-opacity", (item) => (state.selected?.id === item.id ? 1 : .55))
    .attr("stroke", (item) => (state.selected?.id === item.id ? "#101d32" : "none"))
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", (item) => `${item.name}, degree ${item.degree}, z-score ${fmt(item.zScore, 1)}`)
    .on("mouseenter focus", (event, item) => {
      tooltip
        .style("display", "block")
        .html(`<strong>${item.name}</strong><br>degree ${item.degree} · betweenness ${fmt(item.betweenness, 4)} · ${fmt(item.zScore, 1)}σ`);
      moveTooltip(event, tooltip);
    })
    .on("mousemove", (event) => moveTooltip(event, tooltip))
    .on("mouseleave blur", () => tooltip.style("display", "none"))
    .on("click keydown", (event, item) => {
      if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
      selectCharacter(item);
      document.querySelector("#dossier").scrollIntoView({ behavior: "smooth" });
    });

  const labelled = state.data.topSurprises.slice(0, 6);
  plot
    .selectAll(".plot-label")
    .data(labelled)
    .join("text")
    .attr("class", "plot-label")
    .attr("x", (item) => x(Math.max(1, item.degree)) + 7)
    .attr("y", (item) => {
      const full = data.find((character) => character.id === item.id);
      return y(state.lens === "betweenness" ? Math.max(floor, full.betweenness) : full.zScore) - 6;
    })
    .text((item) => item.name);

  svg
    .append("text")
    .attr("x", margin.left + innerWidth / 2)
    .attr("y", height - 10)
    .attr("text-anchor", "middle")
    .attr("font-family", "IBM Plex Mono")
    .attr("font-size", 9)
    .text("connections (degree) · logarithmic");
  svg
    .append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + innerHeight / 2))
    .attr("y", 13)
    .attr("text-anchor", "middle")
    .attr("font-family", "IBM Plex Mono")
    .attr("font-size", 9)
    .text(state.lens === "betweenness" ? "betweenness · logarithmic" : "betweenness surprise · z-score");
}

function moveTooltip(event, tooltip) {
  if (!event.clientX) return;
  tooltip.style("left", `${Math.min(event.clientX + 14, window.innerWidth - 250)}px`).style("top", `${event.clientY + 14}px`);
}

function selectCharacter(character) {
  state.selected = character;
  document.querySelector("#subject-name").textContent = character.name;
  document.querySelector("#subject-source").href = character.url;
  document.querySelector("#subject-z").textContent = fmt(character.zScore, 1);
  document.querySelector("#subject-degree").textContent = fmt(character.degree, 0);
  document.querySelector("#subject-degree-rank").textContent = `degree rank #${character.degreeRank}`;
  document.querySelector("#subject-between").textContent = fmt(character.betweenness, 4);
  document.querySelector("#subject-between-rank").textContent = `broker rank #${character.betweennessRank}`;
  document.querySelector("#subject-null").textContent = fmt(character.nullMean, 4);
  document.querySelector("#subject-stranded").textContent = fmt(character.removal.stranded, 0);
  document.querySelector("#subject-components").textContent = `${character.removal.components} components remain`;
  document.querySelector("#subject-reading").textContent =
    `${character.name} ranks #${character.degreeRank} by direct connections but #${character.betweennessRank} by brokerage. ` +
    `In rewired networks with the exact same degree, expected betweenness is ${fmt(character.nullMean, 4)}. ` +
    `Removing this article strands ${character.removal.stranded} character${character.removal.stranded === 1 ? "" : "s"} outside the largest surviving component.`;
  document.querySelector("#subject-neighbours").innerHTML = character.neighbours
    .slice(0, 8)
    .map((item) => `<div class="contact-row"><span>${item.name}</span><span>k ${item.degree}</span></div>`)
    .join("");
  scatter();
}

function fillShortlist() {
  document.querySelector("#surprise-list").innerHTML = state.data.topSurprises
    .slice(0, 9)
    .map(
      (item) =>
        `<li><button data-subject="${item.id}">${item.name} · ${fmt(item.zScore, 1)}σ</button></li>`,
    )
    .join("");
  document.querySelectorAll("[data-subject]").forEach((button) => {
    button.addEventListener("click", () => {
      selectCharacter(state.data.characters.find((item) => item.id === button.dataset.subject));
    });
  });
}

function attackChart() {
  const host = document.querySelector("#attack-chart");
  host.replaceChildren();
  const width = Math.max(host.clientWidth, 360);
  const height = window.innerWidth < 760 ? 380 : 570;
  const margin = { top: 28, right: 28, bottom: 54, left: 62 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const x = d3.scaleLinear().domain([0, 60]).range([0, innerWidth]);
  const y = d3.scaleLinear().domain([0, state.data.summary.nodes]).range([innerHeight, 0]);
  const svg = d3.select(host).append("svg").attr("viewBox", `0 0 ${width} ${height}`);
  const plot = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  plot
    .append("g")
    .attr("class", "grid")
    .call(d3.axisLeft(y).ticks(6).tickSize(-innerWidth).tickFormat(""))
    .call((group) => group.select(".domain").remove());
  plot.append("g").attr("class", "axis").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x).ticks(7));
  plot.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6));
  plot
    .append("line")
    .attr("x1", x(state.removed))
    .attr("x2", x(state.removed))
    .attr("y2", innerHeight)
    .attr("stroke", "#101d32")
    .attr("stroke-dasharray", "3 4");

  [...state.strategies].forEach((key) => {
    const values = state.data.attacks[key];
    plot
      .append("path")
      .datum(values)
      .attr("fill", "none")
      .attr("stroke", COLORS[key])
      .attr("stroke-width", key === "random" ? 2 : 3)
      .attr("stroke-dasharray", key === "random" ? "6 5" : null)
      .attr("d", d3.line().x((item) => x(item.removed)).y((item) => y(item.giant)));
    const point = values[state.removed];
    plot.append("circle").attr("cx", x(point.removed)).attr("cy", y(point.giant)).attr("r", 5).attr("fill", COLORS[key]);
  });

  svg
    .append("text")
    .attr("x", margin.left + innerWidth / 2)
    .attr("y", height - 9)
    .attr("text-anchor", "middle")
    .attr("font-family", "IBM Plex Mono")
    .attr("font-size", 9)
    .text("characters removed");
  svg
    .append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + innerHeight / 2))
    .attr("y", 12)
    .attr("text-anchor", "middle")
    .attr("font-family", "IBM Plex Mono")
    .attr("font-size", 9)
    .text("characters in largest component");

  const readout = [...state.strategies]
    .map((key) => {
      const giant = state.data.attacks[key][state.removed].giant;
      return `<span style="color:${COLORS[key]}">${key}: <strong>${fmt(giant, 1)}</strong> remain together</span>`;
    })
    .join("<br>");
  document.querySelector("#attack-readout").innerHTML = readout || "Select at least one strategy.";
}

function fillVerdict() {
  const winner = state.data.characters.find((item) => item.id === state.data.summary.topSurprise);
  const neighbourNames = winner.neighbours.map((item) => item.name);
  document.querySelector("#winner-name").textContent = winner.name;
  document.querySelector("#winner-finding").textContent =
    `${winner.name} has only ${winner.degree} links (degree rank #${winner.degreeRank}), yet ranks #${winner.betweennessRank} in betweenness. ` +
    `Its score is ${fmt(winner.zScore, 1)} standard deviations above the degree-preserving null. ` +
    `The local explanation is concrete: it is the only route joining ${neighbourNames.join(" and ")}. ` +
    `That is the post’s main surprise—but the removal lab is the caution: unusual brokerage and catastrophic fragmentation are related questions, not identical ones.`;
}

function bindControls() {
  document.querySelectorAll("[data-lens]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-lens]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.lens = button.dataset.lens;
      scatter();
    });
  });
  document.querySelector("#character-search").addEventListener("change", (event) => {
    const character = state.data.characters.find(
      (item) => item.name.toLowerCase() === event.target.value.trim().toLowerCase(),
    );
    if (character) {
      selectCharacter(character);
      document.querySelector("#dossier").scrollIntoView({ behavior: "smooth" });
    }
  });
  document.querySelectorAll("[data-strategy]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.strategy;
      if (state.strategies.has(key)) state.strategies.delete(key);
      else state.strategies.add(key);
      button.classList.toggle("active");
      attackChart();
    });
  });
  document.querySelector("#remove-slider").addEventListener("input", (event) => {
    state.removed = Number(event.target.value);
    document.querySelector("#remove-count").textContent = state.removed;
    attackChart();
  });

  const deck = document.querySelector(".case-deck");
  const updateProgress = () => {
    const horizontal = deck.scrollWidth > deck.clientWidth + 5;
    const amount = horizontal
      ? deck.scrollLeft / (deck.scrollWidth - deck.clientWidth)
      : window.scrollY / (document.documentElement.scrollHeight - window.innerHeight);
    document.querySelector(".progress").style.width = `${Math.max(0, Math.min(1, amount)) * 100}%`;
  };
  deck.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("scroll", updateProgress, { passive: true });

  let timer;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      scatter();
      attackChart();
    }, 180);
  });
}

async function init() {
  try {
    await loadData();
    fillSummary();
    state.selected = state.data.characters.find((item) => item.id === state.data.summary.topSurprise);
    fillShortlist();
    fillVerdict();
    selectCharacter(state.selected);
    attackChart();
    bindControls();
  } catch (error) {
    console.error(error);
    document.body.insertAdjacentHTML("afterbegin", `<p class="tooltip" style="display:block;top:80px;left:20px">${error.message}</p>`);
  }
}

init();
