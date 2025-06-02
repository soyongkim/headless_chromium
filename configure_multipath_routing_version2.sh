#!/bin/bash

WLAN_IF=$1
TUN_IF=$2

if [[ -z "$WLAN_IF" || -z "$TUN_IF" ]]; then
  echo "Usage: $0 <wlan_interface> <tun_interface>"
  exit 1
fi

# Get dynamic IPs
UCL_IP=$(ip -4 addr show "$WLAN_IF" | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -n1)
VPN_IP=$(ip -4 addr show "$TUN_IF" | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -n1)

if [[ -z "$UCL_IP" || -z "$VPN_IP" ]]; then
  echo "[ERROR] Could not find IP for one of the interfaces"
  exit 1
fi

echo "[INFO] UCL IP  = $UCL_IP on $WLAN_IF"
echo "[INFO] VPN IP  = $VPN_IP on $TUN_IF"

# Remove old rules and flush routing tables
sudo ip rule del from "$UCL_IP" table 130 2>/dev/null
sudo ip rule del from "$VPN_IP" table 10 2>/dev/null
sudo ip route flush table 130
sudo ip route flush table 10

# Add new rules
sudo ip rule add from "$UCL_IP" table 130
sudo ip rule add from "$VPN_IP" table 10

# Copy routes associated with the interface into the custom table
copy_routes() {
    local IFACE=$1
    local TABLE=$2
    echo "[INFO] Copying routes from main table for $IFACE into table $TABLE..."

    ip route show table main | grep "dev $IFACE" | while read -r route; do
        echo "  + $route"
        sudo ip route add $route table $TABLE

        # Try to test one IP from the route
        DEST=$(echo "$route" | awk '{print $1}')
        if [[ "$DEST" == "default" ]]; then
            continue  # skip unreachable test for default route
        fi

        # Use first IP in range (or exact IP if /32)
        TEST_IP=$(ipcalc -n "$DEST" 2>/dev/null | grep -Po 'Address:\s*\K[\d.]+' || echo "$DEST")
        if [[ -n "$TEST_IP" ]]; then
            echo "    ↪ testing: ping -c 1 -I $IFACE $TEST_IP"
            ping -c 1 -W 1 -I "$IFACE" "$TEST_IP" >/dev/null && \
                echo "    ✅ Reachable: $TEST_IP" || \
                echo "    ❌ Unreachable: $TEST_IP"
        fi
    done
}

# Check if `ipcalc` exists
if ! command -v ipcalc &>/dev/null; then
    echo "[WARN] 'ipcalc' not found — subnet testing will be limited."
fi

copy_routes "$WLAN_IF" 130
copy_routes "$TUN_IF" 10

echo "[DONE] Source-based routing configured with route verification."
