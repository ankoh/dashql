# API Survey

Status: research, as of 2026-11. It backs the format in [overlay.md](../overlay.md), and it measures whether the format stays general, or only fits the API it was designed on.

**The short version:** the layers, named hosts and the `name` and `wire` split hold up. The first version of the format was shaped too closely to Data 360: Stripe couldn't be expressed at all, and Snowflake only in part. The changes below are now in the format.

## How this was measured

A script read each published OpenAPI document, resolved its references, and counted operations, parameters, response shapes and schema features.

- **Static analysis only.** Nothing was called, and no spec was generated.
- **Paging labels come from name matching** on parameters such as `page` and `starting_after`, so they're approximate.
- **Specs under-declare.** GitHub's search endpoint declares no `Link` header, for example, so real numbers can be higher.
- **Schema statistics count each named schema once,** because unfolding Stripe's schemas is exponential.

Data 360 is the [contract normalized by Salesforce](../../../overlay/d360/docs/api_notes.md#sources-for-the-api-surface) rather than a full OpenAPI document, so some of its rows are missing. It keeps no response headers at all, so `Link` and `Location` are unknown there.

## The numbers

| | Data 360 | Snowflake | GitHub | Stripe |
|---|---:|---:|---:|---:|
| Operations | 414 | 418 | 1,272 | 612 |
| Can return `202` | 12 | 400 | 40 | 0 |
| ... with a `Location` header | unknown | 398 | 0 | 0 |
| Operations declaring a `Link` header | unknown | 123 (13 not `GET`) | 212 | 0 |
| Top-level array responses | 0 | 91 | 258 | 0 |
| Array request bodies | 0 | 56 | 0 | 0 |
| Form-encoded requests | 0 | 0 | 0 | 611 |
| `deepObject` query parameters | not measured | 0 | 0 | 366 |
| Multi-segment path parameters | not measured | 0 | 68 operations | 0 |
| Same name in body and parameter | a handful | 26 | 5 | 0 |
| Schema nesting depth | not measured | 5 | 6 | 20 |
| Recursive references | not measured | 0 | 0 | 124 |
| `anyOf` | not measured | 0 | 35 | 2,050 |
| Discriminators | not measured | 25 | 5 | 0 |
| Attributes in named schemas | 4,035 rows | 1,414 | 10,438 | 18,407 |
| Document size | 1.6 MB, normalized | 1.3 MB | 14 MB | 8 MB |
| `operationId` | none | all | all | all |

**Paging, in more detail:**

| API | How the next page is found |
|---|---|
| Data 360 | `nextPageUrl` in the body, `offset` with `limit` or `batchSize`, or a `pageToken` |
| Snowflake | A `Link` header pointing at `/api/v2/results/{handle}?page=1`. 21 list operations also have `showLimit` and `fromName`, a cursor taken from a row's name |
| GitHub | `page` and `per_page` on 241 operations, 172 of them also declaring a `Link` header. `before` and `after` cursors on some |
| Stripe | `limit`, `starting_after` and `ending_before` on 126 operations. The response has `data`, `has_more`, `object` and `url`, and no next value at all, so the cursor is the last row's id |

**Asynchronous work comes in three kinds:**

| Kind | API | What it looks like |
|---|---|---|
| The HTTP response says "poll here" | Snowflake | `202` with `Location`, poll `GET /api/v2/results/{handle}` until `200` |
| The HTTP response says "ask again" | GitHub | `202` from `GET /repos/{owner}/{repo}/stats/contributors`, with no `Location` |
| A job, with a status in its body | Data 360 | A status field read through another function |

The first two are transport behavior that the runtime can handle per spec. The third is workflow knowledge, and stays out of the spec.

## What held up

| Decision | Evidence |
|---|---|
| Named hosts, resolved by the binding | `uploads.github.com` and `files.stripe.com` are per-operation servers, and they fit a host name. Snowflake's host is per account |
| Auth and fixed headers in the binding | Snowflake's `X-Snowflake-Authorization-Token-Type` header depends on the token. GitHub declares no security schemes in its document at all |
| `name` and `wire` | 26 Snowflake operations such as `PUT /warehouses/{name}` have `name` in the path and body. A prefix on one solves it |
| Plain paths | 191 Snowflake operations use `:rename`-style paths, which need nothing special |
| Named schemas, walked along the value | Recursion doesn't matter when the walk follows a script's finite value |
| Leaving out non-JSON responses | About 10 Snowflake operations, mostly Cortex and Spark Connect. Stripe has 1 PDF, and GitHub a handful of diffs |

## What had to change

| Finding | Change in [the format](../overlay.md) |
|---|---|
| Snowflake declares `Link` on 13 `POST` and `PUT` operations, and the URL points at a results path | A followed URL always uses `GET` with no body. Otherwise, fetching page 2 could repeat a create |
| Next values live in headers and in rows, not only in the body | `from` takes a pointer, `header:Link#next`, `header:<name>` or `last_row:/id` |
| GitHub pages by number | A `page` kind |
| Stripe ends with `has_more` | `end` takes `{ "has_more": ... }` |
| 400 Snowflake operations can return `202` | `pending`, with `_poll` and `_wait` |
| A poll URL and a page token can't be told apart in one value | `_poll` is separate from `_next` |
| Snowflake's `:set-tags` and `:unset-tags` take an array as the whole body | `in: "body:root"` |
| Stripe's whole API is form-encoded | `body: "form"` |
| Stripe's `created[gte]=1` and `expand` | A per-option `style` |
| 68 GitHub operations have path values containing `/` | `multi_segment`. The earlier rule of percent-encoding everything breaks them |
| Stripe has 197 responses with one array plus other fields, but only 135 are `data` | `rows` is explicit, and a generator never guesses it |
| 349 top-level array responses on Snowflake and GitHub | `rows: ""` |
| Merging Snowflake's 55 files gives 39 duplicate schema names | A generator prefixes them, since `schemas` is one flat map |
| `Link` and `Location` aren't readable cross-origin without `Access-Control-Expose-Headers` | A check per service, in [Security](../overlay.md#security) |

**Data 360's contract alone would have shown almost none of these.** It has no top-level array responses, no array bodies and no form encoding, and it doesn't record response headers. A format is only as general as the APIs it has met.

## Similar formats

| Format | Paging | When the vocabulary runs out |
|---|---|---|
| [dlt REST API source](https://dlthub.com/docs/dlt-ecosystem/verified-sources/rest_api/basic) | `json_link`, `header_link`, `header_cursor`, `offset`, `page_number`, `cursor`, `single_page`, `auto`. Ends with `total_path`, `has_more_path`, `maximum_offset`, `stop_after_empty_page` | [Custom Python paginators and callables](https://dlthub.com/docs/dlt-ecosystem/verified-sources/rest_api/advanced) |
| [Airbyte low-code](https://docs.airbyte.com/platform/connector-development/config-based/understanding-the-yaml-file/pagination) | `PageIncrement`, `OffsetIncrement`, `CursorPagination` | Values are [Jinja2 templates](https://docs.airbyte.com/platform/connector-development/config-based/advanced-topics/string-interpolation) |
| [Speakeasy `x-speakeasy-pagination`](https://www.speakeasy.com/docs/sdks/customize/runtime/pagination) | `offsetLimit`, `cursor`, `url`, as an OpenAPI extension with JSONPath outputs | Generated SDK code |

**What to take from them:**
- **Paging categories converge.** Independent formats land on URL, cursor, offset and page number, so a closed vocabulary is realistic. dlt's end rules are nearly the ones this format arrived at from the numbers.
- **All of them have a code escape.** This format can't, since [the app evaluates no code](../app_csp.md). The escape here is `_raw` and passing `_next` by hand, so some APIs will page less conveniently. It's a deliberate limit.
- **These tools fetch everything,** because they're loaders. A script in DashQL pays per call while someone waits, so paging here stays bounded and explicit, through `_pages`.
- **dlt's `response_actions`** ignores a 404 per status, which is the same idea as `empty_on`.
- **dlt's parent and child resources** call an endpoint once per parent row. That's a real need, and it's left out here, because it hides a call count that can cost money.

**Standards:**
- **[OpenAPI Overlay 1.0](https://spec.openapis.org/overlay/v1.0.0)** is a list of updates applied in order to an OpenAPI document. It's the standard form of the annotations [Data 360 needs](../../../overlay/d360/docs/overview.md#where-attributes-come-from), so it's the format for a generator's input. Despite the name, it's unrelated to DashQL's overlays.
- **OpenAPI has no paging standard.** None of the extensions in the Snowflake, GitHub and Stripe documents describe it: they're `x-github`, `x-multi-segment`, `x-expandableFields` and `x-stripeBypassValidation`. Every service needs annotations for this.

## Sources

- [Snowflake REST API specs](https://github.com/snowflakedb/snowflake-rest-api-specs), [Getting started with the Snowflake REST APIs](https://docs.snowflake.com/en/developer-guide/snowflake-rest-api/getting-started)
- [GitHub REST API description](https://github.com/github/rest-api-description)
- [Stripe OpenAPI](https://github.com/stripe/openapi)
- [Data 360 contract in `sf-pi`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-contracts.json)

These were read for analysis, and none of them is vendored.
