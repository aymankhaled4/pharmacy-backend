# MedConnect — Task 5 Specification
## AI Module: Chat + Excel Import

> Read this entire file before writing any code.
> Build files in the exact order listed. After each file, run all test cases for that file before moving on.

---

## 1. Project Context

MedConnect is a pharmacy management platform for Egypt with three clients:
- **Mobile App** — patients searching for drugs and making reservations
- **Web App** — pharmacists managing inventory
- **Admin Dashboard** — admins approving pharmacies

Your job is to build the entire AI module:
- **Chat Feature**: Mobile users talk to an AI assistant that finds drugs and nearby pharmacies using OpenAI Function Calling.
- **Excel Import Feature**: Pharmacists upload inventory Excel files. The AI maps column headers and matches drug names to the existing catalog.

---

## 2. Tech Stack

```
Framework:     NestJS (TypeScript)
Database:      Supabase (PostgreSQL 15) — already built, do NOT modify schema
AI:            OpenAI API — gpt-4o for chat, gpt-4o-mini for column mapping and drug matching
File parsing:  SheetJS (xlsx package)
Queue:         BullMQ + Redis (for Excel files over 200 rows)
Auth:          Supabase JWT — already handled by existing guards
```

---

## 3. Environment Variables You Will Use

These are already registered in `src/config/`. Access them only via `ConfigService`, never via `process.env` directly.

```
OPENAI_API_KEY
OPENAI_MODEL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
REDIS_URL
```

---

## 4. Database Tables for Task 5

Do not alter any table. These already exist in Supabase.

### `drugs` — READ + occasional INSERT (unmatched drugs only)
```
id                uuid PK
brand_name        text
brand_name_ar     text
generic_name      text
active_ingredient text  (UPPERCASE, '+' separated for combinations)
category          text
strength          text
dosage_form       text
manufacturer      text
search_vector     tsvector (auto-generated, do not write to this)
created_at        timestamptz
```

### `inventory` — INSERT only
```
id               uuid PK
pharmacy_id      uuid FK → pharmacy_profiles
drug_id          uuid FK → drugs
batch_number     text
quantity         integer  CHECK >= 0
expiry_date      date
selling_price    numeric  CHECK > 0
discount_percent numeric  DEFAULT 0, CHECK 0-100
status           text     DEFAULT 'active'
created_at       timestamptz
```

### `search_logs` — INSERT + UPDATE
```
id                  uuid PK
user_id             uuid NULLABLE
query               text
resolved_ingredient text NULLABLE
result_found        boolean NULLABLE
latitude            numeric NULLABLE
longitude           numeric NULLABLE
searched_at         timestamptz DEFAULT now()
```

### `ai_suggestions` — INSERT only
```
id                uuid PK
search_id         uuid FK → search_logs
suggested_drug_id uuid FK → drugs
reason            text
confidence_score  numeric  (0.0 to 1.0)
created_at        timestamptz DEFAULT now()
```

---

## 5. Existing RPCs — Call These, Do Not Rewrite

### `search_drugs(p_query text)`
Fuzzy search using pg_trgm on brand_name, brand_name_ar, generic_name, active_ingredient.
Returns top 20 results ordered by relevance.
Call using `adminClient.rpc('search_drugs', { p_query: '...' })`.
Returns: `Array<{ id, brand_name, brand_name_ar, generic_name, active_ingredient, strength, dosage_form }>`

### `search_nearby_pharmacies(drug_id, lat, lng, radius_km)`
PostGIS distance query. Returns approved pharmacies with active inventory > 0, sorted by distance. Default radius: 10km.
Call using `adminClient.rpc('search_nearby_pharmacies', { drug_id, lat, lng, radius_km })`.
Returns: `Array<{ pharmacy_id, pharmacy_name, distance_km, address, inventory_id, quantity, selling_price, discount_percent }>`

---

## 6. Existing Infrastructure — Import and Use, Do Not Recreate

### `SupabaseService` at `src/database/supabase.service.ts`
- `adminClient` — bypasses RLS. Use this for ALL database operations in Task 5.
- `userClient(token)` — RLS-enforced. Do NOT use in Task 5.

### Guards and Decorators
- `SupabaseAuthGuard` — validates JWT
- `RolesGuard` — checks role
- `@Roles('user')` — for the chat endpoint
- `@Roles('pharmacy')` — for the Excel import endpoint
- `@CurrentUser()` — extracts `{ id: string, token: string, role: string }` from the request

