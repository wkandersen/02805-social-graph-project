"""Week 5: read the sentence behind every Marvel link and type it.

For each directed link A -> B we find the sentences on A's page that name B
(by title, Wikidata alias, or the parenthetical real name in the node blurb),
count relationship words from a small lexicon around the mention, and label
the link foe / ally / family / romance / mixed / none. Then we ask whether
foes sit across Louvain communities more often than friends do.

Writes docs/week5/data/week5.json. The browser re-runs the labelling rule
live, so every number here must match app.js on the default settings.
"""

from __future__ import annotations

import csv
import json
import math
import random
import re
import statistics
import urllib.parse
import warnings
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import networkx as nx
import spacy

ROOT = Path(__file__).parent
DATA = ROOT / "data"
OUTPUT = ROOT / "docs" / "week5" / "data" / "week5.json"
CHECK_TSV = DATA / "week5_human_check.tsv"

SEEDS = range(20)
NULL_SAMPLES = 2000
CHECK_PER_LABEL = 12
CHECK_MAX_SENTENCES = 5
TYPES = ["foe", "ally", "family", "romance"]

LEXICON: dict[str, list[str]] = {
    "foe": [
        "enemy", "archenemy", "nemesis", "foe", "rival", "rivalry", "villain",
        "adversary", "antagonist", "fight", "battle", "defeat", "kill", "murder",
        "attack", "clash", "oppose", "opponent", "capture", "kidnap", "betray",
        "confront", "ambush", "duel", "hunt", "revenge", "vendetta", "assassinate",
        "imprison", "torture", "slay",
    ],
    "ally": [
        "ally", "alliance", "friend", "friendship", "befriend", "teammate",
        "partner", "partnership", "sidekick", "mentor", "protégé", "alongside",
        "help", "aid", "assist", "rescue", "save", "recruit", "join", "member",
        "team", "comrade", "companion", "trust",
    ],
    "family": [
        "father", "mother", "son", "daughter", "brother", "sister", "sibling",
        "twin", "parent", "cousin", "uncle", "aunt", "niece", "nephew",
        "grandfather", "grandmother", "grandson", "granddaughter", "family",
        "stepfather", "stepmother", "stepson", "stepdaughter", "adopt",
        "descendant", "ancestor", "offspring", "heir",
    ],
    "romance": [
        "marry", "marriage", "wife", "husband", "girlfriend", "boyfriend",
        "lover", "love", "romance", "romantic", "romantically", "kiss",
        "fiancé", "fiancée", "affair", "crush", "spouse", "flirt", "wedding",
    ],
}


# ---------------------------------------------------------------- loading

def read_nodes() -> list[dict[str, str]]:
    with (DATA / "week1_nodes.tsv").open(encoding="utf-8", newline="") as handle:
        rows = (line for line in handle if not line.startswith("#"))
        return list(csv.DictReader(rows, delimiter="\t", quoting=csv.QUOTE_NONE))


def read_edges() -> list[tuple[str, str]]:
    with (DATA / "week1_edges.tsv").open(encoding="utf-8") as handle:
        return [
            tuple(line.rstrip("\n").split("\t"))  # type: ignore[misc]
            for line in handle
            if line.strip() and not line.startswith("#")
        ]


def read_weights() -> dict[tuple[str, str], int]:
    path = DATA / "week4_edges_weighted.tsv"
    if not path.exists():
        return {}
    weights = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip() and not line.startswith("#"):
                source, target, weight = line.rstrip("\n").split("\t")
                weights[(source, target)] = int(weight)
    assert len(weights) == 1784, len(weights)
    return weights


def read_pages() -> dict[str, str]:
    with zipfile.ZipFile(DATA / "marvel_pages.zip") as archive:
        return {
            urllib.parse.unquote(name.split("/")[-1][:-4]): archive.read(name).decode("utf-8")
            for name in archive.namelist()
            if name.endswith(".txt") and "README" not in name
        }


# ---------------------------------------------------------------- aliases

def strip_disambiguator(title: str) -> str:
    return re.sub(r"\s*\(.*?\)\s*$", "", title).strip()


