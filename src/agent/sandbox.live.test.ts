// The sandbox check: the agent's page in a real browser, against a published
// UI that tries every way out of its frame. It needs no model and no Docker,
// so it never skips, and CI runs it on every push in its sandbox job. It
// serves the agent's own server in-process, with a scripted model and a store
// holding the hostile document, and opens the page in headless Chromium and
// headless WebKit through Playwright, each against its own agent. Playwright's
// routing stands in for the runtime's relay: it adds the agent's token to the
// page's request, which a browser opening a URL can't send, and stamps the
// sender on the page's messages. It skips WebRTC, which leaves the frame, the
// known exception in the agent-ui spec's sandboxed-frame requirement.
// Playwright's WebKit doesn't reproduce
// Safari's dropped activation (JEN-22), so it checks that focus stays in a
// text field through a click, which is what makes Safari count it.

import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit, type Browser, type BrowserType } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Agent } from "./loop.ts";
import { ScriptedModel } from "./model/scripted.ts";
import { createServer } from "./server.ts";
import { openStore, type Store } from "./store.ts";

const token = "sandbox-check-token-0123456789abcdef";

// A UI that tries to reach the probe at probe, and the agent's own routes at
// its page's host, in every way the design measured, and to read the page's
// token. It writes what it saw into #results, which the check reads. One
// button asks the agent from a click. Another tries to leave the frame from a
// click, apart from the ask, since a popup attempt can consume the click's
// activation before the page reads it. A form of an input and a button asks
// with the input's value, the controls after it need mousedown with the input
// focused, and another form sits in an open shadow root; what their handlers
// saw goes in #seen.
function hostile(probe: string): string {
  return `<!doctype html>
<html><head>
<style>@import url("${probe}/css-import"); body { background: url("${probe}/css-url"); }</style>
<link rel="prefetch" href="${probe}/prefetch">
<link rel="stylesheet" href="${probe}/stylesheet">
<script src="${probe}/script"></script>
</head><body>
<button id="ask">Ask</button>
<button id="escape">Escape</button>
<a id="top" href="${probe}/top-link" target="_top">top</a>
<img src="${probe}/img">
<iframe src="${probe}/iframe"></iframe>
<form id="form" action="${probe}/form" method="post"><input name="x" value="1"></form>
<div><input id="field"> <button id="send">Send</button></div>
<div><textarea id="notes"></textarea></div>
<div><input id="slider" type="range" min="0" max="100" value="0" style="width: 200px"></div>
<div id="drag" draggable="true" style="width: 60px; height: 40px; background: gray">drag</div>
<div id="drop" style="width: 120px; height: 60px; background: silver">drop</div>
<div><select id="choice"><option>a</option><option>b</option></select> <span id="editable" contenteditable="true" style="display: inline-block; width: 120px; border: 1px solid">edit</span></div>
<x-form id="shadow"></x-form>
<pre id="seen"></pre>
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
  // Asks with no user input, which the page must drop.
  jen.ask("loaded");
  setTimeout(() => jen.ask("timer"), 200);
  // A forged ask naming another version.
  parent.postMessage({ jen: "ask", version: 7, body: '"forged"' }, "*");
  document.getElementById("results").textContent = JSON.stringify(results);
  document.getElementById("ask").addEventListener("click", () => jen.ask({ choice: "b" }));
  // Tries to leave the frame, which the sandbox refuses.
  document.getElementById("escape").addEventListener("click", () => {
    try { window.open("${probe}/window-open-click"); } catch {}
    document.getElementById("top").click();
    location.href = "${probe}/location";
  });
  const field = document.getElementById("field");
  const seen = {};
  const record = () => (document.getElementById("seen").textContent = JSON.stringify(seen));
  document.getElementById("send").addEventListener("click", () => {
    seen.focusedAtSend = document.activeElement === field;
    record();
    jen.ask({ text: field.value });
  });
  const drop = document.getElementById("drop");
  document.getElementById("drag").addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", "drag"));
  drop.addEventListener("dragover", (event) => event.preventDefault());
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    seen.dropped = true;
    record();
  });
  // A form inside an open shadow root, as a component kit would build it.
  customElements.define("x-form", class extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = '<input id="inner-field"> <button id="inner-send">Send</button>';
      root.getElementById("inner-send").addEventListener("click", () => {
        seen.shadowFocusedAtSend = root.activeElement === root.getElementById("inner-field");
        record();
      });
    }
  });
</script>
</body></html>`;
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

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

describe.each<[string, BrowserType]>([
  ["chromium", chromium],
  ["webkit", webkit],
])("in %s", (_name, browserType) => {
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
    browser = await browserType.launch();
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

  const messages = () => store.load().filter((item) => item.type === "message" && item.role === "user");

  test("a hostile UI reaches no server, can't read the token, and asks only from a click", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    // The runtime's relay, as far as the page needs it.
    await page.route(`${base}/page`, (route) => route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${token}` } }));
    await page.route(`${base}/messages`, (route) => route.continue({ headers: { ...route.request().headers(), "jen-from": "owner" } }));
    await page.goto(`${base}/page#token=${token}`);

    // The token leaves the address bar.
    expect(page.url()).toBe(`${base}/page`);

    const frame = await until(() => page.frames().find((f) => f !== page.mainFrame()), "the UI's frame");
    // The asks sent without user input, and the forged one, are dropped.
    // Nothing reads either frame's DOM until then: Playwright evaluates with a
    // user gesture, in Chromium and WebKit, which would activate the page for
    // a few seconds.
    await sleep(1500);
    expect(messages()).toEqual([]);
    expect(await page.locator("#bar-text").textContent()).toMatch(/dropped/);

    const results = await until(async () => {
      const text = await frame.locator("#results").textContent({ timeout: 10_000 });
      return text ? (JSON.parse(text) as Record<string, string | number>) : undefined;
    }, "the UI's results");
    // The frame never sees the token.
    for (const read of ["parent.document", "parent.sessionStorage", "parent.location", "sessionStorage", "localStorage"]) {
      expect(results[read], read).toMatch(/^threw /);
    }
    // WebKit gives an opaque origin an empty cookie where Chromium throws.
    expect(results["document.cookie"]).toMatch(/^(threw |read: $)/);
    expect(results.origin).toBe("null");
    expect(results.version).toBe(1);
    expect(await frame.evaluate(() => document.documentElement.outerHTML)).not.toContain(token);

    const ui = page.frameLocator("iframe");
    const asked = async (count: number, what: string) => {
      await until(() => (messages().length >= count ? true : undefined), what, 20_000).catch(async (error) => {
        const bar = await page.locator("#bar-text").textContent();
        throw new Error(`${error.message}. The page's bar says ${JSON.stringify(bar)}, and the agent served ${JSON.stringify(served)}`);
      });
      await agent.idle();
    };
    const seen = async () => JSON.parse((await ui.locator("#seen").textContent()) || "{}") as Record<string, boolean>;
    const focused = () => frame.evaluate(() => document.activeElement?.id);

    // A click's ask reaches the inbox, in the given format.
    await ui.locator("#ask").click();
    await asked(1, "the clicked ask to reach the inbox");
    expect(messages()).toEqual([{ type: "message", role: "user", from: "owner", text: 'Asked from your UI, version 1:\n{"choice":"b"}' }]);

    // Typing in an input, then clicking its button, keeps focus in the input
    // through the click, and the button's ask reaches the inbox.
    await ui.locator("#field").click();
    await ui.locator("#field").pressSequentially("hello");
    await ui.locator("#send").click();
    await asked(2, "the typed ask to reach the inbox");
    expect((await seen()).focusedAtSend).toBe(true);
    expect(messages()[1]).toEqual({ type: "message", role: "user", from: "owner", text: 'Asked from your UI, version 1:\n{"text":"hello"}' });

    // A press on another field takes focus.
    await ui.locator("#field").click();
    await ui.locator("#field").pressSequentially("!");
    await ui.locator("#notes").click();
    expect(await focused()).toBe("notes");

    // With the input focused, a slider's thumb drags and a draggable element drops.
    await ui.locator("#field").click();
    expect(await focused()).toBe("field");
    const slider = ui.locator("#slider");
    await slider.scrollIntoViewIfNeeded();
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    expect(Number(await slider.inputValue())).toBeGreaterThan(50);
    await ui.locator("#field").click();
    expect(await focused()).toBe("field");
    await ui.locator("#drag").dragTo(ui.locator("#drop"));
    expect((await seen()).dropped).toBe(true);

    // With the input focused, a press on a select or editable text takes focus.
    for (const id of ["choice", "editable"]) {
      await ui.locator("#field").click();
      await ui.locator(`#${id}`).click();
      expect(await focused()).toBe(id);
      await page.keyboard.press("Escape");
    }

    // Inside an open shadow root, typing in an input and clicking its button
    // keeps focus in the input too.
    await ui.locator("#inner-field").click();
    await ui.locator("#inner-field").pressSequentially("hi");
    await ui.locator("#inner-send").click();
    expect((await seen()).shadowFocusedAtSend).toBe(true);

    // A click's popup and navigations don't leave the frame, and nothing
    // reached any server but the page's own requests.
    await ui.locator("#escape").click();
    await sleep(1500);
    expect(page.url()).toBe(`${base}/page`);
    expect(probed).toEqual([]);
    const own = new Set(["GET /page", "GET /ui", "GET /events", "POST /messages"]);
    expect(served.filter((request) => !own.has(request))).toEqual([]);
    expect(served.filter((request) => request === "POST /messages")).toHaveLength(2);
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

  test("a drop partway through a publish's event still shows the new version, with no other publish or reload", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route(`${base}/page`, (route) => route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${token}` } }));
    // The first stream waits for the publish below, then carries its call
    // whole and its result only as far as its ID, and closes. Later streams
    // reach the agent, which resumes after the Last-Event-ID they send.
    let release!: (body: string) => void;
    const cut = new Promise<string>((resolve) => (release = resolve));
    const resumedFrom: (string | undefined)[] = [];
    let first = true;
    await page.route(`${base}/events`, async (route) => {
      if (!first) {
        resumedFrom.push(route.request().headers()["last-event-id"]);
        return route.continue();
      }
      first = false;
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: await cut });
    });
    await page.goto(`${base}/page#token=${token}`);
    const title = () => page.locator("iframe").getAttribute("title");
    const before = (await store.latestUi())!.version;
    await expect.poll(title).toBe(`UI, version ${before}`);

    const start = store.after(0).at(-1)?.seq ?? 0;
    const version = store.publish("<p>after the drop</p>");
    store.save([
      { type: "tool_call", id: "publish-cut", name: "publish_ui", input: {} },
      { type: "tool_result", callId: "publish-cut", output: `Published ui/index.html as version ${version}.` },
    ]);
    const [call, result] = store.after(start);
    release(`id: ${call.seq}\nevent: item\ndata: ${JSON.stringify(call.item)}\n\nid: ${result.seq}\nevent: item\n`);

    await expect.poll(title, { timeout: 20_000 }).toBe(`UI, version ${version}`);
    expect(resumedFrom[0]).toBe(String(call.seq));
    await context.close();
  }, 60_000);
});
