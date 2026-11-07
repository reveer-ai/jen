// The agent's entrypoint in its container: serves the protocol on port 8080
// until stopped. See server.ts for the routes and loop.ts for the work.

import { openStore } from "./store.ts";
import { OpenAIResponsesModel } from "./model/openai-responses.ts";
import { Agent } from "./loop.ts";
import { delegationTools, instructions, readIdentity, RuntimeClient, type Identity } from "./delegation.ts";
import { createServer } from "./server.ts";
import { VARIANT, STYLE } from "./variant.ts";

// Node is PID 1 in the container, which gets no default signal handling.
// Every finished step is already saved, and the next start resumes from it.
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

for (const name of ["JEN_MODEL", "JEN_API_KEY", "JEN_TOKEN"]) {
  if (!process.env[name]) fail(`${name} is not set`);
}
let identity: Identity;
try {
  identity = readIdentity(process.env);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const token = process.env.JEN_TOKEN!;
const runtime = new RuntimeClient(process.env.JEN_RUNTIME_URL || "http://runtime:8080", token);
const store = openStore("/state/agent.db");
const agent = new Agent({
  store,
  model: new OpenAIResponsesModel({
    model: process.env.JEN_MODEL!,
    apiKey: process.env.JEN_API_KEY!,
    baseURL: process.env.JEN_BASE_URL || undefined,
  }),
  tools: delegationTools(identity, runtime),
  instructions: instructions(identity),
  wake: identity.wake,
  wait: VARIANT === "bc" && identity.grant.spawn,
  label: STYLE === "anon" ? (from) => (from === identity.parent ? "" : from) : undefined,
  // LAB: a turn's final text is the reply to the parent; a root's stays on its stream.
  reply:
    identity.parent === "owner"
      ? undefined
      : async (text) => void (await runtime.request("POST", `/agents/${encodeURIComponent(identity.parent)}/messages`, { text })),
  // A root's parent is the owner, who reads its event stream instead.
  report:
    identity.parent === "owner"
      ? undefined
      : async (text) => void (await runtime.request("POST", `/agents/${encodeURIComponent(identity.parent)}/messages`, { text })),
});
agent.on("failure", (message: string) => process.stderr.write(`jen: model call failed: ${message}\n`));
const server = createServer({ store, agent, token });
agent.start();
// Every interface, so docker run -p can reach it.
server.listen(8080, "0.0.0.0", () => {
  process.stderr.write("jen: listening on 8080\n");
});

function fail(message: string): never {
  process.stderr.write(`jen: ${message}\n`);
  process.exit(1);
}
