// The runtime's entrypoint, in its own container beside its engine, with the
// engine's socket mounted. Claims its name, recovers the tree, then serves
// the API on port 8080. See server.ts for the routes.

import { hostname } from "node:os";
import { createDocker } from "./docker.ts";
import { Runtime } from "./runtime.ts";
import { createRuntimeServer } from "./server.ts";

// Node is PID 1 in the container, which gets no default signal handling.
// Agents keep running without the runtime, and a new one reads them back.
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

for (const name of ["JEN_OWNER_TOKEN", "JEN_MODEL", "JEN_API_KEY"]) {
  if (!process.env[name]) fail(`${name} is not set`);
}

const runtime = new Runtime({
  docker: createDocker(),
  name: process.env.JEN_RUNTIME_NAME || "jen",
  image: process.env.JEN_AGENT_IMAGE || "jen-agent",
  model: { model: process.env.JEN_MODEL!, apiKey: process.env.JEN_API_KEY!, baseURL: process.env.JEN_BASE_URL || undefined },
  maxDepth: count("JEN_MAX_DEPTH", 3),
  maxAgents: count("JEN_MAX_AGENTS", 10),
});

try {
  // Docker sets a container's hostname to its ID.
  await runtime.startup(hostname());
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

// Reports to each parent a sub-agent whose restarts ran out.
runtime.watch((error) => process.stderr.write(`jen-runtime: a crashed agent wasn't reported: ${error instanceof Error ? error.message : String(error)}\n`));

// Every interface, so docker run -p can reach it.
createRuntimeServer({ runtime, ownerToken: process.env.JEN_OWNER_TOKEN! }).listen(8080, "0.0.0.0", () => {
  process.stderr.write("jen-runtime: listening on 8080\n");
});

// A positive whole number from the environment, or fallback when it's unset.
function count(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) fail(`${name} must be a positive whole number`);
  return n;
}

function fail(message: string): never {
  process.stderr.write(`jen-runtime: ${message}\n`);
  process.exit(1);
}
