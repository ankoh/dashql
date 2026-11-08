import * as arrow from 'apache-arrow';

import type { HttpClient, HttpFetchResult } from '../../platform/http/http_client.js';
import { parseTrinoTimestampMs } from '../trino/arrow_conversion.js';
import { buildClientFunctionRequest, followRequest, ClientFunctionRequest, requestUrl, STANDARD_OPTIONS } from './clfn_request.js';
import {
    findClientFunction,
    ClientFunctionCallDescription,
    ClientFunctionColumn,
    ClientFunctionError,
    ClientFunction,
    ClientFunctionPaging,
    ClientFunctionPending,
    ClientFunctionSpec,
    ClientFunctionValueSource,
    jsonPointerSegments,
    pendingOf,
    readJsonPointer,
} from './clfn_spec.js';

/// Where a host of a spec is, and what every request to it carries
export interface ClientFunctionHostTarget {
    baseUrl: URL;
    headers: Record<string, string>;
}

/// What a connection provides for its client functions
export interface ClientFunctionEnvironment {
    /// The HTTP client
    http: HttpClient;
    /// Resolve a host that the spec names. Async, since a token may need a refresh or an exchange.
    resolveHost(host: string): Promise<ClientFunctionHostTarget>;
    /// The values of the variables in the base paths
    variables?(): Record<string, string>;
    /// Sleep while a pending result polls, for tests
    sleep?(ms: number, abort?: AbortSignal): Promise<void>;
    /// The current time in milliseconds, for tests
    now?(): number;
}

/// The result table of a call
export interface ClientFunctionResult {
    schema: arrow.Schema;
    rows: unknown[][];
}

/// The first and the longest wait between two polls
const POLL_MIN_MS = 1000;
const POLL_MAX_MS = 10000;
/// The value of `_poll` for a request that is repeated
const POLL_SAME = 'same';

/// The Arrow type of a column
function columnType(type: string | undefined): arrow.DataType {
    switch (type) {
        case 'TIMESTAMPTZ': return new arrow.TimestampMillisecond('UTC');
        case 'DATE': return new arrow.DateDay();
        case 'INTEGER': return new arrow.Int32();
        case 'BIGINT': return new arrow.Int64();
        case 'DOUBLE': return new arrow.Float64();
        case 'BOOLEAN': return new arrow.Bool();
        default: return new arrow.Utf8();
    }
}

/// Convert a value to its column type, undefined if it can't be. The value then goes to `_raw`.
function convertValue(value: unknown, type: string | undefined): unknown {
    if (value === null || value === undefined) {
        return null;
    }
    switch (type) {
        case 'INTEGER': {
            const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
            return typeof n === 'number' && Number.isInteger(n) && Math.abs(n) <= 0x7FFFFFFF ? n : undefined;
        }
        case 'BIGINT': {
            if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
            return typeof value === 'string' && /^-?\d+$/.test(value) ? value : undefined;
        }
        case 'DOUBLE': {
            const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
            return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
        }
        case 'BOOLEAN':
            return typeof value === 'boolean' ? value : undefined;
        // What the Arrow batch can read: a value that passes here and fails there would be lost
        case 'TIMESTAMPTZ':
            return typeof value === 'string' && parseTrinoTimestampMs(value) !== null ? value : undefined;
        // The day as written, whatever time and zone follow it
        case 'DATE': {
            const day = typeof value === 'string' ? value.slice(0, 10) : '';
            return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) ? day : undefined;
        }
        case 'JSON':
            return JSON.stringify(value);
        default:
            return typeof value === 'object' ? undefined : String(value);
    }
}

/// One page of a response
interface Page {
    /// The status
    status: number;
    /// The rows of the page, the fields as the API sent them
    items: unknown[];
    /// The fields outside the rows
    meta: Record<string, unknown> | null;
    /// The parsed body
    body: unknown;
    /// The headers
    headers: Headers;
    /// A body that doesn't hold the rows the spec promises. It ends the list and lands in `_raw`, so a spec that disagrees
    /// with a response doesn't look like an empty list.
    unexpected?: unknown;
}