### Global Behaviors (already configured, no action needed)
- All successful responses are automatically wrapped: `{ data: {...}, meta: { timestamp } }`
- All errors are automatically shaped: `{ error: { code, message, timestamp } }`
- Throw standard NestJS exceptions (`BadRequestException`, `NotFoundException`, etc.)

---

## 7. File Structure to Build

```
src/modules/ai/
├── ai.module.ts
├── openai.service.ts
├── chat/
│   ├── chat.module.ts
│   ├── chat.controller.ts
│   ├── chat.service.ts
│   ├── chat.tools.ts
│   ├── chat.executor.ts
│   ├── search-logs.service.ts
│   └── dto/
│       └── chat-message.dto.ts
└── excel-import/
    ├── excel-import.module.ts
    ├── excel-import.controller.ts
    ├── excel-import.service.ts
    ├── excel-parser.ts
    ├── column-mapper.service.ts
    ├── drug-matcher.service.ts
    ├── import-queue.processor.ts
    └── dto/
        └── import-result.dto.ts
```

---

## 8. Build Order and Specifications

---

### FILE 1 — `openai.service.ts`

**What it does:**
Injectable NestJS service that wraps the OpenAI client. Single instance used by all AI features in this module. Reads `OPENAI_API_KEY` from ConfigService. Exposes one method: `chat()` that accepts the full OpenAI chat completion params and returns the raw OpenAI response.

**Interface:**
```typescript
chat(params: OpenAI.Chat.ChatCompletionCreateParams): Promise<OpenAI.Chat.ChatCompletion>
```

**Test Cases:**
1. Service initializes successfully when `OPENAI_API_KEY` is present.
2. `chat()` returns a valid `ChatCompletion` object for a simple prompt.
3. OpenAI API errors propagate to the caller — do not catch or swallow them here.
4. Multiple calls reuse the same internal client instance.

---

### FILE 2 — `chat.tools.ts`

**What it does:**
Constants file — no class, no DI. Exports `CHAT_TOOLS` array with exactly 3 OpenAI tool definitions.

**The 3 tools:**

`search_drug(query: string)`
Called when user mentions a drug name or describes symptoms. Maps to `search_drugs()` RPC.

`find_nearby_pharmacies(drug_id: string, lat: number, lng: number, radius_km?: number)`
Called after a drug is found to locate nearby pharmacies. `radius_km` is optional, default 10. Maps to `search_nearby_pharmacies()` RPC.

`find_alternatives(active_ingredient: string)`
Called when a drug is unavailable. Searches drugs table by active ingredient. `active_ingredient` must be UPPERCASE.

**Test Cases:**
1. `CHAT_TOOLS` has exactly 3 items.
2. Each tool has `type: 'function'`.
3. `search_drug` — `query` is required.
4. `find_nearby_pharmacies` — `drug_id`, `lat`, `lng` are required. `radius_km` is optional.
5. `find_alternatives` — `active_ingredient` is required.
6. All parameter types are valid JSON Schema types.

---

### FILE 3 — `chat.executor.ts`

**What it does:**
Injectable service. Receives a single OpenAI tool call object, executes the corresponding Supabase operation, and returns the result formatted as an OpenAI tool message.

**Interface:**
```typescript
execute(
  toolCall: OpenAI.Chat.ChatCompletionMessageToolCall,
  userLocation: { lat?: number; lng?: number }
): Promise<OpenAI.Chat.ChatCompletionToolMessageParam>
```

**Behavior per tool:**
- `search_drug` → calls `search_drugs()` RPC with `p_query`
- `find_nearby_pharmacies` → calls `search_nearby_pharmacies()` RPC. Falls back to `userLocation` if lat/lng not in tool args. Uses `radius_km: 10` as default.
- `find_alternatives` → queries `drugs` table with ILIKE on `active_ingredient`, limit 10.

**Return shape:** always `{ role: 'tool', tool_call_id: <id>, content: JSON.stringify(result) }`

**Error handling:** ALL errors must be caught inside `execute()`. Never throw. Return `{ error: '<message>' }` serialized in `content` so the loop can continue.

