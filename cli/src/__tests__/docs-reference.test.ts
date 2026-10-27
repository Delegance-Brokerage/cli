import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { createProgram } from '../program';
import { renderCommandReference, commandPaths, EXAMPLES } from '../docs/render-reference';

vi.mock('conf', () => {
  class MockConf {
    get() { return undefined; }

    set() {}

    delete() {}

    get path() { return '/tmp/delegance-test-config.json'; }
  }
  return { default: MockConf };
});

const PAGE = join(__dirname, '..', '..', '..', 'app', '(docs)', 'docs', 'cli', 'commands', 'page.mdx');

describe('commands reference', () => {
  const program = createProgram();

  it('has examples only for commands that exist', () => {
    const paths = new Set(commandPaths(program));
    expect(Object.keys(EXAMPLES).filter(p => !paths.has(p))).toEqual([]);
  });

  it('escapes MDX-significant characters outside code', () => {
    const page = renderCommandReference(program);
    const prose = page
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]*`/g, '')
      .replace(/^\{\/\*.*\*\/\}$/m, '');
    expect(prose).not.toMatch(/(?<!\\)[<{]/);
  });

  // The public CLI export ships without the docs app, so skip there.
  it.skipIf(!existsSync(PAGE))('matches the checked-in docs page (run cli/scripts/gen-command-docs.ts)', () => {
    expect(readFileSync(PAGE, 'utf8')).toBe(renderCommandReference(program));
  });
});
