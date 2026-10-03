FROM alpine:3.22.2
RUN apk add --no-cache iptables ip6tables
COPY guard.sh /usr/local/bin/guard
RUN chmod 0555 /usr/local/bin/guard
ENTRYPOINT ["/usr/local/bin/guard"]