**Test Cases:**
1. `search_drug` calls RPC with correct param and returns serialized array.
2. `find_nearby_pharmacies` defaults to `radius_km: 10` when not provided.
3. `find_nearby_pharmacies` uses `userLocation` when args don't include coordinates.
4. `find_alternatives` queries `drugs` table with ILIKE and limits to 10 results.
5. Supabase error is caught and returned as `{ error: message }` — does NOT throw.
6. Unknown tool name returns `{ error: 'Unknown tool: xyz' }` — does NOT throw.
7. Return always has `role: 'tool'` and `tool_call_id` matching the input.
8. `content` is always a JSON string, never a raw object.

---

### FILE 4 — `search-logs.service.ts`

**What it does:**
Injectable service. Handles all writes to `search_logs` and `ai_suggestions` tables.

**Interface:**
```typescript
create(params: {
  userId?: string;
  query: string;
  latitude?: number;
  longitude?: number;
}): Promise<string>  // returns the new search_log id

updateResolved(searchId: string, resolvedIngredient: string, resultFound: boolean): Promise<void>

createSuggestions(
  searchId: string,
  suggestions: Array<{ drugId: string; reason: string; confidenceScore: number }>
): Promise<void>
```

**Test Cases:**
1. `create()` inserts a row and returns a valid UUID.
2. `create()` with no `userId` inserts `null` (not undefined).
3. `create()` with no coordinates inserts `null` for both.
4. `updateResolved()` updates the correct row by `searchId`.
5. `createSuggestions()` with empty array returns without making a DB call.
6. `createSuggestions()` inserts all rows when array has items.
7. DB error in `create()` throws and propagates.

---

### FILE 5 — `chat-message.dto.ts`

**What it does:**
Validates the request body for `POST /ai/chat`.

**Fields:**
- `message: string` — required, non-empty
- `conversationHistory?: OpenAI.Chat.ChatCompletionMessageParam[]` — optional
- `latitude?: number` — optional
- `longitude?: number` — optional

**Test Cases:**
1. Body with `message` only passes validation.
2. Empty string `message` → 400.
3. Missing `message` → 400.
4. `conversationHistory` missing → valid (optional).
5. Non-number `latitude` → 400.

---

### FILE 6 — `chat.service.ts`

**What it does:**
Core orchestration service. Stateless — the client sends full conversation history with each request. Runs the OpenAI function-calling loop, logs to search_logs, returns the final reply and updated history.

**Interface:**
```typescript
processMessage(
  dto: ChatMessageDto,
  userId: string
): Promise<{ reply: string; updatedHistory: OpenAI.Chat.ChatCompletionMessageParam[] }>
```

**Function-calling loop behavior:**
1. Create a `search_log` entry via `SearchLogsService`.
2. Build messages array: system prompt + conversation history + current user message.
3. Call OpenAI with `CHAT_TOOLS`.
4. While `finish_reason === 'tool_calls'`: execute all tool calls via `ChatExecutor`, append results to messages, call OpenAI again.
5. When `finish_reason === 'stop'`: update search log if a drug was found or ingredient was resolved. Create ai_suggestions if applicable.
6. Return `reply` and `updatedHistory`. Strip the system prompt from history before returning.

**System prompt must include:**
- User GPS coordinates if provided, or a note that GPS is unavailable.
- Instruction to respond in the same language the user writes in (Arabic or English).
- Instruction to search nearby pharmacies automatically after finding a drug.
- Instruction to search alternatives when a drug is not found.

**Test Cases:**
1. Message with no tool calls: single OpenAI call, returns reply and history.
2. Message triggering one tool: loop runs twice, tool result included in history.
3. Message triggering chained tools (search_drug → find_nearby_pharmacies): loop runs three times.
4. `finish_reason = 'stop'` on first response: loop body never executes.
5. `conversationHistory` is included between system prompt and current user message.
6. System prompt contains GPS when coordinates provided.
7. System prompt notes unavailable GPS when no coordinates.
8. Returned `updatedHistory` does NOT contain the system prompt.
9. `SearchLogsService.create()` called once per `processMessage()` call.
10. `SearchLogsService.updateResolved()` called when `search_drug` tool was used and returned results.
11. Tool executor errors (returned as `{ error: ... }`) do not crash the loop.
12. `userId` is correctly passed to search log creation.

---

### FILE 7 — `chat.controller.ts`

**What it does:**
Single endpoint. Protected by `SupabaseAuthGuard` + `RolesGuard` with `@Roles('user')`.

