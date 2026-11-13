// The sandbox check: the agent's page in a real browser, against a published
// UI that tries every way out of its frame. It needs no model and no Docker,
// so it never skips, and CI runs it on every push in its sandbox job. It
// serves the agent's own server in-process, with a scripted model and a store
// holding the hostile document, and opens the page in headless Chromium
// through Playwright. Playwright's routing stands in for the runtime's relay:
// it adds the agent's token to the page's request, which a browser opening a
// URL can't send, and stamps the sender on the page's messages. It skips
// WebRTC, which leaves the frame (see the add-agent-ui design's risks).

import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Agent } from "./loop.ts";
import { ScriptedModel } from "./model/scripted.ts";
import { createServer } from "./server.ts";
import { openStore, type Store } from "./store.ts";

const token = "sandbox-check-token-0123456789abcdef";

// A UI that tries to reach the probe at probe, and the agent's own routes at
// its page's host, in every way the design measured, and to read the page's
// token. It writes what it saw into #results, which the check reads. One
// button acts from a click. Another tries to leave the frame from a click,
// apart from the action, since a popup attempt can consume the click's
// activation before the page reads it.
function hostile(probe: string): string {
  return `<!doctype html>
<html><head>
<style>@import url("${probe}/css-import"); body { background: url("${probe}/css-url"); }</style>
<link rel="prefetch" href="${probe}/prefetch">
<link rel="stylesheet" href="${probe}/stylesheet">
<script src="${probe}/script"></script>
</head><body>
<input name="note" value="Looks good">
<input type="checkbox" name="urgent" checked>
<input type="checkbox" name="t" value="a" checked>
<input type="checkbox" name="t" value="b" checked>
<input type="checkbox" name="t" value="c">
<input value="unnamed">
<button id="act">Act</button>
<button id="escape">Escape</button>
<a id="top" href="${probe}/top-link" target="_top">top</a>
<img src="${probe}/img">
<iframe src="${probe}/iframe"></iframe>
<form id="form" action="${probe}/form" method="post"><input name="x" value="1"></form>
<pre id="results"></pre>
<script>
  const results = {};
  const attempt = (name, body) => {
    try {
      const value = body();
      results[name] = "read: " + String(value);
    } catch (error) {
      results[name] = "threw " + error.name;
    }
  };
  attempt("parent.document", () => parent.document.body.innerHTML);
  attempt("parent.sessionStorage", () => parent.sessionStorage.getItem("jen-token"));
  attempt("parent.location", () => parent.location.href);
  attempt("sessionStorage", () => sessionStorage.getItem("jen-token"));
  attempt("localStorage", () => localStorage.length);
  attempt("document.cookie", () => document.cookie);
  results.origin = origin;
  results.version = jen.version;
  for (const path of ["${probe}/fetch", "/ui?from=frame", "/events?from=frame", "/messages?from=frame"]) {
    fetch(path, { method: path.includes("messages") ? "POST" : "GET", body: path.includes("messages") ? '{"text":"from the frame"}' : undefined }).catch(() => {});
  }
  try { navigator.sendBeacon("${probe}/beacon", "x"); } catch {}
  try { new WebSocket("${probe.replace("http", "ws")}/socket"); } catch {}
  try { const x = new XMLHttpRequest(); x.open("GET", "${probe}/xhr"); x.send(); } catch {}
  try { new EventSource("${probe}/event-source"); } catch {}
  try { document.getElementById("form").submit(); } catch {}
  try { window.open("${probe}/window-open"); } catch {}
  // Actions with no user input, which the page must drop.
  jen.act("loaded");
  setTimeout(() => jen.act("timer"), 200);
  // A forged action naming another version.
  parent.postMessage({ jen: "act", version: 7, body: '{"context":"forged","inputs":{}}' }, "*");
  document.getElementById("results").textContent = JSON.stringify(results);
  document.getElementById("act").addEventListener("click", () => jen.act({ choice: "b" }));
  // Tries to leave the frame, which the sandbox refuses.
  document.getElementById("escape").addEventListener("click", () => {
    try { window.open("${probe}/window-open-click"); } catch {}
    document.getElementById("top").click();
    location.href = "${probe}/location";
  });
</script>
</body></html>`;
}

