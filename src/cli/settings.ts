// jen's settings: the model, its base URL and key, the owner token jen makes
// up once, and the port the runtime was last published on. They're kept in a
// volume of the command's own, <name>-settings, as settings.json, so nothing
// of jen's lives outside Docker. The runtime never mounts it: it gets the
// settings in its environment when jen starts it. Reading and writing the
// volume takes a short-lived container of the runtime's image, so while the
// runtime runs, its token and port are read from its container instead.

import { randomBytes } from "node:crypto";
import { DockerError, type Docker } from "./docker.ts";

export interface Settings {
  model: string;
  apiKey: string;
  // Empty for OpenAI's endpoint.
  baseURL: string;
  ownerToken: string;
  port?: number;
}

// What jen's runtime and images are called, from the environment.
export interface Names {
  name: string;
  runtimeImage: string;
  agentImage: string;
  workspaceImage: string;
}

export function namesFrom(env: NodeJS.ProcessEnv): Names {
  return {
    name: env.JEN_RUNTIME_NAME || "jen",
    runtimeImage: env.JEN_RUNTIME_IMAGE || "jen-runtime",
    agentImage: env.JEN_AGENT_IMAGE || "jen-agent",
    workspaceImage: env.JEN_WORKSPACE_IMAGE || "jen-workspace",
  };
}

// The Dockerfile target each image is built from.
export const TARGETS = { runtimeImage: "runtime", agentImage: "agent", workspaceImage: "workspace" } as const;

export const settingsVolume = (name: string) => `${name}-settings`;
export const runtimeContainer = (name: string) => `${name}-runtime`;

// An image jen needs that isn't there, named with the command that builds it.
export class MissingImage extends Error {
  constructor(image: string, target: string) {
    super(`The image ${image} is missing. Build it from jen's checkout with: docker build --target ${target} -t ${image} .`);
    this.name = "MissingImage";
  }
}

// What the user can do about something, as opposed to a fault.
export class Refusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Refusal";
  }
}

// Asks the user questions, on stderr, so stdout keeps only a command's result.
export interface Terminal {
  // Whether stdin is a terminal, so questions can be asked.
  interactive: boolean;
  ask(question: string): Promise<string>;
  // Asks without echoing the answer.
  askHidden(question: string): Promise<string>;
}

// The settings in the volume, or undefined when there are none yet.
export async function readSettings(docker: Docker, names: Names): Promise<Settings | undefined> {
  const volume = settingsVolume(names.name);
  // docker run would create a missing volume, without jen's labels.
  if (!(await docker.volumeExists(volume))) return undefined;
  const args = ["--rm", "--network", "none", "-v", `${volume}:/settings:ro`, "--entrypoint", "cat", names.runtimeImage, "/settings/settings.json"];
  const output = await docker.run(args);
  if (output.code !== 0) {
    if (/No such file/i.test(output.stderr)) return undefined;
    throw new DockerError(["run"], output);
  }
  try {
    const parsed = JSON.parse(output.stdout);
    const { model, apiKey, baseURL = "", ownerToken, port } = parsed ?? {};
    if ([model, apiKey, baseURL, ownerToken].every((v) => typeof v === "string") && (port === undefined || Number.isSafeInteger(port))) {
      return { model, apiKey, baseURL, ownerToken, ...(port === undefined ? {} : { port }) };
    }
  } catch {}
  // Settings that can't be read are asked for again, like missing ones.
  return undefined;
}

// Replaces the settings whole: written to a temporary file renamed over the
// old one, so a write cut short leaves them as they were. The key is in the
// container's stdin, never its arguments.
export async function writeSettings(docker: Docker, names: Names, settings: Settings): Promise<void> {
  const volume = settingsVolume(names.name);
  await docker.createVolume(volume, { "jen.runtime": names.name, "jen.settings": "" });
  const script = "cat > /settings/.settings.json.tmp && mv /settings/.settings.json.tmp /settings/settings.json";
  const args = ["--rm", "-i", "--network", "none", "-v", `${volume}:/settings`, "--entrypoint", "sh", names.runtimeImage, "-c", script];
  const output = await docker.run(args, { input: JSON.stringify(settings), guard: [settings.apiKey, settings.ownerToken] });
  if (output.code !== 0) throw new DockerError(["run"], output);
}

// The running runtime's token and port, read from its container with no
// container started, or undefined when it isn't running or not yet published.
export async function runningRuntime(docker: Docker, names: Names): Promise<{ token: string; port: number } | undefined> {
  const container = runtimeContainer(names.name);
  const details = await docker.inspect(container);
  if (!details || !alive(details.state)) return undefined;
  const token = details.env.find((e) => e.startsWith("JEN_OWNER_TOKEN="))?.slice("JEN_OWNER_TOKEN=".length);
  const port = await docker.port(container);
  if (!token || port === undefined) return undefined;
  return { token, port };
}

export const alive = (state: string) => state === "running" || state === "restarting";

// The key as it's shown: its last four characters at most.
export const mask = (key: string) => (key.length > 8 ? `…${key.slice(-4)}` : "…");

// Asks for the model, the base URL and the key, in that order, showing each
// current value, and keeping it on an empty answer. The model and the key are
// required, so with no current value they're asked again. The owner token is
// made up the first time, and kept.
export async function askSettings(terminal: Terminal, current?: Settings): Promise<Settings> {
  const required = async (ask: () => Promise<string>, kept: string | undefined) => {
    for (;;) {
      const answer = (await ask()).trim();
      if (answer !== "") return answer;
      if (kept) return kept;
    }
  };
  const shown = (value: string | undefined) => (value ? ` [${value}]` : "");
  const model = await required(() => terminal.ask(`Model${shown(current?.model)}: `), current?.model);
  const baseURL = (await terminal.ask(`Base URL, empty for OpenAI's${shown(current?.baseURL)}: `)).trim() || current?.baseURL || "";
  const apiKey = await required(() => terminal.askHidden(`Model key${current?.apiKey ? ` [${mask(current.apiKey)}]` : ""}: `), current?.apiKey);
  return {
    model,
    baseURL,
    apiKey,
    ownerToken: current?.ownerToken ?? randomBytes(32).toString("hex"),
    ...(current?.port === undefined ? {} : { port: current.port }),
  };
}
