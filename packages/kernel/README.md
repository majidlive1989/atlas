# @atlas/kernel

Application bootstrap and lifecycle.

The public surface is `src/index.ts`. Build with `pnpm build` and run its smoke test with
`pnpm test` from this directory. Runtime dependencies are introduced with the phase that uses them.
The shared TypeScript configuration keeps compilation consistent across the workspace.
