"""Build the data products used by the Week 1 GitHub Pages story."""

from __future__ import annotations

import csv
import json
import math
import statistics
from collections import Counter
from pathlib import Path

import networkx as nx

ZETA_CAP = 20_000


ROOT = Path(__file__).parent
DATA = ROOT / "data"
OUTPUT = ROOT / "docs" / "week1" / "data"


def read_nodes() -> list[dict[str, str]]:
    with (DATA / "week1_nodes.tsv").open(encoding="utf-8", newline="") as handle:
        rows = (line for line in handle if not line.startswith("#"))
        return list(csv.DictReader(rows, delimiter="\t", quoting=csv.QUOTE_NONE))


def read_edges() -> list[tuple[str, str]]:
    with (DATA / "week1_edges.tsv").open(encoding="utf-8", newline="") as handle:
        rows = (line for line in handle if not line.startswith("#"))
        return [tuple(row) for row in csv.reader(rows, delimiter="\t")]


def degree_distribution(values: list[int]) -> list[dict[str, int | float]]:
    counts = Counter(values)
    total = len(values)
    return [
        {"degree": degree, "count": count, "probability": count / total}
        for degree, count in sorted(counts.items())
    ]


def logarithmic_bins(values: list[int]) -> list[dict[str, int | float]]:
    """Course binning scheme: width-1 bins over u = k + 1, then doubling widths."""
    shifted = [value + 1 for value in values]
    counts = Counter(shifted)
    total = len(shifted)
    largest = max(shifted)

    edges = [(u, u) for u in range(1, 8)]
    low = 8
    while low <= largest:
        edges.append((low, 2 * low - 1))
        low *= 2

    bins = []
    for low, high in edges:
        if low > largest:
            break
        count = sum(counts[u] for u in range(low, high + 1))
        width = high - low + 1
        bins.append(
            {
                "low": low,
                "high": high,
                "width": width,
                "count": count,
                # geometric mean of the integers covered: the only honest
                # position for a bin on a logarithmic axis
                "center": math.sqrt(low * high),
                "density": count / (total * width),
            }
        )
    return bins


def _suffix_zeta(alpha: float) -> list[float]:
    """suffix[k] = sum over j >= k of j ** -alpha, truncated at ZETA_CAP."""
    suffix = [0.0] * (ZETA_CAP + 2)
    for k in range(ZETA_CAP, 0, -1):
        suffix[k] = suffix[k + 1] + k**-alpha
    return suffix


def _mle_alpha(tail: list[int], k_min: int) -> float:
    total = sum(math.log(value / (k_min - 0.5)) for value in tail)
    return 1.0 + len(tail) / total


