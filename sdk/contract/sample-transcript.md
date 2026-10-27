# Sample onboarding transcript (frozen contract, WS1)

A literal request/response transcript of one full agentic onboarding against
the canonical host. Every JSON body below validates against the schemas in
`sdk/contract/openapi.yaml`; the conformance suite
(`scripts/contract/__tests__/conformance.test.ts`) enforces this mechanically
via the fixtures in `sdk/contract/fixtures/`.

Placeholders: `dlg_bootstr1_sk_...` is the show-once bootstrap key;
UUIDs are stable example values.

## 1. Create the company (bootstrap-create path, idempotent)

Request:

```http
POST /api/v1/companies HTTP/1.1
Host: portal.delegancebrokerage.com
Content-Type: application/json
Idempotency-Key: agent-run-42-create-acme

{
  "name": "Acme Manufacturing LLC",
  "industry": "Manufacturing",
  "companySize": "11-25",
  "contactEmail": "ops@acme.com",
  "externalId": "acme-crm-8841"
}
```

Response `201` (fixture `createCompany.201.json`):

```json
{
  "success": true,
  "traceId": "5a1e18aa-9a45-4c1a-9a3e-0a51a1b2c3d4",
  "isExisting": false,
  "company": {
    "id": "c0ffee00-0000-4000-8000-000000000001",
    "name": "Acme Manufacturing LLC"
  },
  "onboarding": {
    "state": "created"
  },
  "bootstrapKey": "dlg_bootstr1_sk_abcdefghijklmnopqrstuvwxyz012345"
}
```

The `bootstrapKey` is shown exactly once. A replay of the same
`Idempotency-Key` with the same body returns the same response with
`"bootstrapKey": null` and `"bootstrapKeyReplay": "redacted"`.

An attempt to call this endpoint WITH a tenant API key returns `403`
(fixture `createCompany.403.json`):

```json
{
  "error": "Forbidden",
  "reason": "tenant_key_cannot_create",
  "message": "A tenant API key may not create companies. Use the bootstrap-create path (unauthenticated or a delegated credential).",
  "traceId": "0b2f28bb-1b56-4d2b-8b4f-1b62b2c3d4e5"
}
```

An unauthenticated create over the abuse caps returns `429`
(fixture `createCompany.429.json`):

```json
{
  "error": "Too Many Requests",
  "reason": "rate_limited",
  "message": "Bootstrap-create daily cap exceeded. Retry tomorrow or contact support.",
  "traceId": "1c3a39cc-2c67-4e3c-9c5a-2c73c3d4e5f6"
}
```

## 2. Poll state: created

```http
GET /api/v1/onboarding/state HTTP/1.1
Authorization: Bearer dlg_bootstr1_sk_abcdefghijklmnopqrstuvwxyz012345
```

Response `200`:

```json
{
  "success": true,
  "traceId": "2d4b4add-3d78-4f4d-8d6b-3d84d4e5f6a7",
  "data": {
    "state": "created",
    "verified": false,
    "capabilities": ["create_company", "poll_onboarding", "request_verification"],
    "verification": { "challengeIssued": false, "sentTo": null },
    "documents": { "total": 0, "processing": 0, "processed": 0, "failed": 0 }
  }
}
```

## 3. Request the human verification challenge

```http
POST /api/v1/onboarding/verification HTTP/1.1
Authorization: Bearer dlg_bootstr1_sk_abcdefghijklmnopqrstuvwxyz012345
```

Response `200` (fixture `requestVerification.200.json`):

```json
{
  "success": true,
  "traceId": "3e5c5bee-4e89-4a5e-9e7c-4e95e5f6a7b8",
  "data": {
    "state": "awaiting_verification",
    "method": "email_link",
    "sentTo": "o***@acme.com"
  }
}
```

## 4. Poll state: awaiting_verification

```http
GET /api/v1/onboarding/state HTTP/1.1
Authorization: Bearer dlg_bootstr1_sk_abcdefghijklmnopqrstuvwxyz012345
```

Response `200` (fixture `getOnboardingState.200.json`):

```json
{
  "success": true,
  "traceId": "4f6d6cff-5f9a-4b6f-8f8d-5fa6f6a7b8c9",
  "data": {
    "state": "awaiting_verification",
    "verified": false,
    "capabilities": ["create_company", "poll_onboarding", "request_verification"],
    "verification": { "challengeIssued": true, "sentTo": "o***@acme.com" },
    "documents": { "total": 0, "processing": 0, "processed": 0, "failed": 0 }
  }
}
```

