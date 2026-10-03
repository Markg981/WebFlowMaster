FROM node:22.21.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends squid ca-certificates && rm -rf /var/lib/apt/lists/*
COPY policy.mjs /opt/policy.mjs
COPY egress.sh /usr/local/bin/egress
RUN chmod 0555 /usr/local/bin/egress
USER proxy
ENTRYPOINT ["/usr/local/bin/egress"]
