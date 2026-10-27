# @delegance/sdk

Get commercial insurance quotes from your code. This TypeScript SDK covers the Delegance API: signup, instant quotes, bind, payments, policies, certificates, bonds, claims, and documents.

Full docs: https://portal.delegancebrokerage.com/docs/sdk

## Install

```bash
npm install @delegance/sdk
```

Requires Node 18 or newer. The package ships CommonJS, ESM, and TypeScript types.

Prefer a terminal? [`@delegance/cli`](https://www.npmjs.com/package/@delegance/cli) runs the same flows: `npx -y @delegance/cli quote start --demo`.

## Availability

- Quoting is open to every account. A new account from `createSignup()` can quote as soon as the owner confirms the email.
- Bind, payments, bonds, and claims are live over the API.
- A licensed Delegance broker approves every bind before coverage starts. `instantQuotes.bind()` files the request; it never charges a card.
- A switched-off feature answers 503 with `reason: 'not_available'`. The SDK does not retry that answer.

## One key, one company

An API key belongs to exactly one company. Every call acts on that company, so you never pass a company id to quote.

- `documents.upload()` and `documents.list()` take an optional `companyId`. Leave it out. If you name a company the key does not belong to, the server answers 403 with `code: 'company_mismatch'`.
- A customer key cannot create companies. `companies.create()` and `companies.upsert()` answer 403 `tenant_key_cannot_create`. Open a new account with `createSignup()` instead.
- `companies.list()` returns the key's own company.

## Quick start: sign up and quote

```typescript
import { createSignup, newDeviceSecret, DeleganceClient } from '@delegance/sdk';

// 1. Create the account. Keep `device.secret` on this machine only.
const signup = createSignup();
const account = await signup.createAccount({
  name: 'Acme Bakery',
  contactEmail: 'owner@acmebakery.com',
  industry: 'commercial bakery',
  companySize: '2-10',
  address: { street: '100 Main St', city: 'Austin', state: 'TX', zip: '78701' },
});
const device = newDeviceSecret();
const { enrollmentId } = await signup.enroll(account.bootstrapKey, {
  deviceSecretHash: device.hash,
  firstName: 'Dana',
  lastName: 'Owner',
});
await signup.requestVerification(account.bootstrapKey);

// 2. The owner clicks the emailed confirm link. Then collect the API key.
const result = await signup.waitForKey(enrollmentId, device.secret);
if (result.status !== 'ready') throw new Error('Confirm link not clicked yet');

// 3. Quote. See "Instant quotes" below for the answers.
const client = new DeleganceClient({ apiKey: result.apiKey });
const session = await client.instantQuotes.start(['general_liability']);
```

Store `result.apiKey` somewhere safe. The server shows it once.

## Quick start: existing API key

```typescript
import { DeleganceClient } from '@delegance/sdk';
import fs from 'fs';

const client = new DeleganceClient({ apiKey: process.env.DELEGANCE_API_KEY! });

// The key's own company
const [company] = await client.companies.list();
console.log(company.name);

// Upload a policy. No companyId: the key decides the company.
const doc = await client.documents.upload({
  file: fs.readFileSync('./GL-Policy-2025.pdf'),
  fileName: 'GL-Policy-2025.pdf',
  documentType: 'policy',
});

const done = await client.documents.waitForExtraction(doc.id, { timeoutMs: 120_000 });
console.log(done.extraction?.policies);

// Read what is in force
const { policies } = await client.policies.list();
```

## Instant quotes

Real carrier premiums over the API. The flow has four calls.

1. `start(coverages)` returns the session and the carriers' questions.
2. `submit()` files your answers with the carriers.
3. `status()` or `waitForQuotes()` returns premiums as carriers answer.
4. `bind()` requests a bind on one offer.

Coverage ids: `general_liability`, `workers_comp`, `business_owners`, `cyber`, `professional_liability`, `tech_eo`, `commercial_auto`, `commercial_property`, `umbrella`.

```typescript
const session = await client.instantQuotes.start(['general_liability', 'workers_comp']);

// Each question: { id, label, type, options?, required, prefill?, suggested?, showIf?, requiredIfShown? }
const answers: Record<string, unknown> = {};
for (const q of session.questions) {
  if (q.prefill !== undefined && q.prefill !== null) answers[q.id] = q.prefill;
}
answers.annual_revenue = 850000;

const submitted = await client.instantQuotes.submit({
  submissionId: session.submissionId,
  sessionVersion: session.sessionVersion,
  answers,
});

if (submitted.status === 'submitted') {
  const status = await client.instantQuotes.waitForQuotes(session.submissionId, { timeoutMs: 10 * 60_000 });
  console.log('Coverage starts', status.effectiveDate);
  for (const q of status.carrierQuotes) {
    console.log(q.coverage, q.carrierName, q.premium, q.limits, q.deductible, q.bindable);
  }
}
```

### Answers

- Key every answer by question `id`.
- `yes_no`: `'yes'` or `'no'`. `number`, `currency`, `percentage`: a number. `select`: one option `value`. Anything else: text.
- `prefill` comes from the insured's own account data. Send it back unless the insured changes it.
- `suggested` is a guess from another source. It counts only after the insured confirms it.
- `showIf: { questionId, equals }` hides a follow-up until the parent answer matches. A hidden question is never required. `requiredIfShown` makes it required while visible.

### Submit results

`submit()` returns `status`:

| Status | Meaning |
|--------|---------|
| `submitted` | Filed with the instant carriers. Poll `status()` for premiums. |
| `acord_pending` | Some coverages need a person. A broker task opened (`brokerTaskId`). |
| `no_carriers` | No carrier can quote this instantly. Hand it to a broker (below). |

A second submit for coverage that already has a live request answers 409 `active_request_exists`. To re-quote, call `start(coverages, { fresh: true })` and submit with `replace: true`.

### Reading quotes

`status()` returns `carrierQuotes`, one row per carrier offer:

- `premium`: annual premium in dollars, or null before the carrier prices it.
- `bindable`: true when you can bind the offer.
- `limits`: readable limits, for example `"$1M per occurrence / $2M aggregate"` or `"Statutory / $1M employers liability"`.
- `deductible`: dollars, 0 for none. Today only cyber quotes carry one; other lines return null.
- `effectiveDate` (on the status): when coverage would start, as `YYYY-MM-DD`.

The three fields are new in 0.2.1. An older server leaves them out, so treat a missing field like null.

Compare prices within one coverage only. The cheapest bindable offer per coverage is the one to show first.

### No instant carrier: broker handoff

```typescript
if (submitted.status === 'no_carriers') {
  const plan = await client.instantQuotes.brokerHandoffQuestions(session.submissionId, answers);
  const acordAnswers: Record<string, unknown> = {}; // answer plan.questions the same way
  const handoff = await client.instantQuotes.brokerHandoff(session.submissionId, {
    answers: acordAnswers,
    instantAnswers: answers,
    complete: true,
  });
  console.log(handoff.status, handoff.brokerTaskId); // 'broker_review'
}
```

A broker places the risk with a market that quotes by hand and emails the owner. `complete: false` says you stopped early; the broker asks the rest. A repeat call returns the same broker task. `status().brokerReview` shows the task.

### Bind and pay

```typescript
const status = await client.instantQuotes.status(session.submissionId);
const offer = status.carrierQuotes.find((q) => q.bindable && q.premium !== null);
if (!offer) throw new Error('No bindable offer yet');

const bind = await client.instantQuotes.bind(session.submissionId, offer.opportunityId);
console.log(bind.status, bind.next);

// After a broker approves the bind, a payment request appears
const due = (await client.payments.list()).filter((p) => p.payable);
if (due[0]) {
  const { checkoutUrl } = await client.payments.checkout(due[0].id);
  console.log('Pay here:', checkoutUrl); // Stripe checkout
}
```

A Delegance broker approves each bind request. You get an email when payment is ready. One live bind per coverage per submission: a repeat returns the existing request (`existing: true`).

`bindWithStepUp()` covers fast bind, where the owner attests the answers and enters a 6-digit code we email. Fast bind with the carrier's own checkout (tier A) is not open yet; until it is, every bind goes to a broker.

## Device login (existing customers)

A person who already has a portal account approves a new device in the browser. No API key is needed to start.

```typescript
import { createDeviceLogin, newDeviceSecret, DeleganceClient } from '@delegance/sdk';

const login = createDeviceLogin();
const device = newDeviceSecret();
const start = await login.start({ deviceSecretHash: device.hash, deviceName: 'build-server' });
console.log(`Open ${start.verificationUriComplete} and confirm code ${start.userCode}`);

const result = await login.waitForKey(start.loginId, device.secret);
if (result.status === 'ready') {
  const client = new DeleganceClient({ apiKey: result.apiKey });
  const info = await client.auth.keyInfo();   // scopes, company, expiry
  if (info.refreshable) await client.auth.refresh(); // extend a CLI key
}
```

## API keys

Create keys in the portal (Settings > API keys), with `delegance signup` / `delegance auth login`, or with `client.apiKeys.create()` from a key with the `admin` scope.

Key rules:

- A key belongs to one company.
- A new key expires in 90 days unless you pick another expiry.
- A key with `write`, `admin`, or `claims:write` must expire within 365 days. `expiresInDays: 'never'` is allowed only for a read-only key; otherwise the server answers 400 `write_key_requires_expiry`.
- `claims:write` can be created only while signed in to the portal (signup and device login keys for owners and admins carry it).
- Delegance staff accounts cannot create client keys (403).
- `appetite:read`, `mcp:read`, `mcp:orin`, and `claims:write` are opt-in. `read` and `write` never imply them.
- Keys from signup and device login refresh with `client.auth.refresh()`.

```typescript
const created = await client.apiKeys.create({
  name: 'CI uploader',
  scopes: ['read', 'write'],
  expiresInDays: 90,
});
console.log('Save this key now:', created.key);
```

Format: `dlg_xxxxxxxx_sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.

## Limits

| Limit | Error |
|-------|-------|
| Quote starts per key per day | 429 `quote_limit_reached` |
| Per-key daily AI budget (chat, quote sessions) | 429 `api_key_budget_exhausted` |
| Delegance-wide daily API AI budget | 429 `api_budget_exhausted`, `Retry-After: 3600` |
| Requests per minute | 429, see `client.usage.rateLimits()` |

The SDK does not retry a 429. Read `err.retryAfter` (seconds, from the body or the `Retry-After` header) and wait before you call again.

## Other modules

Every module hangs off the client. Each one has a docs page with examples.

| Module | What it does |
|--------|--------------|
| `instantQuotes` | Start, submit, status, broker handoff, bind |
| `payments` | Premium payment requests and checkout links |
| `bonds` | Surety bond quotes; you buy on the surety's page |
| `claims` | File and track claims (needs `claims:write`; accept the claims disclaimer once in the portal) |
| `policies` | Policies in force, expiring soon, cancellation requests |
| `coi` | Certificates of insurance |
| `documents` | Upload, extraction status, list |
| `sov` | Schedules of values |
| `chat` | Ask about your coverage |
| `knowledge` | Notecards and facts extracted from a document |
| `appetite` | Which carriers will write a risk (needs `appetite:read`) |
| `leads` | Send a prospect business to Delegance |
| `onboarding` | Account setup status and verification email |
| `feedback` | Report a bug, an idea, or a question |
| `usage` | Billing-period usage, daily usage, rate limits |
| `apiKeys` | Create, list, revoke keys |
| `auth` | Key info and refresh |
| `companies` | The key's own company |
| `quotes` | Legacy partner quote queue. Submission answers 501; use `instantQuotes` |

### Bonds

```typescript
const start = await client.bonds.start({ state: 'TX', bondName: 'notary' });
```

### Claims

```typescript
const claim = await client.claims.file({ description: 'Water damage in the kitchen', incidentDate: '2026-10-01' });
console.log(claim.claimId, claim.status, claim.portalUrl);
```

A 403 with `reason: 'gate_not_acknowledged'` means the claims disclaimer is not accepted yet. The owner accepts it once in the portal (`err.body.portalUrl`).

### Feedback

```typescript
const { id } = await client.feedback.submit({
  type: 'bug',
  message: 'quote submit hung on the delivery question',
  context: { command: 'quote submit', exitCode: 1, traceId: 'trace-from-the-error' },
});
```

### Appetite

Needs a key with the `appetite:read` scope. A warm cache hit returns the result at once; a cold match returns a job to poll.

```typescript
const start = await client.appetite.match({
  state: 'CA',
  industry: 'commercial bakery',
  coverageTypes: ['general_liability', 'workers_comp'],
});
const result = start.status === 'succeeded' ? start : await client.appetite.waitForMatch(start.jobId);
```

### Leads

Idempotent on `externalId`. A contact email that already belongs to a company returns that company.

```typescript
const { companyId } = await client.leads.create({
  name: 'Riverbend Bakery',
  contactEmail: 'owner@riverbend.example',
  state: 'TX',
  externalId: 'crm-4411',
});
```

## Use it from an AI agent

Claude Code, Codex, Gemini CLI, and other coding agents can drive the SDK or the CLI. The CLI is often simpler for an agent: `npx -y @delegance/cli quote start --json` prints the questions as JSON, and `--answers answers.json` files them. See the CLI README section "Use it from an AI agent" and https://portal.delegancebrokerage.com/docs/cli.

Rules that keep an agent safe:

- Read the key from `DELEGANCE_API_KEY`. Never paste it into a prompt or a file the agent commits.
- Pass your own `idempotencyKey` to `submit()`, `bind()`, and `brokerHandoff()` when the agent may retry across restarts. The same key lands on the same request.
- Gate on `err.reason` and `err.code`, never on the message text.

## Configuration

```typescript
const client = new DeleganceClient({
  apiKey: 'dlg_xxxxxxxx_sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // required
  baseUrl: 'https://portal.delegancebrokerage.com',           // default
  timeout: 30000,                                             // ms, default 30000
  retries: 3,                                                 // default 3
  headers: { 'X-Custom-Header': 'value' },
});
```

`createClientFromEnv()` reads `DELEGANCE_API_KEY` and, if set, `DELEGANCE_BASE_URL`.

## Errors

```typescript
import {
  DeleganceError,
  AuthenticationError,  // 401
  ValidationError,      // 400
  ForbiddenError,       // 403
  NotFoundError,        // 404
  RateLimitError,       // 429
  NotImplementedError,  // 501
} from '@delegance/sdk';

try {
  await client.documents.list({ companyId: 'another-company' });
} catch (err) {
  if (err instanceof DeleganceError) {
    console.error(err.statusCode, err.reason, err.code, err.message, err.traceId);
  }
}
```

Every error carries:

- `statusCode`: the HTTP status.
- `reason`: the machine-readable reason from the body, when sent (`not_available`, `quote_limit_reached`, `active_request_exists`, `attestation_required`, ...).
- `code`: the body's `code`, when sent (`company_mismatch`). New in 0.2.1; on 0.2.0 read `err.body.code`.
- `body`: the parsed error body, for fields such as `portalUrl`.
- `traceId`: quote it to support.

Retries: the SDK retries network failures and 5xx answers other than 501, with backoff. It never retries a 4xx (including 429), a 501, or a 503 with `reason: 'not_available'`.

## Support

- Docs: https://portal.delegancebrokerage.com/docs/sdk
- Email: support@delegancebrokerage.com
