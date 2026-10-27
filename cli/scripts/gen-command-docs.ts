/**
 * Regenerate the CLI commands reference page from the live command tree.
 *
 *   npx tsx cli/scripts/gen-command-docs.ts          # write
 *   npx tsx cli/scripts/gen-command-docs.ts --check  # exit 1 on drift
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createProgram } from '../src/program';
import { renderCommandReference } from '../src/docs/render-reference';

const target = join(__dirname, '..', '..', 'app', '(docs)', 'docs', 'cli', 'commands', 'page.mdx');
const rendered = renderCommandReference(createProgram());

if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8');
  if (current !== rendered) {
    console.error(`${target} is stale. Run: npx tsx cli/scripts/gen-command-docs.ts`);
    process.exit(1);
  }
  console.log('commands reference is current');
} else {
  writeFileSync(target, rendered);
  console.log(`wrote ${target}`);
}