def build_aliases(nodes: list[dict[str, str]]) -> dict[str, set[str]]:
    wikidata = json.loads((DATA / "week5_aliases.json").read_text(encoding="utf-8"))["nodes"]
    aliases: dict[str, set[str]] = {}
    for row in nodes:
        names = {
            strip_disambiguator(row["name"]),
            strip_disambiguator(row["node_id"].replace("_", " ")),
        }
        entity = wikidata.get(row["node_id"]) or {}
        if entity.get("label"):
            names.add(strip_disambiguator(entity["label"]))
        names.update(entity.get("aliases", []))
        blurb = re.search(r"\(([^)]*)\)", row["description"])
        if blurb:
            for part in re.split(r",|;| alias | also known as | or ", blurb.group(1)):
                part = part.strip()
                if part and part[0].isupper():
                    names.add(part)
        aliases[row["node_id"]] = {name for name in names if len(name) >= 3}
    return aliases


def display_name(title: str) -> str:
    """Drop generic disambiguators, keep informative ones like '(android)'."""
    return re.sub(
        r"\s*\((?:[^)]*(?:character|comics|Comics|Marvel)[^)]*)\)\s*$", "", title.replace("_", " ")
    ).strip()


def name_pattern(names: set[str]) -> re.Pattern[str] | None:
    if not names:
        return None
    ordered = sorted(names, key=len, reverse=True)
    return re.compile("|".join(r"(?<![\w-])" + re.escape(n) + r"(?![\w-])" for n in ordered))


# ---------------------------------------------------------------- text

def sentences_by_page(pages: dict[str, str]) -> dict[str, list[dict]]:
    """spaCy sentences per page. Paragraph breaks are hard sentence breaks."""
    nlp = spacy.load("en_core_web_sm", disable=["ner"])
    paragraphs: list[tuple[str, str]] = []
    for node_id, text in pages.items():
        for paragraph in text.split("\n"):
            if paragraph.strip():
                paragraphs.append((node_id, paragraph))
    result: dict[str, list[dict]] = defaultdict(list)
    for (node_id, _), doc in zip(
        paragraphs, nlp.pipe((p for _, p in paragraphs), batch_size=256)
    ):
        for sent in doc.sents:
            tokens = [t for t in sent if not t.is_space]
            if not tokens:
                continue
            start = tokens[0].idx
            result[node_id].append(
                {
                    "text": sent.text.strip(),
                    "w": [t.text for t in tokens],
                    "ws": [1 if t.whitespace_ else 0 for t in tokens],
                    "l": [t.lemma_.lower() for t in tokens],
                    "off": [t.idx - start for t in tokens],
                }
            )
    return result


def char_span_to_tokens(offsets: list[int], words: list[str], start: int, end: int) -> tuple[int, int]:
    first = last = None
    for i, (off, word) in enumerate(zip(offsets, words)):
        if off < end and off + len(word) > start:
            first = i if first is None else first
            last = i
    assert first is not None and last is not None
    return first, last


# ---------------------------------------------------------------- labelling

def label_edge(
    evidence: list[dict],
    sentences: list[dict],
    lexicon: dict[str, set[str]],
    mode: str = "lemma",
    window: int | None = None,
) -> tuple[str, dict[str, int]]:
    """One vote per sentence per type; majority wins, ties are 'mixed'.

    Mirrored exactly by labelEdge() in docs/week5/app.js.
    """
    votes = Counter()
    for ev in evidence:
        sent = sentences[ev["s"]]
        keys = sent["l"] if mode == "lemma" else [w.lower() for w in sent["w"]]
        hit = set()
        for i, key in enumerate(keys):
            if sent["mask"][i]:
                continue
            if window is not None:
                distance = min(
                    0 if a <= i <= b else (a - i if i < a else i - b) for a, b in ev["m"]
                )
                if distance > window:
                    continue
            for kind in TYPES:
                if key in lexicon[kind]:
                    hit.add(kind)
        votes.update(hit)
    if not votes:
        return "none", {}
    top = max(votes.values())
    winners = [k for k in TYPES if votes[k] == top]
    return (winners[0] if len(winners) == 1 else "mixed"), dict(votes)


# ---------------------------------------------------------------- stats

def within_share(edges, labels, community) -> dict[str, tuple[int, int]]:
    tally = {k: [0, 0] for k in TYPES + ["mixed", "none"]}
    for (s, t), lab in zip(edges, labels):
        tally[lab][1] += 1
        tally[lab][0] += community[s] == community[t]
    return {k: (v[0], v[1]) for k, v in tally.items()}


