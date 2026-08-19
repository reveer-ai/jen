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
