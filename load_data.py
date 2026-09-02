import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

import networkx as nx
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parent
DATA_DIR = PROJECT_ROOT / "data"


def load_graph(data_dir=DATA_DIR):
    """Load the Marvel node and edge tables and build both graph views."""
    data_dir = Path(data_dir)
    nodes = pd.read_csv(
        data_dir / "week1_nodes.tsv",
        sep="\t",
        comment="#",
        quoting=3,
    )
    edges = pd.read_csv(
        data_dir / "week1_edges.tsv",
        sep="\t",
        comment="#",
        names=["source", "target"],
    )

    graph = nx.DiGraph()
    graph.add_nodes_from(nodes.node_id)
    graph.add_edges_from(edges.itertuples(index=False, name=None))
    return nodes, edges, graph, graph.to_undirected()


def _wikipedia_summary(row):
    page_title = urlparse(row["url"]).path.rsplit("/", 1)[-1]
    summary_url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + quote(page_title, safe="")
    request = Request(summary_url, headers={"User-Agent": "02806-social-graph-project/1.0"})
    try:
        with urlopen(request, timeout=8) as response:
            summary = json.load(response).get("extract")
            if summary:
                return row["node_id"], summary
    except Exception:
        pass
    return row["node_id"], row["description"]


def enrich_descriptions(nodes, workers=8):
    """Use Wikipedia summaries for richer character descriptions when available."""
    descriptions = {}
    with ThreadPoolExecutor(max_workers=workers) as executor:
        for node_id, description in executor.map(_wikipedia_summary, nodes.to_dict(orient="records")):
            descriptions[node_id] = description
    enriched = nodes.copy()
    enriched["description"] = enriched["node_id"].map(descriptions)
    return enriched


def export_browser_data(output_path=PROJECT_ROOT / "docs" / "graph-data.json"):
    """Export the shared graph data in the format used by the website."""
    nodes, edges, graph, undirected_graph = load_graph()
    nodes = enrich_descriptions(nodes)
    communities = sorted(
        nx.community.louvain_communities(undirected_graph, seed=42),
        key=lambda members: (-len(members), sorted(members)[0]),
    )
    community_by_node = {}
    community_info = []
    for community_id, members in enumerate(communities):
        representative = max(
            members,
            key=lambda node_id: (undirected_graph.degree(node_id), str(node_id)),
        )
        label = f"{nodes.loc[nodes.node_id == representative, 'name'].iloc[0]} & co." if len(members) > 1 else nodes.loc[nodes.node_id == representative, 'name'].iloc[0]
        for node_id in members:
            community_by_node[node_id] = community_id
        community_info.append({"id": community_id, "label": label, "size": len(members)})
    nodes["community_id"] = nodes["node_id"].map(community_by_node)
    nodes["community_label"] = nodes["community_id"].map(
        {item["id"]: item["label"] for item in community_info}
    )
    node_records = nodes.where(pd.notna(nodes), None).to_dict(orient="records")
    payload = {
        "nodes": node_records,
        "edges": edges.to_dict(orient="records"),
        "stats": {
            "nodes": graph.number_of_nodes(),
            "edges": graph.number_of_edges(),
            "weak_components": nx.number_weakly_connected_components(graph),
            "largest_component": max((len(component) for component in nx.weakly_connected_components(graph)), default=0),
            "reciprocity": nx.reciprocity(graph) or 0,
            "density": nx.density(graph),
            "undirected_edges": undirected_graph.number_of_edges(),
            "undirected_components": nx.number_connected_components(undirected_graph),
            "undirected_largest_component": max((len(component) for component in nx.connected_components(undirected_graph)), default=0),
            "undirected_density": nx.density(undirected_graph),
            "communities": community_info,
        },
    }
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")
    return output_path


nodes, edges, G, G_undirected = load_graph()


if __name__ == "__main__":
    print(f"Loaded {G.number_of_nodes()} nodes and {G.number_of_edges()} edges")
    print(f"Browser data written to {export_browser_data()}")