def null_test(edges, labels, community, rng, samples=NULL_SAMPLES):
    """Shuffle the type labels over the same set of mention-found links."""
    same = [community[s] == community[t] for s, t in edges]
    observed = within_share(edges, labels, community)
    draws = {k: [] for k in TYPES}
    shuffled = list(labels)
    for _ in range(samples):
        rng.shuffle(shuffled)
        counts = Counter()
        within = Counter()
        for lab, flag in zip(shuffled, same):
            counts[lab] += 1
            within[lab] += flag
        for k in TYPES:
            draws[k].append(within[k] / counts[k] if counts[k] else math.nan)
    out = {}
    for k in TYPES:
        w, n = observed[k]
        share = w / n if n else math.nan
        mean = statistics.fmean(draws[k])
        sd = statistics.pstdev(draws[k])
        lo = sum(d <= share for d in draws[k]) / samples
        hi = sum(d >= share for d in draws[k]) / samples
        out[k] = {
            "n": n,
            "within": w,
            "share": share,
            "null_mean": mean,
            "null_sd": sd,
            "null_lo": sorted(draws[k])[int(0.025 * samples)],
            "null_hi": sorted(draws[k])[int(0.975 * samples)],
            "z": (share - mean) / sd if sd else 0.0,
            "p_two_sided": min(1.0, 2 * min(lo, hi)),
        }
    return out


def cohen_kappa(pairs: list[tuple[str, str]]) -> float:
    n = len(pairs)
    if not n:
        return math.nan
    agree = sum(a == b for a, b in pairs) / n
    left = Counter(a for a, _ in pairs)
    right = Counter(b for _, b in pairs)
    chance = sum(left[k] * right[k] for k in set(left) | set(right)) / n / n
    return (agree - chance) / (1 - chance) if chance < 1 else math.nan


# ---------------------------------------------------------------- main

