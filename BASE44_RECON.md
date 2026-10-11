# BASE44_RECON — writing a Base44 app directly as files (no builder AI)

Sources: docs.base44.com `.md` pages, fetched 2026-10-10. Quotes are verbatim. Anything the docs do not state is marked **UNCONFIRMED**.
Verified local code: `/Users/apple/Desktop/talktouser/base44/` (talktouser deployed with the CLI from a local project).

## 0. Panel → capability → how BillProof uses it → fallback

| Panel | Capability | How BillProof uses it | Fallback |
|---|---|---|---|
| Data | Entities (`base44/entities/*.jsonc`, JSON Schema + `rls`) | Company, Vendor, Invoice, AgentRun, Evidence, VerifyCall, Payment, AuditLog, EvalRun, EvalCase. Every row has `company_id`. RLS checks `{{user.data.company_id}}`. | `query_entities`/`create_entities` MCP tools; `asServiceRole` in functions |
| Data | Built-in User entity + custom fields (`User.jsonc`) | Add `company_id` and `app_role` (`owner`/`bookkeeper`/`viewer`). The built-in `role` field only holds `admin`/`user`. | Keep the role checks inside backend functions |
| Code → Functions | Deno functions `base44/functions/<name>/entry.ts` | `runCrew`, `extractInvoice`, `verifyVendor`, `scoreRisk`, `approvePayment`, `runEval`, `reverifyAll` | Split long runs into self-invoking batches (5 min limit) |
| Code → Functions | Public HTTP endpoint `https://<app-domain>/functions/<name>` | `vapiWebhook` receives Vapi call events with no user. It checks a shared secret and writes VerifyCall through `asServiceRole`. | Return 200 fast and use `waitUntil()` for the heavy work |
| Integrations | `Core.InvokeLLM` / `ExtractDataFromUploadedFile` / `UploadFile` / `SendEmail` | Parse the invoice PDF, run the crew reasoning (JSON schema output), send approval and alert emails | Vendor APIs called through `fetch` + secrets |
| Agents | `base44/agents/*.jsonc` + `base44.agents.*` SDK | `paycrew_analyst` (chat over Invoice/Vendor/AgentRun) and `call_script` (writes the Vapi call script) | `InvokeLLM` called from a function |
| Workflows | Workflows (new apps) or `function.jsonc` automations (older apps) | Invoice create → `runCrew`; nightly → `reverifyAll`; emails | Frontend calls `functions.invoke('runCrew')` right after `Invoice.create` |
| Secrets | `secrets.get()` from `base44:runtime` | `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET`, other vendor keys | — |
| Realtime | `base44.entities.X.subscribe(cb)` | Live AgentRun / Evidence / VerifyCall feed in the UI | Poll `filter()` |
| Settings | Visibility `public`/`private`/`workspace` | `private` and invite-only | — |

## 1. Project structure (`developers/backend/overview/project-structure`)

```
base44/
  .app.jsonc            // { "id": "your-app-id" }  (do not commit)
  config.jsonc          // { "name": "...", "visibility": "private", "entitiesDir": "./entities", ... }
  entities/<Entity>.jsonc
  functions/<name>/entry.ts        (+ optional function.jsonc, + any other .ts files)
  shared/*.ts                      // "place it in a `shared` directory inside your `base44/` folder"
  agents/<agent_name>.jsonc
  agent-skills/<skill>.md
  actors/<Name>/entry.ts
  connectors/<type>.jsonc
  auth/config.jsonc
```
- config keys: `name` (required), `description`, `visibility`, `entitiesDir`, `functionsDir`, `agentsDir`, `agentSkillsDir`, `actorsDir`, `connectorsDir`, `authDir`, `site.outputDirectory|buildCommand|installCommand|serveCommand`.
- Function name = "the directory path relative to the functions root" (`functions/email/send/entry.ts` → `email/send`).
- "Every `.js`, `.ts`, `.json`, and `.jsonc` file in the function directory is deployed with the function." Relative imports "can reach `base44/shared/` but can't escape `base44/`."
- Workflows have no file format in the CLI project structure. The editor docs say a workflow "appears in 2 places: your app's file tree and the Workflows dashboard". The path and format of that file are **UNCONFIRMED**. The API returns `file_key` ("Name of the workflow's file in the app's code").
- Sandbox naming conventions (base44-sandbox skill): entity file `{kebab-case}.jsonc`, entity `name` PascalCase `/^[a-zA-Z0-9]+$/`, fields snake_case. Function dirs are kebab-case. Agent file `{agent_name}.jsonc`, name `/^[a-z0-9_]+$/`. The CLI docs also accept `Task.json` and camelCase function dirs (talktouser uses `crawlLender/`).