def power_law_fit(values: list[int]) -> dict[str, float | int | list] | None:
    """Discrete power-law MLE with a Clauset-style k_min chosen by KS distance.

    Fitted on the raw degrees, never on binned or shifted values.
    """
    positive = sorted(value for value in values if value > 0)
    if len(positive) < 50:
        return None

    best = None
    for k_min in sorted({value for value in positive if value <= max(positive) // 4}):
        tail = [value for value in positive if value >= k_min]
        if len(tail) < 30:
            continue

        alpha = _mle_alpha(tail, k_min)
        suffix = _suffix_zeta(alpha)
        normaliser = suffix[k_min]
        size = len(tail)
        distance = max(
            abs(
                (size - index) / size  # empirical P(X >= k)
                - suffix[min(value, ZETA_CAP)] / normaliser
            )
            for index, value in enumerate(tail)
        )

        if best is None or distance < best["ksDistance"]:
            best = {
                "alpha": alpha,
                "kMin": k_min,
                "tailCount": size,
                "tailShare": size / len(values),
                "ksDistance": distance,
            }

    if best is None:
        return None

    suffix = _suffix_zeta(best["alpha"])
    scale = best["tailShare"] / suffix[best["kMin"]]
    best["curve"] = [
        {"degree": degree, "probability": scale * degree ** -best["alpha"]}
        for degree in range(best["kMin"], max(positive) + 1)
    ]
    return best


def main() -> None:
    nodes = read_nodes()
    edges = read_edges()
    metadata = {node["node_id"]: node for node in nodes}

    graph = nx.DiGraph()
    graph.add_nodes_from(metadata)
    graph.add_edges_from(edges)
    undirected = graph.to_undirected()

    assert graph.number_of_nodes() == 303
    assert graph.number_of_edges() == 1_784
    assert undirected.number_of_edges() == 1_434
    assert nx.number_of_isolates(undirected) == 17

    components = sorted(nx.connected_components(undirected), key=len, reverse=True)
    giant = components[0]
    communities = list(
        nx.community.greedy_modularity_communities(undirected.subgraph(giant))
    )
    community_by_node = {
        node_id: index
        for index, community in enumerate(communities)
        for node_id in community
    }

    in_degrees = dict(graph.in_degree())
    out_degrees = dict(graph.out_degree())
    total_degrees = dict(undirected.degree())
    reciprocity = graph.to_undirected(reciprocal=True)

    def ranked(degrees: dict[str, int], limit: int = 10) -> list[dict[str, int | str]]:
        return [
            {"id": node_id, "name": metadata[node_id]["name"], "degree": degree}
            for node_id, degree in sorted(
                degrees.items(),
                key=lambda item: (-item[1], metadata[item[0]]["name"]),
            )[:limit]
        ]

    island = components[1]
    isolates = sorted(
        nx.isolates(undirected), key=lambda node_id: metadata[node_id]["name"]
    )
    top_in_id = max(in_degrees, key=in_degrees.get)
    top_out_id = max(out_degrees, key=out_degrees.get)

    network = {
        "nodes": [
            {
                "id": node_id,
                "name": node["name"],
                "url": node["url"],
                "description": node["description"],
                "inDegree": in_degrees[node_id],
                "outDegree": out_degrees[node_id],
                "degree": total_degrees[node_id],
                "community": community_by_node.get(node_id, -1),
                "component": components.index(
                    next(component for component in components if node_id in component)
                ),
            }
            for node_id, node in metadata.items()
        ],
        "links": [{"source": source, "target": target} for source, target in edges],
    }

    insights = {
        "snapshot": "2026-08-26",
        "nodes": graph.number_of_nodes(),
        "directedEdges": graph.number_of_edges(),
        "undirectedEdges": undirected.number_of_edges(),
        "reciprocalPairs": reciprocity.number_of_edges(),
        "density": nx.density(undirected),
        "meanInDegree": sum(in_degrees.values()) / len(in_degrees),
        "meanOutDegree": sum(out_degrees.values()) / len(out_degrees),
        "meanUndirectedDegree": sum(total_degrees.values()) / len(total_degrees),
        "inOutCorrelation": statistics.correlation(
            list(in_degrees.values()), list(out_degrees.values())
        ),
        "isolates": len(isolates),
        "giantComponent": len(giant),
        "island": [
            {"id": node_id, "name": metadata[node_id]["name"]}
            for node_id in sorted(island, key=lambda item: metadata[item]["name"])
        ],
        "isolateNames": [metadata[node_id]["name"] for node_id in isolates],
        "topIn": ranked(in_degrees),
        "topOut": ranked(out_degrees),
        "topUndirected": ranked(total_degrees),
        "topInOutDifference": {
            "in": {
                "name": metadata[top_in_id]["name"],
                "inDegree": in_degrees[top_in_id],
                "outDegree": out_degrees[top_in_id],
            },
            "out": {
                "name": metadata[top_out_id]["name"],
                "inDegree": in_degrees[top_out_id],
                "outDegree": out_degrees[top_out_id],
            },
        },
        "distributions": {
            "in": degree_distribution(list(in_degrees.values())),
            "out": degree_distribution(list(out_degrees.values())),
            "undirected": degree_distribution(list(total_degrees.values())),
        },
        "binned": {
            "in": logarithmic_bins(list(in_degrees.values())),
            "out": logarithmic_bins(list(out_degrees.values())),
            "undirected": logarithmic_bins(list(total_degrees.values())),
        },
        "powerLaw": {
            "in": power_law_fit(list(in_degrees.values())),
            "out": power_law_fit(list(out_degrees.values())),
            "undirected": power_law_fit(list(total_degrees.values())),
        },
    }

    for degree_type, bins in insights["binned"].items():
        raw = {point["degree"]: point["probability"] for point in insights["distributions"][degree_type]}
        for bin_ in bins:
            if bin_["width"] != 1:
                continue
            assert math.isclose(bin_["density"], raw.get(bin_["low"] - 1, 0.0))

    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "network.json").write_text(
        json.dumps(network, separators=(",", ":")), encoding="utf-8"
    )
    (OUTPUT / "insights.json").write_text(
        json.dumps(insights, indent=2), encoding="utf-8"
    )

    print(
        f"Wrote {len(network['nodes'])} nodes, {len(network['links'])} links, "
        f"and {len(components)} components to {OUTPUT.relative_to(ROOT)}/"
    )


if __name__ == "__main__":
    main()
