#!/bin/bash

# Directory containing your files
TARGET_DIR="list_ipv4"

# Process each JSON file
for file in "$TARGET_DIR"/*.json; do
  echo "Fixing: $file"

  # Remove trailing comma if present, then wrap in square brackets
  tmp_file="${file}.tmp"

  # Ensure correct formatting
  echo "[" > "$tmp_file"
  sed '$s/},$/}/' "$file" >> "$tmp_file"  # fix last line's comma
  echo "]" >> "$tmp_file"

  # Replace original file
  mv "$tmp_file" "$file"
done

echo "✅ All files in '$TARGET_DIR' wrapped in [ ] and cleaned."
