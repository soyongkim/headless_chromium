#!/bin/bash
set -e

TARGET_IF=$1
if [ -z "$TARGET_IF" ]; then
  echo "❌ Please provide the interface name (e.g., eth0, tun0)"
  exit 1
fi

echo "🔍 Checking existing default routes..."
ROUTES=$(ip route | grep '^default')

# Store all current default routes
mapfile -t LINES <<< "$ROUTES"

# Track other routes for re-adding later
OTHER_ROUTES=()
METRIC=100

for LINE in "${LINES[@]}"; do
  IFACE=$(echo "$LINE" | awk '{for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1)}')
  GATEWAY=$(echo "$LINE" | awk '{print $3}')

  if [[ "$IFACE" == "$TARGET_IF" ]]; then
    TARGET_GATEWAY="$GATEWAY"
    echo "✅ Interface '$TARGET_IF' found with gateway $TARGET_GATEWAY"
  else
    OTHER_ROUTES+=("$LINE")
  fi

  echo "🧹 Deleting: $LINE"
  sudo ip route del $LINE || true
done

# Add back the selected interface first with metric 0
echo "➕ Adding default route: dev $TARGET_IF via $TARGET_GATEWAY metric 0"
sudo ip route add default via "$TARGET_GATEWAY" dev "$TARGET_IF" metric 0

# Add the rest with increasing metrics
for LINE in "${OTHER_ROUTES[@]}"; do
  IFACE=$(echo "$LINE" | awk '{for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1)}')
  GATEWAY=$(echo "$LINE" | awk '{print $3}')
  echo "➕ Adding default route: dev $IFACE via $GATEWAY metric $METRIC"
  sudo ip route add default via "$GATEWAY" dev "$IFACE" metric $METRIC
  METRIC=$((METRIC + 1))
done

echo "✅ Routing table updated!"
ip route show | grep '^default'
