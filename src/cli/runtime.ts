// Starting, checking, replacing and stopping the runtime's container. Every
// command but config, uninstall and help calls ensureRuntime() first, which
// starts the runtime when it isn't running and leaves it running after.

import { Api } from "./api.ts";
import type { ContainerInfo, Docker } from "./docker.ts";
import { DockerError } from "./docker.ts";
import type { Machine } from "./machine.ts";
import {
  alive,
  askSettings,
  IMAGE_KEYS,
  MissingImage,
  pulls,
  readSettings,
  Refusal,
  REGISTRY,
  registryRepository,
  runningRuntime,
  runtimeContainer,
  TARGETS,
  writeSettings,
  type ImageKey,
  type Names,
  type Settings,
  type Terminal,
} from "./settings.ts";

export interface Context {
  docker: Docker;
  names: Names;
  terminal: Terminal;
  // Writes a line to stderr.
  say: (line: string) => void;
  // Writes a line to stdout.
  print: (line: string) => void;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  // jen's machine, on macOS.
  machine?: Machine;
}

// How long the runtime may take to answer once started.
export const READY_MS = 15_000;
const POLL_MS = 200;

type Images = Record<ImageKey, string>;

// An image's current ID, pulling an installed jen's own when it's missing,
// and failing for any other that's missing. pulled is set when it pulled.
async function image(ctx: Context, key: ImageKey, pulled?: { any: boolean }): Promise<string> {
  const name = ctx.names[key];
  const id = await ctx.docker.imageId(name);
  if (id !== undefined) return id;
  const host = ctx.machine?.docker().env.DOCKER_HOST;
  if (!pulls(ctx.names, key)) throw new MissingImage(name, TARGETS[key], host);
  ctx.say(`pulling ${name}...`);
  await ctx.docker.pull(name);
  if (pulled) pulled.any = true;
  const fetched = await ctx.docker.imageId(name);
  if (fetched === undefined) throw new MissingImage(name, TARGETS[key], host);
  return fetched;
}

// Fails naming the runtime's image when it's missing and isn't pulled, since
// the settings are read and written with it.
export async function requireRuntimeImage(ctx: Context) {
  await image(ctx, "runtimeImage");
}

// A client of the running runtime, once it's up.
export async function ensureRuntime(ctx: Context): Promise<Api> {
  const { docker, names } = ctx;
  const pulled = { any: false };
  const ids = {} as Images;
  for (const key of IMAGE_KEYS) ids[key] = await image(ctx, key, pulled);
  const runtime = await docker.inspect(runtimeContainer(names.name));
  const running = runtime !== undefined && alive(runtime.state);
  const theirs = (await docker.containers([`jen.runtime=${names.name}`])).filter((c) => alive(c.state));
  const stale = staleImages(ids, names, running ? runtime : undefined, theirs);
  if (stale.length === 0) {
    const api = running ? await connect(ctx) : await start(ctx);
    if (pulled.any) await removeOtherVersions(ctx);
    return api;
  }

  // Agents started from an image that has since changed are stopped, through
  // the runtime, since the tree is its to change. Each starts on the current
  // image at its next message.
  let api = running ? await connect(ctx) : await start(ctx);
  await stopRoots(api);
  if (running && runtime.image !== ids.runtimeImage) {
    await docker.remove(runtimeContainer(names.name));
    api = await start(ctx);
  }
  ctx.say(`${stale.join(" and ")} changed, so jen stopped every agent${running && runtime.image !== ids.runtimeImage ? " and restarted the runtime" : ""}. Each agent starts on the new image at its next message.`);
  await removeOtherVersions(ctx);
  return api;
}

// Once nothing runs on them, an installed jen removes the registry's images
// of its other versions, which an upgrade leaves behind. One a container
// still uses is passed over, as is any other failure: it's tidying, and the
// next upgrade tries again.
async function removeOtherVersions(ctx: Context) {
  const { names } = ctx;
  if (names.version === undefined) return;
  const keep = IMAGE_KEYS.filter((key) => pulls(names, key));
  if (keep.length === 0) return;
  try {
    for (const listed of await ctx.docker.listImages(`${REGISTRY}/jen-*`)) {
      const ours = keep.some((key) => listed.startsWith(`${registryRepository(key)}:`));
      if (ours && !listed.endsWith(`:${names.version}`)) await ctx.docker.removeImage(listed).catch(() => {});
    }
  } catch {}
}

