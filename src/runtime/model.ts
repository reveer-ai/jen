// The check every agent's model call passes before the runtime sends it to the
// provider with the owner's key. It accepts exactly the request the agent's
// Responses adapter (src/agent/model/openai-responses.ts) builds: text
// messages, function tools, function calls and their outputs, and storage
// off. It's an allowlist, so it fails closed: anything else a request may
// carry could name a URL the provider fetches, such as an image or a file, or
// a hosted tool that reaches the internet or the owner's account, and a field
// a provider adds later is refused until the runtime accepts it here.

export interface ModelRequest {
  model: string;
  instructions: string;
  input: unknown[];
  tools: unknown[];
  store: false;
}

// The error names the first field that doesn't fit, by its path in the body.
export type CheckedModelRequest = { request: ModelRequest } | { error: string };

// The error for the value at path, or undefined when it fits.
type Check = (value: unknown, path: string) => string | undefined;

const string: Check = (value, path) => (typeof value === "string" ? undefined : `${path} must be a string`);
const boolean: Check = (value, path) => (typeof value === "boolean" ? undefined : `${path} must be a boolean`);
// Any JSON object: a tool's parameters are the JSON Schema of its input, and
// providers fetch nothing a schema names.
const object: Check = (value, path) => (isObject(value) ? undefined : `${path} must be an object`);

function literal(...accepted: unknown[]): Check {
  const named = accepted.map((value) => JSON.stringify(value)).join(" or ");
  return (value, path) => (accepted.includes(value) ? undefined : `${path} must be ${named}`);
}

// An object with exactly these fields, each required.
function exactly(fields: Record<string, Check>): Check {
  return (value, path) => {
    if (!isObject(value)) return `${path} must be an object`;
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(fields, key)) return `${field(path, key)} is not accepted`;
    }
    for (const [key, check] of Object.entries(fields)) {
      if (!Object.hasOwn(value, key)) return `${field(path, key)} is required`;
      const error = check(value[key], field(path, key));
      if (error !== undefined) return error;
    }
    return undefined;
  };
}

function arrayOf(check: Check): Check {
  return (value, path) => {
    if (!Array.isArray(value)) return `${path} must be an array`;
    for (const [i, element] of value.entries()) {
      const error = check(element, `${path}[${i}]`);
      if (error !== undefined) return error;
    }
    return undefined;
  };
}

const message = exactly({ role: literal("user", "assistant"), content: string });
const functionCall = exactly({ type: literal("function_call"), call_id: string, name: string, arguments: string });
const functionCallOutput = exactly({ type: literal("function_call_output"), call_id: string, output: string });

// An input item is told apart by its type, and a message has none.
const inputItem: Check = (value, path) => {
  if (!isObject(value)) return `${path} must be an object`;
  if (!Object.hasOwn(value, "type")) return message(value, path);
  if (value.type === "function_call") return functionCall(value, path);
  if (value.type === "function_call_output") return functionCallOutput(value, path);
  return `${path}.type must be "function_call" or "function_call_output", or absent for a message`;
};

const tool = exactly({ type: literal("function"), name: string, description: string, parameters: object, strict: boolean });

const request = exactly({
  model: string,
  instructions: string,
  input: arrayOf(inputItem),
  tools: arrayOf(tool),
  store: literal(false),
});

// The request with model in place of the one it names, or why it's refused.
// The runtime sets the model, so an agent can't pick a pricier one or a
// variant that adds a hosted tool, such as OpenRouter's <model>:online.
export function checkModelRequest(body: unknown, model: string): CheckedModelRequest {
  if (!isObject(body)) return { error: "the body must be a JSON object" };
  const error = request(body, "");
  if (error !== undefined) return { error };
  return { request: { ...(body as unknown as ModelRequest), model } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}