## 2. Entity schema (`entities/entity-schemas`, `entities/security`, skill `entities-create`, `rls-examples`)

Top level: `name`, `type: "object"` (required), `title`, `description`, `properties` (required), `required: [...]`, `rls: {...}`.
- Types: `string`, `integer`, `number`, `boolean`, `array`, `object` (skill also lists `binary`).
- string options: `minLength`, `maxLength`, `pattern`, `format` (`date`, `date-time`, `time`, `email`, `uri`, `hostname`, `ipv4`, `ipv6`, `uuid`; skill adds `file`, `regex`, `richtext`), `enum`, `default`. Skill also lists `enumNames` and `description`.
- integer/number: `minimum`, `maximum`, `default`. array: `items`, `default`. object: `properties`, `required`.
- Built-in fields (do not define them): `id`, `created_date`, `updated_date`, `created_by` (email), `created_by_id`. Internal fields: `is_deleted`, `deleted_date`, `is_sample`, `entity_name`, `app_id`, `environment`.
- No unique constraints. Use `upsert(records, {key})` or check-then-create.
- Relations: there is no foreign-key type. "use ID reference fields" (`"board_id": {"type":"string"}`). The skill lists `$ref` as "Reference to another schema definition", but its semantics are **UNCONFIRMED**, so don't use it.
- "If no RLS is defined, all records are accessible to all users."

**RLS syntax.** Row-level permissions are `create`/`read`/`update`/`delete`. Field-level permissions (an `rls` key on a property) are `read`/`write`. Each value is `true`, `false`, or a condition:
- Record vs user: `{"created_by": "{{user.email}}"}`, `{"data.company_id": "{{user.data.company_id}}"}`, `{"data.status": "approved"}`. Templates: `{{user.email}}`, `{{user.id}}`, `{{user.role}}`, `{{user.data.*}}`.
- User check: `{"user_condition": {"role": "admin"}}`, `{"user_condition": {"data.level": "senior"}}`. **Equality only.**
- Operators: `$or`, `$and`, `$nor`. `$in`, `$nin`, `$ne`, `$all` work on `data.*` fields only.
- Denied list/filter returns empty. Denied `get()` returns 404. Denied create/update throws 403. `asServiceRole` "bypasses both RLS and FLS entirely".

BillProof example `base44/entities/invoice.jsonc`:
```jsonc
{
  "name": "Invoice", "type": "object", "title": "Invoice",
  "properties": {
    "company_id": { "type": "string" },
    "vendor_id":  { "type": "string", "description": "Vendor.id" },
    "invoice_number": { "type": "string" },
    "amount": { "type": "number", "minimum": 0 },
    "currency": { "type": "string", "default": "USD" },
    "due_date": { "type": "string", "format": "date" },
    "file_url": { "type": "string" },
    "status": { "type": "string", "enum": ["received","analyzing","needs_review","approved","rejected","paid"], "default": "received" },
    "risk_score": { "type": "number", "minimum": 0, "maximum": 100 },
    "line_items": { "type": "array", "items": { "type": "object",
      "properties": { "description": {"type":"string"}, "qty": {"type":"number"}, "unit_price": {"type":"number"} },
      "required": ["description"] } },
    "bank_details": { "type": "object", "properties": { "iban": {"type":"string"}, "routing": {"type":"string"} },
      "rls": { "read": { "user_condition": { "data.app_role": "owner" } }, "write": false } }
  },
  "required": ["company_id", "amount"],
  "rls": {
    "create": { "$or": [ { "user_condition": { "data.app_role": "owner" } }, { "user_condition": { "data.app_role": "bookkeeper" } } ] },
    "read":   { "data.company_id": "{{user.data.company_id}}" },
    "update": { "$and": [ { "data.company_id": "{{user.data.company_id}}" },
                          { "$or": [ { "user_condition": { "data.app_role": "owner" } }, { "user_condition": { "data.app_role": "bookkeeper" } } ] } ] },
    "delete": { "user_condition": { "data.app_role": "owner" } }
  }
}
```
Notes on this example:
- `create` cannot pin `company_id` to the user, because the docs show no template check on incoming data for create. **UNCONFIRMED**. Have functions set `company_id` server-side.
- Nesting `$and`/`$or` around `user_condition` follows the documented `$or` example; the deeper nesting shown here is **UNCONFIRMED**.
- For AuditLog/AgentRun/Evidence, set `create/update/delete: false` and write only through `asServiceRole`.

