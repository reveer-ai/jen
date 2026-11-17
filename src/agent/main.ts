// The agent's entrypoint in its container: serves the protocol on port 8080
// until stopped. See server.ts for the routes and loop.ts for the work.

import { openStore } from "./store.ts";
import { OpenAIResponsesModel } from "./model/openai-responses.ts";
import { Agent } from "./loop.ts";
import { instructions, readIdentity, RuntimeClient, RuntimeRefusal, toolsFor, type Identity } from "./delegation.ts";
import { createServer } from "./server.ts";

// Node is PID 1 in the container, which gets no default signal handling.
// Every finished step is already saved, and the next start resumes from it.
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

for (const name of ["JEN_MODEL", "JEN_TOKEN"]) {
  if (!process.env[name]) fail(`${name} is not set`);
}
let identity: Identity;
try {
  identity = readIdentity(process.env);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const token = process.env.JEN_TOKEN!;
const runtimeURL = process.env.JEN_RUNTIME_URL || "http://runtime:8080";
const runtime = new RuntimeClient(runtimeURL, token);
const store = openStore("/state/agent.db");
const agent = new Agent({
  store,
  // The runtime makes the call with the owner's key, which no agent holds.
  // The agent's own token takes the key's place, as on every runtime route.
  model: new OpenAIResponsesModel({ model: process.env.JEN_MODEL!, apiKey: token, baseURL: `${runtimeURL.replace(/\/+$/, "")}/model` }),
  tools: toolsFor(identity, runtime, store),
  instructions: instructions(identity),
  wake: identity.wake,
  parent: identity.parent,
  wait: identity.grant.spawn,
  // A root's parent is the owner, who reads its replies on its event stream.
  post:
    identity.parent === "owner"
      ? undefined
      : async (text, signal) => {
          try {
            await runtime.request("POST", `/agents/${encodeURIComponent(identity.parent)}/messages`, { text }, signal);
            return "delivered";
          } catch (error) {
            if (error instanceof RuntimeRefusal && error.status === 404) return "gone";
            throw error;
          }
        },
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
