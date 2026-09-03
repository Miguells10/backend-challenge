import { describe, expect, test } from 'bun:test';

describe('health test harness', () => {
  test('runs with Bun', () => {
    expect(1).toBe(1);
  });
});
