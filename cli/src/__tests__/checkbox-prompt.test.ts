import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import inquirer from 'inquirer';
import { CHECKBOX_HINT, minimalCheckboxPrompt } from '../utils/checkbox-prompt';

const strip = (s: string): string => s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');

async function run(keys: string[], register: boolean) {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean };
  const output = new PassThrough();
  let screen = '';
  output.on('data', (d) => { screen += d.toString(); });
  const prompt = inquirer.createPromptModule({ input, output } as any);
  if (register) {
    const Base = (prompt as unknown as { prompts: Record<string, any> }).prompts.checkbox;
    prompt.registerPrompt('checkbox', minimalCheckboxPrompt(Base) as any);
  }
  const answer = prompt([
    { type: 'checkbox', name: 'picked', message: 'Pick:', choices: ['one', 'two', 'three'] } as any,
  ]);
  for (const k of keys) {
    await new Promise((r) => setTimeout(r, 5));
    input.write(k);
  }
  const result = (await answer) as { picked: string[] };
  return { picked: result.picked, screen: strip(screen) };
}

describe('minimal checkbox prompt', () => {
  it('shows only the space/Enter hint', async () => {
    const { screen } = await run(['\r'], true);
    expect(screen).toContain(CHECKBOX_HINT);
    expect(screen).not.toContain('toggle all');
    expect(screen).not.toContain('invert selection');
  });

  it('ignores a and i, and space still selects', async () => {
    const { picked } = await run(['a', 'i', ' ', '\r'], true);
    expect(picked).toEqual(['one']);
  });

  it('control: the stock prompt toggles all on a', async () => {
    const { picked, screen } = await run(['a', '\r'], false);
    expect(picked).toEqual(['one', 'two', 'three']);
    expect(screen).toContain('toggle all');
  });
});
