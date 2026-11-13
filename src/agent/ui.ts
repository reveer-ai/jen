// publish_ui: how a root agent with workspace publishes its UI. The UI is one
// file in its workspace, ui/index.html, which the agent writes with the file
// tools and publishes as it is: nothing parses or rewrites it, and nothing it
// references is read. Each publish is saved in the store as the next version,
// which the agent's page serves to the browser (see server.ts and ui/page.html).

import { readFileSync } from "node:fs";
import type { Tool } from "./loop.ts";
import { RuntimeRefusal, type Identity, type RuntimeClient } from "./delegation.ts";
import type { Store } from "./store.ts";

// The UI's entry, relative to the agent's home directory.
export const ENTRY = "ui/index.html";
// The largest document a publish takes, in bytes.
export const MAX_UI = 4 * 2 ** 20;
// The textbox every agent starts with, served as version 0 until it publishes.
export const TEXTBOX = readFileSync(new URL("./ui/textbox.html", import.meta.url), "utf8");
// jen's fixed page, which runs the UI in a sandboxed frame.
export const PAGE = readFileSync(new URL("./ui/page.html", import.meta.url), "utf8");

// The tools the agent's identity allows: publish_ui for a root with
// workspace, and none otherwise, since nobody can open a sub-agent's UI and a
// root without workspace has nowhere to write one.
export function uiTools(identity: Identity, runtime: RuntimeClient, store: Pick<Store, "publish">): Tool[] {
  if (identity.parent !== "owner" || !identity.grant.workspace) return [];
  return [publishUi(runtime, store)];
}

function publishUi(runtime: RuntimeClient, store: Pick<Store, "publish">): Tool {
  return {
    name: "publish_ui",
    description:
      `Publish ${ENTRY} in your workspace as your UI, under a new version, replacing the one the user sees. ` +
      "Edits to the file are drafts until you publish. " +
      `The file is sent as it is and must stand alone: write scripts and styles inline, and images and fonts as data: URLs. ` +
      "The UI runs with no network, so fetch, references to other files and links to other pages don't work. " +
      "The UI can call jen.act(context) to send you an action, and read jen.version, the version it shows. " +
      "Call jen.act only from the user's clicks or keys: an action sent on load or on a timer is dropped. " +
      "An action brings you its context, any JSON value, and the value of every input, select and textarea, keyed by its name or id, so give each input a name. " +
      "Nothing else on the page is sent, such as a heading beside the button, so make each action's context say everything you'll need to act on it. " +
      "The user sees only what your UI shows, never your text replies, so answer each action by publishing, and make every UI give the user a way to act or type. " +
      "The file may be at most 4 MB.",
    inputSchema: { type: "object", properties: {} },
    async run(_input, signal) {
      let bytes: Buffer;
      try {
        bytes = await runtime.readFile(ENTRY, signal);
      } catch (error) {
        if (error instanceof RuntimeRefusal && error.status === 404) throw new Error(`there's no ${ENTRY} in your workspace. Write it with write_file, then publish.`);
        if (error instanceof RuntimeRefusal && error.status === 413) throw new Error(`${ENTRY} is over the 4 MB limit for a UI.`);
        throw error;
      }
      if (bytes.length > MAX_UI) throw new Error(`${ENTRY} is ${bytes.length} bytes, over the 4 MB (${MAX_UI} bytes) limit for a UI.`);
      let document: string;
      try {
        // The BOM is kept, so the document is saved byte for byte.
        document = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        throw new Error(`${ENTRY} isn't valid UTF-8, so it can't be published.`);
      }
      const version = store.publish(document);
      return `Published ${ENTRY} as version ${version}, ${bytes.length} bytes.`;
    },
  };
}
