# Pre-commit Hooks

This project uses [Husky](https://typicode.github.io/husky/) to run checks before each commit.

## What Gets Checked

### On Every Commit:

1. **Lint-staged** - Runs on staged files only:
   - ESLint with auto-fix on `.ts` files
   - Prettier formatting on all files

2. **TypeScript Type Check** - Full project type check (`npm run typecheck`)

3. **Tests** - Full test suite (`npm test`)

## Performance Options

### Default (Full Checks)

The default `.husky/pre-commit` runs all checks including tests (~30-60 seconds).

### Fast Mode (Skip Tests)

If commits are too slow, use the fast version:

```bash
cp .husky/pre-commit.fast .husky/pre-commit
```

This skips tests but still catches:

- TypeScript errors
- Linting issues
- Formatting issues

**Note**: Tests will still run in CI/CD, so you'll catch issues before deployment.

## Temporarily Skip Hooks

If you need to commit without running hooks (not recommended):

```bash
git commit --no-verify -m "your message"
```

## Benefits

- ✅ Catch TypeScript errors before pushing
- ✅ Prevent linting failures in CI/CD
- ✅ Ensure consistent code formatting
- ✅ Catch test failures early
- ✅ Faster feedback loop than waiting for CI/CD

## Troubleshooting

If hooks aren't running:

```bash
npm run prepare  # Re-install hooks
```

If hooks fail unexpectedly:

```bash
git commit --no-verify  # Skip hooks once
```
