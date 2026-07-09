"""
Somerville Bike Kitchen — Visitor Sign-In Dashboard (Streamlit).

Reads live data straight from the published Google Sheet (which the Google
Form writes to), so every load reflects the latest sign-ins. Run locally with:

    streamlit run app.py

Configure the data source without editing code via a Streamlit secret named
CSV_URL, or the SBK_CSV_URL environment variable. Falls back to the published
sheet URL below.
"""

import os
from datetime import datetime, timezone

import streamlit as st

import analysis

# Published-to-web CSV endpoint for the SBK sign-in sheet.
DEFAULT_CSV_URL = (
    "https://docs.google.com/spreadsheets/d/e/"
    "2PACX-1vSemsjvYjyMeEDH9ht4IE-LbfLcdt5vfyzg0lUEDRP5pG0v-PrG4TWSR3-iGyNOcR-uGQThu8kEk8O6/"
    "pub?gid=1829621986&single=true&output=csv"
)


def csv_url():
    # Secret > env var > default. st.secrets access is wrapped because it
    # raises if no secrets file exists (common in local dev).
    try:
        if "CSV_URL" in st.secrets:
            return st.secrets["CSV_URL"]
    except Exception:
        pass
    return os.environ.get("SBK_CSV_URL", DEFAULT_CSV_URL)


@st.cache_data(ttl=300, show_spinner="Loading latest sign-in data…")
def load(url):
    """Cached for 5 minutes so repeat views don't re-hit the sheet every render.

    Returns (dataframe, fetched_at) so the UI can show when data was pulled.
    """
    df = analysis.load_and_clean(url)
    return df, datetime.now(timezone.utc)


st.set_page_config(page_title="SBK Visitor Dashboard", page_icon="🚲", layout="wide")
st.title("🚲 Somerville Bike Kitchen — Visitor Dashboard")

# ── Sidebar: data controls ─────────────────────────────────────────────────
with st.sidebar:
    st.header("Data")
    if st.button("🔄 Refresh now", width="stretch"):
        load.clear()
        st.rerun()

    auto = st.checkbox("Auto-refresh", value=False,
                       help="Reload the page automatically on an interval.")
    interval = st.select_slider("Every", options=[1, 5, 10, 30],
                                value=5, format_func=lambda m: f"{m} min",
                                disabled=not auto)
    if auto:
        try:
            from streamlit_autorefresh import st_autorefresh

            st_autorefresh(interval=interval * 60 * 1000, key="auto")
        except ModuleNotFoundError:
            st.caption("Install `streamlit-autorefresh` to enable auto-refresh.")

try:
    df, fetched_at = load(csv_url())
except Exception as e:  # noqa: BLE001 — surface any load failure to the user
    st.error(f"Couldn't load data from the sheet.\n\n{e}")
    st.info("Check that the sheet is still Published to web as CSV and shared "
            "with *Anyone with the link*.")
    st.stop()

s = analysis.summary(df)
st.caption(
    f"Data through **{s['date_max']}** · fetched {fetched_at:%Y-%m-%d %H:%M UTC} · "
    "cached up to 5 min"
)

# ── KPI row ────────────────────────────────────────────────────────────────
c1, c2, c3 = st.columns(3)
c1.metric("Total sign-ins", f"{s['total_signins']:,}")
c2.metric("Unique visitors", f"{s['unique_visitors']:,}")
c3.metric("Date range", f"{s['date_min']} → {s['date_max']}")

st.divider()

# ── Sidebar: chart controls ────────────────────────────────────────────────
with st.sidebar:
    st.header("Chart options")
    months_back = st.slider("Monthly window (months)", 3, 36, 12)
    top_origins = st.slider("Top origins", 3, 20, 10)
    top_reasons = st.slider("Top visit reasons", 3, 15, 8)
    default_years = analysis.full_years(df) or s["years"]
    season_years = st.multiselect("Seasonality years", options=s["years"],
                                  default=default_years)

# ── Charts ─────────────────────────────────────────────────────────────────
tab_time, tab_who, tab_engage = st.tabs(
    ["📈 Over Time", "📍 Who Visits", "💬 Engagement"]
)

with tab_time:
    st.pyplot(analysis.fig_monthly(df, months_back))
    st.pyplot(analysis.fig_seasonality(df, season_years or None))
    st.pyplot(analysis.fig_peak_hours(df))

with tab_who:
    left, right = st.columns(2)
    with left:
        st.pyplot(analysis.fig_origins(df, top_origins))
        st.pyplot(analysis.fig_arrival(df))
    with right:
        st.pyplot(analysis.fig_reasons(df, top_reasons))
        st.pyplot(analysis.fig_new_vs_returning(df))
    st.subheader("Unique visitors per year")
    st.dataframe(analysis.unique_per_year_table(df), width="stretch")
    st.pyplot(analysis.fig_unique_per_year(df))

with tab_engage:
    st.pyplot(analysis.fig_engagement(df))
