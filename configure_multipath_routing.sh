
# add uclouvain routing table
# sudo ip rule add from 130.104.97.46 table 130
# sudo ip route add default via 130.104.99.254 dev wlp0s20f3 table 130
# sudo ip route add 130.104.96.0/22 dev wlp0s20f3 table 130

#sudo ip rule del from 192.168.11.71 table 12


# add tun0 routing table
sudo ip rule add from 10.211.1.17 table 10
sudo ip route add default via 10.211.1.18 dev tun0 table 10
sudo ip route add 128.0.0.0/1 dev tun0 table 10

#sudo ip rule del from 192.168.34.50 table 134