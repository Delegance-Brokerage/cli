# Delegance Onboarding State Machine (frozen contract, WS1)

This document is part of the frozen onboarding contract. It is consumed by
`app/services/onboarding-api/state-machine.ts` (the pure derivation), the
`GET /api/v1/onboarding/state` route, and the conformance suite. Changing it is
a contract change: bump the OpenAPI version and re-run the conformance tests.

## The five states

| State | Meaning |
|---|---|
| `created` | The company exists (created via `POST /api/v1/companies`) and no verification challenge has been issued yet. |
| `awaiting_verification` | A verification challenge email has been sent to the company contact email. A human must open the link and confirm. The agent cannot self-verify. |
| `documents_pending` | The tenant is verified and either has no documents yet or every uploaded document failed terminally, so it needs (re)uploads. |
| `processing` | At least one uploaded document is in flight through the document pipeline. |
| `ready` | The tenant is verified, at least one document processed successfully, and no document is in flight. |

## Transition table

```
created               --request verification-->   awaiting_verification
awaiting_verification --human confirms link-->    documents_pending
documents_pending     --first document upload-->  processing
processing            --all documents processed-> ready
(any state)           --GET state-->              (no transition, read only)
```

Notes:

- Verification is one-way. Once a tenant is `verified`, the machine never
  returns to `created` or `awaiting_verification`.
- `processing` returns to `documents_pending` only in the all-failed case
  described under document terminal statuses below.
- A `ready` tenant that uploads another document moves back to `processing`
  until that document reaches a terminal status.

## Per-state callable-endpoint matrix

Bootstrap capabilities (available in EVERY state, including pre-verification):

| Capability | Endpoint |
|---|---|
| `create_company` | `POST /api/v1/companies` (bootstrap-create path only; a tenant API key, including a bootstrap key, gets 403 `tenant_key_cannot_create`) |
| `poll_onboarding` | `GET /api/v1/onboarding/state`, `GET /api/v1/onboarding/status` |
| `request_verification` | `POST /api/v1/onboarding/verification` |

Verified capabilities (available ONLY in `documents_pending`, `processing`,
and `ready`, i.e. after a human completed the verification link):

| Capability | Endpoint |
|---|---|
| `upload_document` | `POST /api/v1/documents` |
| `request_quote` | quote endpoints (`/api/v1/quotes/*`) |
| `generate_coi` | COI endpoints (`/api/v1/coi/*`) |

Any call outside the bootstrap set on an unverified tenant returns
`403` with `reason: tenant_unverified` (see the error model below). The
capability list is exhaustive pre-verification: reads are blocked too.

## Polling semantics

- Poll `GET /api/v1/onboarding/state`. Recommended interval: 5 seconds.
- There are no webhooks in v1. Polling is the only progress signal.
- Polling never mutates state (read only, safe to retry).

## Document terminal statuses (frozen lists)

The document pipeline writes the `documents.status` column. These two lists
are FROZEN as of this contract and are encoded verbatim as
`TERMINAL_SUCCESS_STATUSES` / `TERMINAL_FAILURE_STATUSES` in
`app/services/onboarding-api/state-machine.ts`:

- TERMINAL SUCCESS (counts as `processed`): `processed`
- TERMINAL FAILURE (counts as `failed`): `failed`

Everything else (`pending`, `uploaded`, `queued`, `processing`) is in flight.

Rules:

- A document in a terminal failure status is NOT in flight. It can never hold
  the state machine in `processing` forever.
- Terminal success statuses count toward `documents.processed`; terminal
  failure statuses count toward `documents.failed`; neither is in flight.
- A tenant whose documents ALL failed terminally returns to
  `documents_pending` (it needs re-uploads), not `ready` and not `processing`.
- `ready` requires at least one terminal SUCCESS document and zero in-flight
  documents.

## Idempotency (company creation)

Request idempotency is a dedicated CLAIM-FIRST mechanism keyed by the creating
principal plus the `Idempotency-Key` header:

- BEFORE any side effect the server claims the ledger row
  `(principal, Idempotency-Key, sha256(request body))` with status
  `in_progress`. After the create succeeds the row is updated to `completed`
  with the recorded (redacted) outcome. A failure mid-create therefore leaves
  an `in_progress` claim; it can never double-create a company under the same
  key.
- A replay with the SAME key and the SAME body hash against a `completed`
  claim returns the ORIGINAL response with `bootstrapKey: null` plus
  `bootstrapKeyReplay: "redacted"` and guidance to use the
  verification/recovery path. The plaintext bootstrap key is shown exactly
  once, on the live 201; it is never stored and never re-shown (show-once is
  preserved even under replay).
- A retry with the SAME key and SAME body hash while the claim is still
  `in_progress` and inside its lease (~10 minutes from the claim) returns
  `409` with `reason: idempotency_in_progress`. Retry later.
- Once the lease expires, the SAME key + body retry takes over the stale
  claim atomically. If the dead attempt already created the company, the
  takeover REPAIRS (finishes minting the bootstrap key for that same
  company) instead of re-creating; otherwise it re-runs the create exactly
  once.
- The SAME key with a DIFFERENT body hash returns `409` with
  `reason: idempotency_conflict`, whatever the claim status.
- `externalId` is a separate business-level dedup field (the caller's own id
  for the company). It is NOT the idempotency mechanism and behaves exactly as
  documented on `CreateCompanyRequest`.

## Who may create a company

Per WS1 Decision 3:

- An existing tenant's API key (any scope, including a previously minted
  bootstrap key) may NOT create companies: `403` with
  `reason: tenant_key_cannot_create`.
- The bootstrap-create path is reachable unauthenticated or with a WS2
  delegated credential, under per-IP and global daily caps
  (`ONBOARDING_BOOTSTRAP_CREATE_IP_DAILY_CAP`, default 5;
  `ONBOARDING_BOOTSTRAP_CREATE_GLOBAL_DAILY_CAP`, default 100). Over a cap, or
  when the limiter state is unavailable (fail closed), the response is `429`
  with `reason: rate_limited`.
- A successful create mints a tenant-bound API key with scopes `[bootstrap]`,
  returned once in the 201 response. Bootstrap keys can call ONLY the
  bootstrap capabilities above; write scopes activate only after human
  verification (the middleware treats `bootstrap` on a verified tenant as
  `[read, write]`).

## Error model

Every error body is the `ErrorResponse` schema:

| Field | Meaning |
|---|---|
| `error` | Human-oriented category, e.g. `Forbidden`. |
| `reason` | Machine-readable failure code. Every 4xx carries it, exactly as the middleware returns it: `tenant_unverified`, `insufficient_scope`, `tenant_key_cannot_create`, `rate_limited`, `idempotency_conflict`, `idempotency_in_progress`. |
| `message` | Human-readable explanation with the next step. |
| `traceId` | Correlation id for support. |

When the verification gate fires (any non-bootstrap call on an unverified
tenant) the response is `403` with `reason: tenant_unverified` and a message
directing the agent to request the verification challenge and hand the emailed
link to a human.
