---
description: How to run the automated regression test suite to ensure architectural logic components execute without errors
---
Whenever any changes are made to the parsing engine (`App.tsx`), validation engine (`validator.ts`), or detection engine (`detector.ts`), you MUST autonomously run the following workflow sequence to mathematically verify that testing baselines and geometrical intersection evaluations continue to function appropriately.

// turbo-all
1. Execute Vitest regression suite locally for the frontend geometry constraints.
```bash
npm run test:all --prefix ./ui
```
2. Verify that the Headless Node environment faithfully reflects constraints synchronously via the CLI.
```bash
npm run test --prefix ./cli-ts
```
3. Observe the generated terminal output from the full-stack suites. If any mathematical check, visual UI DOM bounding error, or baseline CLI layout fails, immediately pause implementations, deeply assess why the change isolated an architectural edge case locally or headlessly, and surgically patch the omission before proceeding. 
4. **Autonomous Test Augmentation Requirement**: If you have just authored a new feature, a new layout edge case, or uncovered a topological vulnerability, you MUST independently enhance either the Vitest assertions (`ui/src/lib/__tests__`), the Playwright suite (`ui/e2e`), or generate/update an `example/architecture.yaml` payload validating the logic natively in your next action.
