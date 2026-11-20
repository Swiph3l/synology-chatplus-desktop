#!/usr/bin/env bash
# Run on an x86_64 Linux host with Docker Buildx, sudo, util-linux and /dev/fuse.
# Build only the desktop/test environment in Docker. Launch in a private
# root and network namespace, with FUSE and normal WebKit sandboxing available.
set -euo pipefail
image=$(realpath "${1:?Usage: smoke-debian.sh IMAGE EVIDENCE_DIR}")
evidence=$(realpath -m "${2:?Missing evidence directory}")
scripts=$(dirname "$(realpath "$0")")
work=$(mktemp -d)
cleanup() {
  if sudo test -d "$work/root/check/evidence"; then
    sudo tar -C "$work/root/check/evidence" -cf - . | tar --no-same-owner -C "$evidence" -xf -
  fi
  sudo rm -rf -- "$work"
}
trap cleanup EXIT
mkdir -p "$work/root" "$evidence"

docker buildx build --platform linux/amd64 --output "type=tar,dest=$work/root.tar" - <<'DOCKERFILE'
FROM debian:13-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates dbus-x11 fonts-dejavu-core fuse3 imagemagick iproute2 \
    libayatana-appindicator3-1 libegl1 libfuse2t64 libgl1 libgl1-mesa-dri libgles2 \
    libgtk-3-0t64 librsvg2-common python3 tesseract-ocr tesseract-ocr-eng \
    util-linux x11-utils xauth xdotool xvfb && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 smoke
DOCKERFILE
sudo tar -xpf "$work/root.tar" -C "$work/root"
sudo install -d "$work/root/check"
sudo install -d -o 1000 -g 1000 "$work/root/check/evidence"
sudo install -m 755 "$image" "$work/root/check/"
sudo install -m 644 "$scripts/smoke-appimage.sh" "$scripts/observe-startup.py" "$work/root/check/"

# Bind the device nodes used by FUSE and headless GUI clients. The guest has
# its own root, network, D-Bus session and evidence directory.
sudo unshare --mount --net --pid --fork bash -eu -c '
  mount --make-rprivate /
  mount --bind "$1" "$1"
  cd "$1"
  for device in null zero random urandom full tty fuse; do
    touch "dev/$device"
    mount --bind "/dev/$device" "dev/$device"
  done
  mkdir -p dev/shm
  mount -t tmpfs -o mode=1777,nosuid,nodev tmpfs dev/shm
  ln -sfn /proc/self/fd dev/fd
  mkdir .oldroot
  pivot_root . .oldroot
  mount -t proc proc /proc
  umount -l /.oldroot
  rmdir /.oldroot
  mount -t sysfs -o ro,nosuid,nodev,noexec sysfs /sys
  ip link set lo up
  dpkg-query -W > /check/evidence/debian-packages.txt
  cd /check
  exec setpriv --reuid=smoke --regid=smoke --init-groups env -i PATH=/usr/bin:/bin \
    bash smoke-appimage.sh "/check/$2" /check/evidence
' smoke "$work/root" "$(basename "$image")"
