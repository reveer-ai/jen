# Design

## Context

JEN-8 left a one-shot entrypoint. `src/main.ts` reads the model configuration from the environment, takes one message from its arguments, calls `respond(store, model, text)` and exits. `respond` runs a turn on the stored conversation, saves the turn whole once it completes and returns the reply, which is the text of the assistant messages that end the turn. A failed turn throws and saves nothing. The store keeps one JSON row per item in `items(seq INTEGER PRIMARY KEY, item TEXT)`, and `node:sqlite` is synchronous. The model port doesn't stream, and the agent has no tools, so a turn is one model call. See proposal.md for why this change exists and what it covers.

## Goals / Non-Goals

**Goals:**

- One process, one conversation, any number of clients. Every client uses the same few routes, with nothing reserved for a particular one.
- Everything the stream sends is durable. An event, once sent, is never taken back, and a client that reconnects gets exactly what it missed.

**Non-Goals:**

- What a busy agent does with a message. It's rejected, and [JEN-2](https://linear.app/reveer/issue/JEN-2) decides the real behavior.
- Token streaming and showing a turn while it runs. Both arrive with the UI engine ([JEN-3](https://linear.app/reveer/issue/JEN-3)).
- TLS, multiple users, scoped or rotating tokens. TLS belongs to whatever fronts the agent, and auth needs its own design later (see proposal.md).
- A health route, CORS and request size limits. Nothing uses them yet.
- Port configuration. The container always listens on 8080, and `docker run -p` chooses the host side.

## Decisions

### Layout

```
src/agent/respond.ts      respond, moved out of main.ts unchanged
src/agent/store.ts        gains after(seq)
src/server.ts             the protocol: routes, auth, the event stream
src/main.ts               configuration, open the store, listen
src/container.live.test.ts  the check, against a running server
Dockerfile                EXPOSE 8080
```

`respond` moves out of `main.ts` so that `server.ts` can import it without importing the entrypoint. Its tests move with it, from `main.test.ts` to `src/agent/respond.test.ts`.

### Routes

All three need `Authorization: Bearer <token>`. Errors are JSON, as `{"error": "<message>"}`.

| Route | Does | Responds |
|---|---|---|
| `POST /messages` | Body `{"text": "…"}`. Runs one turn. | `200 {"reply": "…"}` once the turn is saved. `400` for a body that isn't JSON or whose `text` isn't a non-empty string. `409` during another turn. `500` if the turn fails. |
| `GET /events` | Opens the SSE stream. | `200 text/event-stream`, held open. |
| anything else | | `404` |

- **The route is the request target up to its query, compared as a string.** It isn't parsed as a URL, which would read a target such as `//` as a host and throw. A request that fails unexpectedly gets `500`, or loses its connection if its response has started, and never stops the agent.

- **`POST /messages` answers when the turn is done, with the reply.** For curl this is a complete conversation: send a message, get the answer. A failed turn is an HTTP error on the request that caused it, so the error never has to travel on the stream. *Alternative:* `202 Accepted` at once, with the result only on the stream. That would make every client open the stream just to learn whether its message worked, and would need a failure event that isn't part of the conversation, so it couldn't be resumed. If JEN-2's delegation needs a message to be accepted before the turn ends, that's the change that makes `202` worth it.
- **If the client hangs up mid-turn, the turn carries on and is saved.** Its items still reach the stream. A proxy that times out a long request doesn't lose the turn.
- **The body is JSON, not plain text.** A message will gain fields, such as who sent it, and a JSON object can take them without breaking clients.
- **Request bodies are UTF-8 JSON, whatever the `Content-Type`.** Checking the header would only reject curl calls that forget `-H`.

### The event stream

Each conversation item is one SSE event:

```
id: 7
event: item
data: {"type":"message","role":"assistant","text":"Hello."}

```

- **The event ID is the item's `seq`, its row in the store.** Without `Last-Event-ID`, the stream starts from the first item, so a new client gets the whole conversation and then live items. With `Last-Event-ID: n`, it starts after item `n`. Browsers' `EventSource` sends that header itself on reconnect. With curl, you send it with `-H`. *Alternative:* start a new client at the live edge, with a query parameter for history. Every client we know of (the UI, a parent agent, a person catching up) wants the history first, and one rule is simpler than two.
- **Items are sent once their turn is saved, not as the loop produces them.** That's what makes every event durable: a failed turn saves nothing, so it never appeared on the stream either. The cost is that a turn's items arrive together when it ends. Today a turn is one model call, so nothing is lost. When tools make turns long, or the UI needs progress, JEN-3 adds events for a turn in progress, which are separate from the durable items and have no IDs. *Alternative:* send items as produced and send a retraction if the turn fails. Every client would then need undo logic, and resuming couldn't be exact.
- **Delivery is a pull from the store.** The server keeps the set of open streams. Each one remembers the last `seq` it sent. After a turn is saved, the server tells each stream to send `store.after(last)`. A new stream sends its backlog and joins the set in the same synchronous step. `node:sqlite` is synchronous, so no turn can be saved between the two, and nothing can be missed or sent twice.
- **A watcher that stops reading is sent nothing more until it drains.** When a write fills the response's buffer, delivery for that stream stops, and the stream's `drain` event resumes it from its last sent `seq`. The store is read 100 items at a time. A stalled watcher therefore holds at most one item beyond the socket's buffer, however long the conversation or however many turns pass, and other watchers and messages are unaffected. *Alternative:* disconnect a watcher whose buffer passes a limit, so it replays with `Last-Event-ID`. A slow client with a long backlog would then be cut off over and over and never catch up, whereas pausing costs nothing extra because delivery is already a pull from the store.
- **A comment line (`: keepalive`) every 15 seconds** keeps proxies and load balancers from closing a quiet stream. A stream waiting to drain skips it, since it isn't quiet.
- **`event: item`** names the type, even though it's the only one. Later events (deltas for a turn in progress, and whatever JEN-2 and JEN-3 add) get their own types, and clients that only handle `item` ignore them.

### The store

The store gains `after(seq: number, limit?: number): { seq: number; item: Item }[]`, which returns the items saved after `seq`, in order, and at most `limit` of them when it's given. `after(0)` returns everything. `seq` stays `INTEGER PRIMARY KEY`. Rows are never deleted, so a row's `seq` never changes and never repeats. The table doesn't change, so a JEN-8 volume works as it is.

### Auth

- **`JEN_TOKEN` is required.** Without it, the agent exits non-zero at startup and names the variable, just as it does for `JEN_MODEL` and `JEN_API_KEY`. There's no unauthenticated mode, so an exposed agent can't be open by accident.
- **The token is checked before anything else, on every route.** A request without a matching bearer token gets `401` with `WWW-Authenticate: Bearer`, and its body isn't read.
- **The comparison is constant-time.** Both sides are hashed with SHA-256 and compared with `timingSafeEqual`, so their lengths always match and timing reveals nothing about the token.
- **The token isn't checked for strength.** Whoever starts the agent chooses it, and the docs show generating one with `openssl rand -hex 32`.

### The server

- **Built on `node:http`, with no framework.** It has two routes and one stream. *Alternative:* Hono, which is small and built on web-standard `Request`/`Response`. Reconsider it when the route count grows.
- **`createServer({ store, model, token })` in `src/server.ts` returns an `http.Server`.** `main.ts` reads the environment, opens `/state/agent.db`, builds the model, listens on `0.0.0.0:8080` and writes `jen: listening on 8080` to stderr. Inside a container it has to bind to every interface for `-p` to reach it. To keep the agent local, publish it as `-p 127.0.0.1:8080:8080`.
- **One turn at a time** is a flag the server sets for the length of a turn. A message is checked against it on arrival and again once its body is in, so a message that arrives during a turn is rejected even if its body finishes after the turn ends, and two uploads that start while idle can't both run.
- **Signals work as before.** SIGINT and SIGTERM exit at once, and a turn in flight saves nothing. Open streams are dropped, and clients reconnect with `Last-Event-ID`.

### Checks

Unit tests run the server in-process on port 0, with `fetch` and the scripted model. They cover:
- **Auth:** a missing or wrong token gets `401`.
- **Replies:** a message gets its reply.
- **Bad bodies:** they get `400` and save nothing.
- **Busy:** a message sent while a turn is held open, by a model whose `next` waits on a promise the test controls, gets `409`, including one whose body finishes after the turn.
- **Unknown routes:** `/status` and a raw `//` target get `404`, and the agent keeps serving.
- **A stalled watcher:** its buffered bytes stay bounded while turns are saved, other watchers and messages are served, and once it reads it gets every item in order.
- **A failed turn:** it gets `500` and saves nothing.
- **The stream:** it sends the backlog, resumes after `Last-Event-ID`, and delivers a later turn's items live.
- **The store:** `after` and its limit get their own tests in `store.test.ts`.

The live container check, `src/container.live.test.ts`, keeps its existing skip rules and runs:
1. Build the image, create a volume and generate a token.
2. Start the agent detached, on a random host port bound to `127.0.0.1`, and wait until it accepts connections.
3. Check that a request without the token gets `401`.
4. Send a message asking it to remember a random word.
5. Remove the container and start a new one on the same volume.
6. Ask for the word, and check that the reply contains it.
7. Read `GET /events` until four items have arrived, and check they're the two exchanges in order.
8. Remove the containers and the volume, even if the check fails.

## Risks / Trade-offs

- **A browser's `EventSource` can't set an `Authorization` header** → the UI can read the stream with `fetch` instead, which can. If it needs `EventSource`, JEN-3 decides how the token reaches the agent, for example a cookie. The stream format doesn't change either way.
- **A proxy can cut off a long `POST /messages`** → the turn still completes and is saved, and the client can read it from the stream. Turns are a single model call until tools arrive.
- **A turn's items reach the stream only when it ends** → acceptable while a turn is one model call. JEN-3 adds events for a turn in progress.
- **One shared token, sent in clear over plain HTTP** → TLS comes from whatever fronts the agent. Locally, the docs bind to `127.0.0.1`. Auth gets its own design later.
- **A replay of a long conversation sends everything** → conversations are short today. Clients that don't want history send `Last-Event-ID`.

## Migration Plan

None needed. jen has no installs, and the store's table is unchanged, so a JEN-8 volume keeps its conversation. The `docker run … jen "message"` form stops working. `context/environment.md` switches to `docker run -d -p …` plus curl.
