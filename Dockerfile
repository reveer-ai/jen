# Three images from one checkout: docker build --target agent -t jen-agent .,
# docker build --target runtime -t jen-runtime . and
# docker build --target workspace -t jen-workspace .

# An agent: only src/agent/ and its dependencies, with jen's LICENSE and
# NOTICE, run as uid 1000.
FROM node:26-slim AS agent
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/agent ./src/agent
COPY LICENSE NOTICE ./
RUN mkdir /state && chown node:node /state
USER node
VOLUME /state
EXPOSE 8080
ENTRYPOINT ["node", "src/agent/main.ts"]

# The runtime: only src/runtime/, which uses Node's built-ins alone, with
# jen's LICENSE and NOTICE, run as root so it can use the engine's socket.
# package.json makes it an ES module.
FROM node:26-slim AS runtime
WORKDIR /app
COPY package.json ./
COPY src/runtime ./src/runtime
COPY LICENSE NOTICE ./
EXPOSE 8080
ENTRYPOINT ["node", "src/runtime/main.ts"]

# A workspace, where an agent's commands run: the agent's whole toolset and
# none of jen's code, since a workspace has no network to install anything
# with. The base image's node user is renamed agent (uid 1000), whose home is
# the workspace volume. The runtime sends what runs each command with it.
FROM node:26-slim AS workspace
RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 procps curl ripgrep jq \
  && rm -rf /var/lib/apt/lists/* \
  && groupmod -n agent node \
  && usermod -l agent -d /home/agent -m node
USER agent
WORKDIR /home/agent
ENTRYPOINT []
CMD ["sleep", "infinity"]

# jen's machine for an Apple silicon Mac, a Linux VM whose only job is to give
# jen a Docker engine: docker build --target machine --output dist/machine .
# It exports the kernel, the initramfs and the system disk, which
# src/machine/build.sh describes. Alpine is pinned by digest and its kernel by
# minor version, since Alpine keeps only each package's latest patch in a
# release, so an exact pin would stop building. The engine is Docker's own
# static build for Linux, pinned exactly and checked against its checksum, with
# the same version as the macOS client in scripts/machine.ts. Alpine's runc,
# built against musl, starts every container with signal 34 ignored.
FROM --platform=linux/arm64 alpine:3.24.4@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf AS machine-system
ARG DOCKER_ENGINE=29.9.3
ADD --checksum=sha256:1b27fd739378ef938401e81ce5afb73b7ad7432d4f598814a9ff5f826bb464d2 \
  https://download.docker.com/linux/static/stable/aarch64/docker-${DOCKER_ENGINE}.tgz /tmp/docker.tgz
RUN apk add --no-cache openrc busybox-openrc ifupdown-ng socat e2fsprogs ca-certificates iptables \
  linux-virt~6.18 docker-openrc \
  && tar -xzf /tmp/docker.tgz -C /usr/bin --strip-components 1 \
    docker/dockerd docker/containerd docker/containerd-shim-runc-v2 docker/runc docker/docker-init docker/docker-proxy \
  && rm /tmp/docker.tgz \
  && addgroup -S docker
COPY src/machine/system/ /
RUN for s in devfs dmesg; do rc-update add $s sysinit; done \
  && for s in modules sysctl hostname bootmisc networking seedrng; do rc-update add $s boot; done \
  && for r in engine port clock stop; do ln -s jen-relay /etc/init.d/jen-relay.$r && rc-update add jen-relay.$r default; done \
  && rc-update add docker default \
  && for s in killprocs mount-ro savecache; do rc-update add $s shutdown; done

FROM --platform=linux/arm64 alpine:3.24.4@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf AS machine-build
RUN apk add --no-cache busybox-static cpio kmod squashfs-tools
COPY --from=machine-system / /rootfs/
COPY src/machine/build.sh /build/
COPY src/machine/initramfs /build/initramfs/
RUN sh /build/build.sh /rootfs /out

FROM scratch AS machine
COPY --from=machine-build /out/ /
