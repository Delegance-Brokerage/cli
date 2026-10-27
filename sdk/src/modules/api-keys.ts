/**
 * ApiKeys Module
 *
 * Handles API key lifecycle management: create, list, revoke, and rotate.
 */

import { HttpClient } from '../utils/http';
import { ValidationError, NotFoundError, NotImplementedError } from '../types';

// ============================================
// Types
// ============================================

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  isActive: boolean;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
}

/** Full API key including the secret — shown once at creation time */
export interface CreatedApiKey extends ApiKey {
  key: string;
}

export interface RotateResult {
  newKey: CreatedApiKey;
  oldKeyValidUntil: string;
  rotationId: string;
  status: 'rotating';
}

/**
 * Scopes the server accepts. `appetite:read`, `mcp:*` and `claims:write` are
 * opt-in and never implied. `claims:write` can be created only while signed
 * in to the portal; an API-key call that asks for it gets a 403.
 */
export type ApiKeyScope = 'read' | 'write' | 'admin' | 'appetite:read' | 'mcp:read' | 'mcp:orin' | 'claims:write';

export const API_KEY_SCOPES: readonly ApiKeyScope[] = ['read', 'write', 'admin', 'appetite:read', 'mcp:read', 'mcp:orin', 'claims:write'];

export interface CreateApiKeyInput {
  name: string;
  scopes: ApiKeyScope[];
  /**
   * Days until the key expires, 1 to 365. Omitted: 90 days. `'never'`: no
   * expiry, allowed only for a read-only key. A key with `write`, `admin` or
   * `claims:write` must expire, or the server answers 400
   * `write_key_requires_expiry`.
   */
  expiresInDays?: number | 'never';
}

export interface ListApiKeysOptions {
  limit?: number;
  cursor?: string;
}

export interface IdempotencyOptions {
  idempotencyKey?: string;
}

// ============================================
// Internal response shapes
// ============================================

interface CreateApiKeyResponse {
  success: boolean;
  data: CreatedApiKey;
  traceId: string;
}

interface ListApiKeysResponse {
  success: boolean;
  data: ApiKey[];
  pagination: {
    cursor?: string;
    nextCursor?: string;
    hasMore: boolean;
  };
  traceId: string;
}

interface RevokeApiKeyResponse {
  success: boolean;
  data: { message: string };
  traceId: string;
}

interface RotateApiKeyResponse {
  success: boolean;
  data: RotateResult;
  traceId: string;
}

// ============================================
// Module
// ============================================

export class ApiKeysModule {
  constructor(private http: HttpClient) {}

  /**
   * Create a new API key.
   *
   * The returned `key` value (the full secret) is shown **only once**.
   * Store it securely — it cannot be retrieved again.
   *
   * @example
   * ```typescript
   * const created = await client.apiKeys.create({
   *   name: 'My Integration Key',
   *   scopes: ['read', 'write'],
   *   expiresInDays: 365,
   * });
   * console.log('Save this key now:', created.key);
   * ```
   */
  async create(
    input: CreateApiKeyInput,
    options?: IdempotencyOptions
  ): Promise<CreatedApiKey> {
    if (!input.name || !input.name.trim()) {
      throw new ValidationError('API key name is required and cannot be blank');
    }

    const body: Record<string, unknown> = {
      name: input.name,
      scopes: input.scopes,
    };

    if (input.expiresInDays !== undefined) {
      body.expiresInDays = input.expiresInDays;
    }

    const requestOptions: Parameters<HttpClient['request']>[0] = {
      method: 'POST',
      path: '/api/v1/api-keys',
      body,
    };

    if (options?.idempotencyKey) {
      requestOptions.headers = { 'Idempotency-Key': options.idempotencyKey };
    }

    const response = await this.http.request<CreateApiKeyResponse>(requestOptions);
    return response.data;
  }

  /**
   * List API keys for the current workspace.
   *
   * @example
   * ```typescript
   * const { data, pagination } = await client.apiKeys.list({ limit: 20 });
   * if (pagination.hasMore) {
   *   const next = await client.apiKeys.list({ cursor: pagination.nextCursor });
   * }
   * ```
   */
  async list(
    options: ListApiKeysOptions = {}
  ): Promise<{ data: ApiKey[]; pagination: ListApiKeysResponse['pagination'] }> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options.cursor !== undefined) {
      params.set('cursor', options.cursor);
    }

    const query = params.toString();
    const path = query ? `/api/v1/api-keys?${query}` : '/api/v1/api-keys';

    const response = await this.http.request<ListApiKeysResponse>({
      method: 'GET',
      path,
    });

    return {
      data: response.data,
      pagination: response.pagination,
    };
  }

  /**
   * Revoke an API key immediately.
   *
   * @example
   * ```typescript
   * await client.apiKeys.revoke('key-id-here');
   * ```
   */
  async revoke(keyId: string): Promise<void> {
    await this.http.request<RevokeApiKeyResponse>({
      method: 'DELETE',
      path: `/api/v1/api-keys/${keyId}`,
    });
  }

  /**
   * Rotate an API key.
   *
   * Issues a new key while keeping the old key valid for `gracePeriodHours`
   * so you have time to update your integrations.
   *
   * @example
   * ```typescript
   * const { newKey, oldKeyValidUntil } = await client.apiKeys.rotate(
   *   'key-id-here',
   *   { gracePeriodHours: 24 },
   *   { idempotencyKey: 'my-rotation-id' }
   * );
   * console.log('New key (save now):', newKey.key);
   * console.log('Old key expires:', oldKeyValidUntil);
   * ```
   */
  async rotate(
    keyId: string,
    options: { gracePeriodHours: number },
    idempotency?: IdempotencyOptions
  ): Promise<RotateResult> {
    const requestOptions: Parameters<HttpClient['request']>[0] = {
      method: 'POST',
      path: `/api/v1/api-keys/${keyId}/rotate`,
      body: { gracePeriodHours: options.gracePeriodHours },
    };

    if (idempotency?.idempotencyKey) {
      requestOptions.headers = { 'Idempotency-Key': idempotency.idempotencyKey };
    }

    try {
      const response = await this.http.request<RotateApiKeyResponse>(requestOptions);
      return response.data;
    } catch (error) {
      // The server has no rotate route yet, so every call 404s. Say so
      // instead of implying the key id is wrong.
      if (error instanceof NotFoundError) {
        throw new NotImplementedError(
          'Server-side key rotation is not available yet. Create a replacement key with ' +
            'apiKeys.create() using the same scopes, then revoke the old key in the portal.',
          error.traceId
        );
      }
      throw error;
    }
  }
}
