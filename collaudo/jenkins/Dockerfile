# Jenkins for INT-08: the shared library of integrations/jenkins run as a customer would run it.
# Configured entirely by casc.yaml; no setup wizard.
FROM jenkins/jenkins:lts-jdk17

USER root
# The library downloads the CLI and runs it with Node on the agent: here the built-in node.
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs git \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*'
USER jenkins

RUN jenkins-plugin-cli --plugins \
    configuration-as-code job-dsl workflow-aggregator git credentials-binding junit

ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false -Dhudson.plugins.git.GitSCM.ALLOW_LOCAL_CHECKOUT=true" \
    CASC_JENKINS_CONFIG=/var/jenkins_home/casc.yaml
COPY --chown=jenkins:jenkins casc.yaml /var/jenkins_home/casc.yaml
