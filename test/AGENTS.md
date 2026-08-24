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