**Endpoint:** `POST /ai/chat`
Accepts `ChatMessageDto` body. Extracts user from `@CurrentUser()`. Delegates entirely to `ChatService.processMessage()`.

**Test Cases:**
1. No Authorization header → 401.
2. Pharmacy JWT → 403.
3. Admin JWT → 403.
4. Valid user JWT + valid body → 200 with `{ reply, updatedHistory }`.
5. Missing `message` in body → 400.
6. Valid body without `conversationHistory` → 200.

---

### FILE 8 — `excel-parser.ts`

**What it does:**
Static utility class — no DI, not injectable. Two static methods.

**Interface:**
```typescript
class ExcelParser {
  static parse(buffer: Buffer): { headers: string[]; rows: Record<string, unknown>[] }
  static normalize(row: Record<string, unknown>, fieldMap: Record<string, string>): NormalizedRow
}

interface NormalizedRow {
  drug_name?: string;
  batch_number?: string;
  quantity?: number;
  expiry_date?: string;
  selling_price?: number;
  discount_percent?: number;
}
```

**`parse()` behavior:**
- Uses SheetJS to read `.xlsx` and `.xls` files.
- Reads only the first sheet.
- `cellDates: true` — date cells return formatted date strings, not raw numbers.
- Missing cells return `null`, not `undefined`.
- Empty file returns `{ headers: [], rows: [] }` without throwing.

**`normalize()` behavior:**
- Maps row values to standardized field names using `fieldMap`.
- Numeric fields (`quantity`, `selling_price`, `discount_percent`) are coerced to numbers.
- String fields are trimmed.
- Missing mapped values return `null`.

**Test Cases:**
1. Valid `.xlsx` returns correct headers and rows.
2. Valid `.xls` parses correctly.
3. Arabic column headers preserved without corruption.
4. Date cells return `YYYY-MM-DD` formatted string.
5. Empty cell in row returns `null`, not `undefined`.
6. Empty file returns `{ headers: [], rows: [] }`.
7. `normalize()` maps headers to correct fields using fieldMap.
8. `normalize()` coerces quantity and price to numbers.
9. `normalize()` trims whitespace from string values.

---

### FILE 9 — `column-mapper.service.ts`

**What it does:**
Injectable service. Makes ONE OpenAI API call per Excel file to map arbitrary column headers to standardized field names. Uses `gpt-4o-mini`.

**Interface:**
```typescript
mapColumns(headers: string[]): Promise<Record<string, string>>
// Returns e.g. { "اسم الدواء": "drug_name", "Qty": "quantity" }
```

**Target field names (the only valid values in the output):**
`drug_name`, `batch_number`, `quantity`, `expiry_date`, `selling_price`, `discount_percent`

**Behavior:**
- One API call for the whole file, regardless of row count.
- Uses `response_format: { type: 'json_object' }`.
- Headers that don't map to any target field are omitted from result.
- Validate the response — any field name not in the allowed list above is stripped from the returned mapping.

**Test Cases:**
1. English headers mapped correctly (`Drug Name` → `drug_name`).
2. Arabic headers mapped correctly (`اسم الدواء` → `drug_name`).
3. Mixed Arabic/English headers work correctly.
4. Unrelated headers (`Notes`, `Supplier`) omitted from result.
5. Hallucinated field names from AI (not in allowed list) are stripped.
6. Returns empty object `{}` if no headers match any target field.
7. Always uses `response_format: json_object` — never parse raw text.

---

### FILE 10 — `drug-matcher.service.ts`

**What it does:**
Injectable service. Two methods: verify a match exists, or generate a new drug record. Both use `gpt-4o-mini`.

**Interface:**
```typescript
verify(
  drugName: string,
  candidates: Array<{ id: string; brand_name: string; brand_name_ar: string; generic_name: string; active_ingredient: string }>
): Promise<string | null>  // returns drug_id if matched, null otherwise

generate(drugName: string): Promise<{
  brand_name: string;
  generic_name: string;
  active_ingredient: string;  // must be UPPERCASE
  category: string;
  strength: string;
  dosage_form: string;
  manufacturer: string;
}>
```

**`verify()` behavior:**
- Empty candidates array → return `null` immediately without calling OpenAI.
- Asks AI if any candidate matches the given drug name (considers brand, Arabic name, generic, active ingredient).
- Uses `response_format: json_object`.
- If AI returns a match, validate that the `drug_id` actually exists in the candidates list before returning it.
- Any error → return `null` (fail gracefully, row becomes auto_created).

