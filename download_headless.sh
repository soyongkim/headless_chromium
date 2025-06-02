#!/bin/bash

set -e  # Exit on errors

# Define the version and URL
CHROME_VERSION="137.0.7151.55"
PLATFORM="linux64"
ARCHIVE_NAME="chrome-${PLATFORM}.zip"
DOWNLOAD_URL="https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/${PLATFORM}/chrome-${PLATFORM}.zip"

# Define output directory
OUTPUT_DIR="$(dirname "$0")/chromium"

# Create the directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Download the archive
echo "Downloading Chromium for Testing (v${CHROME_VERSION})..."
curl -L -o "${OUTPUT_DIR}/${ARCHIVE_NAME}" "${DOWNLOAD_URL}"

# Extract it
echo "Extracting Chromium..."
unzip -q "${OUTPUT_DIR}/${ARCHIVE_NAME}" -d "${OUTPUT_DIR}"

# Remove the archive (optional)
rm "${OUTPUT_DIR}/${ARCHIVE_NAME}"

echo "Chromium downloaded and extracted to: ${OUTPUT_DIR}"