Verified local example (`talktouser/base44/entities/Business.json`): plain `.json`, `enum` + `default`, a free-form `object`, no `rls`.

## 3. Backend functions (`backend-functions/overview`, `createClientFromRequest`)

```ts
// base44/functions/runCrew/entry.ts
import { createClientFromRequest } from "npm:@base44/sdk";
import { secrets, waitUntil } from "base44:runtime";
export default async function (req: Request): Promise<Response> {   // docs also show Deno.serve(async (req) => ...)
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();               // null/throws when there is no user context (HTTP/automation)
    const body = await req.json().catch(() => ({}));
    const invoiceId = body.invoice_id ?? body.data?.id; // entity-trigger payload shape: UNCONFIRMED (log req body first)
    const db = base44.asServiceRole.entities;
    const inv = await db.Invoice.get(invoiceId);
    const runs = await db.AgentRun.filter({ invoice_id: invoiceId }, "-created_date", 50);   // legacy array form
    const page = await db.Vendor.list({ sort: "-created_date", limit: 100 });               // cursor form -> {items,next_cursor,has_more}
    const run = await db.AgentRun.create({ invoice_id: invoiceId, company_id: inv.company_id, status: "running" });
    await db.Evidence.bulkCreate([{ agent_run_id: run.id, kind: "llm", text: "..." }]);
    await db.Invoice.update(invoiceId, { status: "analyzing" });
    await base44.asServiceRole.functions.invoke("verifyVendor", { vendor_id: inv.vendor_id }); // fn→fn (verified in talktouser recrawlAll)
    const key = secrets.get("VAPI_API_KEY");          // inside the handler only
    return Response.json({ ok: true, run_id: run.id });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
}
```
- Entity handler signatures (SDK `entities`):
  - `get(id)`, `create(data)`, `bulkCreate(data[])`, `update(id, data)` (partial merge).
  - `delete(id)` returns `{success}`.
  - `upsert(records, {key})`, up to 500 per call, returns `{created, updated, records}`.
  - `updateMany`, `bulkUpdate`, `deleteMany`, `count`, `aggregate`.
- `list`/`filter` have two forms:
  - Cursor form: `list({sort, limit, cursor, fields})` / `filter(query, {sort, limit, cursor, fields})`. Returns `{items, next_cursor, has_more}`. Default limit 100, max 5000.
  - Legacy form: `list(sort?, limit?, skip?, fields?)` / `filter(query, sort?, limit?, skip?, fields?)`. Returns an array, default limit 5000.
  - talktouser defensively does `Array.isArray(res) ? res : res.items`.
- Sort is `'-field'` (descending) or `'field'`/`'+field'` (ascending). Filter operators: `$gte`, `$in`, `$regex`, `$all`, `$size`, root `$or`/`$and`/`$nor`, `null`, and the array shorthand.
- Limits: "maximum execution time of 5 minutes". `waitUntil(promise)` keeps work going after the response, but it is "best-effort".
- `base44.cleanup()` disconnects WebSockets.
- **HTTP endpoint (webhooks):** "Each deployed function gets an HTTP endpoint at: `https://<your-app-domain>/functions/<function-name>`" (example `https://your-app.base44.app/functions/sendWelcomeEmail`). "When calling functions via direct HTTP (like cURL or webhooks), there's no authenticated user context. Use `asServiceRole` for all operations."
  - There is no documented auth flag. A private app's visibility does not appear to block this endpoint, but that is **UNCONFIRMED**, so test with curl.
  - Verify Vapi with a shared secret header compared against `secrets.get("VAPI_WEBHOOK_SECRET")`.
- **function.jsonc**: `name` (optional), `entry`, `automations` (array, see §7).
- **Secrets**: `import { secrets } from "base44:runtime"; secrets.get("KEY")` returns a string or `undefined`. "Call `secrets.get()` inside your handler, not at the top level". Verified in `talktouser/base44/shared/brightdata.ts`.
  - `Deno.env.get("KEY")` for app secrets is **not documented** in the current docs (only `Deno.env.get("DENO_ENV")` appears), so treat it as **UNCONFIRMED** and use `secrets.get`.

