/**
 * The stock inquirer checkbox prints "(Press <space> to select, <a> to toggle
 * all, <i> to invert selection, and <enter> to proceed)". Tester feedback
 * (2026-10-07): toggle-all and invert are noise for a short list and make the
 * prompt confusing. This prompt says only space and Enter, and the a/i keys
 * do nothing, so a stray keypress cannot flip every answer at once.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';

export const CHECKBOX_HINT = '(space to select, Enter to continue)';

type PromptCtor = new (...args: any[]) => any;

let registered = false;

export function minimalCheckboxPrompt(Base: PromptCtor): PromptCtor {
  return class MinimalCheckboxPrompt extends Base {
    constructor(...args: any[]) {
      super(...args);
      // Suppresses the stock hint; getQuestion adds the short one instead.
      this.dontShowHints = true;
    }

    getQuestion(): string {
      const question = super.getQuestion();
      return this.status === 'answered' ? question : `${question}${chalk.dim(CHECKBOX_HINT)} `;
    }

    onAllKey(): void {}

    onInverseKey(): void {}
  };
}

/** Swaps the checkbox prompt once, before any command can prompt. */
export function registerMinimalCheckbox(): void {
  if (registered) return;
  const prompts = (inquirer.prompt as unknown as { prompts?: Record<string, PromptCtor> }).prompts;
  const Base = prompts?.checkbox;
  if (!Base) return;
  inquirer.registerPrompt('checkbox', minimalCheckboxPrompt(Base) as any);
  registered = true;
}
