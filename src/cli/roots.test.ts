import { afterEach, expect, test } from "vitest";
import { ApiError } from "./api.ts";
import { harness } from "./harness.ts";
import { listRoots, newRoot, openRoot, query, stopRoot } from "./roots.ts";
import { ensureRuntime } from "./runtime.ts";
import { Refusal } from "./settings.ts";

let close: (() => Promise<void>) | undefined;
async function setup() {
  const h = await harness();
  close = () => h.api.close();
  return h;
}
afterEach(() => close?.());

test("jen new creates a running root with spawn and workspace", async () => {
  const { ctx, api, out } = await setup();
  await newRoot(ctx, "home");
  expect([...api.agents.values()]).toEqual([{ id: expect.any(String), parent: null, name: "home", grant: { spawn: true, workspace: true }, state: "running" }]);
  expect(out).toEqual(["Created @home. Talk to it with: jen @home <query>"]);
});

test("a name in use, or a malformed one, is the runtime's refusal, and creates nothing", async () => {
  const { ctx, api } = await setup();
  await newRoot(ctx, "home");
  await expect(newRoot(ctx, "home")).rejects.toMatchObject({ status: 409, message: "a root agent is already named home" });
  await expect(newRoot(ctx, "Home")).rejects.toBeInstanceOf(ApiError);
  expect(api.agents.size).toBe(1);
});

test("jen list shows named roots by name with their state, then roots without a name by ID", async () => {
  const { ctx, api, out } = await setup();
  await ensureRuntime(ctx);
  api.add({ name: "work", state: "stopped" });
  const home = api.add({ name: "home" });
  api.add({ parent: home.id, name: null });
  api.add({ id: "0123456789ab", name: null, state: "stopped" });
  await listRoots(ctx);
  expect(out).toEqual(["@home         running", "@work         stopped", "0123456789ab  stopped  (no name, so jen can't address it)"]);
});

test("jen list with no roots says how to make one", async () => {
  const { ctx, out } = await setup();
  await listRoots(ctx);
  expect(out).toEqual(["No root agents yet. Create one with: jen new <name>"]);
});

test("jen stop @home stops home and its sub-agents, and leaves work and the runtime running", async () => {
  const { ctx, api, docker } = await setup();
  await ensureRuntime(ctx);
  const home = api.add({ name: "home" });
  const sub = api.add({ parent: home.id, name: null });
  const work = api.add({ name: "work" });
  await stopRoot(ctx, "home");
  expect([home, sub, work].map((a) => api.agents.get(a.id)!.state)).toEqual(["stopped", "stopped", "running"]);
  expect(docker.find("jen-runtime")!.state).toBe("running");
});

test("an unknown name suggests jen new, and sends nothing", async () => {
  const { ctx, api } = await setup();
  await ensureRuntime(ctx);
  const error = await query(ctx, "work", "hi", { interrupt: new AbortController().signal, columns: 80, write: () => {} }).catch((e) => e);
  expect(error).toBeInstanceOf(Refusal);
  expect(error.message).toBe("No root agent is named work. Create it with: jen new work");
  await expect(stopRoot(ctx, "work")).rejects.toThrow("jen new work");
  expect(api.messages).toEqual([]);
  expect(api.requests.filter((r) => r.startsWith("POST"))).toEqual([]);
});

test("jen @home open starts a stopped home, prints its page's URL with the owner token, and opens it", async () => {
  const { ctx, api, out } = await setup();
  await ensureRuntime(ctx);
  const home = api.add({ name: "home", state: "stopped" });
  const opened: string[] = [];
  await openRoot(ctx, "home", async (url) => (opened.push(url), true));
  const url = `http://127.0.0.1:${api.port}/agents/${home.id}/page#token=${api.token}`;
  expect(out).toEqual([url]);
  expect(opened).toEqual([url]);
  expect(api.agents.get(home.id)!.state).toBe("running");
});

test("with no browser to open, the URL is the result", async () => {
  const { ctx, api, out, err } = await setup();
  await ensureRuntime(ctx);
  api.add({ name: "home" });
  await openRoot(ctx, "home", async () => false);
  expect(out).toHaveLength(1);
  expect(err).toEqual(["Open that URL in a browser to see the UI."]);
});

test("a query is sent to the root by name and its reply returned", async () => {
  const { ctx, api } = await setup();
  await ensureRuntime(ctx);
  const home = api.add({ name: "home" });
  api.onMessage = (id, text) => {
    api.save(id, [{ type: "message", role: "user", from: "owner", text }]);
    api.save(id, [{ type: "message", role: "assistant", text: "heron" }]);
  };
  let written = "";
  expect(await query(ctx, "home", "Reply with just the word heron.", { interrupt: new AbortController().signal, columns: 80, write: (t) => (written += t) })).toBe(0);
  expect(written).toBe("heron\n");
  expect(api.messages).toEqual([{ id: home.id, text: "Reply with just the word heron." }]);
});