## 4. Core integrations (`sdk/docs/type-aliases/integrations`)

Call as `base44.integrations.Core.X(params)` in the frontend, or `base44.asServiceRole.integrations.Core.X(params)` in functions.

| Method | Params (exact) | Returns |
|---|---|---|
| `InvokeLLM` | `prompt` (req), `model?`, `add_context_from_internet?`, `response_json_schema?`, `file_urls?: string[]` ("Do not use this together with `add_context_from_internet`") | string, or object when a schema is given |
| `UploadFile` | `{ file: File }` | `{ file_url }` |
| `UploadPrivateFile` / `CreateFileSignedUrl` | `{file}` → `{file_uri}`; `{file_uri, expires_in (60–3600)}` → `{signed_url}` | |
| `ExtractDataFromUploadedFile` | `file_url` (req), `json_schema` (req) | object |
| `SendEmail` | `to`, `subject`, `body` (plain text), `from_name?` | any |
| `GenerateImage` | `prompt`, `existing_image_urls?` | `{ url }` |

- `model` values: `"gpt_5_mini"`, `"gemini_3_flash"`, `"gpt_5_4"`, `"gpt_5_6_sol"`, `"gpt_5_6_luna"`, `"gemini_3_1_pro"`, `"claude_sonnet_4_6"`, `"claude_opus_4_6"`, `"claude_opus_4_7"`, `"claude_opus_4_8"`, `"claude-sonnet-5"`. talktouser uses `"claude_sonnet_4_6"`, which is verified.
- SendEmail: "Send emails to registered users of your app". Sending to vendors who are not app users is **UNCONFIRMED** or may be blocked, so use Resend/`fetch` for vendor email.

```ts
const { file_url } = await base44.integrations.Core.UploadFile({ file });
const inv = await base44.integrations.Core.ExtractDataFromUploadedFile({ file_url,
  json_schema: { type: "object", properties: { invoice_number: {type:"string"}, total_amount: {type:"number"}, vendor_name: {type:"string"} } } });
```

## 5. Frontend SDK

```js
import { base44 } from "@/api/base44Client";
const rows  = await base44.entities.Invoice.list("-created_date", 50);                 // array
const open  = await base44.entities.Invoice.filter({ status: "needs_review" }, "-created_date", 20);
const page  = await base44.entities.Invoice.filter({ status: "open" }, { limit: 50 }); // {items,next_cursor,has_more}
const inv   = await base44.entities.Invoice.create({ company_id, amount: 120 });
await base44.entities.Invoice.update(inv.id, { status: "approved" });
await base44.entities.Invoice.delete(inv.id);                                          // {success}
// REALTIME — exact: subscribe(callback): () => void
const unsub = base44.entities.AgentRun.subscribe((event) => {
  // event.type: 'create'|'update'|'delete'; event.data: record after change; event.id; event.timestamp (ISO)
});
unsub();
// Functions — invoke(functionName, data?) returns the RAW axios response
const res = await base44.functions.invoke("runCrew", { invoice_id: inv.id });
const out = res.data;            // your Response.json body; throws on non-2xx (err.response.data)
// base44.functions.fetch(path, init) -> native Response (streaming / PUT etc.)
const me = await base44.auth.me();   // {id,email,full_name,role,...custom fields e.g. me.company_id}
await base44.auth.updateMe({ app_role: "bookkeeper" });
base44.auth.logout("/");             // logout(redirectUrl?): void, browser only
await base44.auth.inviteUser("a@b.com", "user");
```
- subscribe "Subscribes to realtime updates for all records of this entity type". It has no filter parameter, so filter by `company_id` client-side. Whether RLS applies to realtime events is **UNCONFIRMED**.

## 6. Agents (`backend/resources/agents/overview`, `sdk/docs/interfaces/agents`)

