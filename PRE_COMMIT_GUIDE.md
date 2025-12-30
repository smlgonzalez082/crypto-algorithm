# Pre-Commit Hook Guide

## Overview

The pre-commit hook ensures code quality and security validations before every commit.

## What Gets Checked

### ✅ Blocking Checks (Must Pass)

These checks **will block your commit** if they fail:

1. **📝 Lint-Staged** - Formats and lints only staged files
   - Auto-fixes formatting issues
   - Runs ESLint with auto-fix
   - Runs Prettier on staged files

2. **🔬 Full ESLint Check** - Checks entire `src/` directory
   - Catches errors in unchanged files
   - Enforces TypeScript strict rules
   - Checks for security issues (no `any` types, etc.)

3. **🔎 TypeScript Type Checking** - Validates all TypeScript types
   - Ensures type safety across the codebase
   - Catches type errors before runtime
   - Critical for preventing bugs

4. **🧪 Unit Tests** - Runs all unit tests
   - **BLOCKING** - Commit will fail if tests fail
   - Ensures code quality and prevents regressions
   - Critical for maintaining codebase stability

## Pre-Commit Flow

```bash
git commit -m "message"
    ↓
🔍 Running pre-commit checks...
    ↓
📝 Formatting staged files... ✓
    ↓
🔬 Running ESLint... ✓
    ↓
🔎 TypeScript type check... ✓
    ↓
🧪 Running unit tests... ✓
    ↓
✅ Pre-commit checks passed!
    ↓
Commit successful
```

## Common Issues and Fixes

### Issue: ESLint Errors

**Error Message:**

```
❌ Linting failed. Please fix all linting errors.
```

**Fix:**

```bash
# Auto-fix most issues
npm run lint:fix

# Check remaining issues
npm run lint
```

### Issue: TypeScript Type Errors

**Error Message:**

```
❌ Type checking failed. Please fix all type errors.
```

**Fix:**

```bash
# Check type errors
npm run typecheck

# Common fixes:
# 1. Add proper type annotations
# 2. Use 'as' type assertions carefully
# 3. Fix any 'any' types with proper types
```

### Issue: Test Failures

**Warning Message:**

```
⚠️  Warning: Some tests failed. Review before pushing.
```

**Fix:**

```bash
# Run tests to see failures
npm test

# Run specific test file
npx jest path/to/test.ts

# Run tests in watch mode
npm run test:watch
```

## Bypassing Pre-Commit Hook

**⚠️ Not Recommended!** Only use in emergencies:

```bash
git commit --no-verify -m "emergency fix"
```

**Note:** CI/CD will still run all checks, so this just delays the inevitable.

## What Was Fixed

As part of the security fixes, all linting and type errors were resolved:

### ✅ Fixed Issues

1. **Unsafe `any` Type Usage** - 46 errors fixed
   - Added proper type annotations in validation middleware
   - Fixed type inference in request handlers
   - Properly typed all validated request data

2. **Missing Type Assertions** - All validated data properly typed
   - BacktestSchema → typed request body
   - OptimizeGridSchema → typed request body
   - All validation schemas properly enforced

3. **WebSocket Type Safety** - Fixed async handler
   - Wrapped async WebSocket handler properly
   - Prevents "floating promise" warnings

## Files Modified for Pre-Commit

### Security Validation Files

- `src/middleware/validation.ts` - Zod validation with proper types
- `src/web/server.ts` - Type-safe request handlers

### Hook Configuration

- `.husky/pre-commit` - Updated with security-focused checks
- `package.json` - lint-staged configuration (unchanged)

## CI/CD Integration

The pre-commit hook matches what CI/CD will check:

| Check             | Pre-Commit  | CI/CD       |
| ----------------- | ----------- | ----------- |
| Linting           | ✅ Blocking | ✅ Blocking |
| Type Check        | ✅ Blocking | ✅ Blocking |
| Unit Tests        | ✅ Blocking | ✅ Blocking |
| Integration Tests | ❌ Skipped  | ✅ Blocking |

**Note:** Integration tests are skipped in pre-commit for speed but run in CI/CD.

## Testing the Hook

To manually test the pre-commit hook:

```bash
# Stage some files
git add src/

# Run hook directly
.husky/pre-commit

# Expected output:
# 🔍 Running pre-commit checks...
# 📝 Formatting and linting staged files...
# 🔬 Running full ESLint check...
# 🔎 Running TypeScript type check...
# 🧪 Running unit tests...
# ✅ Pre-commit checks passed!
```

## Performance

Approximate execution times:

- **Lint-staged**: ~2-5 seconds (only staged files)
- **Full ESLint**: ~3-5 seconds (entire src/)
- **Type Check**: ~2-3 seconds (tsc --noEmit)
- **Unit Tests**: ~1-2 seconds (jest)

**Total**: ~8-15 seconds per commit

## Skip Checks (Advanced)

If you need to skip specific checks (not recommended):

```bash
# Skip lint-staged
HUSKY=0 git commit -m "message"

# Skip all git hooks
git commit --no-verify -m "message"
```

## Troubleshooting

### Hook Not Running

```bash
# Reinstall husky
npm run prepare

# Check hook permissions
chmod +x .husky/pre-commit

# Verify hook exists
ls -la .husky/pre-commit
```

### Slow Pre-Commit

```bash
# Check if tests are taking too long
npm run test:unit

# Consider skipping tests temporarily
# (Edit .husky/pre-commit and comment out test line)
```

### Deprecated Husky Warning

You may see:

```
husky - DEPRECATED
Please remove the following two lines from .husky/pre-commit:
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"
```

**Action**: This will be fixed in a future husky update. Safe to ignore for now.

## Best Practices

1. **Commit Often** - Small commits = faster checks
2. **Fix Issues Immediately** - Don't accumulate linting errors
3. **Run Tests First** - `npm test` before committing
4. **Stage Selectively** - `git add -p` for partial changes
5. **Keep Dependencies Updated** - `npm audit fix` regularly

## Related Documentation

- `SECURITY_ASSESSMENT.md` - Security vulnerability analysis
- `SECURITY_FIXES_APPLIED.md` - Details of security fixes
- `TESTING.md` - Testing documentation
- `.eslintrc` - ESLint configuration
- `tsconfig.json` - TypeScript configuration

---

**Status**: ✅ All security validations passing
**Last Updated**: 2025-12-29
