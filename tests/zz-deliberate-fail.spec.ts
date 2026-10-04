import { test, expect } from '@playwright/test';

// Deliberate failure to prove that a red build check blocks a merge. Never merge this branch.
test('deliberate failure', () => {
  expect(1).toBe(2);
});