`base44/agents/paycrew_analyst.jsonc`:
```jsonc
{
  "name": "paycrew_analyst",                 // lowercase+underscores, matches filename
  "description": "Answers AP questions about invoices, vendors and crew runs",
  "instructions": "You are BillProof Analyst... cite Evidence ids...",
  "model": "automatic",                      // dev docs: required; sandbox skill lists only name/description/instructions as required
  "tool_configs": [
    { "entity_name": "Invoice",  "allowed_operations": ["read"] },
    { "entity_name": "Evidence", "allowed_operations": ["read"] },
    { "function_name": "runCrew", "description": "Re-run the AP crew on one invoice (invoice_id)" }
  ],
  "whatsapp_greeting": "Hi, I'm BillProof.",   // optional
  "selected_skill_names": []                 // optional, <=10, names of base44/agent-skills/*.md
}
```
- `allowed_operations` ⊆ `"read"`,`"create"`,`"update"`,`"delete"`. The docs example uses a lowercase entity name (`"tickets"`); use the exact entity `name`.
- `call_script` follows the same format with no tools, or `{function_name:"vapiStartCall"}`.

SDK:
```js
const conv = await base44.agents.createConversation({ agent_name: "paycrew_analyst", metadata: { invoice_id } });
const un = base44.agents.subscribeToConversation(conv.id, (c) => { const last = c.messages.at(-1); /* id, role, content, tool_calls... */ });
await base44.agents.addMessage(conv, { role: "user", content: "Why was INV-12 flagged?" });  // pass the conversation OBJECT
// also: getConversations(), getConversation(id), listConversations(filterParams), getWhatsAppConnectURL(agentName), getTelegramConnectURL(agentName)
```
Tool-call data in the subscription is truncated (`arguments_string` 500 chars, `results` 50). Call `getConversation()` to get the full data.

## 7. Automations vs workflows

**Version check first:** "Workflows replaces automations. Apps created from July 6, 2026 use workflows ... Your app has one or the other, not both." "If your app has workflows enabled, deploying a `function.jsonc` that contains automations fails with HTTP 409." In sandbox mode `function.jsonc` "is ignored". A new BillProof app therefore needs **Workflows**.

**A. Legacy `function.jsonc` automations** (older apps or a local CLI project; verified in `talktouser/base44/functions/recrawlAll/function.jsonc`):
```jsonc
{ "name": "reverifyAll", "entry": "entry.ts", "automations": [
  { "type": "scheduled", "name": "nightly_reverify", "is_active": true,
    "schedule_mode": "recurring", "schedule_type": "cron", "cron_expression": "0 10 * * *", "function_args": { "mode": "full" } },
  { "type": "entity", "name": "on_invoice_create", "entity_name": "Invoice", "event_types": ["create"] } ] }
```
- Common fields: `type` (`scheduled`/`entity`/`connector`), `name`, `description`, `function_args`, `is_active`.
- Scheduled fields: `schedule_mode` (`recurring`/`one-time`), `schedule_type` (`cron`/`simple`), `cron_expression` (5-field UTC), `ends_type`/`ends_on_date`/`ends_after_count`.
- Simple-schedule fields: `repeat_unit` (`minutes`…`months`), `repeat_interval`, `start_time` "HH:MM", `repeat_on_days`, `repeat_on_day_of_month`, `one_time_date`.
- Function args arrive as `body.args`.
- Entity automations "only fire for single-record create, update, and delete". `bulkCreate`/`updateMany` do NOT fire them.
- The entity event body shape is **UNCONFIRMED**.

**B. Workflows (Apps API, beta; Builder plan+; main branch only)**:
- Endpoints: `POST https://app.base44.com/api/apps/{app_id}/workflows` with `Authorization: Bearer <PAT>`, and `POST .../workflows/validate-definition`.
- Over MCP, use `list_api_catalog` → `describe_api` → `execute_api`.
- Body: `name` (unique), `description`, `definition` (CNCF Serverless Workflow v1.0), `trigger`, `change_summary`.
```json
{ "name": "Nightly re-verify",
  "definition": { "document": { "dsl": "1.0.0", "name": "nightly", "version": "1.0.0" }, "do": [ ... ] },
  "trigger": { "config": { "trigger_type": "scheduled", "cron_expression": "0 9 * * *", "timezone": "UTC" } } }
```
- `trigger_type` ∈ `scheduled`, `entity`, `connector`, `in_app_agent`, `app_user_auth`, `app_publish`, `app_payment`, `webhook`, `goal_file`.
- Optional top-level `condition` takes a jq expression over the payload.
- Task types are `call`, `switch`, `wait`. Activities are app-specific; examples include `invoke_backend_function` and `compute_seconds_until`.
- **UNCONFIRMED**:
  - the `entity` trigger's config keys (likely entity name and event; not documented);
  - the `call: invoke_backend_function` `with:` argument names;
  - recurring runs at most once every 5 minutes.
