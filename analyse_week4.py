"""Generate Week 4's weighted-vs-unweighted community story."""

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
OUTPUT = ROOT / "docs" / "week4" / "data" / "week4.json"
SEEDS = range(10)
NULL_SAMPLES = 30


def data_file(name: str) -> Path:
    candidates = [ROOT / "data" / name, ROOT.parent / "uge4" / name]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        f"Missing {name}. Download it from the 02805 data page into {ROOT / 'data'}."
    )


def read_nodes() -> dict[str, dict[str, str]]:
    with data_file("week4_philosophers_nodes.tsv").open(
        encoding="utf-8", newline=""
    ) as handle:
        rows = (line for line in handle if not line.startswith("#"))
        return {
            row["node_id"]: row
            for row in csv.DictReader(rows, delimiter="\t", quoting=csv.QUOTE_NONE)
        }


def read_graph(nodes: dict[str, dict[str, str]]) -> nx.Graph:
    graph = nx.Graph()
    graph.add_nodes_from(nodes)
    with data_file("week4_philosophers_edges.tsv").open(
        encoding="utf-8", newline=""
    ) as handle:
        rows = (line for line in handle if not line.startswith("#"))
        for row in csv.DictReader(rows, delimiter="\t", quoting=csv.QUOTE_NONE):
            source, target, weight = row["source"], row["target"], int(row["weight"])
            if graph.has_edge(source, target):
                graph[source][target]["weight"] += weight
            else:
                graph.add_edge(source, target, weight=weight)
    return graph


def labels_from(communities: list[set[str]], nodes: list[str]) -> list[int]:
    membership = {
        node: community
        for community, members in enumerate(communities)
        for node in members
    }
    return [membership[node] for node in nodes]


def nmi(labels_a: list[int], labels_b: list[int]) -> float:
    """Arithmetic-mean normalized mutual information, matching sklearn's default."""
    n = len(labels_a)
    count_a, count_b = Counter(labels_a), Counter(labels_b)
    joint = Counter(zip(labels_a, labels_b))
    mutual_information = sum(
        count / n * math.log((n * count) / (count_a[a] * count_b[b]))
        for (a, b), count in joint.items()
    )
    entropy_a = -sum((count / n) * math.log(count / n) for count in count_a.values())
    entropy_b = -sum((count / n) * math.log(count / n) for count in count_b.values())
    return 2 * mutual_information / (entropy_a + entropy_b)


def detect(graph: nx.Graph, seed: int, weight: str | None) -> list[set[str]]:
    communities = nx.community.louvain_communities(graph, seed=seed, weight=weight)
    return sorted((set(group) for group in communities), key=len, reverse=True)


def describe_partition(
    communities: list[set[str]],
    graph: nx.Graph,
    metadata: dict[str, dict[str, str]],
    weight: str | None,
) -> list[dict[str, object]]:
    measure = dict(graph.degree(weight=weight))
    output = []
    for index, members in enumerate(communities):
        leaders = sorted(members, key=lambda node: (-measure[node], metadata[node]["name"]))[:5]
        era = Counter(metadata[node]["era"] for node in members).most_common(1)[0]
        output.append(
            {
                "id": index,
                "name": metadata[leaders[0]]["name"],
                "size": len(members),
                "leaders": [metadata[node]["name"] for node in leaders],
                "era": era[0],
                "eraShare": era[1] / len(members),
            }
        )
    return output


def stability(
    partitions: list[list[set[str]]], nodes: list[str]
) -> dict[str, float | list[float]]:
    labels = [labels_from(partition, nodes) for partition in partitions]
    values = [
        nmi(labels[left], labels[right])
        for left in range(len(labels))
        for right in range(left + 1, len(labels))
    ]
    return {
        "minimum": min(values),
        "mean": statistics.mean(values),
        "maximum": max(values),
        "values": values,
    }


