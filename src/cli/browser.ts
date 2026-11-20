// Opens a URL in the user's browser: with $BROWSER when it's set, `open` on
// macOS, or `xdg-open` on Linux with a display. Where none applies, such as
// over SSH, or the opener fails, the URL jen printed is what the user follows.

import { spawn } from "node:child_process";

// Starts program with args, answering whether it started and didn't fail
// within a moment. A browser started directly may run until it's closed, so
// one still running then counts as opened, and is left to run.
export type Launcher = (program: string, args: string[]) => Promise<boolean>;

const SETTLE_MS = 3_000;

export const launch: Launcher = (program, args) =>
  new Promise((resolve) => {
    const child = spawn(program, args, { detached: true, stdio: "ignore" });
    const timer = setTimeout(() => {
      child.unref();
      resolve(true);
    }, SETTLE_MS);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });

// The opener for this system, or undefined when none applies.
export function opener(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  if (env.BROWSER) return env.BROWSER;
  if (platform === "darwin") return "open";
  if (platform === "linux" && (env.DISPLAY || env.WAYLAND_DISPLAY)) return "xdg-open";
  return undefined;
}

// Whether the URL was opened.
export async function openURL(url: string, { env = process.env, platform = process.platform, run = launch }: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; run?: Launcher } = {}): Promise<boolean> {
  const program = opener(env, platform);
  if (program === undefined) return false;
  return run(program, [url]);
}