## 5. Attempted document upload BEFORE verification: blocked

```http
POST /api/v1/documents HTTP/1.1
Authorization: Bearer dlg_bootstr1_sk_abcdefghijklmnopqrstuvwxyz012345
Content-Type: application/json

{ "file": "<base64>", "fileName": "loss-runs-2025.pdf" }
```

Response `403` (fixture `uploadDocument.403.json`):

```json
{
  "error": "Forbidden",
  "reason": "tenant_unverified",
  "message": "This tenant has not completed human verification. Call POST /api/v1/onboarding/verification and have a human open the emailed link.",
  "traceId": "5a7e7d00-6a0b-4c7a-9a9e-6ab7a7b8c9d0"
}
```

## 6. Human clicks the emailed link (out of band)

The email sent in step 3 contains a single-use signed link to
`GET /api/v1/onboarding/verification/confirm?token=...`. The page never
mutates on GET; the human presses Confirm, which POSTs the token back and
atomically flips the tenant to `verified`.

## 7. Poll state: documents_pending

Response `200`:

```json
{
  "success": true,
  "traceId": "6b8f8e11-7b1c-4d8b-8b0f-7bc8b8c9d0e1",
  "data": {
    "state": "documents_pending",
    "verified": true,
    "capabilities": [
      "create_company",
      "poll_onboarding",
      "request_verification",
      "upload_document",
      "request_quote",
      "generate_coi"
    ],
    "verification": { "challengeIssued": true, "sentTo": "o***@acme.com" },
    "documents": { "total": 0, "processing": 0, "processed": 0, "failed": 0 }
  }
}
```

## 8. Upload a document (now allowed)

```http
POST /api/v1/documents HTTP/1.1
Authorization: Bearer dlg_bootstr1_sk_abcdefghijklmnopqrstuvwxyz012345
Content-Type: application/json

{ "file": "<base64>", "fileName": "loss-runs-2025.pdf" }
```

Response `201` (fixture `uploadDocument.201.json`):

```json
{
  "success": true,
  "document": {
    "id": "d0c00000-0000-4000-8000-000000000001",
    "fileName": "loss-runs-2025.pdf",
    "documentType": "loss_runs",
    "status": "pending",
    "fileSize": "482113",
    "createdAt": "2026-07-02T15:04:05.000Z"
  },
  "message": "Document uploaded successfully. Processing will begin shortly.",
  "traceId": "7c9a9f22-8c2d-4e9c-9c1a-8cd9c9d0e1f2"
}
```

## 9. Poll state: processing

Response `200`:

```json
{
  "success": true,
  "traceId": "8daab033-9d3e-4fad-8d2b-9deadad0e1f3",
  "data": {
    "state": "processing",
    "verified": true,
    "capabilities": [
      "create_company",
      "poll_onboarding",
      "request_verification",
      "upload_document",
      "request_quote",
      "generate_coi"
    ],
    "verification": { "challengeIssued": true, "sentTo": "o***@acme.com" },
    "documents": { "total": 1, "processing": 1, "processed": 0, "failed": 0 }
  }
}
```

## 10. Poll state: ready

Response `200`:

```json
{
  "success": true,
  "traceId": "9ebbc144-0e4f-4abe-9e3c-0efbebe1f2a4",
  "data": {
    "state": "ready",
    "verified": true,
    "capabilities": [
      "create_company",
      "poll_onboarding",
      "request_verification",
      "upload_document",
      "request_quote",
      "generate_coi"
    ],
    "verification": { "challengeIssued": true, "sentTo": "o***@acme.com" },
    "documents": { "total": 1, "processing": 0, "processed": 1, "failed": 0 }
  }
}
```

## Appendix: legacy checklist (kept for back-compat)

```http
GET /api/v1/onboarding/status HTTP/1.1
Authorization: Bearer dlg_bootstr1_sk_abcdefghijklmnopqrstuvwxyz012345
```

Response `200` (fixture `getOnboardingChecklist.200.json`):

```json
{
  "success": true,
  "data": {
    "account": "complete",
    "company": "complete",
    "companyFull": "incomplete",
    "billing": "sandbox",
    "quoteReady": false,
    "sandbox": true,
    "nextStep": {
      "action": "complete_company",
      "fields": ["fein", "street_address", "city", "state", "zip_code"],
      "url": "/portal/settings/company"
    }
  },
  "traceId": "aafcd255-1f5a-4bcf-8f4d-1facfcf2a3b5"
}
```
