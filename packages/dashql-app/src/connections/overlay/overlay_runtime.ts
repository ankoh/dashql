import * as arrow from 'apache-arrow';

import type { HttpClient, HttpFetchResult } from '../../platform/http/http_client.js';
import { bindCallOptions, buildOverlayRequest, followRequest, OverlayRequest, requestUrl, STANDARD_OPTIONS } from './overlay_request.js';
import {
    findOverlayFunction,
    isWriteCall,
    OverlayCallDescription,
    OverlayColumn,
    OverlayError,
    OverlayFunction,
    OverlayPaging,
    OverlayPending,
    OverlaySpec,
    pendingOf,
    readJsonPointer,
} from './overlay_spec.js';

/// What a connection provides for its overlay
export interface OverlayEnvironment {
    /// The HTTP client
    http: HttpClient;
    /// Resolve a host that the overlay names. Async, since a token may need a refresh or an exchange.
    resolveHost(host: string): Promise<{ baseUrl: URL; headers: Record<string, string> }>;
    /// The values of the variables in the base paths
    variables?(): Record<string, string>;
    /// The values of the parameters of the script
    params?: Record<string, unknown>;
    /// Read a stored secret
    resolveSecret?(name: string): Promise<string>;
    /// Sleep while a pending result polls, for tests
    sleep?(ms: number, abort?: AbortSignal): Promise<void>;
    /// The current time in milliseconds, for tests
    now?(): number;
}

/// The result table of a call
export interface OverlayResult {
    schema: arrow.Schema;
    rows: unknown[][];
    /// Is the call still running? `_poll` holds the value to poll.
    pending: boolean;
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
        case 'TIMESTAMPTZ':
        case 'DATE':
            return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined;
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
}

/// Read the `rel="next"` entry of a `Link` header
function readLinkNext(link: string | null): string | null {
    for (const entry of (link ?? '').split(',')) {
        const match = /<([^>]*)>\s*;\s*(.*)/.exec(entry.trim());
        if (match !== null && /(^|;)\s*rel="?next"?\s*(;|$)/i.test(match[2])) {
            return match[1];
        }
    }
    return null;
}

/// A value that the overlay points to
function readSource(source: string | undefined, page: Page): unknown {
    if (source === undefined) {
        return undefined;
    }
    if (source.startsWith('last_row:')) {
        const last = page.items[page.items.length - 1];
        return last === undefined ? undefined : readJsonPointer(last, source.substring('last_row:'.length));
    }
    if (source.startsWith('header:')) {
        const name = source.substring('header:'.length);
        if (name.toLowerCase() === 'link#next') {
            return readLinkNext(page.headers.get('Link'));
        }
        return page.headers.get(name);
    }
    return readJsonPointer(page.body, source);
}

