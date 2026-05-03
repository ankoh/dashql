# Salesforce Query Service V3 HTTP API

## Base Path

```
/api/v3
```

## Content Negotiation

Endpoints that return query data support two response formats via the `Accept` header:

| Accept Value | Format |
|---|---|
| `application/json` | JSON (default when `Accept` is missing, blank, or `*/*`) |
| `application/vnd.apache.arrow.stream` | Apache Arrow IPC binary stream |

Quality factors (`q=`) are respected. Unsupported-only Accept values return **406 Not Acceptable**.

## Common Request Headers

| Header | Required | Default | Description |
|---|---|---|---|
| `x-hyperdb-workload` | No | `query-service-http-v3-proxy` | Workload/job name for query routing |
| `x-hyperdb-external-client-context` | No | — | Opaque client context string |
| `X-hyperdb-adaptive-timeout` | No | — | Adaptive timeout value passed through to Hyper |
| `Accept` | No | `application/json` | Response format preference |

## Scopes

All endpoints require at least one of:
- `cdpquery`
- `cdp_query_api`

---

## Endpoints

### 1. Execute Query — `POST /api/v3/query`

Executes a SQL query. Returns results inline for fast queries, or a query ID for async retrieval.

#### Request Body (`application/json`)

```typescript
{
  sql: string;                          // Required
  transferMode?: "ADAPTIVE" | string;   // Default: "ADAPTIVE"
  settings?: Record<string, unknown>;   // Query settings map
  resultRange?: {
    rowLimit?: number;
    byteLimit: number;
  };
  queryRowLimit?: number;               // -1 = unlimited (default)
  paramStyle?: "NAMED" | string;
}
```

`sql` is the only required field. The generated constructor accepts it as the sole argument.

#### Response (JSON) — `Content-Type: application/json`

```typescript
// Body:
{
  metadata?: { columns: ColumnDefinition[] } | null;
  data: unknown[][];       // Array of row arrays
  returnedRows?: number;
}
```

#### Response (Arrow) — `Content-Type: application/vnd.apache.arrow.stream`

Body is raw binary Arrow IPC stream bytes.

#### `status` Response Header

Both JSON and Arrow responses include a `status` header containing a JSON-serialized QueryStatus:

```typescript
{
  queryId: string;
  completionStatus: CompletionStatus;
  chunkCount: number | null;
  rowCount: number | null;
  progress: number | null;
  expirationTime: string | null;        // ISO 8601
  executionStats: ExecutionStats | null;
}
```

#### Status Codes

- `200` — Success
- `406` — Unsupported Accept type
- `4xx/5xx` — Error (see Error Handling)

---

### 2. Get Query Status — `GET /api/v3/query/{queryId}`

Polls for query execution status. Supports long-polling.

#### Path Parameters

| Param | Type | Required |
|---|---|---|
| `queryId` | string | Yes |

#### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `waitTimeMs` | long | No | `10000` | Long-poll timeout in milliseconds |

#### Response (`application/json`)

```typescript
{
  queryId: string;
  completionStatus: CompletionStatus;
  chunkCount: number | null;
  rowCount: number | null;
  progress: number;                  // 0.0 – 100.0
  expirationTime?: string;          // ISO 8601, or absent
  executionStats?: ExecutionStats | null;
}
```

Note: `chunkCount` and `rowCount` are serialized as JSON strings (e.g. `"10"` not `10`).

---

### 3. Cancel Query — `DELETE /api/v3/query/{queryId}`

Cancels a running query.

| Param | Type | Required |
|---|---|---|
| `queryId` | string | Yes |

**Response:** `204 No Content` (empty body)

---

### 4. Get Query Result Chunk — `GET /api/v3/query/{queryId}/chunk/{chunkId}`

Retrieves a single result chunk by index.

#### Path Parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `queryId` | string | Yes | Query identifier |
| `chunkId` | long | Yes | Zero-based chunk index |

#### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `omitSchema` | boolean | No | `false` | Omit column metadata from response |

#### Response (JSON)

```typescript
{
  metadata?: { columns: ColumnDefinition[] } | null;
  data: unknown[][];
  returnedRows?: number;
}
```

#### Response (Arrow)

Raw binary Arrow IPC stream.

---

### 5. Stream Query Result Rows — `GET /api/v3/query/{queryId}/row`

