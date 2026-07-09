"""
Data loading, cleaning, and chart building for the SBK Visitor Dashboard.

This module is intentionally free of any Streamlit imports so the analysis
logic can be tested on its own. `app.py` wraps these functions with UI.

Ported from sbk-visitor-analysis.ipynb, with two robustness changes:
  * Columns are taken by position (first 10) so the Google Form adding
    trailing questions (e.g. contribution acknowledgments) no longer breaks
    the rename step.
  * Seasonality years are chosen from the data instead of being hardcoded.
"""

from collections import Counter

import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")  # headless backend — no GUI needed on a server
import matplotlib.pyplot as plt

# The 10 fields we care about, in the order the Google Form emits them.
COLUMNS = [
    "timestamp", "email", "origin", "arrival_mode",
    "visit_reasons", "first_visit", "first_name", "last_name",
    "email_opt_in", "volunteer_interest",
]

# Shared palette (same greens/blues/oranges as the notebook).
GREEN, BLUE, ORANGE, PURPLE, RED = "#4CAF82", "#5B8FD6", "#F4A261", "#9B59B6", "#E74C3C"
YEAR_COLORS = [GREEN, BLUE, ORANGE, PURPLE, RED, "#1ABC9C", "#E67E22"]


def load_and_clean(source):
    """Read the CSV (URL or path) and return a cleaned DataFrame.

    `source` can be a Google Sheets published-CSV URL or a local file path —
    pandas.read_csv accepts both.
    """
    df = pd.read_csv(source)

    # Keep only the first 10 columns and give them clean names. Slicing first
    # means extra trailing form questions don't cause a length mismatch.
    df = df.iloc[:, : len(COLUMNS)].copy()
    df.columns = COLUMNS

    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df = df.dropna(subset=["timestamp"])

    df["date"] = df["timestamp"].dt.date
    df["year"] = df["timestamp"].dt.year
    df["month"] = df["timestamp"].dt.to_period("M")
    df["week"] = df["timestamp"].dt.to_period("W")
    df["hour"] = df["timestamp"].dt.hour

    for col in ["origin", "arrival_mode", "first_visit", "email_opt_in", "volunteer_interest"]:
        df[col] = df[col].astype(str).str.strip()

    return df


def summary(df):
    """Top-level numbers for the KPI row."""
    return {
        "total_signins": len(df),
        "unique_visitors": int(df["email"].nunique()),
        "date_min": df["timestamp"].min().date(),
        "date_max": df["timestamp"].max().date(),
        "years": sorted(int(y) for y in df["year"].unique()),
    }


def full_years(df, min_months=6):
    """Years that have at least `min_months` distinct months of data.

    Used as the sensible default for the seasonality chart so a partial
    current year (or a partial first year) doesn't distort the average.
    """
    months_per_year = df.groupby("year")["month"].nunique()
    return sorted(int(y) for y, n in months_per_year.items() if n >= min_months)


# ── Charts ────────────────────────────────────────────────────────────────
# Each function returns a matplotlib Figure so the caller decides how to render.

def fig_monthly(df, months_back=12):
    cutoff = df["timestamp"].max() - pd.DateOffset(months=months_back)
    monthly = df[df["timestamp"] >= cutoff].groupby("month").size().sort_index()

    fig, ax = plt.subplots(figsize=(12, 4))
    ax.plot(monthly.index.astype(str), monthly.values, marker="o", color=GREEN, linewidth=2)
    ax.set_title(f"Monthly Visits (Last {months_back} Months)", fontsize=13)
    ax.set_xlabel("Month")
    ax.set_ylabel("Visits")
    ax.tick_params(axis="x", rotation=45)
    fig.tight_layout()
    return fig


