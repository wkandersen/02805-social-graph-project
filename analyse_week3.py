"""Generate the reproducible data behind the Week 3 broker-dossier post."""

from __future__ import annotations

import csv
import json
import random
import statistics
from pathlib import Path

import networkx as nx

ROOT = Path(__file__).parent
DATA = ROOT / "data"
OUTPUT = ROOT / "docs" / "week3" / "data" / "week3.json"
SEED = 20260916
NULL_SAMPLES = 80
SWAPS_PER_EDGE = 3
ATTACK_STEPS = 60
RANDOM_ATTACKS = 120


def read_nodes() -> dict[str, dict[str, str]]:
    with (DATA / "week1_nodes.tsv").open(encoding="utf-8", newline="") as handle:
        rows = (line for line in handle if not line.startswith("#"))
        return {
            row["node_id"]: row
            for row in csv.DictReader(rows, delimiter="\t", quoting=csv.QUOTE_NONE)
        }


def read_edges() -> list[tuple[str, str]]:
    with (DATA / "week1_edges.tsv").open(encoding="utf-8", newline="") as handle:
        rows = (line for line in handle if not line.startswith("#"))
        return [tuple(row) for row in csv.reader(rows, delimiter="\t")]


def ranks(values: dict[str, float | int]) -> dict[str, int]:
    ordered = sorted(values, key=lambda node: (-values[node], node))
    return {node: index + 1 for index, node in enumerate(ordered)}


def removal_result(graph: nx.Graph, node: str) -> dict[str, int | list[int]]:
    reduced = graph.copy()
    reduced.remove_node(node)
    sizes = sorted((len(component) for component in nx.connected_components(reduced)), reverse=True)
    return {
        "giant": sizes[0],
        "stranded": graph.number_of_nodes() - 1 - sizes[0],
        "components": len(sizes),
        "fragmentSizes": sizes[1:8],
    }


def attack_curve(graph: nx.Graph, order: list[str]) -> list[dict[str, int]]:
    attacked = graph.copy()
    points = [{"removed": 0, "giant": attacked.number_of_nodes(), "components": 1}]
    for count, node in enumerate(order[:ATTACK_STEPS], start=1):
        attacked.remove_node(node)
        components = list(nx.connected_components(attacked))
        points.append(
            {
                "removed": count,
                "giant": max(map(len, components), default=0),
                "components": len(components),
            }
        )
    return points


def random_attack_curve(graph: nx.Graph) -> list[dict[str, float | int]]:
    rng = random.Random(SEED)
    runs: list[list[int]] = []
    nodes = list(graph)
    for _ in range(RANDOM_ATTACKS):
        order = rng.sample(nodes, len(nodes))
        runs.append([point["giant"] for point in attack_curve(graph, order)])
    return [
        {
            "removed": removed,
            "giant": statistics.mean(run[removed] for run in runs),
        }
        for removed in range(ATTACK_STEPS + 1)
    ]


def main() -> None:
    metadata = read_nodes()
    directed = nx.DiGraph()
    directed.add_nodes_from(metadata)
    directed.add_edges_from(read_edges())
    undirected = directed.to_undirected()
    giant_nodes = max(nx.connected_components(undirected), key=len)
    graph = undirected.subgraph(giant_nodes).copy()

    assert directed.number_of_nodes() == 303
    assert directed.number_of_edges() == 1_784
    assert undirected.number_of_edges() == 1_434
    assert nx.number_of_isolates(undirected) == 17
    assert graph.number_of_nodes() == 277
    assert graph.number_of_edges() == 1_421

    degree = dict(graph.degree())
    closeness = nx.closeness_centrality(graph)
    betweenness = nx.betweenness_centrality(graph)
    degree_rank = ranks(degree)
    betweenness_rank = ranks(betweenness)

    null_values = {node: [] for node in graph}
    shuffled = graph.copy()
    for sample in range(NULL_SAMPLES):
        nx.double_edge_swap(
            shuffled,
            nswap=SWAPS_PER_EDGE * shuffled.number_of_edges(),
            max_tries=100 * shuffled.number_of_edges(),
            seed=SEED + sample,
        )
        assert dict(shuffled.degree()) == degree
        sample_betweenness = nx.betweenness_centrality(shuffled)
        for node, value in sample_betweenness.items():
            null_values[node].append(value)

    characters = []
    for node in graph:
        expected = statistics.mean(null_values[node])
        deviation = statistics.stdev(null_values[node])
        z_score = (betweenness[node] - expected) / deviation if deviation else 0.0
        neighbours = sorted(
            graph.neighbors(node),
            key=lambda neighbour: (-degree[neighbour], metadata[neighbour]["name"]),
        )
        characters.append(
            {
                "id": node,
                "name": metadata[node]["name"],
                "url": metadata[node]["url"],
                "degree": degree[node],
                "degreeRank": degree_rank[node],
                "closeness": closeness[node],
                "betweenness": betweenness[node],
                "betweennessRank": betweenness_rank[node],
                "nullMean": expected,
                "nullStd": deviation,
                "zScore": z_score,
                "removal": removal_result(graph, node),
                "neighbours": [
                    {
                        "id": neighbour,
                        "name": metadata[neighbour]["name"],
                        "degree": degree[neighbour],
                    }
                    for neighbour in neighbours
                ],
            }
        )

    by_surprise = sorted(characters, key=lambda item: item["zScore"], reverse=True)
    attack_orders = {
        "degree": sorted(graph, key=lambda node: (-degree[node], node)),
        "betweenness": sorted(graph, key=lambda node: (-betweenness[node], node)),
        "closeness": sorted(graph, key=lambda node: (-closeness[node], node)),
    }
    output = {
        "seed": SEED,
        "representation": {
            "node": "a Marvel superhero Wikipedia article",
            "edge": "an undirected pair when either article links to the other",
            "scope": "the 277-character giant component",
            "weighted": False,
            "directed": False,
        },
        "summary": {
            "nodes": graph.number_of_nodes(),
            "edges": graph.number_of_edges(),
            "meanDegree": 2 * graph.number_of_edges() / graph.number_of_nodes(),
            "nullSamples": NULL_SAMPLES,
            "topSurprise": by_surprise[0]["id"],
            "topSurpriseName": by_surprise[0]["name"],
            "topSurpriseZ": by_surprise[0]["zScore"],
        },
        "characters": characters,
        "topSurprises": [
            {
                "id": item["id"],
                "name": item["name"],
                "degree": item["degree"],
                "betweenness": item["betweenness"],
                "zScore": item["zScore"],
            }
            for item in by_surprise[:12]
        ],
        "attacks": {
            key: attack_curve(graph, order) for key, order in attack_orders.items()
        }
        | {"random": random_attack_curve(graph)},
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {OUTPUT.relative_to(ROOT)}: "
        f"top surprise={by_surprise[0]['name']} "
        f"(degree {by_surprise[0]['degree']}, z={by_surprise[0]['zScore']:.1f}); "
        f"{NULL_SAMPLES} degree-preserving nulls"
    )


if __name__ == "__main__":
    main()
