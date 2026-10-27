/**
 * Quotes Module
 * 
 * Handles quote requests and carrier interactions.
 */

import { HttpClient } from '../utils/http';
import { DeleganceError, NotFoundError, AuthenticationError, RateLimitError, ValidationError } from '../types';

export interface Carrier {
  id: string;
  name: string;
  logoUrl?: string;
  supportedLines?: string[];
  statesAvailable?: string[];
  averageQuoteTimeSeconds: number;
  successRate?: number;
  queueDepth: number;
}

export interface QuoteRequest {
  /** Carrier IDs to request quotes from */
  carriers: string[];
  
  /** Priority level */
  priority?: 'low' | 'normal' | 'high';
  
  /** Coverage types to quote (optional - uses company defaults) */
  coverageTypes?: string[];
  
  /** Schedule for later (ISO datetime) */
  scheduledFor?: string;
}

export interface Quote {
  id: string;
  carrierId: string;
  carrierName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  priority: string;
  createdAt: string;
  scheduledFor?: string;
  startedAt?: string;
  completedAt?: string;
  estimatedWaitSeconds?: number | null;
  durationSeconds?: number | null;
  result?: {
    premium?: number;
    bindable?: boolean;
    expiresAt?: string;
  };
  error?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  /**
   * Instant quotes only: what the carrier's instant leg ended in. A referral
   * keeps `status: 'processing'` but reads 'referred' here. Absent on older servers.
   */
  outcome?: string;
}

export interface GetQuoteResponse {
  success: boolean;
  quote: Quote;
  actions: {
    canCancel: boolean;
  };
  traceId: string;
}

export interface SubmitQuoteResponse {
  success: boolean;
  queueIds: string[];
  carriers: Array<{ id: string; name: string }>;
  invalidCarriers?: string[];
  errors?: string[];
  message: string;
  traceId: string;
}

export interface ListQuotesResponse {
  success: boolean;
  quotes: Quote[];
  count: number;
  traceId: string;
}

export interface ListCarriersResponse {
  success: boolean;
  carriers: Carrier[];
  count: number;
  traceId: string;
}

export interface ListQuotesOptions {
  /** Filter by status */
  status?: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  
  /** Maximum results (default: 50) */
  limit?: number;
}

export class QuotesModule {
  constructor(private http: HttpClient) {}

  /**
   * List available carriers for quoting
   * 
   * @example
   * ```typescript
   * const { carriers } = await client.quotes.listCarriers();
   * for (const carrier of carriers) {
   *   console.log(`${carrier.name} - avg ${carrier.averageQuoteTimeSeconds}s`);
   * }
   * ```
   */
  async listCarriers(): Promise<ListCarriersResponse> {
    return this.http.request<ListCarriersResponse>({
      method: 'GET',
      path: '/api/v1/quotes/carriers',
    });
  }

  /**
   * Submit a quote request to one or more carriers
   * 
   * @example
   * ```typescript
   * // Get available carriers
   * const { carriers } = await client.quotes.listCarriers();
   * 
   * // Submit to first 3 carriers
   * const result = await client.quotes.submit({
   *   carriers: carriers.slice(0, 3).map(c => c.id),
   *   priority: 'high'
   * });
   * 
   * console.log(`Submitted ${result.queueIds.length} quote requests`);
   * ```
   */
  async submit(request: QuoteRequest): Promise<SubmitQuoteResponse> {
    return this.http.request<SubmitQuoteResponse>({
      method: 'POST',
      path: '/api/v1/quotes',
      body: request,
    });
  }

  /**
   * List quote requests for the company
   * 
   * @example
   * ```typescript
   * // List all quotes
   * const { quotes } = await client.quotes.list();
   * 
   * // List only pending quotes
   * const { quotes: pending } = await client.quotes.list({ status: 'pending' });
   * ```
   */
  async list(options: ListQuotesOptions = {}): Promise<ListQuotesResponse> {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    if (options.limit) params.set('limit', String(options.limit));
    
    const query = params.toString();
    const path = query ? `/api/v1/quotes?${query}` : '/api/v1/quotes';
    
    return this.http.request<ListQuotesResponse>({
      method: 'GET',
      path,
    });
  }

  /**
   * Get a single quote by ID with full details
   * 
   * @example
   * ```typescript
   * const { quote, actions } = await client.quotes.get('quote-uuid');
   * console.log(`Status: ${quote.status}`);
   * if (actions.canCancel) {
   *   console.log('This quote can be cancelled');
   * }
   * ```
   */
  async get(quoteId: string): Promise<{ quote: Quote; canCancel: boolean }> {
    const response = await this.http.request<GetQuoteResponse>({
      method: 'GET',
      path: `/api/v1/quotes/${quoteId}`,
    });
    
    return {
      quote: response.quote,
      canCancel: response.actions.canCancel
    };
  }

  /**
   * Cancel a pending quote
   * 
   * Only quotes in 'pending' status can be cancelled.
   * Once a quote starts processing, it cannot be stopped.
   * 
   * @example
   * ```typescript
   * try {
   *   await client.quotes.cancel('quote-uuid');
   *   console.log('Quote cancelled');
   * } catch (error) {
   *   console.log('Cannot cancel:', error.message);
   * }
   * ```
   */
  async cancel(quoteId: string): Promise<{ success: boolean; message: string }> {
    const response = await this.http.request<{ success: boolean; message: string; traceId: string }>({
      method: 'DELETE',
      path: `/api/v1/quotes/${quoteId}`,
    });
    
    return { success: response.success, message: response.message };
  }

  /**
   * Wait for a quote to complete
   * 
   * @example
   * ```typescript
   * const result = await client.quotes.submit({ carriers: ['carrier-1'] });
   * const quote = await client.quotes.waitForCompletion(result.queueIds[0]);
   * console.log('Quote status:', quote.status);
   * ```
   */
  async waitForCompletion(
    quoteId: string,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<Quote> {
    const { timeoutMs = 300000, pollIntervalMs = 5000 } = options; // 5 min default
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const { quote } = await this.get(quoteId);
        
        // A referred instant quote stays `processing` (an underwriter may
        // still price it), but its instant answer is in: stop waiting.
        if (['completed', 'failed', 'cancelled'].includes(quote.status)
          || (quote.outcome !== undefined && quote.outcome !== 'pending')) {
          return quote;
        }
      } catch (error) {
        if (
          error instanceof NotFoundError ||
          error instanceof AuthenticationError ||
          error instanceof RateLimitError ||
          error instanceof ValidationError
        ) {
          throw error;
        }
        // Transient errors — continue polling
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new DeleganceError(`Quote ${quoteId} did not complete within ${timeoutMs}ms`, 408);
  }
}
