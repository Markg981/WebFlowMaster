# Build the repository's Dockerfile.agent first and tag it webflowmaster-agent:1.3.0.
FROM webflowmaster-agent:1.3.0
USER root
COPY deployment/bdd-agent/sample /support
RUN cd /support && npm ci --omit=dev && chown -R root:root /support && chmod -R a-w /support
COPY deployment/bdd-agent/profiles.example.json /etc/wfm/bdd-profiles.json
ENV WFM_BDD_PROFILES=/etc/wfm/bdd-profiles.json
USER pwuser
