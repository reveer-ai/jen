# Three images from one checkout: docker build --target agent -t jen-agent .,
# docker build --target runtime -t jen-runtime . and
# docker build --target workspace -t jen-workspace .

# An agent: only src/agent/ and its dependencies, run as uid 1000.
FROM node:26-slim AS agent
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/agent ./src/agent
RUN mkdir /state && chown node:node /state
USER node
VOLUME /state
EXPOSE 8080
ENTRYPOINT ["node", "src/agent/main.ts"]

# The runtime: only src/runtime/, which uses Node's built-ins alone, run as
# root so it can use the engine's socket. package.json makes it an ES module.
FROM node:26-slim AS runtime
WORKDIR /app
COPY package.json ./
COPY src/runtime ./src/runtime
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
