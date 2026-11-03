# Two images from one checkout: docker build --target agent -t jen-agent .
# and docker build --target runtime -t jen-runtime .

# An agent: everything under src/ but the runtime, run as uid 1000.
FROM node:26-slim AS agent
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --exclude=runtime src ./src
RUN mkdir /state && chown node:node /state
USER node
VOLUME /state
EXPOSE 8080
ENTRYPOINT ["node", "src/main.ts"]

# The runtime: only src/runtime/, which uses Node's built-ins alone, run as
# root so it can use the engine's socket. package.json makes it an ES module.
FROM node:26-slim AS runtime
WORKDIR /app
COPY package.json ./
COPY src/runtime ./src/runtime
EXPOSE 8080
ENTRYPOINT ["node", "src/runtime/main.ts"]
