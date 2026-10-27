/**
 * Delegance SDK
 * 
 * Get commercial insurance quotes from your code. An API key belongs to one
 * company; every call acts on that company.
 *
 * @example
 * ```typescript
 * import { DeleganceClient } from '@delegance/sdk';
 *
 * const client = new DeleganceClient({ apiKey: process.env.DELEGANCE_API_KEY! });
 *
 * // Start an instant quote and read the questions the carriers ask
 * const session = await client.instantQuotes.start(['general_liability']);
 *
 * // Answer them (keyed by question id), then file the answers
 * await client.instantQuotes.submit({
 *   submissionId: session.submissionId,
 *   sessionVersion: session.sessionVersion,
 *   answers: { annual_revenue: 850000 },
 * });
 *
 * // Wait for premiums
 * const status = await client.instantQuotes.waitForQuotes(session.submissionId);
 * console.log(status.carrierQuotes);
 * ```
 * 
 * @packageDocumentation
 */

// Main client
export { DeleganceClient, createClientFromEnv, createSignup, createDeviceLogin } from './client';

// Version + canonical default API origin (WS0 shared constant, re-exported
// for consumers/docs). The default host is the prod portal
// (portal.delegancebrokerage.com), decided for the 0.2.0 publish; changing
// it is exactly two lines (this SDK constant in utils/http.ts + the CLI
// mirror in cli/src/utils/config.ts) plus regenerated docs.
export { SDK_VERSION, DEFAULT_BASE_URL, API_VERSION } from './utils/http';

// Modules
export { CompaniesModule } from './modules/companies';
export type { ListCompaniesOptions } from './modules/companies';

export { DocumentsModule } from './modules/documents';
export type { ListDocumentsOptions, WaitForExtractionOptions } from './modules/documents';

export { ChatModule } from './modules/chat';
export type { ChatMessage, ChatOptions, ChatResponse } from './modules/chat';

export { QuotesModule } from './modules/quotes';
export type { 
  Carrier, 
  Quote, 
  QuoteRequest, 
  ListQuotesOptions,
  SubmitQuoteResponse,
  ListQuotesResponse,
  ListCarriersResponse,
  GetQuoteResponse
} from './modules/quotes';

export { PoliciesModule } from './modules/policies';
export type {
  Policy,
  PolicyCoverage,
  ListPoliciesOptions,
  ListPoliciesResponse,
  GetPolicyResponse,
  CancellationReason,
  CancellationRequestInput,
  CancellationSignInput,
  CancellationSignResult,
  CancellationStatus
} from './modules/policies';

export { COIModule } from './modules/coi';
export type {
  CertificateHolder,
  GenerateCOIRequest,
  GenerateCOIResponse,
  COI,
  ListCOIsResponse
} from './modules/coi';

export { SOVModule } from './modules/sov';
export type {
  UploadSOVRequest,
  UploadSOVResponse,
  SOV,
  SOVLocation,
  ListSOVsResponse,
  ListSOVsOptions,
  GetSOVResponse
} from './modules/sov';

export { ApiKeysModule, API_KEY_SCOPES } from './modules/api-keys';
export type {
  ApiKey,
  CreatedApiKey,
  RotateResult,
  CreateApiKeyInput,
  ApiKeyScope,
  ListApiKeysOptions,
  IdempotencyOptions
} from './modules/api-keys';

export { UsageModule } from './modules/usage';
export type {
  MeterUsage,
  UsageSummary,
  DailyUsage,
  RateLimitStatus,
  DailyUsageOptions
} from './modules/usage';

export { KnowledgeModule } from './modules/knowledge';
export type {
  KnowledgeSearchResult,
  Notecard,
  DocumentFacts,
  SearchInput,
  ListNotecardsOptions
} from './modules/knowledge';

export { OnboardingModule } from './modules/onboarding';
export type {
  OnboardingStatus,
  OnboardingNextStep,
  OnboardingState,
  OnboardingStateData
} from './modules/onboarding';

export { AppetiteModule } from './modules/appetite';
export type {
  AppetiteMatchInput,
  AppetiteMatch,
  CarrierAppetiteResult,
  AppetiteMatchResult,
  AppetiteMatchStart,
  AppetiteJobStatus,
  WaitForMatchOptions
} from './modules/appetite';

export { LeadsModule } from './modules/leads';
export type { CreateLeadInput, CreateLeadResult, LeadAddress } from './modules/leads';

// Types
export type {
  DeleganceClientConfig,
  APIResponse,
  PaginatedResponse,
  
  // Company types
  Company,
  CreateCompanyInput,
  CompanySize,
  
  // Document types
  Document,
  DocumentWithExtraction,
  DocumentType,
  DocumentStatus,
  UploadDocumentInput,
  ExtractedPolicy,
  
  // API Key types
  APIKey,
  CreateAPIKeyInput,
  CreatedAPIKey
} from './types';

// Schemas for validation
export {
  CompanySizeSchema,
  CreateCompanySchema,
  DocumentTypeSchema,
  DocumentStatusSchema
} from './types';

// Errors
export {
  DeleganceError,
  AuthenticationError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  ForbiddenError,
  NotImplementedError,
  OutcomeUnknownError,
  V1_ERROR_CODES
} from './types';
export type { V1ErrorCode } from './types';

// Commerce: signup, instant quotes, bind, payments, bonds, claims
export { SignupModule, newDeviceSecret } from './modules/signup';
export { AuthModule, DeviceLoginModule } from './modules/auth';
export type { ApiKeyInfo, DeviceLoginStart, DeviceLoginPoll } from './modules/auth';
export type { CreateAccountInput, CreateAccountResult, EnrollResult, ExchangeResult, TermsInfo } from './modules/signup';
export { TermsModule } from './modules/terms';
export type { TermsAcceptance } from './modules/terms';
export { InstantQuotesModule, invalidAnswersDetails } from './modules/instant-quotes';
export type {
  InvalidAnswer,
  InvalidAnswerReason,
  InvalidAnswersDetails,
  InstantQuestion,
  InstantQuestionOption,
  InstantSession,
  WcMarket,
  WcMarketState,
  InstantSubmitResult,
  CarrierQuote,
  InstantQuoteStatus,
  WithheldCarrier,
  BindRequestResult,
  FinancingOffer,
  BindStepUpRequired,
  FastBindInput,
  BrokerHandoffQuestions,
  BrokerHandoffResult,
} from './modules/instant-quotes';
export { PaymentsModule } from './modules/payments';
export type { PaymentRequest } from './modules/payments';
export { BondsModule } from './modules/bonds';
export type { StartBondQuoteInput, BondToolResult } from './modules/bonds';
export { ClaimsModule } from './modules/claims';
export type { ClaimSummary, FileClaimInput } from './modules/claims';

export { FeedbackModule, FEEDBACK_MESSAGE_MAX } from './modules/feedback';
export type { FeedbackType, FeedbackContext, SubmitFeedbackInput } from './modules/feedback';
