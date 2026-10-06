#!/bin/sh
set -eu

# Fixed Ubuntu 26.04 security packages; never use an unversioned dist-upgrade.
openssl_version=3.5.5-1ubuntu3.7
apt-get update
apt-get install -y --no-install-recommends \
  "libssl3t64=$openssl_version" "openssl=$openssl_version" \
  "openssl-provider-legacy=$openssl_version"
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
