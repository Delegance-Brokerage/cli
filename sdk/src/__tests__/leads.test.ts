import { describe, it, expect, vi } from 'vitest';
import { LeadsModule } from '../modules/leads';
import type { HttpClient } from '../utils/http';

describe('LeadsModule', () => {
  it('POSTs /api/v1/leads and returns the company id', async () => {
    const request = vi.fn().mockResolvedValue({
      success: true, companyId: 'c1', message: 'Lead created successfully', traceId: 't',
    });
    const leads = new LeadsModule({ request, uploadFile: vi.fn() } as unknown as HttpClient);
    const input = { name: 'Riverbend Bakery', contactEmail: 'owner@riverbend.example', state: 'TX' };

    const res = await leads.create(input);

    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/api/v1/leads', body: input });
    expect(res.companyId).toBe('c1');
  });
});
