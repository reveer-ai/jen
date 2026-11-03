// The agent's entrypoint in its container: serves the protocol on port 8080
// until stopped. See server.ts for the routes.

import { openStore } from "./store.ts";
import { OpenAIResponsesModel } from "./model/openai-responses.ts";
import { createServer } from "./server.ts";

// Node is PID 1 in the container, which gets no default signal handling.
// Exiting mid-turn saves nothing, and clients reconnect with Last-Event-ID.
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

for (const name of ["JEN_MODEL", "JEN_API_KEY", "JEN_TOKEN"]) {
  if (!process.env[name]) fail(`${name} is not set`);
}

const model = new OpenAIResponsesModel({
  model: process.env.JEN_MODEL!,
  apiKey: process.env.JEN_API_KEY!,
  baseURL: process.env.JEN_BASE_URL || undefined,
});
const store = openStore("/state/agent.db");
// Every interface, so docker run -p can reach it.
createServer({ store, model, token: process.env.JEN_TOKEN! }).listen(8080, "0.0.0.0", () => {
  process.stderr.write("jen: listening on 8080\n");
});

function fail(message: string): never {
  process.stderr.write(`jen: ${message}\n`);
  process.exit(1);
}
