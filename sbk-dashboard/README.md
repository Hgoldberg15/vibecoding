# 🚲 SBK Visitor Dashboard

A live Streamlit dashboard for Somerville Bike Kitchen visitor sign-ins. It
reads directly from the Google Form's published Google Sheet, so it always
reflects the latest submissions — no CSV export step.

This is the notebook (`sbk-visitor-analysis.ipynb`) turned into a hosted,
always-current web app. The analysis logic is unchanged; it just reads the
sheet over the network and renders in the browser.

## Files
- `analysis.py` — data loading, cleaning, and chart builders (no Streamlit; testable on its own).
- `app.py` — the Streamlit UI: KPIs, tabs, sidebar controls, refresh.
- `requirements.txt` — dependencies.

## How the data stays live
The Google Sheet is **Published to web as CSV** and shared with *Anyone with
the link*. `app.py` fetches that CSV on load and caches it for 5 minutes
(`@st.cache_data(ttl=300)`). Use the sidebar **🔄 Refresh now** button to force
a fresh pull, or tick **Auto-refresh** to reload on an interval.

Because the Form appends new rows to the same sheet, new sign-ins appear in the
dashboard within the cache window automatically.

## Run locally
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```
Opens at http://localhost:8501.

## Deploy free (Streamlit Community Cloud)
1. Commit this folder to a GitHub repo (e.g. `Hgoldberg15/vibecoding`).
2. Go to https://share.streamlit.io → **New app**.
3. Point it at the repo, branch `main`, main file `sbk-dashboard/app.py`.
4. Deploy. You'll get a public `*.streamlit.app` URL that always shows current data.

## Changing the data source
The sheet URL is hardcoded as a fallback in `app.py`, but you can override it
without editing code:
- **On Streamlit Cloud:** app settings → *Secrets* → add
  `CSV_URL = "https://…&output=csv"`.
- **Locally:** create `.streamlit/secrets.toml` with the same line, or set the
  `SBK_CSV_URL` environment variable.

To get the CSV URL for a sheet: File → Share → **Publish to web** → pick the
tab → **Comma-separated values (.csv)**. The link ends in `output=csv`.

## Note on privacy
The sheet contains visitor emails and names. Anyone with the published link (or
the deployed dashboard URL) can view aggregate charts. The dashboard itself
only shows aggregates — it never displays individual emails or names — but the
underlying published CSV does include them. If that's a concern, restrict the
deployed app (Streamlit Cloud supports viewer authentication) or move to the
Google Sheets API with a service account instead of public publishing.
