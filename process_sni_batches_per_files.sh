#!/usr/bin/env bash
#
# process_sni_batches.sh — One worker per JSON file
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

SNIS_PER_BATCH=3  # Parallel node runs within each file

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

process_json() {
  local json="$1"
  local base=$(basename "${json%.json}")
  local log="$LOG_DIR/$base.log"
  local csv="$RESULT_DIR/$base.csv"

  echo "### $(date) — Processing $json" | tee -a "$log"

  # Load all SNIs
  if jq -e 'type=="array"' "$json" >/dev/null 2>&1; then
    mapfile -t sni_arr < <(jq -r '.[].sni // empty' "$json" | sort -u)
  else
    mapfile -t sni_arr < <(jq -r '.sni // empty'   "$json" | sort -u)
  fi

  local total=${#sni_arr[@]}
  echo "[DEBUG] Loaded $total SNIs" | tee -a "$log"
  (( total == 0 )) && { echo "[WARN] Skipped (no SNIs)"; return; }

  # Determine last completed batch number
  local last_batch=0
  if [[ -f "$log" ]]; then
    last_batch=$(grep -oP '^--- Batch \K[0-9]+' "$log" | sort -n | tail -n1 || echo 0)
  fi

  local processed=$(( last_batch * SNIS_PER_BATCH ))
  echo "[RESUME] Resuming from batch $((last_batch + 1)) → SNI index $processed" | tee -a "$log"
  (( processed >= total )) && { echo "[INFO] All SNIs already processed. Skipping."; return; }

  local batch=$last_batch
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

# ── Launch one worker per JSON file ───────────────────────────────────────
worker_id=0
for f in "${json_files[@]}"; do
  (( ++worker_id ))
  echo "== Worker $worker_id processing: $f"
  ( process_json "$f" ) &
done

wait
echo "ALL JSON FILES COMPLETE"
