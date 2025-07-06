#!/usr/bin/env bash
# --------------------------------------------------------------
# compare_geo.sh  –  Geo-difference analyser (directory version)
# Outputs:
#   geo_diff_master.csv  – consolidated results from *all* pairs
#   geo_diff_stats.log   – aggregate text log
# Usage:
#   ./compare_geo.sh <jp_dir> <be_dir>
# Example:
#   ./compare_geo.sh scan_japan/results results
# Requires:
#   python3 with pandas  →  sudo apt install python3-pandas
# --------------------------------------------------------------
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <jp_dir> <be_dir>" >&2
  exit 1
fi

JP_DIR="$1"
BE_DIR="$2"

python3 - <<'PY' "$JP_DIR" "$BE_DIR"
import os, sys, warnings, pandas as pd, numpy as np
warnings.filterwarnings("ignore", category=pd.errors.PerformanceWarning)
warnings.filterwarnings("ignore", category=FutureWarning, module="pandas")

jp_dir, be_dir = sys.argv[1], sys.argv[2]
THR = 0.50           # size-gap threshold (ratio)
CSV_PATTERNS = ('.csv', '.jcsv')   # accept both extensions

# ---------- discover matching filenames ----------
jp_files = [f for f in os.listdir(jp_dir) if f.endswith(CSV_PATTERNS)]
common   = [f for f in jp_files if os.path.exists(os.path.join(be_dir, f))]
if not common:
    sys.exit("❌ No matching CSV filenames found between the two directories.")

# helpers ------------------------------------------------------
BASE = ["url","status_jp","status_be","load_time_jp","load_time_be",
        "total_bytes_jp","total_bytes_be"]
FILTER_COLS = ["restricted_country","difference_bytes","difference_percent",
               "html_lang_jp","html_lang_be","japanese_text_jp","japanese_text_be"]
HEADERS = ["response_headers_jp","response_headers_be"]
CSV_COLS = BASE + FILTER_COLS + HEADERS

def blank(df_slice: pd.DataFrame) -> pd.DataFrame:
    tmp = df_slice.copy()
    for col in FILTER_COLS:
        tmp[col] = '-'
    return tmp

def analyse_pair(jp_csv: str, be_csv: str):
    """Return master-DataFrame and stats dict for one file pair."""
    jp = pd.read_csv(jp_csv)
    be = pd.read_csv(be_csv)
    df_all = jp.merge(be, on="url", suffixes=("_jp", "_be"))

    for c in ("html_lang_jp", "html_lang_be"):
        if c not in df_all:
            df_all[c] = pd.NA

    chunks, stats = [], {}
    # 1️⃣ status-code mismatch ------------------------------
    mask = ((df_all.status_jp==200)&(df_all.status_be!=200)) | \
           ((df_all.status_be==200)&(df_all.status_jp!=200))
    tmp = blank(df_all[mask])
    tmp.loc[tmp.status_jp==200, "restricted_country"] = "BE"
    tmp.loc[tmp.status_be==200, "restricted_country"] = "JP"
    stats['status_diff'] = len(tmp)
    chunks.append(tmp)
    df_all = df_all[~mask]

    # 2️⃣ large size gap (>50 %) ----------------------------
    gap   = (df_all.total_bytes_jp - df_all.total_bytes_be).abs()
    ratio = gap / df_all[["total_bytes_jp","total_bytes_be"]].max(axis=1).replace(0,np.nan)
    mask  = ratio > THR
    tmp   = blank(df_all[mask])
    tmp["difference_bytes"]   = gap[mask]
    tmp["difference_percent"] = (ratio[mask]*100).round(1)
    stats['size_diff'] = len(tmp)
    chunks.append(tmp)
    df_all = df_all[~mask]

    # 3️⃣ html_lang mismatch -------------------------------
    mask = df_all.html_lang_jp != df_all.html_lang_be
    tmp  = blank(df_all[mask])
    tmp["html_lang_jp"] = df_all.loc[mask,"html_lang_jp"]
    tmp["html_lang_be"] = df_all.loc[mask,"html_lang_be"]
    stats['html_lang_diff'] = len(tmp)
    chunks.append(tmp)
    df_all = df_all[~mask]

    # 4️⃣ japanese_text mismatch ---------------------------
    mask = df_all.japanese_text_jp != df_all.japanese_text_be
    tmp  = blank(df_all[mask])
    tmp["japanese_text_jp"] = df_all.loc[mask,"japanese_text_jp"]
    tmp["japanese_text_be"] = df_all.loc[mask,"japanese_text_be"]
    stats['japanese_text_diff'] = len(tmp)
    chunks.append(tmp)

    master = pd.concat(chunks, ignore_index=True)[CSV_COLS]
    return master, stats, jp.shape[0], be.shape[0]

# ---------- iterate over all pairs ----------
masters, total_stats = [], {'status_diff':0,'size_diff':0,
                            'html_lang_diff':0,'japanese_text_diff':0}
tot_jp_rows = tot_be_rows = 0

for fname in sorted(common):
    jp_csv = os.path.join(jp_dir, fname)
    be_csv = os.path.join(be_dir, fname)
    master_pair, stats_pair, jp_rows, be_rows = analyse_pair(jp_csv, be_csv)

    master_pair.insert(0, "source_file", fname)      # keep origin trace
    masters.append(master_pair)

    for k in total_stats:           # accumulate stats
        total_stats[k] += stats_pair.get(k, 0)
    tot_jp_rows += jp_rows
    tot_be_rows += be_rows

# ---------- write consolidated outputs ----------
master_all = pd.concat(masters, ignore_index=True)
master_all.to_csv("geo_diff_master.csv", index=False)

with open("geo_diff_stats.log", "w") as log:
    log.write(f"JP CSV files processed.............. {len(common)}\n")
    log.write(f"Total rows (JP)..................... {tot_jp_rows}\n")
    log.write(f"Total rows (BE)..................... {tot_be_rows}\n\n")
    log.write("Filtered by signal (all files):\n")
    for k, v in total_stats.items():
        log.write(f"  {k:<22} {v}\n")
    log.write(f"\nTOTAL filtered URLs............... {len(master_all)}\n")

print(f"✔ geo_diff_master.csv   ({len(master_all)} rows)")
print( "✔ geo_diff_stats.log    written" )
PY
