import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SDK_VERSION } from '../utils/http';

describe('SDK_VERSION', () => {
  it('matches package.json so the User-Agent never reports a stale version', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
    expect(SDK_VERSION).toBe(pkg.version);
  });
});