- **Action**: call validate-definition, which returns `available_activities` and errors. Create one workflow in the dashboard, then `GET .../workflows/{id}` to copy the exact definition and trigger.
- **Fallback that needs no workflow**: the frontend calls `functions.invoke("runCrew", {invoice_id})` right after `Invoice.create`. For nightly runs, an external cron can POST to `https://<app-domain>/functions/reverifyAll` with a shared secret.

## 8. Secrets

- CLI: `base44 secrets set KEY=VALUE [KEY2=V2]` or `base44 secrets set --env-file .env`. Also `secrets list` and `secrets delete`.
- API: `POST /api/apps/{app_id}/secrets` with a body of `{ "KEY": "value", ... }`. "Setting a secret redeploys the app's backend functions". Values are write-only.
- Read in functions with `secrets.get("KEY")` from `base44:runtime`, as in §3.

## 9. Deploy and the cloud sandbox

- **Local project CLI:**
  - `base44 deploy` (`-y`, `--build`, `--no-build`) deploys entities, connectors, agents, agent skills, functions and actors. Remote resources that are missing locally get removed.
  - `base44 entities push` and `base44 agents push`: local is the source of truth; anything missing locally is deleted remotely.
  - `base44 functions deploy [names...]` (`--force` prunes).
  - `base44 site deploy` (needs `site.outputDirectory`).
  - `base44 visibility <public|private|workspace>`.
- **Cloud sandbox (BillProof's situation, edited via MCP):**
  - "Structured resources sync the same way. ... In the sandbox, creating `base44/functions/send-email/entry.ts` is all it takes to add that function."
  - "writing a resource file into the sandbox is what ships it (backend functions, realtime actors, entities, and agents all auto-sync from the file you write)".
  - "Edits to entities, agents, workflows, backend functions, and page routing are synced into Base44 automatically after the commit."
  - `write_file`/`edit_file` commit immediately. `run_command` file changes commit after about 5s.
  - **Do NOT run** `deploy`/`functions deploy`/`entities push`/`agents push` against a sandbox app.
- **Checkpoints:** auto-commit is "not a checkpoint". A builder Restore or Revert "discards everything written after" the last checkpoint, so call `create_checkpoint` after each unit of work.
- **Publish:** "Editing through the sandbox isn't the same as publishing." The live site needs a publish: `POST /api/apps/{app_id}/deploy` via MCP `execute_api`, and `GET /api/apps/platform/{app_id}/published-url` returns the live URL.
- **Sandbox rules:**
  - Using the sandbox blocks the builder chat (about 10 min idle timeout).
  - Rate limits: 60 change requests/min and 30 run commands/min.
  - Requires the Builder plan; writes need `sandbox:write`.
  - Paths `.git` and `.agents` are protected.
- Whether sandbox-synced functions get live HTTP endpoints before a publish is **UNCONFIRMED**. Assume they appear once the commit syncs, and test the URL.

## 10. Users, roles, visibility

- Built-in User fields: `full_name`, `email`, `role` ("Either `admin` or `user`"), plus the generic built-ins.
- Custom fields go in `base44/entities/User.jsonc`, which contains ONLY the extra properties (redefining a built-in is a validation error):
```jsonc
{ "name": "User", "type": "object", "properties": {
  "company_id": { "type": "string" },
  "app_role": { "type": "string", "enum": ["owner", "bookkeeper", "viewer"], "default": "viewer" } } }
```
- In RLS, use `{{user.data.company_id}}` and `{"user_condition": {"data.app_role": "owner"}}`.
- In code, `me.company_id` is available, and a user can set their own fields with `auth.updateMe({...})`. Admin-side writes go through `asServiceRole.entities.User.update(id, {...})`; that this works on User is **UNCONFIRMED**, though `User.list()` with service role is documented.
- Extra app "roles" beyond admin/user are only described as an AI-chat feature ("Create a role called Staff Manager..."), and their storage format is **UNCONFIRMED**. Hence `app_role` as a custom field.
- Visibility: `public` (no login), `workspace` (workspace members), `private` (invited only). Set it in `config.jsonc` `"visibility"` or with `base44 visibility`. `inviteUser(email, role)` accepts `'admin'`/`'user'`.
