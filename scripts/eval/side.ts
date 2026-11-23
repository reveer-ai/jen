// A side's runtime: started from the side's images under a name of its own,
// jen-eval-<id>-<side>, and removed with everything it started. The key and
// the other settings reach the runtime's container by name from this
// process's environment, so no secret is on a command line.

import { randomBytes } from "node:crypto";
import { command, tag, TARGETS } from "./build.ts";
import { RuntimeApi } from "./run.ts";

export interface SideOptions {
  id: string;
  side: string;
  model: string;
  apiKey: string;
  baseURL?: string;
  // The most runs this side has in flight at once.
  inFlight: number;
}

// The most agents one run's tree holds at once, with room to spare: the
// nested task's is four.
const AGENTS_PER_RUN = 5;

export const runtimeName = (id: string, side: string) => `jen-eval-${id}-${side}`;

// Starts the side's runtime and resolves once it serves.
export async function startSide({ id, side, model, apiKey, baseURL, inFlight }: SideOptions): Promise<{ name: string; api: RuntimeApi }> {
  const name = runtimeName(id, side);
  const ownerToken = randomBytes(32).toString("hex");
  const settings: Record<string, string> = {
    JEN_RUNTIME_NAME: name,
    JEN_OWNER_TOKEN: ownerToken,
    JEN_MODEL: model,
    JEN_API_KEY: apiKey,
    JEN_MAX_AGENTS: String(inFlight * AGENTS_PER_RUN),
    JEN_AGENT_IMAGE: tag("agent", id, side),
    JEN_WORKSPACE_IMAGE: tag("workspace", id, side),
    ...(baseURL ? { JEN_BASE_URL: baseURL } : {}),
  };
  const env = { ...process.env, ...settings };
  const passed = Object.keys(settings).flatMap((n) => ["-e", n]);
  await command("docker", ["run", "-d", "--name", `${name}-runtime`, "-p", "127.0.0.1::8080", "-v", "/var/run/docker.sock:/var/run/docker.sock", ...passed, tag("runtime", id, side)], { env });
  const port = (await command("docker", ["port", `${name}-runtime`, "8080/tcp"])).trim().split("\n")[0]!.split(":").at(-1);
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; !(await fetch(base).catch(() => undefined)); attempt++) {
    if (attempt === 100) {
      const logs = await command("docker", ["logs", `${name}-runtime`]).catch(() => "");
      throw new Error(`the runtime ${name} didn't serve${logs ? `: ${logs.trim()}` : ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { name, api: new RuntimeApi(base, ownerToken) };
}

// Removes the side's runtime, every container, volume and network labelled
// with its name, and its image tags. Each step runs whatever the others did,
// and what's already gone is skipped.
export async function removeSide(id: string, side: string): Promise<void> {
  const name = runtimeName(id, side);
  const quiet = (args: string[]) => command("docker", args, { timeoutMs: 120_000 }).catch(() => "");
  const list = async (args: string[]) => (await quiet(args)).split("\n").filter(Boolean);
  // The runtime first, so it starts nothing more.
  await quiet(["rm", "-f", `${name}-runtime`]);
  const containers = await list(["ps", "-aq", "--filter", `label=jen.runtime=${name}`]);
  if (containers.length > 0) await quiet(["rm", "-f", ...containers]);
  const volumes = await list(["volume", "ls", "-q", "--filter", `label=jen.runtime=${name}`]);
  if (volumes.length > 0) await quiet(["volume", "rm", "-f", ...volumes]);
  await quiet(["network", "rm", name]);
  await quiet(["image", "rm", ...TARGETS.map((target) => tag(target, id, side))]);
}

// What of the side is left in Docker, for checking that removal worked.
export async function leftovers(id: string, side: string): Promise<string[]> {
  const name = runtimeName(id, side);
  const list = async (args: string[]) => (await command("docker", args)).split("\n").filter(Boolean);
  return [
    ...(await list(["ps", "-a", "--format", "{{.Names}}", "--filter", `name=${name}`])),
    ...(await list(["ps", "-a", "--format", "{{.Names}}", "--filter", `label=jen.runtime=${name}`])),
    ...(await list(["volume", "ls", "-q", "--filter", `label=jen.runtime=${name}`])),
    ...(await list(["network", "ls", "--format", "{{.Name}}", "--filter", `name=${name}`])),
    ...(await list(["image", "ls", "--format", "{{.Repository}}:{{.Tag}}"])).filter((image) => image.endsWith(`:eval-${id}-${side}`)),
  ];
}