/// Read the entry with a `rel` of a `Link` header
function readLink(link: string | null, rel: string): string | null {
    const wanted = rel.toLowerCase();
    for (const entry of (link ?? '').split(',')) {
        const match = /<([^>]*)>\s*;\s*(.*)/.exec(entry.trim());
        const found = match === null ? null : /(?:^|;)\s*rel="?([^";]*)"?\s*(?:;|$)/i.exec(match[2]);
        if (found !== null && found[1].trim().toLowerCase() === wanted) {
            return match![1];
        }
    }
    return null;
}

/// A value that the spec points to
function readSource(source: ClientFunctionValueSource | undefined, page: Page): unknown {
    if (source === undefined) {
        return undefined;
    }
    if ('last_row' in source) {
        const last = page.items[page.items.length - 1];
        return last === undefined ? undefined : readJsonPointer(last, source.last_row);
    }
    if ('link' in source) {
        return readLink(page.headers.get('Link'), source.link);
    }
    if ('header' in source) {
        return page.headers.get(source.header);
    }
    if ('body' in source) {
        return readJsonPointer(page.body, source.body);
    }
    // A mistake in a spec would end the list without a word otherwise
    throw new ClientFunctionError(`the spec reads a value from the unknown source ${JSON.stringify(source)}`);
}

/// Does the list end after a page? Only a documented rule ends it early, so an empty page is the default.
function isLastPage(paging: ClientFunctionPaging, page: Page, position: number, size: number | null): boolean {
    const end = paging.end ?? 'empty_page';
    if (end === 'empty_page') {
        return page.items.length === 0;
    }
    if (end === 'short_page') {
        return size === null ? page.items.length === 0 : page.items.length < size;
    }
    if ('has_more' in end) {
        return readJsonPointer(page.body, end.has_more) !== true;
    }
    const total = Number(readJsonPointer(page.body, end.total));
    if (Number.isNaN(total)) {
        return page.items.length === 0;
    }
    // A total counts the pages of a page number, and the rows of an offset
    return paging.kind === 'page' ? position - (paging.start ?? 0) + 1 >= total : position + page.items.length >= total;
}

/// Is a value absent or empty?
function isEmptyValue(value: unknown): boolean {
    return value === null || value === undefined || value === '';
}

/// The value for the next page, null on the last page
function nextValue(paging: ClientFunctionPaging | undefined, page: Page, position: number, size: number | null): string | null {
    if (paging === undefined) {
        return null;
    }
    if (paging.kind === 'url' || paging.kind === 'token') {
        const value = readSource(paging.from, page);
        if (isEmptyValue(value)) {
            return null;
        }
        if (paging.end !== undefined && isLastPage(paging, page, position, size)) {
            return null;
        }
        return String(value);
    }
    if (isLastPage(paging, page, position, size)) {
        return null;
    }
    // Pages can be shorter than asked for, an offset follows the rows that arrived
    return String(paging.kind === 'offset' ? position + page.items.length : position + 1);
}

