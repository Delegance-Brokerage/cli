/**
 * Delegance SDK Client
 * 
 * Main entry point for interacting with the Delegance API.
 * 
 * @example
 * ```typescript
 * import { DeleganceClient } from '@delegance/sdk';
 * 
 * const client = new DeleganceClient({
 *   apiKey: 'dlg_xxx_sk_xxx',
 *   baseUrl: 'https://portal.delegancebrokerage.com'
 * });
 * 
 * // Create a company
 * const company = await client.companies.create({
 *   name: 'ABC Construction',
 *   industry: 'construction',
 *   companySize: '11-25',
 *   contactEmail: 'contact@abc.com'
 * });
 * 
 * // Upload a document
 * const doc = await client.documents.upload({
 *   companyId: company.id,
 *   file: fs.readFileSync('./policy.pdf'),
 *   fileName: 'GL-2025.pdf'
 * });
 * 
 * // Wait for extraction
 * const result = await client.documents.waitForExtraction(doc.id);
 * ```
 */

import { HttpClient, SDK_VERSION } from './utils/http';
import { CompaniesModule } from './modules/companies';
import { DocumentsModule } from './modules/documents';
import { ChatModule } from './modules/chat';
import { QuotesModule } from './modules/quotes';
import { PoliciesModule } from './modules/policies';
import { COIModule } from './modules/coi';
import { SOVModule } from './modules/sov';
import { ApiKeysModule } from './modules/api-keys';
import { UsageModule } from './modules/usage';
import { KnowledgeModule } from './modules/knowledge';
import { OnboardingModule } from './modules/onboarding';
import { AppetiteModule } from './modules/appetite';
import { LeadsModule } from './modules/leads';
import { InstantQuotesModule } from './modules/instant-quotes';
import { PaymentsModule } from './modules/payments';
import { BondsModule } from './modules/bonds';
import { ClaimsModule } from './modules/claims';
import { FeedbackModule } from './modules/feedback';
import { TermsModule } from './modules/terms';
import { SignupModule } from './modules/signup';
import { AuthModule, DeviceLoginModule } from './modules/auth';
import type { DeleganceClientConfig } from './types';

// API key format validation
const API_KEY_REGEX = /^dlg_[a-zA-Z0-9]{8}_sk_[a-zA-Z0-9]{32}$/;

export class DeleganceClient {
  private http: HttpClient;
  
  /** Companies module for managing companies */
  public readonly companies: CompaniesModule;
  
  /** Documents module for uploading and managing documents */
  public readonly documents: DocumentsModule;
  
  /** Chat module for interacting with the Orin assistant */
  public readonly chat: ChatModule;
  
  /** Quotes module for requesting insurance quotes */
  public readonly quotes: QuotesModule;
  
  /** Policies module for managing insurance policies */
  public readonly policies: PoliciesModule;
  
  /** COI module for generating certificates of insurance */
  public readonly coi: COIModule;
  
  /** SOV module for managing schedules of values */
  public readonly sov: SOVModule;

  /** API keys module for managing API keys */
  public readonly apiKeys: ApiKeysModule;

  /** Usage module for billing summaries, daily data, and rate-limit status */
  public readonly usage: UsageModule;

  /** Knowledge module for searching notecards and document facts */
  public readonly knowledge: KnowledgeModule;

  /** Onboarding module for checking developer setup status */
  public readonly onboarding: OnboardingModule;

  /** Appetite module for carrier appetite matching (needs the appetite:read scope) */
  public readonly appetite: AppetiteModule;

  /** Leads module for sending prospect businesses to Delegance */
  public readonly leads: LeadsModule;

  /** Instant quotes: questions, carrier premiums, and bind requests */
  public readonly instantQuotes: InstantQuotesModule;

  /** Premium payment requests and Stripe checkout links */
  public readonly payments: PaymentsModule;

  /** Surety bond quotes */
  public readonly bonds: BondsModule;

  /** File and track claims (needs the claims:write scope) */
  public readonly claims: ClaimsModule;

  /** Report a bug, an idea, or a question to Delegance */
  public readonly feedback: FeedbackModule;
  public readonly terms: TermsModule;

