"""Freeze English Wikidata labels and aliases for the 303 Marvel characters.

Run once; analyse_week5.py reads the cached data/week5_aliases.json so the
post stays reproducible even if Wikidata changes.
"""

from __future__ import annotations

import csv
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
NODES = ROOT / "data" / "week1_nodes.tsv"
OUTPUT = ROOT / "data" / "week5_aliases.json"
API = "https://www.wikidata.org/w/api.php"
USER_AGENT = "02805-go-nuts-week5/1.0 (DTU course project; s224225@dtu.dk)"


def main() -> None:
    with NODES.open(encoding="utf-8", newline="") as handle:
        rows = (line for line in handle if not line.startswith("#"))
        nodes = list(csv.DictReader(rows, delimiter="\t", quoting=csv.QUOTE_NONE))
    qids = sorted({row["wikidata_id"] for row in nodes})

    entities: dict[str, dict[str, list[str] | str]] = {}
    for start in range(0, len(qids), 50):
        batch = qids[start : start + 50]
        query = urllib.parse.urlencode(
            {
                "action": "wbgetentities",
                "ids": "|".join(batch),
                "props": "labels|aliases",
                "languages": "en",
                "format": "json",
            }
        )
        request = urllib.request.Request(f"{API}?{query}", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.load(response)
        for qid, entity in payload["entities"].items():
            entities[qid] = {
                "label": entity.get("labels", {}).get("en", {}).get("value", ""),
                "aliases": [a["value"] for a in entity.get("aliases", {}).get("en", [])],
            }
        time.sleep(0.5)

    by_node = {row["node_id"]: entities.get(row["wikidata_id"], {}) for row in nodes}
    OUTPUT.write_text(
        json.dumps(
            {
                "source": "Wikidata wbgetentities (en labels + aliases)",
                "fetched": time.strftime("%Y-%m-%d"),
                "nodes": by_node,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"wrote {OUTPUT} for {len(by_node)} nodes")


if __name__ == "__main__":
    main()