/// Parse a response body. What isn't JSON stays text, it ends up in `_raw`.
function parseBody(text: string): unknown {
    if (text === '') {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/// The error message of a response
function errorMessage(spec: ClientFunctionSpec, fn: ClientFunction, body: unknown, fallback: string): string {
    const pointers = fn.errors?.message ?? spec.errors?.message ?? [];
    for (const pointer of pointers) {
        const message = readJsonPointer(body, pointer);
        if (typeof message !== 'string' || message === '') {
            continue;
        }
        if (fn.errors?.message_is_json ?? spec.errors?.message_is_json) {
            const inner = parseBody(message);
            const nested = readJsonPointer(inner, '/message');
            if (typeof nested === 'string') {
                return nested;
            }
        }
        return message;
    }
    return typeof body === 'string' && body !== '' ? body : fallback;
}

/// Is a value an object?
function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/// An object without the value at a path and without the objects that this leaves empty, null if nothing is left
function withoutPath(object: Record<string, unknown>, [segment, ...rest]: string[]): Record<string, unknown> | null {
    const { [segment]: child, ...others } = object;
    const inner = rest.length > 0 && isObject(child) ? withoutPath(child, rest) : null;
    const out = inner === null ? others : { ...others, [segment]: inner };
    return Object.keys(out).length > 0 ? out : null;
}

/// Read the page of a finished response
function readPage(fn: ClientFunction, status: number, body: unknown, headers: Headers): Page {
    if (fn.raw || fn.rows === undefined) {
        return { status, items: body === null ? [{}] : [body], meta: null, body, headers };
    }
    const items = readJsonPointer(body, fn.rows);
    // An explicit null and an empty object are an empty list
    const isEmpty = items === null || body === null || (typeof body === 'object' && Object.keys(body).length === 0);
    if (!Array.isArray(items) && !isEmpty) {
        return { status, items: [], meta: null, body, headers, unexpected: body };
    }
    const meta = fn.rows !== '' && isObject(body) ? withoutPath(body, jsonPointerSegments(fn.rows)) : null;
    return { status, items: Array.isArray(items) ? items : [], meta, body, headers };
}

/// The options of a call with `_next` applied, if that sets an option
function optionsWithNext(fn: ClientFunction, options: Record<string, unknown>): Record<string, unknown> {
    const next = options['_next'] ?? null;
    const paging = fn.paging;
    if (next === null || paging === undefined || paging.kind === 'url' || paging.option === undefined) {
        return options;
    }
    const numeric = paging.kind === 'offset' || paging.kind === 'page';
    return { ...options, [paging.option]: numeric ? Number(next) : next };
}

/// The first request of a call, which a run sends and `EXPLAIN` prints. A followed `_next` or `_poll` URL replaces the path
/// and query, the headers of options still apply.
function firstRequest(spec: ClientFunctionSpec, fn: ClientFunction, options: Record<string, unknown>, variables: Record<string, string>): ClientFunctionRequest {
    const label = `${spec.namespace}.${fn.name}`;
    const next = options['_next'] ?? null;
    const poll = options['_poll'] ?? null;
    // Only a request that repeats has this value, anything else would send the request again, even a write
    const pending = pendingOf(spec, fn);
    if (poll === POLL_SAME && (pending === null || !('repeat' in pending.poll))) {
        throw new ClientFunctionError(`${label} polls a URL, _poll takes the value of its result`);
    }
    const followed = next !== null && fn.paging?.kind === 'url' ? next : poll !== null && poll !== POLL_SAME ? poll : null;
    if (followed === null) {
        return buildClientFunctionRequest(spec, fn, optionsWithNext(fn, options), variables);
    }
    if (fn.raw === true) {
        throw new ClientFunctionError(`${label} can't follow a URL`);
    }
    if (fn.host === undefined) {
        throw new ClientFunctionError(`${label} has no host`);
    }
    const headers: [string, string][] = [];
    for (const option of fn.options ?? []) {
        if (option.in === 'header' && options[option.name] !== undefined && options[option.name] !== null) {
            headers.push([option.api_name ?? option.name, String(options[option.name])]);
        }
    }
    return followRequest({ method: 'GET', host: fn.host, path: '', query: [], headers, body: null, followUrl: null }, String(followed));
}

/// Run calls of one function
class ClientFunctionCallRun {
    readonly fn: ClientFunction;
    readonly pending: ClientFunctionPending | null;
    readonly columns: ClientFunctionColumn[];

    constructor(readonly spec: ClientFunctionSpec, description: ClientFunctionCallDescription, readonly env: ClientFunctionEnvironment, readonly abort?: AbortSignal) {
        this.fn = findClientFunction(spec, description.function);
        this.pending = pendingOf(spec, this.fn);
        // A raw call has no columns, its response is in `_raw`
        this.columns = this.fn.raw ? [] : (this.fn.columns ?? []);
    }

    /// The schema of the result
    schema(): arrow.Schema {
        const fields = this.columns.map(c => new arrow.Field(c.name, columnType(c.type), true));
        fields.push(new arrow.Field('_status', new arrow.Int32(), true));
        fields.push(new arrow.Field('_next', new arrow.Utf8(), true));
        if (this.pending !== null) {
            fields.push(new arrow.Field('_poll', new arrow.Utf8(), true));
        }
        fields.push(new arrow.Field('_meta', new arrow.Utf8(), true));
        fields.push(new arrow.Field('_raw', new arrow.Utf8(), true));
        return new arrow.Schema(fields);
    }

    /// A row with only the standard columns
    private standardRow(status: number | null, next: string | null, poll: string | null, meta: unknown, raw: unknown): unknown[] {
        const row: unknown[] = this.columns.map(() => null);
        row.push(status, next);
        if (this.pending !== null) {
            row.push(poll);
        }
        row.push(meta === null || meta === undefined ? null : JSON.stringify(meta));
        row.push(raw === null || raw === undefined ? null : JSON.stringify(raw));
        return row;
    }

    /// A row of an item: the listed fields in their columns, everything else in `_raw`
    private itemRow(item: unknown, page: Page, next: string | null): unknown[] {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            return this.standardRow(page.status, next, null, page.meta, item);
        }
        const rest: Record<string, unknown> = { ...item };
        const row: unknown[] = this.columns.map(column => {
            const apiName = column.api_name ?? column.name;
            const converted = convertValue(rest[apiName], column.type);
            // A value that can't be converted stays in `_raw`, so a spec that disagrees doesn't fail the statement
            if (converted !== undefined) {
                delete rest[apiName];
            }
            return converted ?? null;
        });
        row.push(page.status, next);
        if (this.pending !== null) {
            row.push(null);
        }
        row.push(page.meta === null ? null : JSON.stringify(page.meta));
        row.push(Object.keys(rest).length > 0 ? JSON.stringify(rest) : null);
        return row;
    }

    /// Send a request
    private async send(request: ClientFunctionRequest): Promise<HttpFetchResult> {
        const { baseUrl, headers } = await this.env.resolveHost(request.host);
        const url = requestUrl(request, baseUrl);
        const merged = new Headers(headers);
        for (const [name, value] of request.headers) {
            merged.set(name, value);
        }
        const init: RequestInit = { method: request.method, headers: merged, signal: this.abort };
        if (request.body !== null) {
            init.body = request.body;
        }
        return this.env.http.fetch(url, init);
    }

    /// Send a request and poll while it's pending, up to the time limit.
    /// Returns the response, or the value to poll if the call is still running when the time runs out.
    private async sendAndWait(request: ClientFunctionRequest, waitSeconds: number): Promise<{ response: HttpFetchResult } | { poll: string; status: number }> {
        const now = this.env.now ?? Date.now;
        const sleep = this.env.sleep ?? ((ms: number, abort?: AbortSignal) => abortableSleep(ms, abort));
        const deadline = now() + waitSeconds * 1000;
        let current = request;
        let delay = POLL_MIN_MS;
        for (;;) {
            const response = await this.send(current);
            if (this.pending === null || response.status !== this.pending.status) {
                return { response };
            }
            const rule = this.pending.poll;
            if (!('header' in rule) && !('repeat' in rule)) {
                throw new ClientFunctionError(`${this.spec.namespace}.${this.fn.name} has the unknown poll rule ${JSON.stringify(rule)}`);
            }
            let poll = POLL_SAME;
            if ('header' in rule) {
                const value = response.headers.get(rule.header);
                if (isEmptyValue(value)) {
                    throw new ClientFunctionError(`${this.spec.namespace}.${this.fn.name} answered ${response.status} without a ${rule.header} header`, response.status);
                }
                poll = value!;
            }
            const remaining = deadline - now();
            if (remaining <= 0) {
                return { poll, status: response.status };
            }
            const retryAfter = Number(response.headers.get('Retry-After'));
            const wait = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay, remaining);
            await sleep(wait, this.abort);
            delay = Math.min(delay * 2, POLL_MAX_MS);
            if (poll !== POLL_SAME) {
                current = followRequest(request, poll);
            }
        }
    }

    /// Read a response as a page, or fail
    private async finish(response: HttpFetchResult): Promise<Page> {
        const body = parseBody(await response.text());
        if (this.fn.errors?.empty_on?.includes(response.status)) {
            return { status: response.status, items: [], meta: null, body: null, headers: response.headers };
        }
        const fallback = `${this.spec.namespace}.${this.fn.name} failed with the status ${response.status}`;
        if (response.status < 200 || response.status >= 300) {
            throw new ClientFunctionError(errorMessage(this.spec, this.fn, body, fallback), response.status);
        }
        const errorIf = this.fn.errors?.error_if;
        if (errorIf !== undefined && !isEmptyValue(readJsonPointer(body, errorIf))) {
            throw new ClientFunctionError(errorMessage(this.spec, this.fn, body, fallback), response.status);
        }
        return readPage(this.fn, response.status, body, response.headers);
    }

    /// Run the call
    async run(options: Record<string, unknown>): Promise<ClientFunctionResult> {
        const { fn, spec, env } = this;
        const paging = fn.paging;
        const next = options['_next'] ?? null;
        const poll = options['_poll'] ?? null;
        const pages = Number(options['_pages'] ?? 1);
        const wait = Number(options['_wait'] ?? 0);
        if (!Number.isInteger(pages) || pages < 1) {
            throw new ClientFunctionError('_pages takes a positive number');
        }
        if (!Number.isFinite(wait) || wait < 0) {
            throw new ClientFunctionError('_wait takes a number of seconds');
        }
        if (next !== null && poll !== null) {
            throw new ClientFunctionError('_next and _poll continue different things, use one of them');
        }
        if (poll !== null && this.pending === null) {
            throw new ClientFunctionError(`${spec.namespace}.${fn.name} has no option _poll`);
        }
        if ((next !== null || pages > 1) && paging === undefined) {
            throw new ClientFunctionError(`${spec.namespace}.${fn.name} doesn't page`);
        }

        const send: Record<string, unknown> = { ...optionsWithNext(fn, options) };
        const numeric = paging?.kind === 'offset' || paging?.kind === 'page';
        const variables = env.variables?.() ?? {};
        const build = (values: Record<string, unknown>) => buildClientFunctionRequest(spec, fn, values, variables);
        let request = firstRequest(spec, fn, options, variables);

        const start = paging?.start ?? 0;
        const size = paging?.size !== undefined && typeof options[paging.size] === 'number' ? options[paging.size] as number : null;
        let position = numeric ? (paging!.option !== undefined && typeof send[paging!.option!] === 'number' ? send[paging!.option!] as number : start) : 0;

        const pageRows: { page: Page }[] = [];
        let lastNext: string | null = null;
        for (let i = 0; i < pages; ++i) {
            const outcome = await this.sendAndWait(request, wait);
            if (!('response' in outcome)) {
                if (i > 0) {
                    throw new ClientFunctionError(`${spec.namespace}.${fn.name}: a later page is still running, use _wait`, outcome.status);
                }
                return { schema: this.schema(), rows: [this.standardRow(outcome.status, null, outcome.poll, null, null)] };
            }
            const page = await this.finish(outcome.response);
            pageRows.push({ page });
            const value = page.unexpected === undefined ? nextValue(paging, page, position, size) : null;
            // A list that doesn't move on would repeat forever
            if (value !== null && value === (i === 0 ? next : lastNext)) {
                throw new ClientFunctionError(`${spec.namespace}.${fn.name} returned the same next value twice`);
            }
            lastNext = value;
            if (value === null || i + 1 === pages) {
                break;
            }
            // The next page of this call
            position = paging!.kind === 'offset' || paging!.kind === 'page' ? Number(value) : position;
            if (paging!.kind === 'url') {
                request = followRequest(request, value);
            } else {
                send[paging!.option!] = numeric ? Number(value) : value;
                request = build(send);
            }
        }

        // `_next` on every row holds the value after the last page. No row can't carry it, so an empty page with a next
        // value still has one.
        const rows: unknown[][] = [];
        for (const { page } of pageRows) {
            for (const item of page.items) {
                rows.push(this.itemRow(item, page, lastNext));
            }
            if (page.unexpected !== undefined) {
                rows.push(this.standardRow(page.status, lastNext, null, null, page.unexpected));
            }
        }
        if (rows.length === 0 && (lastNext !== null || paging === undefined)) {
            const last = pageRows[pageRows.length - 1].page;
            rows.push(this.standardRow(last.status, lastNext, null, last.meta, null));
        }
        return { schema: this.schema(), rows };
    }
}

