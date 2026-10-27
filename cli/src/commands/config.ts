/**
 * Config commands for the Delegance CLI
 * 
 * Manage CLI configuration and profiles.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import { getConfig, setConfig, getApiKey, getBaseUrl, clearCredentials } from '../utils/config';
import { success, error, info, warn, header, keyValue } from '../utils/output';
import { cliInvocation } from '../utils/invocation';

export function createConfigCommand(): Command {
  const config = new Command('config')
    .description('Manage CLI configuration');

  // Show current config
  config
    .command('show')
    .alias('list')
    .description('Show current configuration')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const currentConfig = getConfig();
      const apiKey = getApiKey();
      const baseUrl = getBaseUrl();

      if (options.json) {
        console.log(JSON.stringify({
          baseUrl,
          defaultCompany: currentConfig.get('defaultCompany'),
          hasApiKey: !!apiKey,
          apiKeyPrefix: apiKey ? apiKey.substring(0, 12) + '...' : null
        }, null, 2));
      } else {
        header('Current Configuration');
        console.log();
        keyValue('Base URL', baseUrl);
        keyValue('API Key', apiKey ? apiKey.substring(0, 12) + '...' + apiKey.slice(-4) : 'Not set');
        keyValue('Default Company', currentConfig.get('defaultCompany') || 'Not set');
        console.log();
        info(`Config file: ${currentConfig.path}`);
      }
    });

  // Set a config value
  config
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key: string, value: string) => {
      const currentConfig = getConfig();
      
      const validKeys = ['baseUrl', 'defaultCompany'];
      
      if (!validKeys.includes(key)) {
        error(`Unknown config key: ${key}`);
        info(`Valid keys: ${validKeys.join(', ')}`);
        process.exit(1);
      }

      currentConfig.set(key, value);
      success(`Set ${key} = ${value}`);
    });

  // Get a config value
  config
    .command('get <key>')
    .description('Get a configuration value')
    .action((key: string) => {
      const currentConfig = getConfig();
      const value = currentConfig.get(key);
      
      if (value === undefined) {
        info(`${key} is not set`);
      } else {
        console.log(value);
      }
    });

  // Reset config
  config
    .command('reset')
    .description('Reset all configuration to defaults')
    .option('-f, --force', 'Skip confirmation')
    .action(async (options) => {
      if (!options.force) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: 'This will reset all configuration. Continue?',
            default: false
          }
        ]);
        
        if (!confirm) {
          info('Cancelled');
          return;
        }
      }

      const currentConfig = getConfig();
      currentConfig.clear();
      clearCredentials();
      
      success('Configuration reset to defaults');
      info(`You will need to run "${cliInvocation()} auth login" again`);
    });

  // Environment info
  config
    .command('env')
    .description('Show environment information')
    .action(() => {
      header('Environment');
      console.log();
      keyValue('Node.js', process.version);
      keyValue('Platform', process.platform);
      keyValue('Arch', process.arch);
      keyValue('CWD', process.cwd());
      console.log();
      
      header('Environment Variables');
      console.log();
      keyValue('DELEGANCE_API_KEY', process.env.DELEGANCE_API_KEY ? '(set)' : '(not set)');
      keyValue('DELEGANCE_BASE_URL', process.env.DELEGANCE_BASE_URL || '(not set)');
      keyValue('DEBUG', process.env.DEBUG || '(not set)');
    });

  // Profiles (for future multi-account support)
  config
    .command('profiles')
    .description('List available profiles')
    .action(() => {
      const currentConfig = getConfig();
      const profiles = currentConfig.get('profiles') as Record<string, any> || {};
      const activeProfile = currentConfig.get('activeProfile') || 'default';
      
      header('Profiles');
      console.log();
      
      if (Object.keys(profiles).length === 0) {
        info('No profiles configured');
        info('Profiles allow you to switch between different accounts/environments');
        console.log();
        info(`Example: ${cliInvocation()} config set-profile production --url https://portal.delegancebrokerage.com`);
      } else {
        for (const [name, profile] of Object.entries(profiles)) {
          const isActive = name === activeProfile;
          console.log(`  ${isActive ? '→ ' : '  '}${name}${isActive ? ' (active)' : ''}`);
          if (typeof profile === 'object' && profile !== null) {
            console.log(`      URL: ${(profile as any).baseUrl || 'default'}`);
          }
        }
      }
    });

  // Set profile
  config
    .command('use-profile <name>')
    .description('Switch to a profile')
    .action((name: string) => {
      const currentConfig = getConfig();
      const profiles = currentConfig.get('profiles') as Record<string, any> || {};
      
      if (!profiles[name] && name !== 'default') {
        error(`Profile "${name}" not found`);
        info(`Create it with: ${cliInvocation()} config set-profile <name> --url <base-url>`);
        process.exit(1);
      }
      
      currentConfig.set('activeProfile', name);
      success(`Switched to profile: ${name}`);
      
      if (name !== 'default' && profiles[name]?.baseUrl) {
        info(`Base URL: ${profiles[name].baseUrl}`);
      }
    });

  // Create/update profile
  config
    .command('set-profile <name>')
    .description('Create or update a profile')
    .option('-u, --url <url>', 'Base URL for this profile')
    .action((name: string, options) => {
      const currentConfig = getConfig();
      const profiles = currentConfig.get('profiles') as Record<string, any> || {};
      
      profiles[name] = {
        ...profiles[name],
        baseUrl: options.url || profiles[name]?.baseUrl
      };
      
      currentConfig.set('profiles', profiles);
      success(`Profile "${name}" ${profiles[name] ? 'updated' : 'created'}`);
      
      if (options.url) {
        info(`Base URL: ${options.url}`);
      }
    });

  return config;
}
