FROM node:26-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir /state && chown node:node /state
USER node
VOLUME /state
ENTRYPOINT ["node", "src/main.ts"]
