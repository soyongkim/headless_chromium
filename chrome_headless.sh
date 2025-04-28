#!/bin/bash
./chrome-headless-shell \
  --remote-debugging-port=9222 \
  --disable-gpu \
  --no-sandbox \
  --ignore-certificate-errors \
  --proxy-server="http://localhost:4433" \
  --user-data-dir=/tmp/chrome-profile \