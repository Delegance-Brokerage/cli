/**
 * Companies Module
 * 
 * Handles company creation and management operations.
 */

import { HttpClient } from '../utils/http';
import {
  Company,
  CreateCompanyInput,
  CreateCompanySchema,
  ValidationError
} from '../types';

interface CreateCompanyResponse {
  success: boolean;
  company: Company;
  isExisting: boolean;
  traceId: string;
}

interface ListCompaniesResponse {
  success: boolean;
  companies: Company[];
  count: number;
  traceId: string;
}

export interface ListCompaniesOptions {
  /**
   * @deprecated A customer API key belongs to one company and cannot create
   * others, so this adds nothing for it.
   */
  includeCreated?: boolean;
}

export class CompaniesModule {
  constructor(private http: HttpClient) {}

  /**
   * Create a new company.
   *
   * @deprecated A customer API key cannot create companies (403
   * `tenant_key_cannot_create`). To open a new account, use
   * `createSignup().createAccount()`.
   * 
   * @example
   * ```typescript
   * const company = await client.companies.create({
   *   name: 'ABC Construction',
   *   industry: 'construction',
   *   companySize: '11-25',
   *   contactEmail: 'contact@abc.com',
   *   fein: '12-3456789'
   * });
   * ```
   */
  async create(input: CreateCompanyInput): Promise<Company> {
    // Validate input
    const parseResult = CreateCompanySchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError(
        'Invalid company data',
        parseResult.error.issues
      );
    }

    const response = await this.http.request<CreateCompanyResponse>({
      method: 'POST',
      path: '/api/v1/companies',
      body: parseResult.data
    });

    return response.company;
  }

  /**
   * List the company this API key belongs to. A key belongs to one company.
   *
   * @example
   * ```typescript
   * const [company] = await client.companies.list();
   * ```
   */
  async list(options: ListCompaniesOptions = {}): Promise<Company[]> {
    const params = new URLSearchParams();
    if (options.includeCreated) {
      params.set('includeCreated', 'true');
    }

    const query = params.toString();
    const path = query ? `/api/v1/companies?${query}` : '/api/v1/companies';

    const response = await this.http.request<ListCompaniesResponse>({
      method: 'GET',
      path
    });

    return response.companies;
  }

  /**
   * Get a company by ID.
   *
   * @deprecated The server has no `GET /api/v1/companies/{id}` route, so this
   * returns 404. Use `list()`, which returns the key's own company.
   * 
   * @example
   * ```typescript
   * const company = await client.companies.get('uuid-here');
   * ```
   */
  async get(companyId: string): Promise<Company> {
    const response = await this.http.request<{ success: boolean; company: Company }>({
      method: 'GET',
      path: `/api/v1/companies/${companyId}`
    });

    return response.company;
  }

  /**
   * Create a company if it doesn't exist (using externalId for deduplication).
   *
   * @deprecated A customer API key cannot create companies. Use
   * `createSignup().createAccount()` for a new account.
   * 
   * @example
   * ```typescript
   * const company = await client.companies.upsert({
   *   name: 'ABC Construction',
   *   industry: 'construction',
   *   companySize: '11-25',
   *   contactEmail: 'contact@abc.com',
   *   externalId: 'ams-12345'  // Will dedupe on this
   * });
   * ```
   */
  async upsert(input: CreateCompanyInput & { externalId: string }): Promise<{ company: Company; isExisting: boolean }> {
    const parseResult = CreateCompanySchema.safeParse(input);
    if (!parseResult.success) {
      throw new ValidationError(
        'Invalid company data',
        parseResult.error.issues
      );
    }

    const response = await this.http.request<CreateCompanyResponse>({
      method: 'POST',
      path: '/api/v1/companies',
      body: parseResult.data
    });

    return {
      company: response.company,
      isExisting: response.isExisting
    };
  }
}