// The names of the images a running container of jen's isn't on any more.
function staleImages(ids: Images, names: Names, runtime: ContainerInfo | undefined, theirs: ContainerInfo[]): string[] {
  const stale = new Set<string>();
  if (runtime && runtime.image !== ids.runtimeImage) stale.add(names.runtimeImage);
  for (const c of theirs) {
    if ("jen.agent" in c.labels && c.image !== ids.agentImage) stale.add(names.agentImage);
    if ("jen.workspace" in c.labels && c.image !== ids.workspaceImage) stale.add(names.workspaceImage);
  }
  return [...stale];
}

// Stops every running root, which stops everything under it.
export async function stopRoots(api: Api): Promise<number> {
  const roots = (await api.list()).filter((a) => a.parent === null && a.state === "running");
  for (const root of roots) await api.stop(root.id);
  return roots.length;
}

// A client of the runtime that's running, or being started by another jen,
// once it answers.
async function connect(ctx: Context): Promise<Api> {
  const deadline = ctx.now() + READY_MS;
  const container = runtimeContainer(ctx.names.name);
  for (;;) {
    const found = await runningRuntime(ctx.docker, ctx.names);
    if (found) {
      const api = new Api(`http://127.0.0.1:${found.port}`, found.token, ctx.fetch);
      if (await answers(ctx, api)) return api;
    } else {
      const details = await ctx.docker.inspect(container);
      if (details && (details.state === "exited" || details.state === "dead")) {
        const logs = await ctx.docker.logs(container, 20);
        throw new Refusal(`the runtime exited as it started${logs ? `:\n${logs}` : "."}`);
      }
      if (!details) throw new Refusal("the runtime's container was removed as it started. Try again.");
    }
    if (ctx.now() >= deadline) throw new Refusal(`the runtime didn't answer within ${READY_MS / 1000} seconds. Its output is in: docker logs ${container}`);
    await ctx.sleep(POLL_MS);
  }
}

// Whether the runtime answers at all: any HTTP answer, such as 401, will do.
async function answers(ctx: Context, api: Api): Promise<boolean> {
  try {
    await ctx.fetch(`${api.base}/agents`, { signal: AbortSignal.timeout(1_000) }).then((res) => res.body?.cancel());
    return true;
  } catch {
    return false;
  }
}

// The settings, asking for them from a terminal when there are none, or no
// base URL, from before it was required. The rest are kept, the token too.
async function settingsOrAsk(ctx: Context): Promise<Settings> {
  const settings = await readSettings(ctx.docker, ctx.names);
  if (settings && settings.baseURL !== "") return settings;
  if (!ctx.terminal.interactive) throw new Refusal(settings ? "jen's settings have no base URL. Run jen config to set it." : "jen has no settings yet. Run jen config to set the model, its base URL and its key.");
  ctx.say(settings ? "jen needs the model's base URL before it can start." : "jen needs a model, its base URL and its key before it can start.");
  const asked = await askSettings(ctx.terminal, settings);
  // A blank line between the answers and what follows.
  ctx.say("");
  await writeSettings(ctx.docker, ctx.names, asked);
  return asked;
}