let dir: string;
let store: Store;
let agent: Agent;
let agentServer: http.Server;
let probeServer: http.Server;
let browser: Browser;
let base: string;
let probe: string;
// Every request that reached the probe, and every one that reached the agent.
const probed: string[] = [];
const served: string[] = [];

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "jen-sandbox-"));
  store = openStore(join(dir, "agent.db"));
  probeServer = http.createServer((req, res) => {
    probed.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "Access-Control-Allow-Origin": "*" }).end("probed");
  });
  probeServer.on("upgrade", (req, socket) => {
    probed.push(`UPGRADE ${req.url}`);
    socket.destroy();
  });
  probe = await listen(probeServer);
  store.publish(hostile(probe));
  agent = new Agent({ store, model: new ScriptedModel([[{ type: "message", role: "assistant", text: "ok" }]]), tools: [], instructions: "" });
  agent.start();
  agentServer = createServer({ store, agent, token });
  agentServer.prependListener("request", (req: http.IncomingMessage) => served.push(`${req.method} ${req.url}`));
  base = await listen(agentServer);
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  for (const server of [agentServer, probeServer]) {
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
  }
  store?.close();
  rmSync(dir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(check: () => T | undefined | Promise<T | undefined>, what: string, timeoutMs = 10_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

const messages = () => store.load().filter((item) => item.type === "message" && item.role === "user");

test("a hostile UI reaches no server, can't read the token, and acts only from a click", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // The runtime's relay, as far as the page needs it.
  await page.route(`${base}/page`, (route) => route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${token}` } }));
  await page.route(`${base}/messages`, (route) => route.continue({ headers: { ...route.request().headers(), "jen-from": "owner" } }));
  await page.goto(`${base}/page#token=${token}`);

  // The token leaves the address bar.
  expect(page.url()).toBe(`${base}/page`);

  const frame = await until(() => page.frames().find((f) => f !== page.mainFrame()), "the UI's frame");
  // The actions sent without user input, and the forged one, are dropped.
  // Nothing reads either frame's DOM until then: Playwright evaluates with a
  // user gesture, which would activate the page for a few seconds.
  await sleep(1500);
  expect(messages()).toEqual([]);
  expect(await page.locator("#bar-text").textContent()).toMatch(/dropped/);

  const results = await until(async () => {
    const text = await frame.locator("#results").textContent({ timeout: 10_000 });
    return text ? (JSON.parse(text) as Record<string, string | number>) : undefined;
  }, "the UI's results");
  // The frame never sees the token.
  for (const read of ["parent.document", "parent.sessionStorage", "parent.location", "sessionStorage", "localStorage", "document.cookie"]) {
    expect(results[read], read).toMatch(/^threw /);
  }
  expect(results.origin).toBe("null");
  expect(results.version).toBe(1);
  expect(await frame.evaluate(() => document.documentElement.outerHTML)).not.toContain(token);

  // A click's action reaches the inbox, in the given format.
  await page.frameLocator("iframe").locator("#act").click();
  await until(() => (messages().length > 0 ? true : undefined), "the clicked action to reach the inbox", 20_000).catch(async (error) => {
    const bar = await page.locator("#bar-text").textContent();
    throw new Error(`${error.message}. The page's bar says ${JSON.stringify(bar)}, and the agent served ${JSON.stringify(served)}`);
  });
  await agent.idle();
  expect(messages()).toEqual([
    {
      type: "message",
      role: "user",
      from: "owner",
      text: 'UI action on version 1:\n{"context":{"choice":"b"},"inputs":{"note":"Looks good","urgent":true,"t":["a","b"],"x":"1"}}',
    },
  ]);

  // A click's popup and navigations don't leave the frame, and nothing
  // reached any server but the page's own requests.
  await page.frameLocator("iframe").locator("#escape").click();
  await sleep(1500);
  expect(page.url()).toBe(`${base}/page`);
  expect(probed).toEqual([]);
  const own = new Set(["GET /page", "GET /ui", "GET /events", "POST /messages"]);
  expect(served.filter((request) => !own.has(request))).toEqual([]);
  expect(served.filter((request) => request === "POST /messages")).toHaveLength(1);
  await context.close();
}, 60_000);

test("a publish whose UI fails to load once still shows, with no other publish or reload", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route(`${base}/page`, (route) => route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${token}` } }));
  // Fails the next load of the UI once, as a passing fault would.
  let failNext = false;
  await page.route(`${base}/ui`, (route) => {
    if (!failNext) return route.continue();
    failNext = false;
    return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
  });
  await page.goto(`${base}/page#token=${token}`);
  const title = () => page.locator("iframe").getAttribute("title");
  const shown = (await store.latestUi())!.version;
  await expect.poll(title).toBe(`UI, version ${shown}`);

  // A publish the stream carries, whose load fails, and then a dropped stream.
  failNext = true;
  const version = store.publish("<p>the answer</p>");
  store.save([
    { type: "tool_call", id: "publish-again", name: "publish_ui", input: {} },
    { type: "tool_result", callId: "publish-again", output: `Published ui/index.html as version ${version}.` },
  ]);
  agent.emit("saved");
  await until(() => (failNext ? undefined : true), "the failed load");
  agentServer.closeAllConnections();

  await expect.poll(title, { timeout: 20_000 }).toBe(`UI, version ${version}`);
  await context.close();
}, 60_000);
