import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RuntimeRefusal, type Identity, type RuntimeClient } from "./delegation.ts";
import { openStore, type Store } from "./store.ts";
import { ENTRY, MAX_UI, uiTools } from "./ui.ts";

const root: Identity = { id: "a1b2c3d4e5f6", parent: "owner", grant: { spawn: false, workspace: true } };
const signal = new AbortController().signal;

// A runtime whose workspace holds files, and that records each path read.
function fakeRuntime(files: Record<string, Buffer | RuntimeRefusal>) {
  const reads: string[] = [];
  const runtime = {
    async readFile(path: string) {
      reads.push(path);
      const file = files[path];
      if (file === undefined) throw new RuntimeRefusal(404, `no file at ${path}`);
      if (file instanceof RuntimeRefusal) throw file;
      return file;
    },
  } as unknown as RuntimeClient;
  return { runtime, reads };
}

let dir: string;
let store: Store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jen-ui-"));
  store = openStore(join(dir, "agent.db"));
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const publish = (files: Record<string, Buffer | RuntimeRefusal>) => {
  const fake = fakeRuntime(files);
  const [tool] = uiTools(root, fake.runtime, store);
  return { run: () => tool!.run({}, signal), reads: fake.reads };
};

describe("a root with workspace publishes its UI", () => {
  test("a first publish saves ui/index.html byte for byte as version 1", async () => {
    // A BOM, multi-byte text and a reference to a file that isn't read.
    const document = "﻿<!doctype html><p>héllo ✓</p><script src=\"app.js\"></script>";
    const { run, reads } = publish({ [ENTRY]: Buffer.from(document, "utf8"), "ui/app.js": Buffer.from("alert(1)") });
    const bytes = Buffer.byteLength(document);
    expect(await run()).toBe(`Published ui/index.html as version 1, ${bytes} bytes.`);
    expect(reads).toEqual([ENTRY]);
    const latest = store.latestUi()!;
    expect(latest.version).toBe(1);
    expect(Buffer.from(latest.document, "utf8").equals(Buffer.from(document, "utf8"))).toBe(true);
  });

  test("a second publish is version 2", async () => {
    const { run } = publish({ [ENTRY]: Buffer.from("<p>one</p>") });
    await run();
    expect(await run()).toMatch(/version 2,/);
  });

  test("only a root with workspace is offered publish_ui", () => {
    const { runtime } = fakeRuntime({});
    expect(uiTools(root, runtime, store).map((t) => t.name)).toEqual(["publish_ui"]);
    expect(uiTools({ ...root, parent: "c0c0c0c0c0c0" }, runtime, store)).toEqual([]);
    expect(uiTools({ ...root, grant: { spawn: true, workspace: false } }, runtime, store)).toEqual([]);
  });

  test("the description gives the contract", () => {
    const [tool] = uiTools(root, fakeRuntime({}).runtime, store);
    expect(tool!.inputSchema).toEqual({ type: "object", properties: {} });
    for (const part of [/ui\/index\.html/, /stand alone/, /data: URLs/, /no fetch/, /jen\.act/, /jen\.version/, /click or keydown handlers/, /submit handler never runs/, /give each input a name/, /nothing else on the page is sent/, /never sees your text replies/, /a way to act or type/, /4 MB/]) {
      expect(tool!.description).toMatch(part);
    }
  });
});

describe("a publish is all or nothing", () => {
  test.each([
    ["missing", {}, /there's no ui\/index\.html/],
    ["not UTF-8", { [ENTRY]: Buffer.from([0x3c, 0xff, 0xfe, 0x3e]) }, /isn't valid UTF-8/],
    ["over 4 MiB", { [ENTRY]: Buffer.alloc(MAX_UI + 1, 0x61) }, new RegExp(`${MAX_UI + 1} bytes, over the 4 MB`)],
    ["over the runtime's bound", { [ENTRY]: new RuntimeRefusal(413, "too large") }, /over the 4 MB limit/],
  ])("a file %s is refused and the version stays unchanged", async (_name, files, error) => {
    store.publish("<p>before</p>");
    await expect(publish(files as Record<string, Buffer | RuntimeRefusal>).run()).rejects.toThrow(error);
    expect(store.latestUi()).toEqual({ version: 1, document: "<p>before</p>" });
  });

  test("a file of exactly 4 MiB is published", async () => {
    await publish({ [ENTRY]: Buffer.alloc(MAX_UI, 0x61) }).run();
    expect(store.latestUi()?.version).toBe(1);
  });
});
