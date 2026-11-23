import { afterEach, describe, expect, test, vi } from "vitest";
import { buildImages, identify } from "./build.ts";
import { credentials, main, parse, pool, queue, type Options } from "./main.ts";
import { startSide } from "./side.ts";

// So a test can see that nothing was built or started.
vi.mock("./build.ts", async (original) => ({ ...(await original<typeof import("./build.ts")>()), identify: vi.fn(), buildImages: vi.fn() }));
vi.mock("./side.ts", async (original) => ({ ...(await original<typeof import("./side.ts")>()), startSide: vi.fn() }));
import { TASKS } from "./tasks.ts";

const env = { JEN_LIVE_MODEL: "openai/gpt-6-luna", JEN_LIVE_API_KEY: "sk-test" };
const options = (argv: string[], e: NodeJS.ProcessEnv = env): Options => {
  const command = parse(argv, e);
  if (command.command !== "evaluate") throw new Error("not an evaluation");
  return command.options;
};

describe("the arguments", () => {
  test("default to every task, 10 runs, the environment's model, the working tree, one side and 24 in flight", () => {
    expect(options([])).toEqual({ tasks: TASKS, runs: 10, model: "openai/gpt-6-luna", build: null, against: null, againstModel: null, parallel: 24 });
  });

  test("choose tasks, runs, model, builds and parallelism", () => {
    const o = options(["--tasks", "direct,files", "--runs", "2", "--model", "m1", "--build", "HEAD~1", "--against", "main", "--against-model", "m2", "--parallel", "4"]);
    expect(o).toEqual({ tasks: [TASKS[1], TASKS[7]], runs: 2, model: "m1", build: "HEAD~1", against: "main", againstModel: "m2", parallel: 4 });
  });

  test("a prompt runs alone, with spawn unless --grant says otherwise, or beside --tasks", () => {
    const alone = options(["--prompt", "List your workspace's files.", "--grant", "workspace"]);
    expect(alone.tasks).toHaveLength(1);
    expect(alone.tasks[0]).toMatchObject({ name: expect.stringMatching(/^prompt-[0-9a-f]{8}$/), grant: { workspace: true }, replies: "some" });
    expect(options(["--prompt", "Hi."]).tasks[0]!.grant).toEqual({ spawn: true });
    expect(options(["--prompt", "Hi.", "--grant", "spawn,workspace"]).tasks[0]!.grant).toEqual({ spawn: true, workspace: true });
    expect(options(["--tasks", "direct", "--prompt", "Hi."]).tasks.map((t) => t.name)).toEqual(["direct", expect.stringMatching(/^prompt-/)]);
  });

  test("report and record take one evaluation", () => {
    expect(parse(["report", "evals/x"], env)).toEqual({ command: "report", evaluation: "evals/x" });
    expect(parse(["record", "x"], env)).toEqual({ command: "record", evaluation: "x" });
    expect(() => parse(["report"], env)).toThrow(/report takes one evaluation/);
  });

  test.each([
    [["--tasks", "nope"], /no task named "nope"/],
    [["--runs", "0"], /--runs must be a positive whole number/],
    [["--parallel", "1.5"], /--parallel must be a positive whole number/],
    [["--grant", "spawn"], /--grant applies only to --prompt/],
    [["--prompt", "x", "--grant", "root"], /--grant takes spawn and workspace/],
    [["--bogus"], /Unknown option '--bogus'/],
    [["run"], /unknown command "run"/],
  ])("%j is refused", (argv, error) => {
    expect(() => parse(argv, env)).toThrow(error);
  });
});

describe("the credentials", () => {
  test("come from the environment, with the base URL when it's set", () => {
    expect(credentials(options([]), env)).toEqual({ apiKey: "sk-test" });
    expect(credentials(options([]), { ...env, JEN_LIVE_BASE_URL: "https://openrouter.ai/api/v1" })).toEqual({ apiKey: "sk-test", baseURL: "https://openrouter.ai/api/v1" });
  });

  test("a missing key or model is refused", () => {
    expect(() => credentials(options([]), { JEN_LIVE_MODEL: "m" })).toThrow("JEN_LIVE_API_KEY is not set");
    expect(() => credentials(options([], { JEN_LIVE_API_KEY: "k" }), { JEN_LIVE_API_KEY: "k" })).toThrow(/no model/);
  });
});

describe("main", () => {
  afterEach(() => vi.restoreAllMocks());
  test("with no key exits non-zero naming the variable, before building or starting anything", async () => {
    const errors: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => (errors.push(String(chunk)), true));
    expect(await main(["--tasks", "direct", "--runs", "2"], { JEN_LIVE_MODEL: "m" })).toBe(2);
    expect(errors.join("")).toContain("JEN_LIVE_API_KEY is not set");
    expect(identify).not.toHaveBeenCalled();
    expect(buildImages).not.toHaveBeenCalled();
    expect(startSide).not.toHaveBeenCalled();
  });
});

describe("the queue", () => {
  test("alternates sides and cycles through tasks, round by round", () => {
    expect(queue(["x", "y"], ["a", "b"], 2).map(({ side, task, index }) => `${side}${task}${index}`)).toEqual(["ax1", "bx1", "ay1", "by1", "ax2", "bx2", "ay2", "by2"]);
    expect(queue(["x"], ["a"], 3).map((r) => r.index)).toEqual([1, 2, 3]);
  });

  test("runs at most --parallel at a time, in order, and starts no more once interrupted", async () => {
    let inFlight = 0;
    let most = 0;
    const started: number[] = [];
    const abort = new AbortController();
    await pool([1, 2, 3, 4, 5, 6, 7, 8], 3, abort.signal, async (n) => {
      started.push(n);
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (n === 4) abort.abort();
      inFlight--;
    });
    expect(most).toBe(3);
    expect(started).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
