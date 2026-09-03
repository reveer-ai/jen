## 1. Make the OpenSpec CLI reachable to the session

- [x] 1.1 In `cli/exec.ts`, import `openspecBin` from `./openspec.js` and add `delimiter`
  to the existing `node:path` import.
- [x] 1.2 Add a private method that writes the shim — e.g. `#openspecShim(directory)`:
  write an `openspec` file with mode `0o755` into **both** `bin/` and `node_modules/.bin/`
  under the run directory (siblings to `repo/` and `config/`), and return the `bin/` path.
  Contents:

  ```sh
  #!/bin/sh
  exec "<process.execPath>" "<openspecBin()>" "$@"
  ```

  Two placements because the two invocations resolve differently: `openspec` off `PATH`
  (the `bin/` prepend), and `npx openspec` off `npm exec`'s walk-up for `node_modules/.bin`
  from the session cwd — `npx` never consults `PATH`, and with no local bin it fetches the
  unscoped `openspec` from the registry. Both paths are interpolated at write time (trusted
  absolute local paths); embed them directly rather than via environment variables — a
  `JEN_*` name would be stripped by `childEnvironment`, and a non-namespaced one is
  avoidable noise. Same shape and lifetime as the askpass script: written into the run
  directory, swept with it.
- [x] 1.3 Call it from `launch()` alongside the other per-run setup (after the `config`
  dir is made), and thread the returned `bin/` path into `#session(...)` as a new argument.
- [x] 1.4 `#session` passes the `bin/` path to `childEnvironment`.

## 2. Prepend the shim dir to the session PATH

- [x] 2.1 `childEnvironment(...)` takes a new `binDir: string` parameter (place it beside
  `configDir` / `askpass`).
- [x] 2.2 After the copy loop and the other explicit assignments, set
  `env.PATH = env.PATH ? binDir + delimiter + env.PATH : binDir`. This wins over whatever
  the inherit loop copied and covers the case where the runner holds no `PATH`.
- [x] 2.3 Update the doc comment on `childEnvironment` so the PATH handling is described
  where the four other transforms already are.

## 3. Tests (`test/exec.test.ts`)

- [x] 3.1 The `childEnvironment` unit call (~line 508) gains the `binDir` argument. Repoint
  `expect(env.PATH …)` from `.toBe('/usr/bin')` to assert the value is
  `binDir + delimiter + '/usr/bin'`.
- [x] 3.2 The closed-environment assertion (~line 404) `expect(invoked.env.PATH).toBeUndefined()`
  becomes an assertion that `PATH` is exactly the run's `bin/` dir
  (`join(invoked.cwd, '..', 'bin')`), since the base environment there carries no `PATH`.
  Reword the comment: the host's `PATH` is still not inherited; what the session gets is
  jen's own shim dir and nothing else.
- [x] 3.3 Add a launched-session assertion: `invoked.env.PATH` starts with the run's `bin/`
  dir + `delimiter`; `bin/openspec` exists, is executable (mode `& 0o111`), and its contents
  name both `process.execPath` and the path `openspecBin()` returns.
- [x] 3.4 Add end-to-end assertions that the shim runs: exec `<binDir>/openspec --version`
  with an empty `PATH`, and run `npx openspec --version` from the clone with a `PATH` that
  carries `sh`/`node`/`npx` but no `openspec`; confirm each prints the version from
  `@fission-ai/openspec`'s `package.json`. This is what proves the resolution actually works
  rather than just that a file was written.

## 4. Verify

- [x] 4.1 `npm test` passes.
- [x] 4.2 `npm run typecheck` and `npm run build` pass; confirm `dist/exec.js` carries the
  shim write and the PATH prepend.
- [x] 4.3 Sanity-check against the real failure: in a checkout with no `node_modules` and a
  `PATH` that does not contain `openspec`, the `bin/` shim on `PATH` makes `openspec …`
  resolve and the `node_modules/.bin/` shim makes `npx openspec …` resolve (verified: `npx`
  does not consult `PATH`, so the `bin/` prepend alone leaves `npx openspec` fetching the
  unscoped registry package).

## 5. Release

- [x] 5.1 Add a patch changeset describing the fix.
- [x] 5.2 Note in the closing handoff: as with ENG-184, the compiled fix reaches the
  scheduled runner only once the Version PR ships — CI installs jen fresh each run.