/// Does the list end after a page? Only a documented rule ends it early, so an empty page is the default.
function isLastPage(paging: OverlayPaging, page: Page, position: number, size: number | null): boolean {
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
function nextValue(paging: OverlayPaging | undefined, page: Page, position: number, size: number | null): string | null {
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
function errorMessage(spec: OverlaySpec, fn: OverlayFunction, body: unknown, fallback: string): string {
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

/// Read the page of a finished response
function readPage(fn: OverlayFunction, status: number, body: unknown, headers: Headers): Page {
    if (fn.raw || fn.rows === undefined) {
        return { status, items: body === null ? [{}] : [body], meta: null, body, headers };
    }
    const items = readJsonPointer(body, fn.rows);
    let meta: Record<string, unknown> | null = null;
    if (fn.rows !== '' && typeof body === 'object' && body !== null && !Array.isArray(body)) {
        const rowsField = fn.rows.split('/')[1];
        const entries = Object.entries(body).filter(([name]) => name !== rowsField);
        meta = entries.length > 0 ? Object.fromEntries(entries) : null;
    }
    return { status, items: Array.isArray(items) ? items : [], meta, body, headers };
}

/// Run calls of one function
class OverlayCallRun {
    readonly fn: OverlayFunction;
    readonly pending: OverlayPending | null;
    readonly columns: OverlayColumn[];

    constructor(readonly spec: OverlaySpec, description: OverlayCallDescription, readonly env: OverlayEnvironment, readonly abort?: AbortSignal) {
        this.fn = findOverlayFunction(spec, description.function);
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
            const wire = column.wire ?? column.name;
            const converted = convertValue(rest[wire], column.type);
            // A value that can't be converted stays in `_raw`, so a spec that disagrees doesn't fail the statement
            if (converted !== undefined) {
                delete rest[wire];
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
    private async send(request: OverlayRequest): Promise<HttpFetchResult> {
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
    private async sendAndWait(request: OverlayRequest, waitSeconds: number): Promise<{ response: HttpFetchResult } | { poll: string; status: number }> {
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
            if (this.pending.poll !== POLL_SAME && !this.pending.poll.startsWith('header:')) {
                throw new OverlayError(`${this.spec.namespace}.${this.fn.name} has the unknown poll rule ${this.pending.poll}`);
            }
            let poll = POLL_SAME;
            if (this.pending.poll !== POLL_SAME) {
                const value = response.headers.get(this.pending.poll.substring('header:'.length));
                if (isEmptyValue(value)) {
                    throw new OverlayError(`${this.spec.namespace}.${this.fn.name} answered ${response.status} without a ${this.pending.poll}`, response.status);
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
            throw new OverlayError(errorMessage(this.spec, this.fn, body, fallback), response.status);
        }
        const errorIf = this.fn.errors?.error_if;
        if (errorIf !== undefined && !isEmptyValue(readJsonPointer(body, errorIf))) {
            throw new OverlayError(errorMessage(this.spec, this.fn, body, fallback), response.status);
        }
        return readPage(this.fn, response.status, body, response.headers);
    }

    /// Run the call
    async run(options: Record<string, unknown>): Promise<OverlayResult> {
        const { fn, spec, env } = this;
        const paging = fn.paging;
        const next = options['_next'] ?? null;
        const poll = options['_poll'] ?? null;
        const pages = Number(options['_pages'] ?? 1);
        const wait = Number(options['_wait'] ?? 0);
        if (!Number.isInteger(pages) || pages < 1) {
            throw new OverlayError('_pages takes a positive number');
        }
        if (!Number.isFinite(wait) || wait < 0) {
            throw new OverlayError('_wait takes a positive number');
        }
        if (next !== null && poll !== null) {
            throw new OverlayError('_next and _poll continue different things, use one of them');
        }
        if (poll !== null && this.pending === null) {
            throw new OverlayError(`${spec.namespace}.${fn.name} has no option _poll`);
        }
        if ((next !== null || pages > 1) && paging === undefined) {
            throw new OverlayError(`${spec.namespace}.${fn.name} doesn't page`);
        }

        // `_next` sets an option, a URL replaces the path and query
        const send: Record<string, unknown> = { ...options };
        const paged = paging !== undefined && paging.kind !== 'url' && paging.option !== undefined;
        const numeric = paging?.kind === 'offset' || paging?.kind === 'page';
        if (next !== null && paged) {
            send[paging!.option!] = numeric ? Number(next) : next;
        }
        const isFollow = (next !== null && paging?.kind === 'url') || (poll !== null && poll !== POLL_SAME);
        if (fn.raw === true && isFollow) {
            throw new OverlayError(`${spec.namespace}.${fn.name} can't follow a URL`);
        }
        const build = (values: Record<string, unknown>) => buildOverlayRequest(spec, fn, values, env.variables?.() ?? {});
        let request = isFollow ? followRequest(this.headerRequest(options), String(next ?? poll)) : build(send);

        const start = paging?.start ?? 0;
        const size = paging?.size !== undefined && typeof options[paging.size] === 'number' ? options[paging.size] as number : null;
        let position = numeric ? (paging!.option !== undefined && typeof send[paging!.option!] === 'number' ? send[paging!.option!] as number : start) : 0;

        const pageRows: { page: Page }[] = [];
        let lastNext: string | null = null;
        for (let i = 0; i < pages; ++i) {
            const outcome = await this.sendAndWait(request, wait);
            if (!('response' in outcome)) {
                if (i > 0) {
                    throw new OverlayError(`${spec.namespace}.${fn.name}: a later page is still running, use _wait`, outcome.status);
                }
                return { schema: this.schema(), rows: [this.standardRow(outcome.status, null, outcome.poll, null, null)], pending: true };
            }
            const page = await this.finish(outcome.response);
            pageRows.push({ page });
            const value = nextValue(paging, page, position, size);
            // A list that doesn't move on would repeat forever
            if (value !== null && value === (i === 0 ? next : lastNext)) {
                throw new OverlayError(`${spec.namespace}.${fn.name} returned the same next value twice`);
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
        }
        if (rows.length === 0 && (lastNext !== null || paging === undefined)) {
            const last = pageRows[pageRows.length - 1].page;
            rows.push(this.standardRow(last.status, lastNext, null, last.meta, null));
        }
        return { schema: this.schema(), rows, pending: false };
    }

    /// The request that a followed URL replaces: the path and query come from the URL, the headers of options still apply
    private headerRequest(options: Record<string, unknown>): OverlayRequest {
        const host = this.fn.host;
        if (host === undefined) {
            throw new OverlayError(`${this.spec.namespace}.${this.fn.name} has no host`);
        }
        const headers: [string, string][] = [];
        for (const option of this.fn.options ?? []) {
            if (option.in === 'header' && options[option.name] !== undefined && options[option.name] !== null) {
                headers.push([option.wire ?? option.name, String(options[option.name])]);
            }
        }
        return { method: 'GET', host, path: '', query: [], headers, body: null, followUrl: null };
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

/// Run a read-only call. Writes wait for run gating and the agent policy, see docs/design/overlay.md.
export async function runOverlayCall(spec: OverlaySpec, description: OverlayCallDescription, env: OverlayEnvironment, abort?: AbortSignal): Promise<OverlayResult> {
    const options = await bindCallOptions(description, async binding => {
        if (binding.secret !== undefined) {
            if (env.resolveSecret === undefined) {
                throw new OverlayError(`the call needs the secret ${binding.secret}, but there is no secret store`);
            }
            return env.resolveSecret(binding.secret);
        }
        const name = binding.param ?? '';
        if (env.params === undefined || !(name in env.params)) {
            throw new OverlayError(`the parameter :${name} has no value`);
        }
        return env.params[name];
    });
    const run = new OverlayCallRun(spec, description, env, abort);
    if (isWriteCall(run.fn, options)) {
        throw new OverlayError(`${spec.namespace}.${run.fn.name} changes something, and overlay calls can only read so far`);
    }
    return run.run(options);
}

/// The result of `EXPLAIN CALL`: the resolved request. It sends nothing, needs no credentials, and shows the name of the
/// host. Secrets print as `secret(name)`, parameters without a value as `:name`.
export async function explainOverlayCall(spec: OverlaySpec, description: OverlayCallDescription, env: Pick<OverlayEnvironment, 'variables' | 'params'> = {}): Promise<OverlayResult> {
    const fn = findOverlayFunction(spec, description.function);
    const options = await bindCallOptions(description, binding => {
        if (binding.secret !== undefined) {
            return `secret(${binding.secret})`;
        }
        const name = binding.param ?? '';
        return env.params !== undefined && name in env.params ? env.params[name] : `:${name}`;
    });
    // A base path shows its variables if the binding isn't there to fill them
    const variables = new Proxy(env.variables?.() ?? {}, {
        get: (target, name: string) => target[name] ?? `{${name}}`,
    });
    let send = options;
    const next = options['_next'] ?? null;
    const poll = options['_poll'] ?? null;
    let request: OverlayRequest;
    if (poll !== null && poll !== POLL_SAME || (next !== null && fn.paging?.kind === 'url')) {
        const host = fn.host ?? '';
        request = followRequest({ method: 'GET', host, path: '', query: [], headers: [], body: null, followUrl: null }, String(poll ?? next));
    } else {
        if (next !== null && fn.paging?.option !== undefined) {
            send = { ...options, [fn.paging.option]: next };
        }
        request = buildOverlayRequest(spec, fn, send, variables);
    }
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
        pending: false,
    };
}
