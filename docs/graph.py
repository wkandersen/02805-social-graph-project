import sys
from pathlib import Path

import ipywidgets as widgets
import matplotlib.pyplot as plt
from matplotlib.ticker import LogLocator, MaxNLocator, ScalarFormatter
import numpy as np
import pandas as pd
from IPython.display import clear_output, display

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from load_data import load_graph

nodes, edges, G, G_undirected = load_graph()

name_by_id = nodes.set_index("node_id")["name"].to_dict()


def make_doubling_bins(max_x):
    edges = list(range(1, 9))
    lower = 8
    width = 2
    while lower <= max_x:
        edges.append(lower + width)
        lower += width
        width *= 2
    return list(zip(edges[:-1], edges[1:]))


def binned_distribution(x_values, frequency_values):
    raw_frequency = dict(zip(x_values, frequency_values))
    bins = make_doubling_bins(int(x_values.max()))
    bin_x = []
    bin_frequency = []

    for lower, upper in bins:
        covered_x = np.arange(lower, upper)
        count = sum(raw_frequency.get(value, 0) for value in covered_x)
        bin_x.append(np.exp(np.mean(np.log(covered_x))))
        bin_frequency.append(count / (upper - lower))

    return np.asarray(bin_x), np.asarray(bin_frequency)


def draw_degree_distribution(degree_view, data_view, x_scale, y_scale):
    with plot_output:
        clear_output(wait=True)

        if degree_view == "in-degree":
            degree_values = dict(G.in_degree())
            degree_label = "in-degree"
        elif degree_view == "out-degree":
            degree_values = dict(G.out_degree())
            degree_label = "out-degree"
        else:
            degree_values = dict(G.to_undirected().degree())
            degree_label = "undirected degree"

        degree_counts = pd.Series(degree_values).value_counts().sort_index()
        raw_x = degree_counts.index.to_numpy() + 1
        raw_frequency = degree_counts.to_numpy()
        binned_x, binned_frequency = binned_distribution(raw_x, raw_frequency)

        width_one_mask = binned_x <= 7
        raw_frequency_by_x = dict(zip(raw_x, raw_frequency))
        width_one_matches = all(
            np.isclose(binned_frequency[index], raw_frequency_by_x.get(x, 0))
            for index, x in enumerate(binned_x[width_one_mask], start=0)
            for x in [int(round(x))]
        )
        print(f"Width-1 bin check: {'passed' if width_one_matches else 'FAILED'}")

        figure, axis = plt.subplots(figsize=(9, 5))
        if data_view in ["raw", "raw + binned"]:
            axis.scatter(raw_x, raw_frequency, label="Raw data", zorder=3)
        if data_view in ["binned", "raw + binned"]:
            binned_mask = binned_frequency > 0 if y_scale == "log" else np.ones_like(binned_frequency, dtype=bool)
            axis.plot(
                binned_x[binned_mask],
                binned_frequency[binned_mask],
                marker="o",
                linewidth=1.5,
                label="Binned data"
            )

        axis.set_xscale(x_scale)
        axis.set_yscale(y_scale)
        axis.set_title(f"{degree_label.title()} distribution ({data_view}, {x_scale}-{y_scale})")
        axis.set_xlabel("k + 1 (degree shifted; isolates at 1)")
        axis.set_ylabel("Number of characters")
        if x_scale == "linear":
            axis.xaxis.set_major_locator(MaxNLocator(integer=True, nbins=10))
            if len(raw_x) <= 12:
                axis.set_xticks(raw_x)
        else:
            axis.xaxis.set_major_locator(LogLocator(base=10, numticks=8))
            axis.xaxis.set_major_formatter(ScalarFormatter())
        if y_scale == "linear":
            axis.yaxis.set_major_locator(MaxNLocator(integer=True, nbins=8))
            if len(np.unique(raw_frequency)) <= 12:
                axis.set_yticks(np.unique(raw_frequency))
        else:
            axis.yaxis.set_major_locator(LogLocator(base=10, numticks=8))
            axis.yaxis.set_major_formatter(ScalarFormatter())
        axis.tick_params(axis="both", which="major", labelsize=10, labelbottom=True, labelleft=True)
        axis.grid(alpha=0.25, which="both")
        axis.legend(loc="best", frameon=True, title="Data")
        plt.tight_layout()
        plt.show()

        print("Degree (k + 1) | Frequency")
        print("--------------------------")
        for degree, frequency in zip(raw_x, raw_frequency):
            print(f"{degree:14d} | {frequency:9d}")

        top_five = sorted(
            degree_values.items(),
            key=lambda item: (-item[1], name_by_id.get(item[0], str(item[0])))
        )[:5]
        print(f"Top five characters by {degree_label}:")
        for rank, (node_id, degree) in enumerate(top_five, start=1):
            print(f"{rank}. {name_by_id.get(node_id, node_id)} ({node_id}): {degree}")
        print("\nCompare these five names and degree values with the real-degrees explorable leaderboard.")


degree_toggle = widgets.ToggleButtons(
    options=["in-degree", "out-degree", "undirected"],
    description="Degree:",
    value="in-degree"
)
data_toggle = widgets.ToggleButtons(
    options=["raw", "binned", "raw + binned"],
    description="Data:",
    value="raw + binned"
)
x_axis_toggle = widgets.ToggleButtons(
    options=["linear", "log"],
    description="X-axis:",
    value="linear"
)
y_axis_toggle = widgets.ToggleButtons(
    options=["linear", "log"],
    description="Y-axis:",
    value="linear"
)
plot_output = widgets.Output()


def refresh_plot(change=None):
    draw_degree_distribution(
        degree_toggle.value,
        data_toggle.value,
        x_axis_toggle.value,
        y_axis_toggle.value
    )


degree_toggle.observe(refresh_plot, names="value")
data_toggle.observe(refresh_plot, names="value")
x_axis_toggle.observe(refresh_plot, names="value")
y_axis_toggle.observe(refresh_plot, names="value")
display(widgets.VBox([
    widgets.HBox([degree_toggle, data_toggle, x_axis_toggle, y_axis_toggle]),
    plot_output
]))
refresh_plot()