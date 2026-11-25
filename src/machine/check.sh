#!/bin/sh
# Checks a booted machine from inside: nothing listens on its network, and no
# folder of the Mac's is mounted. Run it in the machine's host namespaces:
#
#   DOCKER_HOST=unix://$HOME/.jen/machines/<name>/engine.sock \
#     docker run --rm -i --network host --pid host alpine sh -s < src/machine/check.sh

failed=0
listening=$(netstat -tuln | awk 'NR > 2 && $4 !~ /^(127\.0\.0\.1|::1):/')
if [ -n "$listening" ]; then
  echo "listening on the machine's network:"
  echo "$listening"
  failed=1
fi
shared=$(awk '$3 ~ /^(virtiofs|9p|nfs|smb|cifs|fuse)/' /proc/1/mounts)
if [ -n "$shared" ]; then
  echo "mounted from outside the machine:"
  echo "$shared"
  failed=1
fi
[ "$failed" = 0 ] && echo "nothing listens on the machine's network, and nothing is mounted from the Mac"
exit "$failed"
