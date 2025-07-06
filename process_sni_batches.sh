#!/usr/bin/env bash
#
# process_sni_batches.sh  —  JSON-chunked workers
#   • split_001, split_002, split_003  →  worker 1
#   • split_004, split_005, split_006  →  worker 2
#   • …
# ---------------------------------------------------------------------------

set -Eeuo pipefail
trap 'echo "[ERROR] Line $LINENO: $BASH_COMMAND"; exit 1' ERR

command -v jq   >/dev/null 2>&1 || { echo "jq not found";   exit 1; }
command -v node >/dev/null 2>&1 || { echo "node not found"; exit 1; }

# — Directories & parameters —
LIST_DIR="list_ipv4"
LOG_DIR="logs"
RESULT_DIR="results"
SCRIPT_PATH="webpage_test.js"

FILES_PER_WORKER=3   # 1-3, 4-6, 7-9 …
SNIS_PER_BATCH=3     # inside each JSON file (parallel node calls)

mkdir -p "$LOG_DIR" "$RESULT_DIR"
shopt -s nullglob
mapfile -t json_files < <(printf '%s\n' "$LIST_DIR"/split_*.json | sort)

total_files=${#json_files[@]}
(( total_files == 0 )) && { echo "No split_*.json files found"; exit 1; }

# ── Helpers ──────────────────────────────────────────────────────────────
run_one() {               # $1 = sni  $2 = log  $3 = csv
  local sni="${1%.}"
  local log="$2" csv="$3"

  echo "[START]  $(date '+%F %T') — $sni" | tee -a "$log"
  if node "$SCRIPT_PATH" --url="$sni" --csv="$csv" > /dev/null 2>&1; then
    st=0; else st=$?; fi
  echo "[ END ]  $(date '+%F %T') — $sni (exit=$st)" | tee -a "$log"
}

process_json() {          # $1 = json file
  local json="$1"
  local base=$(basename "${json%.json}")
  local log="$LOG_DIR/$base.log"
  local csv="$RESULT_DIR/$base.csv"

  echo "### $(date) — Processing $json" | tee -a "$log"

  if jq -e 'type=="array"' "$json" >/dev/null 2>&1; then
    mapfile -t sni_arr < <(jq -r '.[].sni // empty' "$json" | sort -u)
  else
    mapfile -t sni_arr < <(jq -r '.sni // empty'   "$json" | sort -u)
  fi

  local total=${#sni_arr[@]}
  echo "[DEBUG] Loaded $total SNIs" | tee -a "$log"
  (( total == 0 )) && { echo "[WARN] Skipped (no SNIs)"; return; }

  local processed=0 batch=0
  while (( processed < total )); do
    batch=$(( batch + 1 ))
    echo -e "\n--- Batch $batch (${processed}/${total}) ---" | tee -a "$log"

    for (( i=0; i<SNIS_PER_BATCH && processed<total; i++,processed++ )); do
      ( run_one "${sni_arr[processed]}" "$log" "$csv" ) || true &
    done
    wait || true

    local pct=$(( 100 * processed / total ))
    echo "[PROGRESS] $(date '+%F %T') — $processed/$total (${pct}%)" | tee -a "$log"
  done

  echo -e "\n### $(date) — Finished $json\n" | tee -a "$log"
}
# ── Worker launcher ──────────────────────────────────────────────────────
launch_worker() {         # $1 = worker id  $2… = slice of json files
  local id="$1"; shift
  echo "== Worker $id starts: $*"            # terminal only
  for f in "$@"; do
    process_json "$f"
  done
  echo "== Worker $id done"
}

# ── Split JSON list into chunks & launch workers ─────────────────────────
worker_id=0
idx=0
while (( idx < total_files )); do
  files_slice=("${json_files[@]:idx:FILES_PER_WORKER}")
  (( ++worker_id ))
  launch_worker "$worker_id" "${files_slice[@]}" &
  idx=$(( idx + FILES_PER_WORKER ))
done

wait
echo "ALL JSON FILES COMPLETE"
