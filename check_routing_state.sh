echo ' -- IP Rule -- '
ip rule show
echo ' '
echo '-- Tunneled if Table (10) --'
ip route show table 10
echo ' '
echo '-- Uclouvain if table (130) --'
ip route show table 130
echo ' '
echo '-- Default Routing Table --'
ip route