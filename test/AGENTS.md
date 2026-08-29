# jen's own tests

## The credential scan reads the git index, so an unstaged rename fails it

`registry.test.ts`'s *tracks no credential in any file* enumerates paths with `git ls-files`
(via `trackedFiles()` in `helpers.ts`) and then opens each one. That is the right source —
the rule it enforces is about what a clone receives, and the index is what a clone receives
— but it means the test reads the index while `readRepoFile` reads the working tree, and
those disagree for exactly as long as a rename sits unstaged.

Delivery walks into this every time. Archiving a change moves its directory under
`openspec/changes/archive/`, and the suite run straight afterwards fails with
`ENOENT: no such file or directory` on the pre-move path — pointing at
`.openspec.yaml` or whichever file the scan reaches first, in a test about credentials,
naming a path the change never touched. `git add -A` makes it pass; nothing is wrong with
the test or the archive.

Worth knowing because of how it presents: the failure names the *old* path, so it reads as
though the move was incomplete or something deleted a file, and the honest fix is to stage
the move rather than to touch either the test or the archive. If a run reaches for
`readFileSync` guards here, it is solving the wrong problem — the scan must keep failing on
a file it cannot open, or a credential in an unreadable file would pass silently.

## `vitest run` does not typecheck, so a mistyped stub reaches the real tracker

The suite's promise is that no test spends money or reaches the network, and the only thing
holding that promise is that every client is constructed with a stub transport. Nothing
enforces it at runtime: `Tracker` falls back to the global `fetch` when it is handed no
transport, so a stub that fails to arrive is not an error — it is a live request to
`api.linear.app`, made with whatever `LINEAR_API_KEY` happens to be exported in the shell
running the suite.

The type system does catch this. `linear.test.ts`'s `tracker()` takes the whole `Scripted`
rather than its transport, so passing a bare `Transport` is a type error — but `npm test`
runs `vitest run`, which transpiles without checking, and the test fails instead on whatever
the live endpoint answered. A `401` with `Authentication required` from a test that scripted
a `500` is the shape of it, and the misdirection is total: the assertion names the response
you did not write, and nothing says the request left the machine.

So run `npm run typecheck` before believing a test failure that mentions a status code or a
message no fixture in the file contains — the two commands cover different halves, and this
gap is exactly where they part. Building a client by hand in a new test, rather than through
the file's helper, is the moment to check that the transport is actually being passed.

## A test spawner that layers `process.env` under the session spawn defeats the thing it tests

`exec.test.ts` arranges hostile conditions by wrapping the real `spawner` and adding to
`spec.env` — the git-configuration test is the standing example. The natural way to write
that wrapper is `{ ...process.env, ...spec.env, ...whatever }`, and it is wrong for the
*session* spawn in a way nothing reports.

`childEnvironment` withholds a variable by leaving its key out, not by setting it to
`undefined`. So spreading the parent environment underneath puts every withheld key back:
the `JEN_*` strip is undone, and so is a name one stage's declaration reserved from another.
On a host that holds the pipeline's own secrets — which is how `payload/jen.yml` arranges a
runner — the session then receives another role's private key, from inside the file whose
job is to prove it cannot. Nothing fails, because a wrapper is not what any assertion is
looking at.

Two consequences to keep in view. The stub records its environment whole, deliberately —
a filter written in jen's names could never see a project variable arriving under the
project's own name — so anything layered in is also serialised to `record.json` in
`$TMPDIR`. And the local symptom of the leak is *nothing at all*: the host has no `JEN_*`
set, so an assertion against it passes on a laptop and fails only where it matters.

Wrap the git spawns alone — `spec.command === 'git'` separates them — and let the session
spawn through untouched. The closed environment is complete for it: the stub is invoked by
absolute path, so it needs no inherited `PATH`.
