#!/bin/bash

INPUT_DIR="list_ipv4"
CSV_OUT="sni_results.csv"
NODE_SCRIPT="categorize_one_sni.mjs"  # we'll create this next

echo "SNI,Category,LoadTime" > "$CSV_OUT"

# For each JSON file
for file in "$INPUT_DIR"/*.json; do
  echo "Processing $file..."

  # Parse the SNI list (remove trailing dot)
  jq -r '.[].sni | rtrimstr(".")' "$file" | while read -r sni; do
    if [[ -z "$sni" ]]; then continue; fi

    echo "  → Testing: $sni"
    output=$(node "$NODE_SCRIPT" --sni="$sni")
    echo "$sni,$output" >> "$CSV_OUT"
  done
done

echo "✅ Done. Results saved to $CSV_OUT"
