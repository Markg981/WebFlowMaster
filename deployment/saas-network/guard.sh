#!/bin/sh
set -eu
# Drop first, before flushing anything. App services only start after /run/ready.
iptables -P OUTPUT DROP
ip6tables -P OUTPUT DROP
iptables -P FORWARD DROP
ip6tables -P FORWARD DROP
iptables -F OUTPUT
ip6tables -F OUTPUT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# Docker rewrites port 53 to its per-namespace resolver listener before filter
# OUTPUT. Restrict the destination to its resolver address, not the translated port.
iptables -A OUTPUT -d 127.0.0.11 -p udp -j ACCEPT
iptables -A OUTPUT -d 127.0.0.11 -p tcp -j ACCEPT

case "${GUARD_MODE:?GUARD_MODE required}" in
  api|worker)
    iptables -A OUTPUT -d 172.29.240.10 -p tcp --dport 5432 -j ACCEPT
    iptables -A OUTPUT -d 172.29.240.11 -p tcp --dport 6379 -j ACCEPT
    iptables -A OUTPUT -d 172.29.241.10 -p tcp --dport 3128 -j ACCEPT
    if [ "$GUARD_MODE" = worker ]; then
      iptables -A OUTPUT -d 172.29.240.20 -p tcp --dport 5000 -j ACCEPT
    else
      # The application's own health probe and trusted self control-plane calls.
      iptables -A OUTPUT -d 127.0.0.1 -p tcp --dport 5000 -j ACCEPT
    fi
    ;;
  egress)
    # Defense in depth for DNS rebinding and mixed DNS answers. The proxy cannot
    # open a connection to reserved destinations even after Squid's DNS check.
    for block in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.88.99.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
      iptables -A OUTPUT -d "$block" -j REJECT
    done
    for block in ::/3 4000::/2 8000::/1 2001::/23 2001:db8::/32 2002::/16 3fff::/20; do
      ip6tables -A OUTPUT -d "$block" -j REJECT
    done
    iptables -A OUTPUT -p tcp -j ACCEPT
    ip6tables -A OUTPUT -p tcp -j ACCEPT
    ;;
  *) echo 'Invalid guard mode' >&2; exit 1 ;;
esac
touch /run/ready
trap 'rm -f /run/ready; exit 0' TERM INT
while :; do sleep 3600 & wait $!; done
