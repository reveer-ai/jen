import { expect, test } from "vitest";
import { launch, openURL } from "./browser.ts";

const url = "http://127.0.0.1:4242/agents/abc/page#token=t";

function recorder(result = true) {
  const calls: [string, string[]][] = [];
  return { calls, run: async (program: string, args: string[]) => (calls.push([program, args]), result) };
}

test("$BROWSER is used when it's set, on any system", async () => {
  const { calls, run } = recorder();
  expect(await openURL(url, { env: { BROWSER: "firefox", DISPLAY: ":0" }, platform: "darwin", run })).toBe(true);
  expect(calls).toEqual([["firefox", [url]]]);
});

test("open on macOS", async () => {
  const { calls, run } = recorder();
  expect(await openURL(url, { env: {}, platform: "darwin", run })).toBe(true);
  expect(calls).toEqual([["open", [url]]]);
});

test.each([{ DISPLAY: ":0" }, { WAYLAND_DISPLAY: "wayland-0" }])("xdg-open on Linux with a display (%o)", async (env) => {
  const { calls, run } = recorder();
  expect(await openURL(url, { env, platform: "linux", run })).toBe(true);
  expect(calls).toEqual([["xdg-open", [url]]]);
});

test("no opener on Linux without a display, as over SSH", async () => {
  const { calls, run } = recorder();
  expect(await openURL(url, { env: {}, platform: "linux", run })).toBe(false);
  expect(calls).toEqual([]);
});

test("an opener that fails is reported as not opened", async () => {
  const { run } = recorder(false);
  expect(await openURL(url, { env: {}, platform: "darwin", run })).toBe(false);
});

test("the real launcher reports a missing program and a failing one as not opened, and a succeeding one as opened", async () => {
  expect(await launch("jen-no-such-browser-7f3a", [url])).toBe(false);
  expect(await launch("false", [url])).toBe(false);
  expect(await launch("true", [url])).toBe(true);
});
