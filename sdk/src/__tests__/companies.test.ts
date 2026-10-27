import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompaniesModule } from '../modules/companies';
import { CompanySizeSchema, ValidationError } from '../types';
import type { HttpClient } from '../utils/http';

function mockHttp(): HttpClient {
  return { request: vi.fn(), uploadFile: vi.fn() } as unknown as HttpClient;
}

const validInput = {
  name: 'ABC Construction',
  industry: 'construction',
  companySize: '11-25' as const,
  contactEmail: 'test@abc.com',
};

describe('CompaniesModule', () => {
  let http: HttpClient;
  let companies: CompaniesModule;

  beforeEach(() => {
    http = mockHttp();
    companies = new CompaniesModule(http);
  });

  describe('create', () => {
    it('calls POST /api/v1/companies with validated input', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        company: { id: 'c-1', ...validInput, createdAt: '2025-01-01' },
        isExisting: false,
      });

      const result = await companies.create(validInput);

      expect(http.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/companies',
        body: validInput,
      });
      expect(result.id).toBe('c-1');
      expect(result.name).toBe('ABC Construction');
    });

    it('throws ValidationError for missing required fields', async () => {
      await expect(
        companies.create({ name: '', industry: '', companySize: '11-25' as const, contactEmail: '' })
      ).rejects.toThrow(ValidationError);
    });

    it('accepts the zero-employee band (no employees, just the owners)', () => {
      expect(CompanySizeSchema.safeParse('0').success).toBe(true);
    });

    it('throws ValidationError for invalid company size', async () => {
      await expect(
        companies.create({ ...validInput, companySize: 'huge' as never })
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for invalid email', async () => {
      await expect(
        companies.create({ ...validInput, contactEmail: 'not-an-email' })
      ).rejects.toThrow(ValidationError);
    });

    it('validates optional fein format', async () => {
      await expect(
        companies.create({ ...validInput, fein: '123456789' })
      ).rejects.toThrow(ValidationError);
    });

    it('accepts valid fein', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        company: { id: 'c-1', ...validInput, createdAt: '2025-01-01' },
        isExisting: false,
      });

      await companies.create({ ...validInput, fein: '12-3456789' });
      expect(http.request).toHaveBeenCalled();
    });

    it('validates optional address state is 2 chars', async () => {
      await expect(
        companies.create({
          ...validInput,
          address: { street: '123 Main', city: 'Austin', state: 'Texas', zip: '78701' },
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('list', () => {
    it('calls GET /api/v1/companies', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        companies: [{ id: 'c-1', name: 'Test' }],
        count: 1,
      });

      const result = await companies.list();
      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/companies',
      });
      expect(result).toHaveLength(1);
    });

    it('adds includeCreated query param', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        companies: [],
        count: 0,
      });

      await companies.list({ includeCreated: true });
      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/companies?includeCreated=true',
      });
    });
  });

  describe('get', () => {
    it('calls GET /api/v1/companies/:id', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        company: { id: 'c-1', name: 'Test' },
      });

      const result = await companies.get('c-1');
      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/companies/c-1',
      });
      expect(result.id).toBe('c-1');
    });
  });

  describe('upsert', () => {
    it('returns company and isExisting flag', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        company: { id: 'c-1', name: 'ABC' },
        isExisting: true,
      });

      const result = await companies.upsert({
        ...validInput,
        externalId: 'ext-1',
      });

      expect(result.isExisting).toBe(true);
      expect(result.company.id).toBe('c-1');
    });

    it('validates input before sending', async () => {
      await expect(
        companies.upsert({
          name: '',
          industry: '',
          companySize: '11-25' as const,
          contactEmail: '',
          externalId: 'ext-1',
        })
      ).rejects.toThrow(ValidationError);
    });
  });
});
