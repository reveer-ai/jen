// The commands that act on root agents by name: new, list, stop @<name>,
// @<name> open and @<name> <query>. Each starts the runtime first if it isn't
// running. A root is found by its name in the owner's list of agents.

import type { Agent, Api } from "./api.ts";
import { openURL } from "./browser.ts";
import { follow } from "./follow.ts";
import { ensureRuntime, type Context } from "./runtime.ts";
import { Refusal } from "./settings.ts";

export type Root = Agent & { name: string };

// The root named name, or a refusal suggesting jen new.
export async function findRoot(api: Api, name: string): Promise<Root> {
  const root = (await api.list()).find((a) => a.parent === null && a.name === name);
  if (!root) throw new Refusal(`No root agent is named ${name}. Create it with: jen new ${name}`);
  return root as Root;
}

// A new root can delegate, work in its workspace and publish a UI.
export async function newRoot(ctx: Context, name: string): Promise<void> {
  const api = await ensureRuntime(ctx);
  await api.spawn(name, { spawn: true, workspace: true });
  ctx.print(`Created @${name}. Talk to it with: jen @${name} <query>`);
}

// Named roots by name, then roots from before names by ID.
export async function listRoots(ctx: Context): Promise<void> {
  const api = await ensureRuntime(ctx);
  const roots = (await api.list()).filter((a) => a.parent === null);
  if (roots.length === 0) return ctx.print("No root agents yet. Create one with: jen new <name>");
  const named = roots.filter((r) => r.name !== null).sort((a, b) => a.name!.localeCompare(b.name!));
  const unnamed = roots.filter((r) => r.name === null).sort((a, b) => a.id.localeCompare(b.id));
  const width = Math.max(...roots.map((r) => (r.name === null ? r.id.length : r.name.length + 1)));
  for (const r of named) ctx.print(`${`@${r.name}`.padEnd(width)}  ${r.state}`);
  for (const r of unnamed) ctx.print(`${r.id.padEnd(width)}  ${r.state}  (no name, so jen can't address it)`);
}

// Stops the root and everything under it, keeping their state, and leaves
// the runtime running.
export async function stopRoot(ctx: Context, name: string): Promise<void> {
  const api = await ensureRuntime(ctx);
  const root = await findRoot(api, name);
  await api.stop(root.id);
  ctx.print(`Stopped @${name} and everything under it. Its conversation and files are kept.`);
}

// Prints the URL of the root's page, with the owner token in its fragment,
// and opens it where the system can. The page starts nothing, so a stopped
// root is started first.
export async function openRoot(ctx: Context, name: string, open: (url: string) => Promise<boolean> = openURL): Promise<void> {
  const api = await ensureRuntime(ctx);
  const root = await findRoot(api, name);
  if (root.state === "stopped") await api.start(root.id);
  const url = `${api.base}/agents/${root.id}/page#token=${api.token}`;
  ctx.print(url);
  if (!(await open(url))) ctx.say("Open that URL in a browser to see the UI.");
}

// Sends the query and follows the root's work until its reply.
export async function query(ctx: Context, name: string, text: string, { interrupt, columns, write }: { interrupt: AbortSignal; columns: number; write: (text: string) => void }): Promise<number> {
  const api = await ensureRuntime(ctx);
  const root = await findRoot(api, name);
  return follow({ api, root, query: text, say: ctx.say, write, columns, interrupt, sleep: ctx.sleep, now: ctx.now });
}
