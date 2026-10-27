/**
 * Output utilities for the Delegance CLI
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import figures from 'figures';

export type OutputFormat = 'table' | 'json' | 'yaml';

/**
 * Print a success message
 */
export function success(message: string): void {
  console.log(chalk.green(`${figures.tick} ${message}`));
}

/**
 * Print an error message
 */
export function error(message: string, details?: string): void {
  console.error(chalk.red(`${figures.cross} ${message}`));
  if (details) {
    console.error(chalk.gray(`  ${details}`));
  }
}

/**
 * Print a warning message
 */
export function warn(message: string): void {
  console.log(chalk.yellow(`${figures.warning} ${message}`));
}

/**
 * Print an info message
 */
export function info(message: string): void {
  console.log(chalk.blue(`${figures.info} ${message}`));
}

/**
 * Print a debug message (only in verbose mode)
 */
export function debug(message: string): void {
  if (process.env.DEBUG || process.env.VERBOSE) {
    console.log(chalk.gray(`${figures.pointer} ${message}`));
  }
}

/**
 * Print a header
 */
export function header(text: string): void {
  console.log();
  console.log(chalk.bold.cyan(text));
  console.log(chalk.gray('─'.repeat(text.length)));
}

/**
 * Print key-value pairs
 * Supports both object format and key/value arguments
 */
export function keyValue(keyOrData: string | Record<string, unknown>, value?: unknown): void {
  if (typeof keyOrData === 'string') {
    // Single key-value call
    console.log(`  ${chalk.gray(keyOrData.padEnd(15))}  ${formatValue(value)}`);
  } else {
    // Object format
    const data = keyOrData;
    const maxKeyLength = Math.max(...Object.keys(data).map(k => k.length));
    
    for (const [key, val] of Object.entries(data)) {
      const paddedKey = key.padEnd(maxKeyLength);
      console.log(`  ${chalk.gray(paddedKey)}  ${formatValue(val)}`);
    }
  }
}

/**
 * Format a value for display
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return chalk.gray('(none)');
  }
  if (typeof value === 'boolean') {
    return value ? chalk.green('yes') : chalk.red('no');
  }
  if (typeof value === 'number') {
    return chalk.yellow(String(value));
  }
  if (value instanceof Date) {
    return chalk.cyan(value.toISOString());
  }
  if (Array.isArray(value)) {
    return chalk.cyan(value.join(', '));
  }
  return String(value);
}

/** Visible width of a string, ignoring ANSI color codes. */
function visibleWidth(s: string): number {
  // eslint-disable-next-line no-control-regex -- strips SGR color codes
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/**
 * A light table: header, one rule line, then the rows. No borders and no
 * dividers between rows. Cells are printed as given (strings keep any color).
 */
export function renderCompactTable(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cells = rows.map((r) => headers.map((_, i) => (r[i] === null || r[i] === undefined ? '-' : String(r[i]))));
  const widths = headers.map((h, i) => Math.max(visibleWidth(h), ...cells.map((r) => visibleWidth(r[i]))));
  const line = (parts: string[]): string =>
    `  ${parts.map((p, i) => p + ' '.repeat(widths[i] - visibleWidth(p))).join('  ')}`.replace(/\s+$/, '');
  return [
    line(headers.map((h) => chalk.bold(h))),
    chalk.dim(line(widths.map((w) => '─'.repeat(w)))),
    ...cells.map(line),
  ].join('\n');
}

/**
 * Print a table. `compact` prints the light style (header, one rule, rows);
 * the default is the bordered cli-table3 grid.
 */
export function table(
  headers: string[],
  rows: (string | number | null | undefined)[][],
  options: { compact?: boolean } = {}
): void {
  if (options.compact) {
    console.log(renderCompactTable(headers, rows));
    return;
  }
  const tbl = new Table({
    head: headers.map(h => chalk.bold(h)),
    style: { 
      head: ['cyan'],
    }
  });

  for (const row of rows) {
    tbl.push(row.map(cell => formatValue(cell)));
  }

  console.log(tbl.toString());
}

/**
 * Print data as JSON
 */
export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Print data based on format
 */
export function output(data: unknown, format: OutputFormat = 'table'): void {
  if (format === 'json') {
    json(data);
    return;
  }

  // For table format, we need specific handling based on data type
  if (Array.isArray(data) && data.length > 0) {
    const headers = Object.keys(data[0]);
    const rows = data.map(item => headers.map(h => item[h]));
    table(headers, rows);
  } else if (typeof data === 'object' && data !== null) {
    keyValue(data as Record<string, unknown>);
  } else {
    console.log(data);
  }
}

/**
 * Format a date for display
 */
export function formatDate(dateStr: string | Date | undefined): string {
  if (!dateStr) return chalk.gray('(none)');
  
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "2026-11-01" (or a full ISO timestamp) -> "Nov 1, 2026". Reads the date
 * part only, so the local time zone never shifts the day. Anything else is
 * returned as given.
 */
export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined) return chalk.gray('(unknown)');
  
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Format document status with color
 */
export function formatStatus(status: string): string {
  switch (status) {
    case 'completed':
    case 'processed':
      return chalk.green(status);
    case 'pending':
      return chalk.yellow(status);
    case 'processing':
      return chalk.blue(status);
    case 'error':
    case 'failed':
      return chalk.red(status);
    default:
      return status;
  }
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number | undefined | null): string {
  if (amount === undefined || amount === null) return chalk.gray('(none)');
  
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}
