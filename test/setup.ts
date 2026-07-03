// Per-suite setup file (vitest setupFiles).
// Runs before each test file. Clears all vi.fn() mocks between suites.
import { afterEach, vi } from 'vitest';

afterEach(() => {
  vi.clearAllMocks();
});