def main() -> None:
    metadata = read_nodes()
    full_graph = read_graph(metadata)
    giant_nodes = max(nx.connected_components(full_graph), key=len)
    graph = full_graph.subgraph(giant_nodes).copy()

    assert full_graph.number_of_nodes() == 1_444
    assert full_graph.number_of_edges() == 9_140
    assert graph.number_of_nodes() == 1_374
    assert graph.number_of_edges() == 9_139

    nodes = sorted(graph)
    unweighted_runs = [detect(graph, seed, None) for seed in SEEDS]
    weighted_runs = [detect(graph, seed, "weight") for seed in SEEDS]
    unweighted, weighted = unweighted_runs[0], weighted_runs[0]
    unweighted_labels = labels_from(unweighted, nodes)
    weighted_labels = labels_from(weighted, nodes)

    degree = dict(graph.degree())
    strength = dict(graph.degree(weight="weight"))
    unweighted_membership = dict(zip(nodes, unweighted_labels))
    weighted_membership = dict(zip(nodes, weighted_labels))
    transitions = Counter(zip(unweighted_labels, weighted_labels))

    overlap = {}
    for node in nodes:
        left = unweighted[unweighted_membership[node]]
        right = weighted[weighted_membership[node]]
        overlap[node] = len(left & right) / len(left | right)

    movers = sorted(
        nodes,
        key=lambda node: (-(degree[node] * (1 - overlap[node])), node),
    )[:40]
    mover_rows = [
        {
            "id": node,
            "name": metadata[node]["name"],
            "url": metadata[node]["url"],
            "degree": degree[node],
            "strength": strength[node],
            "overlap": overlap[node],
            "from": unweighted_membership[node],
            "to": weighted_membership[node],
            "description": metadata[node]["description"],
        }
        for node in movers
    ]

    edge_weights = [data["weight"] for _, _, data in graph.edges(data=True)]
    rng = random.Random(20260923)
    null_nmis = []
    null_qs = []
    null_graph = graph.copy()
    edge_pairs = list(null_graph.edges())
    for sample in range(NULL_SAMPLES):
        shuffled_weights = edge_weights.copy()
        rng.shuffle(shuffled_weights)
        nx.set_edge_attributes(
            null_graph,
            dict(zip(edge_pairs, shuffled_weights)),
            "weight",
        )
        partition = detect(null_graph, 10_000 + sample, "weight")
        null_nmis.append(nmi(unweighted_labels, labels_from(partition, nodes)))
        null_qs.append(nx.community.modularity(null_graph, partition, weight="weight"))

    unweighted_info = describe_partition(unweighted, graph, metadata, None)
    weighted_info = describe_partition(weighted, graph, metadata, "weight")
    cross_nmi = nmi(unweighted_labels, weighted_labels)
    output = {
        "representation": {
            "node": "a Wikipedia article about a philosopher born before 1900",
            "edge": "an undirected pair when either article links to the other",
            "weight": "the total number of article-text links in both directions",
            "scope": "the 1,374-node giant component",
        },
        "summary": {
            "nodes": graph.number_of_nodes(),
            "edges": graph.number_of_edges(),
            "totalWeight": sum(edge_weights),
            "unweightedCommunities": len(unweighted),
            "weightedCommunities": len(weighted),
            "unweightedQ": nx.community.modularity(graph, unweighted, weight=None),
            "weightedQ": nx.community.modularity(graph, weighted, weight="weight"),
            "crossNmi": cross_nmi,
            "nullNmiMean": statistics.mean(null_nmis),
            "nullNmiStd": statistics.stdev(null_nmis),
            "nullQMean": statistics.mean(null_qs),
            "nullQStd": statistics.stdev(null_qs),
            "nullSamples": NULL_SAMPLES,
        },
        "unweighted": unweighted_info,
        "weighted": weighted_info,
        "transitions": [
            {"source": source, "target": target, "count": count}
            for (source, target), count in sorted(transitions.items())
        ],
        "movers": mover_rows,
        "stability": {
            "unweighted": stability(unweighted_runs, nodes),
            "weighted": stability(weighted_runs, nodes),
        },
        "null": {"nmi": null_nmis, "modularity": null_qs},
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {OUTPUT.relative_to(ROOT)}: NMI={cross_nmi:.3f}; "
        f"weight-shuffle NMI={statistics.mean(null_nmis):.3f}±"
        f"{statistics.stdev(null_nmis):.3f}"
    )


if __name__ == "__main__":
    main()
