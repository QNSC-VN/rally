// Global setup runs once before all test suites.
// Unit tests use in-process mocks so there is no real DB/Redis to start.
// This file exists so vitest.config.ts globalSetup resolves without error.
export async function setup(): Promise<void> {}
export async function teardown(): Promise<void> {}