/// Sleep until the time is over or the signal aborts
function abortableSleep(ms: number, abort?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        abort?.throwIfAborted();
        const timer = setTimeout(resolve, ms);
        abort?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(abort.reason);
        }, { once: true });
    });
}

/// Run a call. A call that writes is sent like any other: the planner leaves a script with one out of the runs of the
/// session and of input changes, and agents don't run it, see docs/design/client_functions.md.
export async function runClientFunctionCall(spec: ClientFunctionSpec, description: ClientFunctionCallDescription, env: ClientFunctionEnvironment, abort?: AbortSignal): Promise<ClientFunctionResult> {
    requireValues(description);
    const run = new ClientFunctionCallRun(spec, description, env, abort);
    return run.run(description.options);
}

/// A plan puts the values of its inputs in a description and the shell has none, so a description here has them. Its options
/// would be sent with a null otherwise.
function requireValues(description: ClientFunctionCallDescription): void {
    const binding = description.bindings?.[0];
    if (binding !== undefined) {
        throw new ClientFunctionError(`the parameter :${binding.param} has no value`);
    }
}

/// The result of `EXPLAIN CALL`: the resolved request. It sends nothing, needs no credentials, and shows the name of the
/// host.
export async function explainClientFunctionCall(spec: ClientFunctionSpec, description: ClientFunctionCallDescription, env: Pick<ClientFunctionEnvironment, 'variables'> = {}): Promise<ClientFunctionResult> {
    const fn = findClientFunction(spec, description.function);
    requireValues(description);
    const options = description.options;
    // A base path shows its variables if the binding isn't there to fill them
    const variables = new Proxy(env.variables?.() ?? {}, {
        get: (target, name: string) => target[name] ?? `{${name}}`,
    });
    const request = firstRequest(spec, fn, options, variables);
    const standard = Object.fromEntries(Object.entries(options).filter(([name]) => (STANDARD_OPTIONS as readonly string[]).includes(name)));
    const text = (value: unknown) => value === null ? null : String(value);
    const query = request.query.map(([name, value]) => `${name}=${value}`).join('&');
    const fields: [string, string | null][] = [
        ['method', request.method],
        ['host', request.host],
        ['path', request.followUrl ?? request.path],
        ['query', query === '' ? null : query],
        ['headers', request.headers.length > 0 ? JSON.stringify(Object.fromEntries(request.headers)) : null],
        ['body', text(request.body)],
        ['standard_options', Object.keys(standard).length > 0 ? JSON.stringify(standard) : null],
    ];
    return {
        schema: new arrow.Schema(fields.map(([name]) => new arrow.Field(name, new arrow.Utf8(), true))),
        rows: [fields.map(([, value]) => value)],
    };
}
