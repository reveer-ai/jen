import { expect, test } from "vitest";
import { FakeDocker } from "./fake-docker.ts";
import { fakeTerminal, SETTINGS } from "./harness.ts";
import { askSettings, mask, namesFrom, readSettings, runningRuntime, writeSettings } from "./settings.ts";

const names = namesFrom({});

test("the names default to jen's, and the environment overrides each", () => {
  expect(names).toEqual({ name: "jen", runtimeImage: "jen-runtime", agentImage: "jen-agent", workspaceImage: "jen-workspace" });
  expect(namesFrom({ JEN_RUNTIME_NAME: "t", JEN_RUNTIME_IMAGE: "r:t", JEN_AGENT_IMAGE: "a:t", JEN_WORKSPACE_IMAGE: "w:t" })).toEqual({ name: "t", runtimeImage: "r:t", agentImage: "a:t", workspaceImage: "w:t" });
});

test("no volume means no settings, and reading creates no volume", async () => {
  const docker = new FakeDocker();
  expect(await readSettings(docker, names)).toBeUndefined();
  expect(docker.volumes_.size).toBe(0);
  expect(docker.runs).toEqual([]);
});

test("a volume without the file means no settings", async () => {
  const docker = new FakeDocker();
  docker.volumes_.set("jen-settings", { labels: {}, files: new Map() });
  expect(await readSettings(docker, names)).toBeUndefined();
});

test("settings are written whole to a labelled volume and read back, through containers of the runtime's image with no network", async () => {
  const docker = new FakeDocker();
  await writeSettings(docker, names, { ...SETTINGS, port: 4242 });
  expect(docker.volumes_.get("jen-settings")!.labels).toEqual({ "jen.runtime": "jen", "jen.settings": "" });
  expect(await readSettings(docker, names)).toEqual({ ...SETTINGS, port: 4242 });

  const [write, read] = docker.runs;
  expect(write!.args).toEqual([
    "--rm", "-i", "--network", "none", "-v", "jen-settings:/settings", "--entrypoint", "sh", "jen-runtime",
    "-c", "cat > /settings/.settings.json.tmp && mv /settings/.settings.json.tmp /settings/settings.json",
  ]);
  expect(JSON.parse(write!.options.input!)).toEqual({ ...SETTINGS, port: 4242 });
  expect(read!.args).toEqual(["--rm", "--network", "none", "-v", "jen-settings:/settings:ro", "--entrypoint", "cat", "jen-runtime", "/settings/settings.json"]);
  // The key and the token are only ever in the input.
  for (const { args } of docker.runs) for (const arg of args) expect(arg).not.toMatch(new RegExp(`${SETTINGS.apiKey}|${SETTINGS.ownerToken}`));
});

test("a running runtime's token and port are read from its container, with no container started", async () => {
  const docker = new FakeDocker();
  docker.add({ name: "jen-runtime", env: ["JEN_OWNER_TOKEN=tok", "JEN_API_KEY=k"], port: 5151 });
  expect(await runningRuntime(docker, names)).toEqual({ token: "tok", port: 5151 });
  expect(docker.runs).toEqual([]);
});

test("a runtime that isn't running is read as none", async () => {
  const docker = new FakeDocker();
  expect(await runningRuntime(docker, names)).toBeUndefined();
  docker.add({ name: "jen-runtime", state: "exited", env: ["JEN_OWNER_TOKEN=tok"], port: 5151 });
  expect(await runningRuntime(docker, names)).toBeUndefined();
});

test("the questions are the model, the base URL and the key, in that order, the key hidden", async () => {
  const { terminal, asked } = fakeTerminal(["gpt-y", "https://openrouter.ai/api/v1", "sk-new-key-9999"]);
  const settings = await askSettings(terminal);
  expect(asked.map((a) => [a.question, a.hidden])).toEqual([
    ["Model: ", false],
    ["Base URL, empty for OpenAI's: ", false],
    ["Model key: ", true],
  ]);
  expect(settings).toEqual({ model: "gpt-y", baseURL: "https://openrouter.ai/api/v1", apiKey: "sk-new-key-9999", ownerToken: expect.stringMatching(/^[0-9a-f]{64}$/) });
});

test("an empty answer keeps the current value, the key is shown masked, and the token and port are kept", async () => {
  const current = { ...SETTINGS, baseURL: "https://x.test/v1", port: 4242 };
  const { terminal, asked } = fakeTerminal(["", "", ""]);
  expect(await askSettings(terminal, current)).toEqual(current);
  expect(asked.map((a) => a.question)).toEqual(["Model [gpt-x]: ", "Base URL, empty for OpenAI's [https://x.test/v1]: ", `Model key [${mask(SETTINGS.apiKey)}]: `]);
  expect(asked[2]!.question).not.toContain(SETTINGS.apiKey);
  expect(mask(SETTINGS.apiKey)).toBe("…6789");
});

test("with nothing to keep, the model and the key are asked again until answered", async () => {
  const { terminal, asked } = fakeTerminal(["", "m", "", "", "k"]);
  expect(await askSettings(terminal)).toMatchObject({ model: "m", baseURL: "", apiKey: "k" });
  expect(asked).toHaveLength(5);
});