**`generate()` behavior:**
- Asks AI to generate a complete drug record for the given name.
- `active_ingredient` must always be UPPERCASE in the result.
- All 7 fields must be present — use `'Unknown'` for fields that cannot be determined.
- Uses `response_format: json_object`.

**Test Cases:**
1. `verify()` returns correct `drug_id` when match found.
2. `verify()` returns `null` when no match.
3. `verify()` with empty candidates returns `null` with no API call.
4. `verify()` AI error returns `null` — does not throw.
5. `verify()` AI returns `drug_id` not in candidates list → returns `null` (prevents hallucination).
6. `generate()` returns object with all 7 fields populated.
7. `generate()` `active_ingredient` is UPPERCASE.
8. `generate()` no field is undefined or missing.

---

### FILE 11 — `import-result.dto.ts`

**What it does:**
TypeScript interfaces for the import pipeline result.

```typescript
interface RowResult {
  drugName: string;
  status: 'matched' | 'auto_created' | 'failed';
  drugId?: string;
  error?: string;
}

interface ImportResult {
  matched: number;
  autoCreated: number;
  failed: number;
  total: number;
  rows: RowResult[];
}
```

---

### FILE 12 — `excel-import.service.ts`

**What it does:**
Orchestrates the complete import pipeline. Processes rows sequentially — never in parallel.

**Interface:**
```typescript
processFile(buffer: Buffer, pharmacyId: string): Promise<ImportResult>
```

**Pipeline steps:**
1. Parse buffer with `ExcelParser.parse()`.
2. Empty file → return zeroed `ImportResult` immediately.
3. Call `ColumnMapperService.mapColumns()` once for the whole file.
4. Normalize all rows with `ExcelParser.normalize()`.
5. For each row sequentially:
   - Validate `drug_name` present, `quantity > 0`, `selling_price > 0`. Fail row if invalid.
   - Call `search_drugs()` RPC to get top candidates.
   - Call `DrugMatcherService.verify()` with top 3 candidates only.
   - If matched: INSERT into `inventory` with matched `drug_id`.
   - If not matched: call `DrugMatcherService.generate()` → INSERT into `drugs` → INSERT into `inventory`.
   - Any uncaught error → row status = `'failed'` with error message.
6. One failed row must NOT stop processing of subsequent rows.
7. Return final `ImportResult` with counts and per-row details.

**Inventory INSERT rules:**
- `status` always = `'active'`
- `discount_percent` defaults to `0` if missing
- `batch_number` and `expiry_date` insert as `null` if missing — never empty string

**Test Cases:**
1. Empty Excel file returns `{ matched:0, autoCreated:0, failed:0, total:0, rows:[] }`.
2. Matched row → `status: 'matched'`, inventory inserted with correct `drug_id`.
3. Unmatched row → `status: 'auto_created'`, drug inserted in `drugs`, inventory inserted.
4. Row missing `drug_name` → `status: 'failed'`.
5. Row with `quantity = 0` → `status: 'failed'`.
6. Row with invalid `selling_price` → `status: 'failed'`.
7. Row with inventory INSERT error → `status: 'failed'` with error message.
8. Failed row does not stop subsequent rows from processing.
9. `mapColumns()` called exactly once regardless of row count.
10. `verify()` receives max 3 candidates (not all 20 from RPC).
11. `matched + autoCreated + failed` always equals `total`.
12. Missing `discount_percent` inserts as `0`.
13. Missing `batch_number` inserts as `null`, not empty string.

---

### FILE 13 — `import-queue.processor.ts`

**What it does:**
BullMQ job processor for large files. Receives a base64-encoded buffer from the queue, decodes it, and delegates to `ExcelImportService.processFile()`.

**Queue name constant:** export as `IMPORT_QUEUE = 'excel-import'`

**Job data shape:** `{ pharmacyId: string; bufferBase64: string }`

**Behavior:**
- Update job progress to 10 at start, 100 at end.
- Decode base64 back to Buffer before passing to service.
- Configure queue with `attempts: 3` for automatic retry on failure.

**Test Cases:**
1. Job processes and returns `ImportResult`.
2. `updateProgress(10)` called at start, `updateProgress(100)` at end.
3. Base64 string decoded to correct original Buffer.
4. Unhandled error triggers BullMQ retry (job configured with `attempts: 3`).