def fig_seasonality(df, years=None, smooth=True):
    """Monthly visits per year on a shared Jan–Dec axis, plus an average line."""
    if years is None:
        years = full_years(df)
    years = [y for y in years if (df["year"] == y).any()]

    fig, ax = plt.subplots(figsize=(12, 5))
    all_monthly = []
    for i, year in enumerate(years):
        counts = (
            df[df["year"] == year]
            .groupby(df["timestamp"].dt.month)
            .size()
            .reindex(range(1, 13), fill_value=0)
        )
        all_monthly.append(counts.values)
        ax.plot(counts.index, counts.values, marker="o", linewidth=1.5, alpha=0.5,
                color=YEAR_COLORS[i % len(YEAR_COLORS)], label=str(year))

    if all_monthly:
        avg = np.mean(all_monthly, axis=0)
        months = np.arange(1, 13)
        # Spline-smooth only when we have enough distinct points for a cubic fit.
        if smooth and len(months) >= 4:
            from scipy.interpolate import make_interp_spline

            smooth_x = np.linspace(1, 12, 300)
            smooth_y = make_interp_spline(months, avg, k=3)(smooth_x)
            ax.plot(smooth_x, smooth_y, linewidth=3, linestyle="--", color="black",
                    label="Average (smoothed)")
            ax.scatter(months, avg, color="black", zorder=5, s=40)
        else:
            ax.plot(months, avg, marker="o", linewidth=3, linestyle="--",
                    color="black", label="Average")

    ax.set_title("Monthly Visits by Year (Seasonality)", fontsize=13)
    ax.set_xlabel("Month")
    ax.set_ylabel("Visits")
    ax.set_xticks(range(1, 13))
    ax.set_xticklabels(["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])
    ax.legend(title="Year")
    fig.tight_layout()
    return fig


def fig_origins(df, top_n=10):
    origins = df[df["origin"] != "nan"]["origin"].value_counts().head(top_n)
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.barh(origins.index[::-1], origins.values[::-1], color=BLUE)
    ax.set_title(f"Top {top_n} Visitor Origins", fontsize=13)
    ax.set_xlabel("Visits")
    fig.tight_layout()
    return fig


def fig_arrival(df):
    modes = df[df["arrival_mode"] != "nan"]["arrival_mode"].value_counts()
    fig, ax = plt.subplots(figsize=(6, 6))
    colors = [YEAR_COLORS[i % len(YEAR_COLORS)] for i in range(len(modes))]
    ax.pie(modes.values, labels=modes.index, autopct="%1.1f%%", startangle=90, colors=colors)
    ax.set_title("How Visitors Arrived", fontsize=13)
    fig.tight_layout()
    return fig


def fig_reasons(df, top_n=8):
    all_reasons = []
    for cell in df["visit_reasons"].dropna():
        if cell != "nan":
            all_reasons.extend(r.strip() for r in str(cell).split(","))
    counts = Counter(all_reasons).most_common(top_n)

    fig, ax = plt.subplots(figsize=(9, 5))
    if counts:
        labels, values = zip(*counts)
        short = [l[:35] for l in labels]
        ax.barh(short[::-1], list(values)[::-1], color=ORANGE)
    ax.set_title(f"Top {top_n} Visit Reasons", fontsize=13)
    ax.set_xlabel("Mentions")
    fig.tight_layout()
    return fig


def fig_new_vs_returning(df):
    fv = df[df["first_visit"].isin(["Yes", "No"])]["first_visit"].value_counts()
    labels = ["Returning", "New"] if (len(fv) and fv.index[0] == "No") else ["New", "Returning"]
    fig, ax = plt.subplots(figsize=(5, 5))
    ax.pie(fv.values, labels=labels, autopct="%1.1f%%", startangle=90, colors=[GREEN, BLUE])
    ax.set_title("New vs. Returning Visitors", fontsize=13)
    fig.tight_layout()
    return fig


def fig_engagement(df):
    opt_in = df[df["email_opt_in"].isin(["Yes", "No"])]["email_opt_in"].value_counts()
    vol = df[df["volunteer_interest"].isin(["Yes", "No"])]["volunteer_interest"].value_counts()
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    axes[0].pie(opt_in.values, labels=opt_in.index, autopct="%1.1f%%", startangle=90,
                colors=[GREEN, RED])
    axes[0].set_title("Email Opt-In")
    axes[1].pie(vol.values, labels=vol.index, autopct="%1.1f%%", startangle=90,
                colors=[BLUE, RED])
    axes[1].set_title("Volunteer Interest")
    fig.suptitle("Engagement Signals", fontsize=13, fontweight="bold")
    fig.tight_layout()
    return fig


def fig_peak_hours(df):
    peak = df["hour"].value_counts().sort_index()
    fig, ax = plt.subplots(figsize=(12, 4))
    ax.bar(peak.index, peak.values, color=PURPLE, edgecolor="white")
    ax.set_title("Peak Sign-In Hours (All Time)", fontsize=13)
    ax.set_xlabel("Hour of Day (24h format)")
    ax.set_ylabel("Visits")
    ax.set_xticks(range(0, 24))
    fig.tight_layout()
    return fig


def unique_per_year_table(df):
    total = df.groupby("year").size()
    unique = df.groupby("year")["email"].nunique()
    out = pd.DataFrame({"Total Sign-ins": total, "Unique Visitors": unique})
    out["Avg Visits/Person"] = (out["Total Sign-ins"] / out["Unique Visitors"]).round(1)
    return out


def fig_unique_per_year(df):
    comp = unique_per_year_table(df)
    fig, ax = plt.subplots(figsize=(9, 4))
    x = np.array(comp.index)
    w = 0.4
    ax.bar(x - w / 2, comp["Total Sign-ins"], w, label="Total Sign-ins", color=GREEN)
    ax.bar(x + w / 2, comp["Unique Visitors"], w, label="Unique Visitors", color=BLUE)
    ax.set_title("Total Sign-ins vs. Unique Visitors per Year", fontsize=13)
    ax.set_xlabel("Year")
    ax.set_ylabel("Count")
    ax.legend()
    fig.tight_layout()
    return fig
