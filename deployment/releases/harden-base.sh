#!/bin/sh
set -eu

# Fixed Ubuntu 26.04 security packages; never use an unversioned dist-upgrade.
openssl_version=3.5.5-1ubuntu3.7
curl_version=8.18.0-1ubuntu2.8
# Ubuntu mirrors can drop connections during parallel CI image builds.
# Retry downloads, bound each connection attempt, and reject incomplete indexes.
apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 \
  -o Acquire::https::Timeout=30 -o APT::Update::Error-Mode=any update
apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 \
  -o Acquire::https::Timeout=30 install -y --no-install-recommends \
  "libssl3t64=$openssl_version" "openssl=$openssl_version" \
  "openssl-provider-legacy=$openssl_version" \
  "curl=$curl_version" "libcurl4t64=$curl_version" \
  "libcurl3t64-gnutls=$curl_version"
# WFM images start Node directly; Pebble is not an entrypoint or runtime service.
rm -f /usr/bin/pebble
rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*
rm -f /var/log/apt/* /var/log/dpkg.log /var/log/alternatives.log /var/cache/ldconfig/aux-cache

# Preserve the previous release's UID/GID for existing named/bind volumes.
if [ "$(id -u pwuser)" != 1000 ]; then
  test "$(id -u ubuntu)" = 1000
  userdel ubuntu
  if getent group ubuntu >/dev/null; then groupdel ubuntu; fi
  usermod -u 1000 pwuser
  groupmod -g 1000 pwuser
  chown -R pwuser:pwuser /home/pwuser
fi
test "$(id -u pwuser)" = 1000
test "$(id -g pwuser)" = 1000
