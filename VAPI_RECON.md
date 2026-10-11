# Vapi recon — PayCrew verify calls

Source: docs.vapi.ai (api-reference/calls/create, server-url/events, server-url/server-authentication, assistants/call-analysis), read 2026-10-10. Account checked with the private key (never logged).

## Account
- Phone number: `VAPI_PHONE_NUMBER_ID` = f7ce3c0f-… (Twilio, +1 866 812 1619). ✅
- Existing assistants belong to other projects → we create a dedicated **"PayCrew Verify"** assistant via `POST https://api.vapi.ai/assistant` and store its id as `VAPI_ASSISTANT_ID`.
- `DEMO_CALLEE_NUMBER` = teammate (+1 408 …). Demo dials it; UI shows the vendor's verified official number with sources.

## Outbound call
`POST https://api.vapi.ai/call`, `Authorization: Bearer <private key>`
```json
{
  "assistantId": "<VAPI_ASSISTANT_ID>",
  "phoneNumberId": "<VAPI_PHONE_NUMBER_ID>",
  "customer": { "number": "+1XXXXXXXXXX" },           // E.164 required by default
  "assistantOverrides": {
    "variableValues": { "company_name": "...", "vendor_name": "...", "invoice_number": "...", "amount": "...", "bank_last4_on_invoice": "..." },
    "server": { "url": "<vapiWebhook function URL>", "headers": { "x-paycrew-secret": "<shared secret>" } }
  }
}
```
Response 201 → `id`, `status` ∈ scheduled | queued | ringing | in-progress | forwarding | ended.
Template variables use Liquid `{{ vendor_name }}` in the assistant's prompt/firstMessage.

## Webhooks (server URL)
POST body `{"message": {...}}`:
- `status-update` → `message.status` (same enum as above), `message.call.id`
- `transcript` → `role` (assistant|user), `transcriptType` (partial|final), `transcript`
- `end-of-call-report` → `endedReason`, `artifact.transcript` (string), `artifact.messages[]`, `artifact.recording` (URLs), `analysis.summary`, `analysis.structuredData` (from `analysisPlan.structuredDataSchema`)
- Auth: overrides-supplied server URLs get **no org credential** → we pass our own header in `server.headers` and the webhook checks it.

## Analysis plan (on the assistant)
`analysisPlan.summaryPrompt`, `analysisPlan.structuredDataPrompt`, `analysisPlan.structuredDataSchema` →
schema `{outcome: confirmed|denied|unsure|no_answer, vendor_issued_invoice: bool|null, bank_details_confirmed: bool|null, disclosed_ai: bool, notes: string}`.

## Fallback (robustness)
- If webhooks don't arrive: poll `GET https://api.vapi.ai/call/{id}` every 3s (status, transcript, analysis on the call object).
- If telephony fails on stage: **simulation toggle** streams a pre-recorded transcript through the same UI.

## Assistant guardrails (system prompt)
Says it's an automated assistant calling on behalf of {{company_name}}; asks only (1) did you issue invoice {{invoice_number}} for {{amount}}, (2) do you bank with an account ending {{bank_last4_on_invoice}}; never reads full account numbers; never accepts new bank details by phone ("please send changes through your usual secure channel"); ends politely if asked; max ~2 minutes.
