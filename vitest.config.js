import { configDefaults, defineConfig } from 'vitest/config';

// Agent worktrees under .claude/ are full checkouts of this repo, tests
// included — without this the suite runs every branch that happens to be
// checked out there and reports a doubled count.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