---

### FILE 14 — `excel-import.controller.ts`

**What it does:**
Two endpoints for the Excel import feature. Both protected with `@Roles('pharmacy')`.

**Endpoints:**
```
POST /pharmacy/inventory/import       — upload Excel file
GET  /pharmacy/inventory/import/:jobId — check job status
```

**Upload endpoint behavior:**
- Uses `FileInterceptor` with multer.
- Accepts only `.xlsx` and `.xls` — reject anything else with 400.
- Max file size: 10MB — reject larger with 400.
- No file in request → throw `BadRequestException`.
- Parse the file to count rows first.
- If rows ≤ 200: process synchronously via `ExcelImportService.processFile()`, return `ImportResult`.
- If rows > 200: enqueue via BullMQ, return `{ jobId, queued: true, rowCount }`.

**Status endpoint behavior:**
- Get job from queue by `jobId`.
- Job not found → throw `NotFoundException`.
- Return: `{ jobId, state, progress, result }` where `result` is the `ImportResult` if completed, `null` otherwise.

**Test Cases:**
1. `.xlsx` upload → 200.
2. `.xls` upload → 200.
3. `.csv` upload → 400.
4. No file → 400.
5. File > 10MB → 400.
6. File ≤ 200 rows → synchronous, returns `ImportResult`.
7. File > 200 rows → enqueued, returns `{ jobId, queued: true, rowCount }`.
8. No auth header → 401.
9. User JWT (not pharmacy) → 403.
10. Valid `jobId` → returns state and progress.
11. Non-existent `jobId` → 404.

---

## 9. Module Registration

Register `AiModule` in `app.module.ts`. Inside `AiModule`:
- Import `BullModule.registerQueue({ name: IMPORT_QUEUE })`.
- Import `DatabaseModule` to access `SupabaseService`.
- Register all providers and controllers listed in the file structure.

**Test Cases:**
1. Application starts without errors after `AiModule` is added.
2. No circular dependency errors on startup.
3. `POST /ai/chat` is reachable.
4. `POST /pharmacy/inventory/import` is reachable.

---

## 10. End-to-End Flows to Verify After All Files Are Built

### Chat — Drug Found
1. User sends Arabic message mentioning a drug name with GPS coordinates.
2. AI calls `search_drug` → executor returns results from RPC.
3. AI calls `find_nearby_pharmacies` → executor returns nearby pharmacies.
4. AI returns final Arabic response listing pharmacies with prices and distances.
5. `search_logs` row exists with `result_found: true`.
6. `ai_suggestions` rows exist for the top matched drugs.

### Chat — Drug Not Found, Alternatives Suggested
1. User asks for an unavailable drug.
2. AI calls `search_drug` → empty results.
3. AI calls `find_alternatives` with resolved active ingredient.
4. AI returns alternatives with nearby pharmacies.
5. `search_logs` row has `resolved_ingredient` populated.

### Excel Import — Small File (≤ 200 rows)
1. Upload `.xlsx` with Arabic headers and 5 drug rows.
2. Column mapping resolves headers correctly.
3. 3 rows match existing drugs, 2 rows auto-create new drugs.
4. All 5 rows inserted into `inventory`.
5. Response: `{ matched: 3, autoCreated: 2, failed: 0, total: 5 }`.

### Excel Import — Large File (> 200 rows)
1. Upload `.xlsx` with 250 rows.
2. Response immediately: `{ jobId, queued: true, rowCount: 250 }`.
3. Poll status endpoint → `state: 'active'`.
4. Poll again after completion → `state: 'completed'`, `result` contains `ImportResult`.

---

## 11. Rules

1. Do not modify any existing file outside `src/modules/ai/` and `src/app.module.ts`.
2. Do not modify the database schema, RPCs, triggers, or functions.
3. Always use `adminClient` for all Supabase calls. Never use `userClient` in this module.
4. Process Excel rows sequentially — never `Promise.all()` over rows.
5. `ColumnMapperService` makes one API call per file, not per row.
6. `ChatExecutor.execute()` never throws — catches all errors and returns them serialized.
7. The chat server is stateless — client owns conversation history.
8. Use `gpt-4o` for chat, `gpt-4o-mini` for all Excel import AI calls.
9. Store Buffer as base64 string when putting in BullMQ — Redis cannot serialize raw Buffers.
10. Commit after each file passes all its test cases.
