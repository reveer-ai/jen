# Design

## Context

The repo has no code, only `context/`, `openspec/` and agent config. The constraints come from the 2026-10-26 entries in `context/decisions.md`: TypeScript on Node, jen's own loop, and a jen-defined model port with adapters behind it. The first adapter wraps the official `openai` SDK on the Responses API, and a scripted fake is the second implementation. No SDK type crosses the port. See proposal.md for why.

## Goals / Non-Goals

**Goals:**

- A port small enough that the Chat Completions and Anthropic adapters fit it later without changing it.
- Conversation items are plain JSON data, so JEN-8 can store them and JEN-9 can send them as they are.
- The loop can be tested end to end against the fake, with no network.

**Non-Goals:**

- System instructions, token usage, truncation reporting, cancellation, typed model errors, and carrying reasoning across turns. Each is added when something uses it.
- Streaming. Nothing reads a partial turn until the UI engine ([JEN-3](https://linear.app/reveer/issue/JEN-3)).
- Persisting the conversation. That's JEN-8. Here the caller holds it in memory.
- Validating tool input against its schema. Each tool checks its own input.

## Decisions

### Project layout and tooling

```
src/
  model/port.ts                     the port: Model, Item, ToolSpec
  model/scripted.ts                 the scripted fake
  model/openai-responses.ts         the Responses adapter (the only openai import)
  agent/loop.ts                     runTurn, Tool
  **/*.test.ts                      unit tests, next to the code
  **/*.live.test.ts                 live checks, excluded from `npm test`
```

- **One npm package, ESM, Node ≥ 26.** A monorepo waits for a second package.
- **No build output.** Node 26 runs TypeScript directly by stripping types, so `npm run check` (`tsc --noEmit`) is the build. The tsconfig sets `erasableSyntaxOnly` and `verbatimModuleSyntax`, so `tsc` rejects anything Node can't strip. Relative imports use `.ts` extensions. *Alternative:* emitting to `dist/` with `tsc`. That adds a step and a second copy of the code before anything consumes `dist/`. Node won't strip types inside `node_modules`, so publishing to npm will need emitted JavaScript. That's settled in JEN-4.
- **TypeScript 7** (the native compiler) for type checking, and **Vitest** for tests. *Alternative:* `node:test`. Vitest has better watch mode and assertions for the price of one dev dependency.
- **npm**, because it ships with Node. pnpm adds nothing for one package.
- **CI**, in `.github/workflows/ci.yml`, runs on every push and pull request: `npm ci`, `npm run check`, `npm test`. It never runs the live check, so CI needs no secrets.

### The port

```ts
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type Item =
  | { type: "message"; role: "user" | "assistant"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Json }
  | { type: "tool_result"; callId: string; output: string };

interface ToolSpec { name: string; description: string; inputSchema: Json }

interface Model {
  next(items: readonly Item[], tools: readonly ToolSpec[]): Promise<Item[]>;
}
```

- **Stateless: each call sends the whole conversation, and `next` returns only the new items.** These are assistant messages and tool calls. jen owns the conversation, so it can change model or provider partway through, and any agent (UI, parent, child) can read it. *Alternative:* the provider keeps the conversation (Responses `store: true` with `previous_response_id`). Only OpenAI offers that, it ties the conversation to one vendor, and jen would still need its own copy for Anthropic and Chat Completions.
- **One flat list of items, not messages made of content blocks.** One item becomes one stored row or one message on the network. The Responses API maps it one to one. The Anthropic adapter will group consecutive items into messages, putting tool results in a user message. Checking this against the Anthropic Messages API now is how we catch a port that quietly copies OpenAI's shape.
- **Ports hold data, not behavior.** `ToolSpec` describes a tool to the model, while the loop's `Tool` adds `run`. So nothing in `Item[]` or `ToolSpec[]` is a function, and both serialize as they are.
- **The model and its credentials are bound when the adapter is constructed.** The loop never chooses a model. A sub-agent on another model gets its own `Model`.
- **A tool call's `id` comes from the provider** (Responses `call_id`, Anthropic `tool_use.id`). The matching `tool_result.callId` echoes it back.

### The agent loop

```ts
interface Tool extends ToolSpec { run(input: Json): Promise<string> }

function runTurn(model: Model, tools: readonly Tool[], conversation: readonly Item[], text: string): Promise<Item[]>;
```

- **`runTurn` is a function over a conversation the caller owns.** It returns the turn's new items: the user message, then every model and tool item in order. The caller appends them. JEN-8 can then persist a turn without the loop knowing about storage. *Alternative:* an `Agent` class that holds the conversation. That decides ownership and lifetime before JEN-8 and JEN-9 know what they need.
- **The loop** appends the user message and calls `model.next`. If the new items contain no tool call, the turn ends. Otherwise it runs every tool call in order, appends one `tool_result` per call, and calls the model again.
- **Tool calls run one at a time, in the order the model gave them.** That's deterministic and needs no concurrency rules. Running them in parallel can come when a slow tool needs it.
- **Tool failures become results.** An unknown tool name or a thrown error produces a `tool_result` whose output is `Error: <message>`, and the loop continues, so the model can recover. A model error (network, authentication, rate limit) throws out of `runTurn`, and the caller's conversation is left unchanged.

### The scripted fake

`new ScriptedModel(turns: Item[][])`. Each `next` call returns the next scripted turn and records a copy of what it was sent in `calls: { items, tools }[]`. When the script runs out, `next` throws, so a test that loops longer than expected fails loudly instead of hanging.

### The Responses adapter

`new OpenAIResponsesModel({ model, apiKey, baseURL? })`. It calls `client.responses.create({ model, input, tools, store: false })`, using the SDK's default retries for temporary failures.

| jen item | Responses input | Responses output → jen |
|---|---|---|
| `message` (`user` or `assistant`) | `{ role, content: text }` | a `message` item's `output_text` and `refusal` parts, joined in order → an assistant `message` |
| `tool_call` | `{ type: "function_call", call_id: id, name, arguments: JSON.stringify(input) }` | `function_call` → `tool_call`, with `input` parsed from `arguments` |
| `tool_result` | `{ type: "function_call_output", call_id: callId, output }` | n/a |
| `ToolSpec` | `{ type: "function", name, description, parameters: inputSchema, strict: false }` | n/a |

- **`store: false`** turns off OpenAI's stored response state, which matches the stateless port. Function call items go back without their output `id`, so the API never looks up a stored item. It isn't a retention guarantee: OpenAI may still keep abuse-monitoring logs that hold prompts and responses, depending on its policies and the account's data controls.
- **A refusal's explanation becomes the assistant's text.** The port has no refusal item, and dropping the explanation would leave an empty reply.
- **A failed generation throws.** A response can arrive with a successful HTTP status but `status: "failed"` and an `error`. The adapter throws a plain `Error` with that message, holding the provider's error as `cause`. An `incomplete` response, such as one cut off at the token limit, is truncation reporting, which is deferred.
- **`reasoning` output items are dropped.** Reasoning models still work, but they lose their reasoning between turns. Carrying it across turns is a later addition.
- **Any other output type throws.** jen only requests function tools, so anything else means the mapping is incomplete. Failing loudly beats quietly dropping it.
- **Arguments that aren't valid JSON throw.** This is a model failure, not a tool failure, and with function calling it's rare.
- **`strict: false`.** Strict mode would make every tool schema mark every property required and set `additionalProperties: false`. That's a cost on every tool author for a guarantee jen doesn't need yet.
- **Errors are re-thrown as a plain `Error` with the SDK error as `cause`.** The message is kept and no SDK class crosses the port.
- **OpenRouter** is reached with `baseURL: "https://openrouter.ai/api/v1"` and a model ID such as `openai/<model>` or `anthropic/<model>`.

### Live check

`npm run test:live` runs `*.live.test.ts`. It reads `JEN_LIVE_API_KEY` and `JEN_LIVE_MODEL`, plus `JEN_LIVE_BASE_URL` for OpenRouter, and skips if the key or model is missing. It gives the model one tool that returns a value the model can't guess. It then checks that the turn contains a `tool_call` and its `tool_result`, and that the final assistant message contains the value.

## Risks / Trade-offs

- **The flat item list might not fit Anthropic once that adapter is built** → we checked the mapping against the Anthropic Messages API in this design. Its adapter is the real test, and the port changes then if it has to.
- **OpenRouter's Responses endpoint is in beta, and it might reject `store: false` or translate some models badly** → the live check runs against whichever endpoint is configured. A failure there means a fix in the adapter, not in the port.
- **A model that keeps calling tools never ends its turn**, because there's no step limit or cancellation → today the caller is a test or a person at a terminal. A bound is added when a real caller needs one.
- **If a model call fails mid-turn, the turn's completed tool calls are lost**, even though their side effects happened → that's acceptable while the conversation lives in memory. JEN-8 revisits it when turns are persisted.
- **TypeScript 7 is new** → if a compiler bug blocks us, fall back to TypeScript 6. The config is the same.
- **Running `.ts` directly isn't publishable to npm** → JEN-4 adds an emit step when distribution needs it.
