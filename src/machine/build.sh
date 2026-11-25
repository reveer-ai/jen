#!/bin/sh
# Builds jen's machine from a system root, in the Dockerfile's machine-build
# stage: build.sh <root> <out>. It writes three files into <out>:
#
#   vmlinuz      the root's kernel, decompressed, since Virtualization.framework
#                boots only an uncompressed arm64 kernel
#   initramfs    busybox, the modules that mounting the disks needs, and init
#   system.img   the root, without /boot, as squashfs
#
# The machine's version is a hash of the three and the launcher, which builds
# only on a Mac, so scripts/machine.ts and scripts/build.ts write it.
set -eu

root=$1
out=$2
here=$(dirname "$0")
kver=$(ls "$root/lib/modules")
mkdir -p "$out"

# Alpine's arm64 kernel is an EFI zboot image: "zimg" at byte 4, then the
# payload's offset and size as little-endian 32-bit numbers at 8 and 12, and
# its compression's name at 24.
kernel=$root/boot/vmlinuz-virt
[ "$(dd if="$kernel" bs=1 skip=4 count=4 2>/dev/null)" = zimg ] || { echo "build.sh: $kernel isn't a zboot image" >&2; exit 1; }
[ "$(dd if="$kernel" bs=1 skip=24 count=4 2>/dev/null)" = gzip ] || { echo "build.sh: $kernel isn't compressed with gzip" >&2; exit 1; }
offset=$(od -An -tu4 -j8 -N4 "$kernel" | tr -d ' ')
size=$(od -An -tu4 -j12 -N4 "$kernel" | tr -d ' ')
tail -c +$((offset + 1)) "$kernel" | head -c "$size" | gunzip > "$out/vmlinuz"

# The initramfs loads what mounting the two disks needs, decompressed and in
# dependency order. The system loads the rest from /etc/modules.
initramfs=$(mktemp -d)
mkdir -p "$initramfs/bin" "$initramfs/dev" "$initramfs/proc" "$initramfs/sys" "$initramfs/lib/modules" \
  "$initramfs/system" "$initramfs/rw" "$initramfs/root"
cp /bin/busybox.static "$initramfs/bin/busybox"
cp "$here/initramfs/init" "$initramfs/init"
chmod 755 "$initramfs/init"
for module in virtio_blk squashfs overlay ext4; do
  modprobe -d "$root" -S "$kver" -D "$module"
done | awk '$1 == "insmod" && !seen[$2]++ { print $2 }' | while read -r path; do
  name=$(basename "$path" .gz)
  gunzip -c "$path" > "$initramfs/lib/modules/$name"
  echo "$name" >> "$initramfs/lib/modules/order"
done
(cd "$initramfs" && find . | sort | cpio -o -H newc -R 0:0 --quiet | gzip -9n) > "$out/initramfs"
rm -rf "$initramfs"

# squashfs pads the image to 4 KiB, a multiple of the 512-byte blocks a disk
# image needs.
rm -rf "$root/boot"
mksquashfs "$root" "$out/system.img" -comp zstd -noappend -quiet -no-progress