Streams query results with offset-based pagination. Response body is flushed progressively.

#### Path Parameters

| Param | Type | Required |
|---|---|---|
| `queryId` | string | Yes |

#### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `offset` | long | **Yes** | — | Row offset to start from |
| `limit` | long | No | — | Max rows to return |
| `byteLimit` | long | No | — | Max bytes to return |
| `omitSchema` | boolean | No | `false` | Omit column metadata |

#### Response (JSON)

Single streamed JSON object assembled from multiple server-side chunks:

```typescript
{
  metadata: { columns: ColumnDefinition[] } | null;
  data: unknown[][];
  returnedRows: number;
}
```

#### Response (Arrow)

Binary chunks written sequentially as a standard Arrow IPC stream.

---

## Shared Types

### CompletionStatus

```typescript
type CompletionStatus =
  | "RUNNING_OR_UNSPECIFIED"
  | "FINISHED"
  | "RESULTS_PRODUCED";
```

### ColumnDefinition

```typescript
{
  name?: string;
  type?: string;       // e.g. "varchar", "bigint"
  nullable?: boolean;
}
```

### ExecutionStats

```typescript
{
  wallClockTime: number;    // milliseconds (double)
  rowsProcessed: number;    // long
}
```

---

## Error Handling

All errors return a consistent JSON envelope with null fields omitted:

```typescript
{
  error: string;             // SQL state (e.g. "42601") or "HY000" or "INTERNAL_ERROR"
  message: string;
  details?: {
    customerHint?: string;
    customerDetail?: string;
    errorSource?: string;
    position?: {             // Only when at least one offset > 0
      errorBeginCharacterOffset: string;
      errorEndCharacterOffset: string;
    };
  };
}
```

### HTTP Status Code Mapping

From gRPC status codes:

| gRPC Code | HTTP Status |
|---|---|
| CANCELLED (1), DEADLINE_EXCEEDED (4) | 408 Request Timeout |
| INVALID_ARGUMENT (3), FAILED_PRECONDITION (9), OUT_OF_RANGE (11) | 400 Bad Request |
| NOT_FOUND (5) | 404 Not Found |
| PERMISSION_DENIED (7) | 403 Forbidden |
| RESOURCE_EXHAUSTED (8) | 429 Too Many Requests |
| ABORTED (10) | 409 Conflict |
| UNIMPLEMENTED (12) | 501 Not Implemented |
| UNAUTHENTICATED (16) | 401 Unauthorized |
| UNKNOWN (2), INTERNAL (13), DATA_LOSS (15), others | 500 Internal Server Error |

From CDPRuntimeException codes:

| CDP Error Code | HTTP Status |
|---|---|
| BAD_REQUEST | 400 |
| TIME_OUT | 408 |
| UNAUTHORIZED | 401 |
| FORBIDDEN | 403 |
| NOT_FOUND | 404 |
| (default) | 500 |

Uncaught exceptions: `500` with `{ error: "INTERNAL_ERROR", message: "..." }`.

---

## Client Implementation Notes

1. **`status` header** — POST `/api/v3/query` and GET `/chunk/{chunkId}` include a `status` response header containing JSON-serialized `QueryStatus`. Parse with `JSON.parse(response.headers.get("status"))`.

2. **Async query flow** — POST returns inline results for fast queries. If `completionStatus` is `RUNNING_OR_UNSPECIFIED`, poll `GET /api/v3/query/{queryId}` (with `waitTimeMs` for long-polling) until `FINISHED` or `RESULTS_PRODUCED`, then fetch chunks via `/chunk/{chunkId}`.

3. **Streaming rows** — `GET /row` streams the response progressively. For Arrow, read the response body as a stream. For JSON, the full object is assembled server-side but flushed in chunks.

4. **`data` field** — Always an array of arrays (rows), not a string. Serialized server-side via `@JsonRawValue`.

5. **`chunkCount`/`rowCount`** — Serialized as JSON strings in GET status responses (e.g. `"10"` not `10`). Handle both string and number in deserialization.

6. **`expirationTime`** — ISO 8601 string when present, absent/null when the query is still running.

7. **Default workload** — If `x-hyperdb-workload` is omitted, the server uses `"query-service-http-v3-proxy"`.
