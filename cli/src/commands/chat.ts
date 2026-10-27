/**
 * Chat commands for the Delegance CLI
 * 
 * Interact with the Orin insurance assistant.
 */

import { Command } from 'commander';
import ora from 'ora';
import inquirer from 'inquirer';
import { getConfig, setConfig } from '../utils/config';
import { getClient, failWith } from '../utils/client';
import { success, error, info, warn, header, keyValue, json } from '../utils/output';

export function createChatCommand(): Command {
  const chat = new Command('ask')
    .alias('chat')
    .description('Ask the Orin insurance assistant a question');

  // Single question
  chat
    .command('query <question...>')
    .alias('q')
    .description('Ask a single question')
    .option('-c, --conversation <id>', 'Continue a previous conversation')
    .option('--json', 'Output as JSON')
    .action(async (questionParts: string[], options) => {
      const question = questionParts.join(' ');
      const client = getClient();
      const spinner = ora('Thinking...').start();

      try {
        const response = await client.chat.ask(question, {
          conversationId: options.conversation,
        });

        spinner.succeed('Response received');

        if (options.json) {
          json(response);
        } else {
          console.log();
          // Strip HTML tags for CLI display
          const cleanResponse = response.response
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          
          console.log(cleanResponse);
          
          if (response.sources && response.sources.length > 0) {
            console.log();
            info(`Sources: ${response.sources.map(s => s.fileName).join(', ')}`);
          }
          
          console.log();
          info(`Conversation ID: ${response.conversationId}`);
          info('Use --conversation flag to continue this conversation');
        }

      } catch (err) {
        spinner.fail('Failed to get response');
        failWith('API error', err);
      }
    });

  // Interactive chat session
  chat
    .command('session')
    .alias('interactive')
    .alias('i')
    .description('Start an interactive chat session')
    .action(async () => {
      const client = getClient();
      let conversationId: string | undefined;

      header('Orin Insurance Assistant');
      console.log('Type your questions. Enter "exit" or "quit" to end the session.');
      console.log();

      while (true) {
        const { question } = await inquirer.prompt([
          {
            type: 'input',
            name: 'question',
            message: 'You:',
            validate: (input: string) => input.length > 0 || 'Please enter a question'
          }
        ]);

        const lowerQuestion = question.toLowerCase().trim();
        if (lowerQuestion === 'exit' || lowerQuestion === 'quit' || lowerQuestion === 'q') {
          info('Ending session. Goodbye!');
          break;
        }

        const spinner = ora('Thinking...').start();

        try {
          const response = await client.chat.ask(question, {
            conversationId,
          });

          conversationId = response.conversationId;
          spinner.stop();

          console.log();
          // Strip HTML tags for CLI display
          const cleanResponse = response.response
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          
          console.log(`Orin: ${cleanResponse}`);
          console.log();

        } catch (err) {
          spinner.fail('Failed to get response');
          error('Error', (err as Error).message);
          console.log();
        }
      }
    });

  // Default action - if called without subcommand, treat args as question
  chat
    .arguments('[question...]')
    .action(async (questionParts: string[] | undefined, options) => {
      if (!questionParts || questionParts.length === 0) {
        // No question provided, show help
        chat.outputHelp();
        return;
      }

      const question = questionParts.join(' ');
      const client = getClient();
      const spinner = ora('Thinking...').start();

      try {
        const response = await client.chat.ask(question);

        spinner.succeed('Response received');
        console.log();
        
        // Strip HTML tags for CLI display
        const cleanResponse = response.response
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>');
        
        console.log(cleanResponse);
        
        if (response.sources && response.sources.length > 0) {
          console.log();
          info(`Sources: ${response.sources.map(s => s.fileName).join(', ')}`);
        }
        
        console.log();
        info(`Conversation ID: ${response.conversationId}`);

      } catch (err) {
        spinner.fail('Failed to get response');
        failWith('API error', err);
      }
    });

  return chat;
}
