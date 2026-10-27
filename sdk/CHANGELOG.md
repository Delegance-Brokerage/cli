# Changelog

## Versioning policy (0.x)

While the SDK is 0.x, a minor release may add fields, methods, and routes. It
never removes or renames one. A removal or rename waits for a new API version
date: the server keeps serving the older shape to clients that send the older
`Delegance-Version` for at least 180 days, and both CHANGELOGs announce it.

## Unreleased

- `instantQuotes.start()` returns `wcMarket` (types `WcMarket`,
  `WcMarketState`) when workers' comp is requested: each insured state's
  workers' comp market, and whether a private WC price was requested. When
  every state is monopolistic (only the state fund writes WC, as in Ohio),
  `privateWcQuote` is `skipped` with `reason: monopolistic_state_fund_only`
  and workers' comp goes to a broker for the state fund and Stop Gap
  Employers Liability. Absent for other coverages and on older servers.
- Writes are no longer resent on their own. A POST, PUT, PATCH, or DELETE goes
  out once unless the call is marked idempotent AND carries an
  Idempotency-Key, and only routes whose server replays the first response are
  marked (today: `feedback.submit`). Before this release the SDK resent every
  write on a 5xx, a network error, or its own timeout, which could file a claim
  or a certificate twice.
- A write that times out or loses its connection throws the new
  `OutcomeUnknownError` (`outcome: 'unknown'`, `statusCode: 0`). The server may
  or may not have acted on it; check before you send it again.
- Reads (GET) now also retry a 429 and a 503, waiting for the server's
  `Retry-After` (seconds or an HTTP date) plus jitter. A wait that would pass
  the new `retryDeadlineMs` option (default 60000) ends the retries and throws.
  The exponential backoff for 5xx and network errors is jittered too.
- Every request sends `Delegance-Version: 2026-10-01` (exported as
  `API_VERSION`) and `X-Delegance-Client: sdk/<version>`.
- `createSignup()` and `createDeviceLogin()` accept `headers` and
  `retryDeadlineMs`.
- Errors carry the server's `retryable` flag (`error.retryable`, undefined
  against an older server) beside `code`. v1 API-key routes now send a `code`
  from the new exported `V1_ERROR_CODES` list (type `V1ErrorCode`), such as
  `rate_limited` or `idempotency_in_progress`.
- A request that carries an `Idempotency-Key` and gets `409
  idempotency_in_progress` waits for the server's `Retry-After` and sends the
  same request once more, any method, within `retryDeadlineMs`. The server
  had not run that copy; the resend gets the first answer or the same 409,
  and the route's own dedupe covers a first request that died. It never waits
  twice.

## 0.3.0 (2026-10-12)

Includes the unreleased 0.2.1 changes, which never reached npm.

- `signup.getTerms()` reads the current Terms of Service version and links
  from `GET /api/v1/legal/terms` (public, no key).
- `signup.enroll()` now takes `termsAccepted: true` and `termsVersion`. Servers
  running the Terms step refuse an enrollment without them.
- New `client.terms` module: `get()` and `accept(version)`.
- Quote offers gain optional `limits`, `deductible`, and `effectiveDate`.
- A bind result carries an optional `financing` offer (lender, checkout link,
  terms, disclosure).
- Dependency security patches (esbuild override), inside the current majors.

## 0.2.0

- First public release.
