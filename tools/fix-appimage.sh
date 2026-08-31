#!/usr/bin/env bash
#
# Take the Wayland client libraries back out of the AppImage.
#
#   tools/fix-appimage.sh [path-to-appimage]
#
# ## Why
#
# linuxdeploy bundles `libwayland-client`, `-cursor`, `-egl` and `-server` into
# the AppImage, and `AppRun` puts them ahead of the system's on the library
# path. The system's Mesa `libEGL` then talks Wayland protocol through a client
# library from whenever the builder was built - Ubuntu 22.04 here - while the
# compositor on the other end is current. The handshake fails and the app dies
# before it draws anything:
#
#     Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
#
# Reported by an Arch user, then reproduced and bisected under WSLg on
# 2026-09-01. Three runs, one variable:
#
#   | bundled libraries        | result                                   |
#   |--------------------------|------------------------------------------|
#   | everything, as shipped   | EGL_BAD_PARAMETER                        |
#   | minus libwayland-*       | runs clean                               |
#   | minus wayland and glib   | breaks differently, on libmount versions |
#
# So the cut has to be exactly this wide. Taking glib as well replaces one
# failure with another, which is why this removes four named libraries rather
# than everything that looks like a system library.
#
# ## Why a script rather than a bundler setting
#
# There is no setting. `tauri-bundler` runs linuxdeploy with fixed arguments and
# exposes no exclude list, so the only place to do this is after the bundle
# exists. Tauri's own answer is an unmerged draft
# (tauri-apps/tauri#12491, open since January 2025), which is not a thing that
# can be shipped from.
#
# ## The signature
#
# Repacking changes the file, so any `.sig` beside it no longer matches. The
# caller must re-sign afterwards - see the Linux job in
# `.github/workflows/build-and-release.yml`. An unsigned or stale-signed
# AppImage in the update manifest is worse than this bug, because it fails at
# update time for everybody rather than at launch for some.

set -euo pipefail

APPIMAGE="${1:-}"
if [ -z "$APPIMAGE" ]; then
  APPIMAGE=$(find src-tauri/target/release/bundle/appimage -maxdepth 1 -name '*.AppImage' | head -1)
fi
if [ -z "$APPIMAGE" ] || [ ! -f "$APPIMAGE" ]; then
  echo "no AppImage found - pass one, or build first" >&2
  exit 1
fi

APPIMAGE=$(readlink -f "$APPIMAGE")
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
echo "fixing $APPIMAGE"

# linuxdeploy's own AppImages need this on a runner with no FUSE, and so does
# appimagetool below.
export APPIMAGE_EXTRACT_AND_RUN=1

cd "$WORK"
"$APPIMAGE" --appimage-extract >/dev/null

FOUND=$(find squashfs-root/usr/lib -maxdepth 1 -name 'libwayland-*.so*' | wc -l)
if [ "$FOUND" -eq 0 ]; then
  echo "  no bundled wayland libraries - nothing to do"
  exit 0
fi
find squashfs-root/usr/lib -maxdepth 1 -name 'libwayland-*.so*' -printf '  removing %f\n'
rm -f squashfs-root/usr/lib/libwayland-*.so*

if [ ! -x "$WORK/appimagetool" ]; then
  curl -sSfL -o "$WORK/appimagetool" \
    https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage
  chmod +x "$WORK/appimagetool"
fi

# Reuse the runtime the original was built with, rather than appimagetool's.
#
# An AppImage is a runtime ELF with a squashfs stuck on the end, and the runtime
# is what mounts and starts it. appimagetool's own runtime wants libfuse2; the
# one Tauri ships does not. Repacking with the default therefore swaps this bug
# for "AppImages require FUSE to run" on every distribution that no longer
# installs libfuse2 - Arch among them, which is where this was reported.
# Measured: the repacked file failed exactly that way before this was added.
#
# `--appimage-offset` is the length of the runtime, so the first that many bytes
# of the original file are the runtime itself.
OFFSET=$("$APPIMAGE" --appimage-offset)
head -c "$OFFSET" "$APPIMAGE" > "$WORK/runtime"
echo "  reusing the original runtime ($OFFSET bytes)"

ARCH=x86_64 "$WORK/appimagetool" --runtime-file "$WORK/runtime" \
  squashfs-root "$WORK/fixed.AppImage" >/dev/null 2>&1
chmod +x "$WORK/fixed.AppImage"

# Only once the new one exists: a failed repack must not destroy the build.
mv "$WORK/fixed.AppImage" "$APPIMAGE"
echo "  repacked $(basename "$APPIMAGE") ($(stat -c%s "$APPIMAGE") bytes)"

# The signature that was made for the old bytes is now a lie. Removing it means
# a caller that forgets to re-sign gets a missing file rather than a signature
# that silently fails to verify on every update.
if [ -f "$APPIMAGE.sig" ]; then
  rm -f "$APPIMAGE.sig"
  echo "  removed the stale .sig - re-sign before publishing"
fi
