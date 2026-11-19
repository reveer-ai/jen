// jen uninstall: deletes everything jen ever made in Docker, then the
// command's npm package when it was installed globally with npm, since npm
// runs no script of a package as it's uninstalled. It goes through no
// runtime, which is removed too, so it works when one can't start.

import { realpathSync } from "node:fs";
import { join, sep } from "node:path";
import type { Runner } from "./docker.ts";
import type { Context } from "./runtime.ts";
import { Refusal, runtimeContainer, TARGETS } from "./settings.ts";

export const QUESTION = "This deletes every agent's conversation and files, and can't be undone. Continue? [y/N] ";
// The package's name on npm.
const PACKAGE = "jenai";

// The exit code: 0 once everything is removed, 1 when the user declined or a
// step failed.
export async function uninstall(ctx: Context, { mainPath, npm }: { mainPath: string; npm: Runner }): Promise<number> {
  const { docker, names } = ctx;
  if (!ctx.terminal.interactive) throw new Refusal("jen uninstall asks before it deletes anything, so it needs a terminal.");
  if ((await ctx.terminal.ask(QUESTION)).trim() !== "y") {
    ctx.print("Nothing was removed.");
    return 1;
  }

  const failures: string[] = [];
  const step = async (what: string, act: () => Promise<void>) => {
    try {
      await act();
    } catch (error) {
      failures.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const label = `jen.runtime=${names.name}`;
  let agents = 0;
  await step("counting the agents", async () => void (agents = (await docker.volumes([label, "jen.agent"])).length));

  // The runtime first, so none watches its agents go. By name, which also
  // finds one started by hand without the label.
  await step(`removing ${runtimeContainer(names.name)}`, () => docker.remove(runtimeContainer(names.name)));
  await step("listing jen's containers", async () => {
    for (const c of await docker.containers([label])) await step(`removing container ${c.name}`, () => docker.remove(c.id));
  });
  // Volumes after containers, since Docker won't remove one in use.
  await step("listing jen's volumes", async () => {
    for (const v of await docker.volumes([label])) await step(`removing volume ${v}`, () => docker.removeVolume(v));
  });
  await step(`removing network ${names.name}`, () => docker.removeNetwork(names.name));
  const images: string[] = [];
  for (const key of Object.keys(TARGETS) as (keyof typeof TARGETS)[]) {
    const image = names[key];
    await step(`removing image ${image}`, async () => {
      if ((await docker.imageId(image)) === undefined) return;
      await docker.removeImage(image);
      images.push(image);
    });
  }

  ctx.print(`Removed ${agents === 1 ? "1 agent" : `${agents} agents`} with their conversations and files, the runtime, the settings${images.length ? ` and the images ${images.join(", ")}` : ""}.`);
  if (failures.length > 0) {
    for (const failure of failures) ctx.say(`jen: ${failure}`);
    ctx.say("Some of jen is left in Docker, and so is the command, to remove it with. Run jen uninstall again once that's fixed.");
    return 1;
  }

  if (await installedWithNpm(mainPath, npm)) {
    const output = await npm("npm", ["uninstall", "-g", PACKAGE]);
    if (output.code !== 0) {
      ctx.say(`jen: npm uninstall -g ${PACKAGE} failed: ${output.stderr.trim()}`);
      return 1;
    }
    ctx.print(`Uninstalled the ${PACKAGE} package. jen is gone.`);
  } else {
    ctx.print("The jen command itself wasn't installed with npm install -g, so remove it the way it was installed. From a checkout linked with npm link, that's: npm unlink -g jen");
  }
  return 0;
}

// Whether the running main.ts is inside the global npm folder's package.
async function installedWithNpm(mainPath: string, npm: Runner): Promise<boolean> {
  const output = await npm("npm", ["root", "-g"]);
  if (output.code !== 0) return false;
  try {
    const root = realpathSync(output.stdout.trim());
    return realpathSync(mainPath).startsWith(join(root, PACKAGE) + sep);
  } catch {
    return false;
  }
}