// Starts the runtime's container, which isn't running, and waits for it.
export async function start(ctx: Context): Promise<Api> {
  const { docker, names } = ctx;
  const settings = await settingsOrAsk(ctx);
  const container = runtimeContainer(names.name);
  // Whatever is left of it, such as a container that exited.
  const left = await docker.inspect(container);
  if (left && !alive(left.state)) await docker.remove(container);

  const run = (port: number | undefined) =>
    docker.run(
      [
        "-d",
        "--name",
        container,
        "--label",
        `jen.runtime=${names.name}`,
        "-v",
        "/var/run/docker.sock:/var/run/docker.sock",
        "-p",
        port === undefined ? "127.0.0.1::8080" : `127.0.0.1:${port}:8080`,
        ...["JEN_OWNER_TOKEN", "JEN_MODEL", "JEN_API_KEY", "JEN_BASE_URL", "JEN_RUNTIME_NAME", "JEN_AGENT_IMAGE", "JEN_WORKSPACE_IMAGE"].flatMap((n) => ["-e", n]),
        names.runtimeImage,
      ],
      {
        env: { JEN_MODEL: settings.model, JEN_BASE_URL: settings.baseURL, JEN_RUNTIME_NAME: names.name, JEN_AGENT_IMAGE: names.agentImage, JEN_WORKSPACE_IMAGE: names.workspaceImage },
        secrets: { JEN_OWNER_TOKEN: settings.ownerToken, JEN_API_KEY: settings.apiKey },
      },
    );
  // A name already in use means another jen is starting the runtime.
  const conflict = (stderr: string) => /Conflict\. The container name .* is already in use/.test(stderr);

  // On a Mac, jen chooses a port the Mac has free, since the machine's engine
  // can't tell whether the Mac's is.
  const port = async (preferred: number | undefined) => (ctx.machine ? ctx.machine.port(preferred) : preferred);
  let output = await run(await port(settings.port));
  if (output.code !== 0 && !conflict(output.stderr) && settings.port !== undefined) {
    // The saved port is taken, most likely. Docker, or on a Mac jen, chooses
    // another.
    await docker.remove(container);
    output = await run(await port(undefined));
  }
  if (output.code !== 0 && !conflict(output.stderr)) {
    await docker.remove(container);
    throw new DockerError(["run"], output);
  }
  const api = await connect(ctx);
  if (output.code === 0) {
    // Keeping the port keeps a UI's URL the same across restarts.
    const port = Number(new URL(api.base).port);
    if (port !== settings.port) await writeSettings(docker, names, { ...settings, port });
  }
  return api;
}

// jen config: asks for the settings and saves them, then replaces a running
// runtime with one that has them. Agents keep running through that, since the
// runtime sets the model on every call itself.
export async function config(ctx: Context): Promise<void> {
  if (!ctx.terminal.interactive) throw new Refusal("jen config asks for the settings, so it needs a terminal.");
  await requireRuntimeImage(ctx);
  const current = await readSettings(ctx.docker, ctx.names);
  const settings = await askSettings(ctx.terminal, current);
  ctx.say("");
  await writeSettings(ctx.docker, ctx.names, settings);
  ctx.print("saved jen's settings.");
  if (await runningRuntime(ctx.docker, ctx.names)) {
    await ctx.docker.remove(runtimeContainer(ctx.names.name));
    await start(ctx);
    ctx.print("restarted the runtime with them. Running agents keep running.");
  }
}

// Stops every agent through the runtime, starting it first when agents run
// without it, then removes the runtime. Every volume is kept. Answers how many
// roots it stopped, or undefined when nothing of jen's was running.
async function stopEverything(ctx: Context): Promise<number | undefined> {
  const { docker, names } = ctx;
  const runtime = await docker.inspect(runtimeContainer(names.name));
  const agents = (await docker.containers([`jen.runtime=${names.name}`, "jen.agent"])).filter((c) => alive(c.state));
  if (!(runtime && alive(runtime.state)) && agents.length === 0) {
    if (runtime) await docker.remove(runtimeContainer(names.name));
    return undefined;
  }
  const api = await ensureRuntime(ctx);
  const stopped = await stopRoots(api);
  await docker.remove(runtimeContainer(names.name));
  return stopped;
}

const rootsUnder = (stopped: number) => (stopped === 1 ? "1 root agent and everything under it" : `${stopped} root agents and everything under them`);

// jen stop all: stops every agent and the runtime, and on macOS then jen's
// machine.
export async function stopAll(ctx: Context, machine?: Machine): Promise<void> {
  const stopped = await stopEverything(ctx);
  ctx.print(stopped === undefined ? "nothing of jen's is running." : `stopped ${rootsUnder(stopped)}, and the runtime. Their conversations and files are kept.`);
  if (machine && (await machine.stop(ctx))) ctx.print("stopped jen's machine.");
}

// Restarts jen's machine on the version jen holds, when it booted another,
// stopping every agent through the runtime first, as a new image does. The
// machine's data is kept.
export async function upgradeMachine(ctx: Context, machine: Machine): Promise<void> {
  if (!(await machine.outdated())) return;
  ctx.say("jen's machine has a new version, so jen is restarting it on that.");
  const stopped = await stopEverything(ctx);
  if (stopped) ctx.say(`stopped ${rootsUnder(stopped)}. Each starts again at its next message.`);
  await machine.stop(ctx);
  await machine.ensure({ start: true, say: ctx.say, sleep: ctx.sleep, now: ctx.now });
}
