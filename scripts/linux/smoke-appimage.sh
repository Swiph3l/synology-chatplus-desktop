#!/usr/bin/env bash
# Run as a regular desktop user in a network namespace with only loopback.
set -euo pipefail
image=$(realpath "${1:?Usage: smoke-appimage.sh IMAGE EVIDENCE_DIR}")
evidence=$(realpath -m "${2:?Missing evidence directory}")
script=$(realpath "$(dirname "$0")/observe-startup.py")
mkdir -p "$evidence"
if [[ $EUID == 0 || $(ip -o link show | wc -l) != 1 ]] || ! ip link show lo >/dev/null; then
  echo 'The smoke test requires a non-root user and a loopback-only network namespace.' >&2
  exit 1
fi
ip -brief link >"$evidence/interfaces.txt"
getconf GNU_LIBC_VERSION >"$evidence/host-libc.txt"
cp /etc/os-release "$evidence/os-release"
sha256sum "$image" >"$evidence/image.sha256"

# Isolate the desktop bus, all XDG paths and every service profile. Leave the
# WebKit sandbox, FUSE runtime and normal production startup path enabled.
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
export HOME="$work/home" XDG_CONFIG_HOME="$work/config" XDG_DATA_HOME="$work/data"
export XDG_CACHE_HOME="$work/cache" XDG_RUNTIME_DIR="$work/run" XDG_STATE_HOME="$work/state"
mkdir -m 700 -p "$HOME" "$XDG_RUNTIME_DIR"
unset WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS
export LANG=C.UTF-8 LC_ALL=C.UTF-8 GDK_BACKEND=x11
dbus-run-session -- xvfb-run -a -s '-screen 0 1440x900x24 -nolisten tcp' \
  python3 "$script" "$image" "$evidence"
