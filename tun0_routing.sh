# add tun0 routing table
sudo ip rule add from 10.211.1.57 table 10
sudo ip route add 0.0.0.0/1 via 10.211.1.58 dev tun0 table 10
sudo ip route add 10.211.1.58/32 dev tun0 table 10
#sudo ip route add 128.0.0.1/1 via 10.211.1.126 dev tun0 table 10


# sudo ip route add 0.0.0.0/1 via 10.211.1.118 dev tun0
# sudo ip route add 10.211.1.118/32 dev tun0
# sudo ip route add 128.0.0.0/1 via 10.211.1.118 dev tun0

#sudo ip rule del from 192.168.34.50 table 134