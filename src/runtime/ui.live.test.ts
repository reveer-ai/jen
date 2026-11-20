// The UI check: the whole path from a browser to an agent's UI and back, on
// Sol (openai/gpt-6-sol), against a runtime of its own. A root with
// workspace is spawned and its page opened in headless Chromium, through the
// runtime's relay as the owner opens it. The check types a task in the
// textbox asking for a UI with a button that asks the agent, clicks that
// button once the page has swapped in a version above 0, and passes when the
// agent receives the ask from that version. It doesn't check what the agent
// does with it. Uses JEN_LIVE_API_KEY
// and JEN_LIVE_BASE_URL, and the model is always Sol. Skipped when the key is
// missing; with it set, a missing Docker fails the check. It prints the UI the
// agent published and its transcript.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { chromium } from "playwright";
import { expect, test } from "vitest";
import type { Item } from "../agent/model/port.ts";

const apiKey = process.env.JEN_LIVE_API_KEY;
const baseURL = process.env.JEN_LIVE_BASE_URL;
const SOL = "openai/gpt-6-sol";
// How long the agent may take to publish.
const PUBLISH_MS = 300_000;

const TASK = 'Make me a UI with a button labeled "Ping". Clicking it should ask you something, with the context "ping".';

test.skipIf(!apiKey)("the agent's published UI shows, and a click in it asks the agent", { timeout: 600_000 }, async () => {
  for (const target of ["agent", "runtime", "workspace"]) {
    docker(["build", "--target", target, "-t", `jen-${target}`, join(import.meta.dirname, "../..")], { timeout: 240_000 });
  }
  const name = `jen-live-${randomBytes(4).toString("hex")}`;
  const ownerToken = randomBytes(32).toString("hex");
  const owner = { Authorization: `Bearer ${ownerToken}` };
  const env = { ...process.env, JEN_RUNTIME_NAME: name, JEN_OWNER_TOKEN: ownerToken, JEN_MODEL: SOL, JEN_API_KEY: apiKey, JEN_BASE_URL: baseURL };
  const names = ["JEN_RUNTIME_NAME", "JEN_OWNER_TOKEN", "JEN_MODEL", "JEN_API_KEY", ...(baseURL ? ["JEN_BASE_URL"] : [])];
  const browser = await chromium.launch();
  const items: Item[] = [];
  const watch = new AbortController();
  try {
    docker(["run", "-d", "--name", `${name}-runtime`, "-p", "127.0.0.1::8080", "-v", "/var/run/docker.sock:/var/run/docker.sock", ...names.flatMap((n) => ["-e", n]), "jen-runtime"], { env });
    const port = docker(["port", `${name}-runtime`, "8080/tcp"]).trim().split("\n")[0]!.split(":").at(-1);
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; !(await fetch(base).catch(() => undefined)); attempt++) {
      if (attempt === 100) throw new Error("the runtime didn't serve");
      await sleep(300);
    }
    const spawned = await fetch(`${base}/agents`, { method: "POST", headers: owner, body: JSON.stringify({ grant: { spawn: false, workspace: true }, name: "ui" }) });
    const root: string = (await spawned.json()).id;
    void stream(`${base}/agents/${root}/events`, owner, items, watch.signal);
    const latest = async () => (await (await fetch(`${base}/agents/${root}/ui`, { headers: owner })).json()) as { version: number; document: string };

    const page = await browser.newPage();
    await page.goto(`${base}/agents/${root}/page#token=${ownerToken}`);
    const ui = page.frameLocator("iframe");
    // The textbox, version 0.
    await expect.poll(() => page.locator("iframe").getAttribute("title")).toBe("UI, version 0");
    await ui.locator("textarea").fill(TASK);
    await ui.getByRole("button", { name: "Send" }).click();

    // The textbox's ask reaches the agent.
    await expect.poll(() => asks(items).length, { timeout: 30_000 }).toBe(1);
    expect(asks(items)[0]).toMatch(/^Asked from your UI, version 0:\n/);

    // The page swaps in a UI of the agent's own, live.
    await expect.poll(() => page.locator("iframe").getAttribute("title"), { timeout: PUBLISH_MS, interval: 1000 }).not.toBe("UI, version 0");
    const shown = await latest();
    await expect.poll(() => page.locator("iframe").getAttribute("title")).toBe(`UI, version ${shown.version}`);
    console.log(`The agent's UI, version ${shown.version}:\n${shown.document}`);
    await ui.getByRole("button", { name: /ping/i }).first().click();

    // Its ask reaches the agent as a message from the owner, from that version.
    // It may wait in the inbox until the agent's next step.
    await expect.poll(() => asks(items).length, { timeout: PUBLISH_MS, interval: 1000 }).toBe(2);
    expect(asks(items)[1]).toMatch(new RegExp(`^Asked from your UI, version ${shown.version}:\n.*ping`, "is"));
    await fetch(`${base}/agents/${root}`, { method: "DELETE", headers: owner });
  } finally {
    watch.abort();
    console.log(`Transcript:\n${transcript(items)}`);
    await browser.close();
    const quiet = (args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 60_000 });
    const containers = quiet(["ps", "-aq", "--filter", `label=jen.runtime=${name}`]).stdout.split("\n").filter(Boolean);
    quiet(["rm", "-f", `${name}-runtime`, ...containers]);
    const volumes = quiet(["volume", "ls", "-q", "--filter", `label=jen.runtime=${name}`]).stdout.split("\n").filter(Boolean);
    if (volumes.length > 0) quiet(["volume", "rm", ...volumes]);
    quiet(["network", "rm", name]);
  }
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The texts of the asks that reached the agent, in order.
const asks = (items: Item[]): string[] => items.flatMap((item) => (item.type === "message" && item.role === "user" && item.text.startsWith("Asked from your UI") ? [item.text] : []));

// Reads the agent's event stream into items until aborted.
async function stream(url: string, headers: Record<string, string>, items: Item[], signal: AbortSignal) {
  try {
    const res = await fetch(url, { headers, signal });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block.match(/^data: (.*)$/m)?.[1];
        if (/^event: item$/m.test(block) && data) items.push(JSON.parse(data));
        else if (/^event: error$/m.test(block) && data) items.push({ type: "message", role: "assistant", text: `[error event] ${data}` });
      }
    }
  } catch {
    // Aborted at the end of the run.
  }
}

function transcript(items: Item[]): string {
  const flat = (text: string) => text.replace(/\n/g, " / ").slice(0, 300);
  return items
    .map((item) => {
      if (item.type === "message") return `${item.role === "user" ? "<-" : "says:"} ${flat(item.text)}`;
      if (item.type === "tool_call") return `call ${item.name} ${flat(JSON.stringify(item.input))}`;
      return `  = ${flat(item.output)}`;
    })
    .join("\n");
}

function docker(args: string[], options: { env?: NodeJS.ProcessEnv; timeout?: number } = {}): string {
  const run = spawnSync("docker", args, { encoding: "utf8", timeout: 60_000, ...options });
  if (run.status !== 0) throw new Error(`docker ${args[0]} failed: ${run.stderr || run.error?.message}`);
  return run.stdout;
}
