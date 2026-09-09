"""Generate the reproducible data behind the Week 2 model-detective post."""

from __future__ import annotations

import csv
import json
import math
import random
import statistics
from collections import Counter
from pathlib import Path

import networkx as nx

ROOT = Path(__file__).parent
DATA = ROOT / "data"
OUTPUT = ROOT / "docs" / "data" / "week2.json"
SEED = 20260909
NULL_SAMPLES = 120


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


def ccdf(graph: nx.Graph) -> list[dict[str, float | int]]:
    degrees = [degree for _, degree in graph.degree()]
    counts = Counter(degrees)
    total = len(degrees)
    remaining = total
    result = []
    for degree in range(max(degrees) + 1):
        result.append({"degree": degree, "probability": remaining / total})
        remaining -= counts[degree]
    return result


def graph_metrics(graph: nx.Graph) -> dict[str, float | int]:
    largest = graph.subgraph(max(nx.connected_components(graph), key=len))
    degrees = [degree for _, degree in graph.degree()]
    return {
        "nodes": graph.number_of_nodes(),
        "edges": graph.number_of_edges(),
        "meanDegree": statistics.mean(degrees),
        "maxDegree": max(degrees),
        "degreeVariance": statistics.pvariance(degrees),
        "clustering": nx.average_clustering(graph),
        "transitivity": nx.transitivity(graph),
        "averageDistance": nx.average_shortest_path_length(largest),
        "giantShare": largest.number_of_nodes() / graph.number_of_nodes(),
        "isolates": nx.number_of_isolates(graph),
    }


def serialise_graph(
    graph: nx.Graph,
    metadata: dict[str, dict[str, str]] | None = None,
) -> dict[str, list[dict] | list[list]]:
    degrees = dict(graph.degree())
    ranked = {
        node: rank
        for rank, (node, _) in enumerate(
            sorted(degrees.items(), key=lambda item: item[1], reverse=True)
        )
    }
    nodes = []
    for node in graph:
        source = metadata.get(str(node), {}) if metadata else {}
        nodes.append(
            {
                "id": str(node),
                "name": source.get("name", f"Node {node}"),
                "degree": degrees[node],
                "rank": ranked[node],
            }
        )
    return {
        "nodes": nodes,
        "links": [[str(source), str(target)] for source, target in graph.edges()],
    }


def make_models(real: nx.Graph) -> dict[str, nx.Graph]:
    n = real.number_of_nodes()
    m = real.number_of_edges()
    mean_degree = 2 * m / n
    even_k = max(2, 2 * round(mean_degree / 2))
    ba_m = max(1, round(mean_degree / 2))
    return {
        "marvel": real.copy(),
        "random": nx.gnm_random_graph(n, m, seed=SEED),
        "smallWorld": nx.watts_strogatz_graph(n, even_k, 0.2, seed=SEED),
        "preferential": nx.barabasi_albert_graph(n, ba_m, seed=SEED),
    }


def degree_preserving_null(real: nx.Graph) -> list[float]:
    shuffled = real.copy()
    values = []
    for index in range(NULL_SAMPLES):
        nx.double_edge_swap(
            shuffled,
            nswap=3 * shuffled.number_of_edges(),
            max_tries=100 * shuffled.number_of_edges(),
            seed=SEED + index,
        )
        values.append(nx.average_clustering(shuffled))
    return values


def shuffle_snapshots(real: nx.Graph) -> list[dict]:
    shuffled = real.copy()
    snapshots = [
        {
            "swaps": 0,
            "clustering": nx.average_clustering(shuffled),
            "links": [[str(a), str(b)] for a, b in shuffled.edges()],
        }
    ]
    completed = 0
    for target in [50, 250, 1_000, 5_000, 15_000]:
        nx.double_edge_swap(
            shuffled,
            nswap=target - completed,
            max_tries=100 * (target - completed),
            seed=SEED + target,
        )
        completed = target
        snapshots.append(
            {
                "swaps": target,
                "clustering": nx.average_clustering(shuffled),
                "links": [[str(a), str(b)] for a, b in shuffled.edges()],
            }
        )
    return snapshots


def main() -> None:
    random.seed(SEED)
    metadata = read_nodes()
    directed = nx.DiGraph()
    directed.add_nodes_from(metadata)
    directed.add_edges_from(read_edges())
    undirected = directed.to_undirected()
    giant_nodes = max(nx.connected_components(undirected), key=len)
    real = undirected.subgraph(giant_nodes).copy()

    assert directed.number_of_nodes() == 303
    assert directed.number_of_edges() == 1_784
    assert undirected.number_of_edges() == 1_434
    assert len(giant_nodes) == 277
    assert nx.number_of_isolates(undirected) == 17

    models = make_models(real)
    null_values = degree_preserving_null(real)
    real_clustering = nx.average_clustering(real)
    null_mean = statistics.mean(null_values)
    null_std = statistics.stdev(null_values)
    extreme = sum(value >= real_clustering for value in null_values)

    model_data = {}
    for key, graph in models.items():
        model_data[key] = {
            "metrics": graph_metrics(graph),
            "ccdf": ccdf(graph),
            "graph": serialise_graph(
                graph, metadata if key == "marvel" else None
            ),
        }

    degrees = dict(real.degree())
    popular_friends = []
    for node in real:
        neighbours = list(real.neighbors(node))
        if not neighbours:
            continue
        mean_friend_degree = statistics.mean(degrees[friend] for friend in neighbours)
        popular_friends.append(
            {
                "id": node,
                "name": metadata[node]["name"],
                "degree": degrees[node],
                "meanFriendDegree": mean_friend_degree,
                "paradox": mean_friend_degree - degrees[node],
            }
        )

    output = {
        "seed": SEED,
        "representation": {
            "node": "a Marvel superhero Wikipedia article",
            "edge": "an undirected pair formed when either article links to the other",
            "scope": "the 277-character giant component",
            "weighted": False,
        },
        "models": model_data,
        "null": {
            "values": null_values,
            "mean": null_mean,
            "standardDeviation": null_std,
            "real": real_clustering,
            "zScore": (real_clustering - null_mean) / null_std,
            "empiricalP": (extreme + 1) / (NULL_SAMPLES + 1),
            "samples": NULL_SAMPLES,
            "snapshots": shuffle_snapshots(real),
        },
        "friendship": {
            "people": sorted(popular_friends, key=lambda item: item["paradox"], reverse=True),
            "meanDegree": statistics.mean(degrees.values()),
            "meanNeighborDegree": sum(value * value for value in degrees.values())
            / sum(degrees.values()),
            "variancePrediction": statistics.mean(degrees.values())
            + statistics.pvariance(degrees.values()) / statistics.mean(degrees.values()),
        },
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {OUTPUT.relative_to(ROOT)}: "
        f"real C={real_clustering:.3f}, null C={null_mean:.3f}±{null_std:.3f}, "
        f"z={output['null']['zScore']:.1f}, p={output['null']['empiricalP']:.4f}"
    )


if __name__ == "__main__":
    main()