  /** The calling key: info and refresh */
  public readonly auth: AuthModule;

  /**
   * Create a new Delegance client
   * 
   * @param config - Client configuration
   * @throws Error if API key is missing or invalid format
   */
  constructor(config: DeleganceClientConfig) {
    // Validate API key
    if (!config.apiKey) {
      throw new Error('API key is required. Get one from the Delegance dashboard.');
    }

    if (!API_KEY_REGEX.test(config.apiKey)) {
      throw new Error(
        'Invalid API key format. Expected format: dlg_xxxxxxxx_sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
      );
    }

    // Initialize HTTP client
    this.http = new HttpClient(config);

    // Initialize modules
    this.companies = new CompaniesModule(this.http);
    this.documents = new DocumentsModule(this.http);
    this.chat = new ChatModule(this.http);
    this.quotes = new QuotesModule(this.http);
    this.policies = new PoliciesModule(this.http);
    this.coi = new COIModule(this.http);
    this.sov = new SOVModule(this.http);
    this.apiKeys = new ApiKeysModule(this.http);
    this.usage = new UsageModule(this.http);
    this.knowledge = new KnowledgeModule(this.http);
    this.onboarding = new OnboardingModule(this.http);
    this.appetite = new AppetiteModule(this.http);
    this.leads = new LeadsModule(this.http);
    this.instantQuotes = new InstantQuotesModule(this.http);
    this.payments = new PaymentsModule(this.http);
    this.bonds = new BondsModule(this.http);
    this.claims = new ClaimsModule(this.http);
    this.feedback = new FeedbackModule(this.http);
    this.auth = new AuthModule(this.http);
    this.terms = new TermsModule(this.http);
  }

  /**
   * Get the SDK version
   */
  static get version(): string {
    return SDK_VERSION;
  }

  /**
   * Verify the API key is valid by making a test request
   * 
   * @example
   * ```typescript
   * const isValid = await client.verifyApiKey();
   * if (!isValid) {
   *   console.error('API key is invalid or expired');
   * }
   * ```
   */
  async verifyApiKey(): Promise<boolean> {
    try {
      await this.companies.list();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create a Delegance client from environment variables
 * 
 * Reads from:
 * - DELEGANCE_API_KEY - Required API key
 * - DELEGANCE_BASE_URL - Optional base URL (default: https://portal.delegancebrokerage.com)
 * 
 * @example
 * ```typescript
 * // Ensure DELEGANCE_API_KEY is set in environment
 * const client = createClientFromEnv();
 * ```
 */
export function createClientFromEnv(): DeleganceClient {
  const apiKey = process.env.DELEGANCE_API_KEY;
  const baseUrl = process.env.DELEGANCE_BASE_URL;

  if (!apiKey) {
    throw new Error(
      'DELEGANCE_API_KEY environment variable is required. ' +
      'Get an API key from the Delegance dashboard.'
    );
  }

  return new DeleganceClient({
    apiKey,
    baseUrl
  });
}

/**
 * Signup runs before any API key exists, so it lives outside DeleganceClient.
 *
 * @example
 * ```typescript
 * const signup = createSignup();
 * const { bootstrapKey } = await signup.createAccount({ ... });
 * ```
 */
export function createSignup(config: { baseUrl?: string; timeout?: number; retries?: number; retryDeadlineMs?: number; headers?: Record<string, string> } = {}): SignupModule {
  return new SignupModule((apiKey) => new HttpClient({ apiKey, ...config }));
}

/**
 * Browser login for an existing customer (`delegance auth login`). No API key
 * yet: the device secret is the credential.
 *
 * ```typescript
 * const login = createDeviceLogin();
 * const device = newDeviceSecret();
 * const start = await login.start({ deviceSecretHash: device.hash, deviceName: 'laptop' });
 * // show start.userCode and open start.verificationUriComplete
 * const result = await login.waitForKey(start.loginId, device.secret);
 * ```
 */
export function createDeviceLogin(config: { baseUrl?: string; timeout?: number; retries?: number; retryDeadlineMs?: number; headers?: Record<string, string> } = {}): DeviceLoginModule {
  return new DeviceLoginModule((apiKey) => new HttpClient({ apiKey, ...config }));
}
