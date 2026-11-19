import { test } from 'node:test';
import assert from 'node:assert/strict';
test('deliberate failure to prove CI turns red (throwaway)', () => { assert.equal(1, 2); });
