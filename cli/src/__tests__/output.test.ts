import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  formatDate,
  formatFileSize,
  formatStatus,
  formatCurrency,
} from '../utils/output';

// Mock chalk to return plain strings (no ANSI codes)
vi.mock('chalk', () => {
  const identity = (s: unknown) => String(s);
  const handler: ProxyHandler<any> = {
    get: () => new Proxy(identity, handler),
    apply: (_target: any, _thisArg: any, args: any[]) => String(args[0]),
  };
  return { default: new Proxy(identity, handler) };
});

vi.mock('figures', () => ({
  default: { tick: '✓', cross: '✗', warning: '⚠', info: 'ℹ', pointer: '>' },
}));

vi.mock('cli-table3', () => ({
    default: vi.fn().mockImplementation(() => ({
      push: vi.fn(),
      toString: vi.fn(() => 'table-output'),
    })),
  }));

// maskApiKey lives in config.ts and is covered by config.test.ts.

describe('output utilities', () => {
  describe('formatFileSize', () => {
    it('formats bytes', () => {
      expect(formatFileSize(500)).toContain('500');
      expect(formatFileSize(500)).toContain('B');
    });

    it('formats kilobytes', () => {
      const result = formatFileSize(2048);
      expect(result).toContain('2.0');
      expect(result).toContain('KB');
    });

    it('formats megabytes', () => {
      const result = formatFileSize(5 * 1024 * 1024);
      expect(result).toContain('5.0');
      expect(result).toContain('MB');
    });

    it('formats gigabytes', () => {
      const result = formatFileSize(2 * 1024 * 1024 * 1024);
      expect(result).toContain('2.0');
      expect(result).toContain('GB');
    });

    it('returns (unknown) for undefined', () => {
      expect(formatFileSize(undefined)).toContain('unknown');
    });
  });

  describe('formatStatus', () => {
    it('formats completed status', () => {
      const result = formatStatus('completed');
      expect(result).toContain('completed');
    });

    it('formats processed status', () => {
      const result = formatStatus('processed');
      expect(result).toContain('processed');
    });

    it('formats pending status', () => {
      const result = formatStatus('pending');
      expect(result).toContain('pending');
    });

    it('formats processing status', () => {
      const result = formatStatus('processing');
      expect(result).toContain('processing');
    });

    it('formats error status', () => {
      const result = formatStatus('error');
      expect(result).toContain('error');
    });

    it('formats failed status', () => {
      const result = formatStatus('failed');
      expect(result).toContain('failed');
    });

    it('returns unknown status as-is', () => {
      expect(formatStatus('custom')).toBe('custom');
    });
  });

  describe('formatCurrency', () => {
    it('formats dollar amounts', () => {
      const result = formatCurrency(5000);
      expect(result).toContain('5,000');
    });

    it('formats large amounts', () => {
      const result = formatCurrency(1000000);
      expect(result).toContain('1,000,000');
    });

    it('returns (none) for undefined', () => {
      expect(formatCurrency(undefined)).toContain('none');
    });

    it('returns (none) for null', () => {
      expect(formatCurrency(null)).toContain('none');
    });

    it('formats zero', () => {
      const result = formatCurrency(0);
      expect(result).toContain('0');
    });
  });

  describe('formatDate', () => {
    it('formats ISO date string', () => {
      const result = formatDate('2026-03-20T14:30:00Z');
      // Should contain month and day at minimum
      expect(result).toContain('20');
    });

    it('formats Date object', () => {
      const result = formatDate(new Date('2026-01-15T12:00:00Z'));
      expect(result).toContain('Jan');
    });

    it('returns (none) for undefined', () => {
      expect(formatDate(undefined)).toContain('none');
    });
  });
});
