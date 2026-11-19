// What the command's unit tests run it in: the in-memory engine, one stand-in
// of the runtime's API that keeps its tree across the runtime's restarts, as
// Docker does, and a terminal that answers from a script.

import { FakeDocker } from "./fake-docker.ts";
import { FakeRuntime } from "./fake-runtime.ts";
import type { Context } from "./runtime.ts";
import { namesFrom, type Settings, type Terminal } from "./settings.ts";

// A terminal that gives answers in order, recording each question.
export function fakeTerminal(answers: string[] = [], interactive = true) {
  const asked: { question: string; hidden: boolean }[] = [];
  const next = async (question: string, hidden: boolean) => {
    asked.push({ question, hidden });
    if (answers.length === 0) throw new Error(`the terminal has no answer to: ${question}`);
    return answers.shift()!;
  };
  const terminal: Terminal = { interactive, ask: (q) => next(q, false), askHidden: (q) => next(q, true) };
  return { terminal, asked, answers };
}

export const SETTINGS: Settings = { model: "gpt-x", apiKey: "sk-test-0123456789", baseURL: "", ownerToken: "a".repeat(64) };

// settings null means there are none yet.
export async function harness({ settings = SETTINGS as Settings | null, answers = [] as string[], interactive = true, env = {} as NodeJS.ProcessEnv } = {}) {
  const docker = new FakeDocker();
  const api = new FakeRuntime();
  const names = namesFrom(env);
  docker.onRuntime = async (container, asked) => {
    api.token = container.env.find((e) => e.startsWith("JEN_OWNER_TOKEN="))!.slice("JEN_OWNER_TOKEN=".length);
    await api.close();
    return api.listen(asked ?? 0);
  };
  docker.onRemove = async (container) => {
    if (container.name === `${names.name}-runtime`) await api.close();
  };
  if (settings) {
    docker.volumes_.set(`${names.name}-settings`, { labels: { "jen.runtime": names.name, "jen.settings": "" }, files: new Map([["settings.json", JSON.stringify(settings)]]) });
  }
  const { terminal, asked } = fakeTerminal(answers, interactive);
  const out: string[] = [];
  const err: string[] = [];
  const ctx: Context = {
    docker,
    names,
    terminal,
    say: (line) => err.push(line),
    print: (line) => out.push(line),
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 20))),
    now: Date.now,
  };
  return { docker, api, ctx, asked, out, err, names };
}