def main() -> None:
    nodes = read_nodes()
    node_ids = [row["node_id"] for row in nodes]
    edges = read_edges()
    pages = read_pages()
    weights = read_weights()

    G = nx.DiGraph()
    G.add_nodes_from(node_ids)
    G.add_edges_from(edges)
    U = G.to_undirected()
    assert G.number_of_nodes() == 303, G.number_of_nodes()
    assert G.number_of_edges() == 1784, G.number_of_edges()
    assert U.number_of_edges() == 1434, U.number_of_edges()
    assert sum(1 for n in G if G.degree(n) == 0) == 17
    assert set(pages) == set(node_ids), "pages must join on node_id"
    lengths = sorted(len(t) for t in pages.values())
    assert lengths[0] == 1244 and lengths[-1] == 87256, (lengths[0], lengths[-1])
    assert lengths[151] == 7642, lengths[151]

    aliases = build_aliases(nodes)
    all_names = set().union(*aliases.values())
    every_name = name_pattern(all_names)
    assert every_name is not None

    print("running spaCy over 303 pages ...")
    sents = sentences_by_page(pages)

    lexicon = {k: set(v) for k, v in LEXICON.items()}
    shipped: list[dict] = []
    shipped_index: dict[tuple[str, int], int] = {}
    edge_rows: list[dict] = []
    no_alias = no_mention = 0

    for s, t in edges:
        others = set().union(*(aliases[o] for o in G.successors(s) if o != t))
        usable = aliases[t] - aliases[s] - others
        pattern = name_pattern(usable)
        evidence = []
        if pattern is None:
            no_alias += 1
        else:
            for i, sent in enumerate(sents[s]):
                spans = [
                    char_span_to_tokens(sent["off"], sent["w"], m.start(), m.end())
                    for m in pattern.finditer(sent["text"])
                ]
                if not spans:
                    continue
                key = (s, i)
                if key not in shipped_index:
                    mask = [0] * len(sent["w"])
                    for m in every_name.finditer(sent["text"]):
                        a, b = char_span_to_tokens(sent["off"], sent["w"], m.start(), m.end())
                        for j in range(a, b + 1):
                            mask[j] = 1
                    shipped_index[key] = len(shipped)
                    shipped.append({**sent, "mask": mask, "page": s})
                evidence.append({"s": shipped_index[key], "m": spans})
            if not evidence:
                no_mention += 1
        edge_rows.append({"source": s, "target": t, "evidence": evidence})

    found = [row for row in edge_rows if row["evidence"]]
    print(f"links with a named mention: {len(found)} / {len(edges)}")

    # ---- default labelling
    for row in edge_rows:
        if row["evidence"]:
            row["label"], row["votes"] = label_edge(row["evidence"], shipped, lexicon)
        else:
            row["label"], row["votes"] = "unfound", {}
    label_counts = Counter(row["label"] for row in edge_rows)
    print(label_counts)

    # ---- communities (undirected, unweighted, same graph as weeks 1-3)
    runs = []
    for seed in SEEDS:
        parts = nx.community.louvain_communities(U, seed=seed)
        runs.append((nx.community.modularity(U, parts), seed, parts))
    runs.sort(key=lambda r: (-r[0], r[1]))
    best_q, best_seed, best_parts = runs[0]
    best_parts = sorted(best_parts, key=len, reverse=True)
    community = {n: i for i, part in enumerate(best_parts) for n in part}
    big = [i for i, part in enumerate(best_parts) if len(part) > 1]

    def community_name(part):
        top = sorted(part, key=lambda n: (-U.degree(n), n))[:3]
        return " · ".join(display_name(n) for n in top)

    communities = [
        {"id": i, "size": len(part), "name": community_name(part),
         "internal": U.subgraph(part).number_of_edges()}
        for i, part in enumerate(best_parts) if len(part) > 1
    ]

    found_edges = [(r["source"], r["target"]) for r in found]
    found_labels = [r["label"] for r in found]
    rng = random.Random(5)
    headline = null_test(found_edges, found_labels, community, rng)
    overall_within = sum(community[s] == community[t] for s, t in found_edges) / len(found_edges)
    for k in TYPES:
        h = headline[k]
        print(f"{k:8s} n={h['n']:4d} within={h['share']:.3f} null={h['null_mean']:.3f}±{h['null_sd']:.3f} z={h['z']:+.2f} p={h['p_two_sided']:.3f}")

    # ---- robustness 1: every Louvain seed
    per_seed = []
    for q, seed, parts in sorted(runs, key=lambda r: r[1]):
        comm = {n: i for i, part in enumerate(parts) for n in part}
        share = within_share(found_edges, found_labels, comm)
        per_seed.append({
            "seed": seed, "q": q, "k": sum(1 for p in parts if len(p) > 1),
            **{k: share[k][0] / share[k][1] for k in TYPES},
        })

    # ---- robustness 2: preprocessing variants
    def variant(mode, window, lex=lexicon):
        labs = [label_edge(r["evidence"], shipped, lex, mode, window)[0] for r in found]
        res = null_test(found_edges, labs, community, random.Random(5), samples=400)
        return {k: {"n": res[k]["n"], "share": res[k]["share"], "z": res[k]["z"]} for k in TYPES}

    variants = []
    for mode in ("lemma", "surface"):
        for window in (None, 10, 5, 3):
            variants.append({"mode": mode, "window": window, "result": variant(mode, window)})
            print("variant", mode, window, {k: round(v["z"], 2) for k, v in variants[-1]["result"].items()})

    # ---- robustness 3: leave one foe/ally word out
    loo = []
    base_gap = headline["foe"]["share"] - headline["ally"]["share"]
    for kind in ("foe", "ally"):
        for word in LEXICON[kind]:
            lex = {k: set(v) for k, v in LEXICON.items()}
            lex[kind].discard(word)
            labs = [label_edge(r["evidence"], shipped, lex)[0] for r in found]
            share = within_share(found_edges, labs, community)
            gap = share["foe"][0] / share["foe"][1] - share["ally"][0] / share["ally"][1]
            loo.append({"kind": kind, "word": word, "gap": gap, "delta": gap - base_gap,
                        "moved": sum(a != b for a, b in zip(labs, found_labels))})
    loo.sort(key=lambda r: -abs(r["delta"]))

    # ---- which words actually fire
    fired = {k: Counter() for k in TYPES}
    for r in found:
        for ev in r["evidence"]:
            sent = shipped[ev["s"]]
            seen = set()
            for i, lem in enumerate(sent["l"]):
                if sent["mask"][i]:
                    continue
                for k in TYPES:
                    if lem in lexicon[k] and (k, lem) not in seen:
                        fired[k][lem] += 1
                        seen.add((k, lem))

    # ---- reciprocal pairs: do both pages tell the same story?
    by_pair = {(r["source"], r["target"]): r["label"] for r in edge_rows}
    recip = []
    for (s, t), lab in by_pair.items():
        if s < t and (t, s) in by_pair:
            recip.append((lab, by_pair[(t, s)]))
    assert len(recip) == 350, len(recip)
    typed_recip = [(a, b) for a, b in recip if a in TYPES and b in TYPES]
    sym = {a: {b: 0 for b in TYPES} for a in TYPES}
    for a, b in typed_recip:
        sym[a][b] += 1
        sym[b][a] += 1 if a != b else 0
    frenemies = []
    for (s, t), lab in by_pair.items():
        back = by_pair.get((t, s))
        if s < t and back and {lab, back} == {"foe", "ally"}:
            frenemies.append({"a": s, "b": t, "a_says": lab, "b_says": back})

    # ---- leaderboards
    foe_in = Counter(r["target"] for r in edge_rows if r["label"] == "foe")
    kin_in = Counter(r["target"] for r in edge_rows if r["label"] == "family")

    # ---- does typing relate to link weight (how often A links B)?
    weight_by_type = {}
    if weights:
        for k in TYPES + ["mixed", "none", "unfound"]:
            ws = [weights[(r["source"], r["target"])] for r in edge_rows if r["label"] == k]
            weight_by_type[k] = {"n": len(ws), "mean": statistics.fmean(ws) if ws else None}

    # ---- a frozen human-check sample
    rng_check = random.Random(2026)
    sample = []
    for k in TYPES + ["none"]:
        pool = [
            r for r in found
            if r["label"] == k and len(r["evidence"]) <= CHECK_MAX_SENTENCES
        ]
        sample += rng_check.sample(pool, min(CHECK_PER_LABEL, len(pool)))
    rng_check.shuffle(sample)
    eligible = sum(1 for r in found if len(r["evidence"]) <= CHECK_MAX_SENTENCES)
    previous = {}
    if CHECK_TSV.exists():
        with CHECK_TSV.open(encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle, delimiter="\t"):
                previous[(row["source"], row["target"])] = row
    with CHECK_TSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t")
        writer.writerow(["source", "target", "lexicon_label", "agent_label", "human_label", "note", "evidence"])
        for r in sample:
            old = previous.get((r["source"], r["target"]), {})
            text = " || ".join(shipped[ev["s"]]["text"] for ev in r["evidence"])
            writer.writerow([
                r["source"], r["target"], r["label"],
                old.get("agent_label", ""), old.get("human_label", ""), old.get("note", ""),
                text.replace("\t", " "),
            ])

    agent_pairs = [
        (row["lexicon_label"], row["agent_label"])
        for row in previous.values() if row.get("agent_label")
    ]
    human_pairs = [
        (row["lexicon_label"], row["human_label"])
        for row in previous.values() if row.get("human_label")
    ]

    def agreement(pairs):
        if not pairs:
            return None
        conf = Counter(pairs)
        return {
            "n": len(pairs),
            "accuracy": sum(a == b for a, b in pairs) / len(pairs),
            "kappa": cohen_kappa(pairs),
            "confusion": [[a, b, c] for (a, b), c in sorted(conf.items())],
            "precision": {
                k: (sum(1 for a, b in pairs if a == k and b == k) / sum(1 for a, _ in pairs if a == k))
                if any(a == k for a, _ in pairs) else None
                for k in TYPES + ["none"]
            },
        }

    # ---- layout
    components = sorted(nx.connected_components(U), key=len, reverse=True)
    giant = U.subgraph(components[0])
    # LinLog separates Louvain communities best of the layouts we tried
    # (mean intra/inter-community distance 0.54 vs 0.63 plain FA2, 0.77 spring).
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        raw = nx.forceatlas2_layout(giant, max_iter=800, seed=7, linlog=True, gravity=1.0)
    assert all(math.isfinite(float(c)) for p in raw.values() for c in p)
    cx = statistics.fmean(float(p[0]) for p in raw.values())
    cy = statistics.fmean(float(p[1]) for p in raw.values())
    rmax = max(math.dist((float(p[0]), float(p[1])), (cx, cy)) for p in raw.values())
    for n, p in raw.items():
        dx, dy = float(p[0]) - cx, float(p[1]) - cy
        r = math.hypot(dx, dy)
        k = (rmax * (r / rmax) ** 0.7 / r) if r else 0.0
        raw[n] = (cx + dx * k, cy + dy * k)
    gx = [float(p[0]) for p in raw.values()]
    gy = [float(p[1]) for p in raw.values()]
    gspan = max(max(gx) - min(gx), max(gy) - min(gy))
    pos = {n: ((float(p[0]) - min(gx)) / gspan, (float(p[1]) - min(gy)) / gspan) for n, p in raw.items()}
    height = max(p[1] for p in pos.values())
    islands = [c for c in components[1:] if len(c) > 1]
    isolates = sorted(n for c in components[1:] if len(c) == 1 for n in c)
    cursor = 0.0
    for island in islands:
        sub = nx.spring_layout(U.subgraph(island), seed=7, scale=0.06)
        for n, p in sub.items():
            pos[n] = (1.1 + float(p[0]), 0.1 + cursor + float(p[1]))
        cursor += 0.18
    for i, n in enumerate(isolates):
        pos[n] = (i / max(1, len(isolates) - 1), height + 0.1)
    xs = [p[0] for p in pos.values()]
    ys = [p[1] for p in pos.values()]
    span = max(max(xs) - min(xs), max(ys) - min(ys))

    def norm(v, lo):
        return round(float((v - lo) / span), 4)

    node_list = [
        {
            "id": n,
            "name": display_name(n),
            "x": norm(pos[n][0], min(xs)),
            "y": norm(pos[n][1], min(ys)),
            "c": community[n] if community[n] in big else -1,
            "kin": G.in_degree(n),
            "kout": G.out_degree(n),
            "chars": len(pages[n]),
            "aliases": sorted(aliases[n])[:8],
        }
        for n, row in zip(node_ids, nodes)
    ]
    node_index = {n["id"]: i for i, n in enumerate(node_list)}

    out = {
        "meta": {
            "n": 303, "m_directed": 1784, "m_undirected": 1434,
            "pages": len(pages), "chars": sum(len(t) for t in pages.values()),
            "sentences_total": sum(len(v) for v in sents.values()),
            "sentences_shipped": len(shipped),
            "found": len(found), "no_alias": no_alias, "no_mention": no_mention,
            "louvain_seed": best_seed, "louvain_q": best_q,
            "overall_within": overall_within,
            "null_samples": NULL_SAMPLES,
            "check_eligible": eligible,
            "check_max_sentences": CHECK_MAX_SENTENCES,
            "spacy": spacy.__version__,
        },
        "lexicon": LEXICON,
        "label_counts": dict(label_counts),
        "headline": headline,
        "per_seed": per_seed,
        "variants": variants,
        "leave_one_out": loo,
        "fired": {k: fired[k].most_common() for k in TYPES},
        "reciprocal": {
            "pairs": len(recip),
            "typed_both": len(typed_recip),
            "agree": sum(a == b for a, b in typed_recip),
            "kappa": cohen_kappa(typed_recip + [(b, a) for a, b in typed_recip]),
            "matrix": sym,
            "frenemies": frenemies,
        },
        "leaders": {
            "foe_in": [[n, c] for n, c in foe_in.most_common(12)],
            "family_in": [[n, c] for n, c in kin_in.most_common(8)],
        },
        "weight_by_type": weight_by_type,
        "check": {
            "sample": [
                {
                    "e": edge_rows.index(r),
                    "lex": r["label"],
                    "agent": previous.get((r["source"], r["target"]), {}).get("agent_label") or None,
                    "note": previous.get((r["source"], r["target"]), {}).get("note") or None,
                }
                for r in sample
            ],
            "agent": agreement(agent_pairs),
            "human": agreement(human_pairs),
        },
        "communities": communities,
        "nodes": node_list,
        "edges": [
            {
                "s": node_index[r["source"]],
                "t": node_index[r["target"]],
                "ev": [[ev["s"], [list(m) for m in ev["m"]]] for ev in r["evidence"]],
                "lab": r["label"],
                "w": weights.get((r["source"], r["target"]), 1),
            }
            for r in edge_rows
        ],
        "sentences": [
            {
                "w": s["w"],
                "ws": s["ws"],
                "l": [lem if lem != w.lower() else "" for lem, w in zip(s["l"], s["w"])],
                "k": s["mask"],
            }
            for s in shipped
        ],
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUTPUT} ({OUTPUT.stat().st_size / 1e6:.2f} MB)")
    print("Q", best_q, "seed", best_seed, "communities", len(communities))
    print("reciprocal", out["reciprocal"]["typed_both"], out["reciprocal"]["agree"], out["reciprocal"]["kappa"])
    print("frenemies", len(frenemies))
    print("foe_in", foe_in.most_common(8))
    print("loo top", loo[:6])
    print("weight", weight_by_type)
    print("fired foe", fired["foe"].most_common(12))
    print("fired ally", fired["ally"].most_common(12))


if __name__ == "__main__":
    main()
