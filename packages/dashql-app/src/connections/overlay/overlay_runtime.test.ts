import * as arrow from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../../platform/logger/test_logger.js';
import { AsyncConsumerLambdas } from '../../utils/async_consumer.js';
import { OVERLAY_PENDING_METADATA, OverlayResultStream } from './overlay_result_stream.js';
import { explainOverlayCall, OverlayEnvironment, OverlayResult, runOverlayCall } from './overlay_runtime.js';
import { OverlayCallDescription, OverlayError, OverlayFunction, OverlaySpec } from './overlay_spec.js';

const BASE = 'https://svc.example.com';

function spec(functions: OverlayFunction[], extra: Partial<OverlaySpec> = {}): OverlaySpec {
    return {
        format: 1,
        namespace: 't',
        hosts: { api: { base_path: '/v{version}' } },
        errors: { message: ['/error/message', '/message'] },
        functions: functions.map(f => ({ method: 'GET', host: 'api', path: '/items', ...f })),
        ...extra,
    };
}

function call(name: string, options: Record<string, unknown> = {}, bindings: OverlayCallDescription['bindings'] = undefined): OverlayCallDescription {
    return { namespace: 't', function: name, effect: 'read', explain: false, options, bindings };
}

/// An environment whose HTTP client answers with the given responses in order
function env(responses: (Response | (() => Response))[], extra: Partial<OverlayEnvironment> = {}) {
    const fetch = vi.fn(async (_input: URL | Request | string, _init?: RequestInit) => {
        const next = responses.shift();
        if (next === undefined) throw new Error('unexpected request');
        return typeof next === 'function' ? next() : next;
    });
    const environment: OverlayEnvironment = {
        http: { fetch },
        resolveHost: async () => ({ baseUrl: new URL(BASE), headers: { Authorization: 'Bearer token' } }),
        variables: () => ({ version: '2' }),
        ...extra,
    };
    return { fetch, environment };
}

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), init);

function urlOf(fetch: ReturnType<typeof env>['fetch'], i: number): string {
    return fetch.mock.calls[i][0].toString();
}
function initOf(fetch: ReturnType<typeof env>['fetch'], i: number): RequestInit {
    return fetch.mock.calls[i][1]!;
}
/// The value of a column in a row
function cell(result: OverlayResult, row: number, column: string): unknown {
    return result.rows[row][result.schema.fields.findIndex(f => f.name === column)];
}

describe('overlay requests', () => {
    const create: OverlayFunction = {
        name: 'create',
        effect: 'read',
        method: 'POST',
        path: '/projects/{project}/items',
        options: [
            { name: 'project', in: 'path:project' },
            { name: 'page_size', wire: 'pageSize', in: 'query' },
            { name: 'tags', wire: 'tagList', in: 'query', style: 'csv' },
            { name: 'ids', in: 'query' },
            { name: 'created', in: 'query', style: 'deep' },
            { name: 'trace_id', wire: 'X-Trace-Id', in: 'header' },
            { name: 'display_name', wire: 'displayName', in: 'body' },
            { name: 'owner', wire: 'ownerInfo', in: 'body', schema: 'Owner' },
        ],
    };
    const schemas = { Owner: { attributes: [{ name: 'first_name', wire: 'firstName' }, { name: 'parent', wire: 'parentOwner', schema: 'Owner' }] } };

    it('sends the wire names from the overlay', async () => {
        const { fetch, environment } = env([json({})]);
        await runOverlayCall(spec([create], { schemas }), call('create', {
            project: 'a b/c',
            page_size: 5,
            tags: ['x', 'y'],
            ids: [1, 2],
            created: { gte: 1 },
            trace_id: 'abc',
            display_name: 'Name',
            owner: { first_name: 'A', parent: [{ first_name: 'B', other_key: 1 }] },
        }), environment);
        const url = new URL(urlOf(fetch, 0));
        expect(url.pathname).toEqual('/v2/projects/a%20b%2Fc/items');
        expect(url.searchParams.get('pageSize')).toEqual('5');
        expect(url.searchParams.get('tagList')).toEqual('x,y');
        expect(url.searchParams.getAll('ids')).toEqual(['1', '2']);
        expect(url.searchParams.get('created[gte]')).toEqual('1');
        const init = initOf(fetch, 0);
        expect(init.method).toEqual('POST');
        const headers = new Headers(init.headers);
        expect(headers.get('Authorization')).toEqual('Bearer token');
        expect(headers.get('X-Trace-Id')).toEqual('abc');
        expect(headers.get('Content-Type')).toEqual('application/json');
        expect(JSON.parse(init.body as string)).toEqual({
            displayName: 'Name',
            ownerInfo: { firstName: 'A', parentOwner: [{ firstName: 'B', other_key: 1 }] },
        });
    });

    it('sends a name the overlay does not list as written', async () => {
        const toBody = env([json({})]);
        await runOverlayCall(spec([create]), call('create', { project: 'a', new_Field: 1 }), toBody.environment);
        expect(JSON.parse(initOf(toBody.fetch, 0).body as string)).toEqual({ new_Field: 1 });
        const toQuery = env([json({})]);
        await runOverlayCall(spec([{ name: 'list' }]), call('list', { new_Field: 1 }), toQuery.environment);
        expect(new URL(urlOf(toQuery.fetch, 0)).searchParams.get('new_Field')).toEqual('1');
    });

    it('keeps path values on their endpoint', async () => {
        const fn: OverlayFunction = { name: 'read', path: '/files/{path}', options: [{ name: 'path', in: 'path:path', multi_segment: true }] };
        const { fetch, environment } = env([json({})]);
        await runOverlayCall(spec([fn]), call('read', { path: 'a b/c' }), environment);
        expect(new URL(urlOf(fetch, 0)).pathname).toEqual('/v2/files/a%20b/c');
        await expect(runOverlayCall(spec([fn]), call('read', { path: '../admin' }), env([]).environment)).rejects.toThrow(/relative segment/);
    });

    it('encodes form and whole bodies', async () => {
        const form = env([json({})]);
        await runOverlayCall(spec([{ name: 'f', method: 'POST', effect: 'read', body: 'form', options: [{ name: 'meta', in: 'body' }] }]), call('f', { meta: { a: 1, b: [2] } }), form.environment);
        expect(new Headers(initOf(form.fetch, 0).headers).get('Content-Type')).toEqual('application/x-www-form-urlencoded');
        expect(new URLSearchParams(initOf(form.fetch, 0).body as string).get('meta[b][0]')).toEqual('2');
        const root = env([json({})]);
        await runOverlayCall(spec([{ name: 'r', method: 'POST', effect: 'read', options: [{ name: 'tags', in: 'body:root' }] }]), call('r', { tags: [{ a: 1 }] }), root.environment);
        expect(JSON.parse(initOf(root.fetch, 0).body as string)).toEqual([{ a: 1 }]);
        const csv = env([json({})]);
        await runOverlayCall(spec([{ name: 'c', method: 'POST', effect: 'read', body: 'text/csv', options: [{ name: 'csv', in: 'body' }] }]), call('c', { csv: 'id,name' }), csv.environment);
        expect(initOf(csv.fetch, 0).body).toEqual('id,name');
    });

    it('fills in parameters and secrets', async () => {
        const fn: OverlayFunction = { name: 'p', options: [{ name: 'a', in: 'query' }, { name: 'key', wire: 'apiKey', in: 'header' }] };
        const description = call('p', { a: null, key: null }, [{ pointer: '/a', param: 'x' }, { pointer: '/key', secret: 'k' }]);
        const { fetch, environment } = env([json({})], { params: { x: 7 }, resolveSecret: async () => 'hidden' });
        await runOverlayCall(spec([fn]), description, environment);
        expect(new URL(urlOf(fetch, 0)).searchParams.get('a')).toEqual('7');
        expect(new Headers(initOf(fetch, 0).headers).get('apiKey')).toEqual('hidden');
        await expect(runOverlayCall(spec([fn]), description, env([], { params: { x: 7 } }).environment)).rejects.toThrow(/no secret store/);
        await expect(runOverlayCall(spec([fn]), description, env([], { resolveSecret: async () => '' }).environment)).rejects.toThrow(/:x has no value/);
    });

    it('refuses writes for now', async () => {
        const { fetch, environment } = env([]);
        await expect(runOverlayCall(spec([{ name: 'w', method: 'POST' }]), call('w'), environment)).rejects.toThrow(/can only read/);
        await expect(runOverlayCall(spec([{ name: 'r', raw: true }]), call('r', { method: 'POST', path: '/x' }), environment)).rejects.toThrow(/can only read/);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('keeps the escape hatch on its hosts', async () => {
        const raw: OverlayFunction = { name: 'request', raw: true };
        const { fetch, environment } = env([json({ a: 1 })]);
        const result = await runOverlayCall(spec([raw]), call('request', { method: 'get', path: '/new', host: 'api', someParam: 1 }), environment);
        expect(urlOf(fetch, 0)).toEqual(`${BASE}/v2/new?someParam=1`);
        expect(cell(result, 0, '_raw')).toEqual('{"a":1}');
        for (const path of ['https://evil.example.com/x', '//evil.example.com/x', '/a/../b', 'x']) {
            await expect(runOverlayCall(spec([raw]), call('request', { method: 'GET', path, host: 'api' }), env([]).environment)).rejects.toThrow(/relative to its host/);
        }
        await expect(runOverlayCall(spec([raw]), call('request', { method: 'GET', path: '/x', host: 'other' }), env([]).environment)).rejects.toThrow(/no host other/);
    });
});

describe('overlay paging', () => {
    const token: OverlayFunction = {
        name: 'list',
        rows: '/items',
        options: [{ name: 'token', wire: 'pageToken', in: 'query' }, { name: 'size', in: 'query' }],
        columns: [{ name: 'id', type: 'BIGINT' }],
        paging: { kind: 'token', from: '/next', option: 'token' },
    };

    it('returns one page and the value for the next one', async () => {
        const { fetch, environment } = env([json({ items: [{ id: 1 }, { id: 2 }], next: 'abc', total: 9 })]);
        const result = await runOverlayCall(spec([token]), call('list', { size: 2 }), environment);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(result.rows.map((_, i) => cell(result, i, 'id'))).toEqual([1, 2]);
        expect(cell(result, 1, '_next')).toEqual('abc');
        expect(JSON.parse(cell(result, 0, '_meta') as string)).toEqual({ next: 'abc', total: 9 });
    });

    it('applies _next to the option of the function', async () => {
        const { fetch, environment } = env([json({ items: [{ id: 3 }] })]);
        const result = await runOverlayCall(spec([token]), call('list', { size: 2, _next: 'abc' }), environment);
        const url = new URL(urlOf(fetch, 0));
        expect(url.searchParams.get('pageToken')).toEqual('abc');
        expect(url.searchParams.get('size')).toEqual('2');
        expect(url.searchParams.has('_next')).toBe(false);
        expect(cell(result, 0, '_next')).toBeNull();
    });

    it('concatenates up to _pages, and _next continues after them', async () => {
        const { fetch, environment } = env([
            json({ items: [{ id: 1 }], next: 'a' }),
            json({ items: [{ id: 2 }], next: 'b' }),
        ]);
        const result = await runOverlayCall(spec([token]), call('list', { _pages: 2 }), environment);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(result.rows.map((_, i) => cell(result, i, 'id'))).toEqual([1, 2]);
        expect([cell(result, 0, '_next'), cell(result, 1, '_next')]).toEqual(['b', 'b']);
    });

    it('stops when the list ends, and fails as a whole', async () => {
        const end = env([json({ items: [{ id: 1 }], next: 'a' }), json({ items: [{ id: 2 }] })]);
        await runOverlayCall(spec([token]), call('list', { _pages: 10 }), end.environment);
        expect(end.fetch).toHaveBeenCalledTimes(2);
        const failing = env([json({ items: [{ id: 1 }], next: 'a' }), json({ message: 'boom' }, { status: 500 })]);
        await expect(runOverlayCall(spec([token]), call('list', { _pages: 2 }), failing.environment)).rejects.toThrow('boom');
    });

    it('fails on a token that comes back unchanged', async () => {
        const again = env([json({ items: [{ id: 1 }], next: 'a' }), json({ items: [{ id: 1 }], next: 'a' })]);
        await expect(runOverlayCall(spec([token]), call('list', { _pages: 5 }), again.environment)).rejects.toThrow(/same next value/);
        const input = env([json({ items: [{ id: 1 }], next: 'a' })]);
        await expect(runOverlayCall(spec([token]), call('list', { _next: 'a' }), input.environment)).rejects.toThrow(/same next value/);
    });

    it('keeps the position on an empty page with a next value', async () => {
        const { environment } = env([json({ items: [], next: 'a' })]);
        const result = await runOverlayCall(spec([token]), call('list'), environment);
        expect(result.rows.length).toEqual(1);
        expect(cell(result, 0, 'id')).toBeNull();
        expect(cell(result, 0, '_next')).toEqual('a');
        const last = await runOverlayCall(spec([token]), call('list'), env([json({ items: [] })]).environment);
        expect(last.rows.length).toEqual(0);
    });

    it('follows a next URL with GET and no body', async () => {
        const fn: OverlayFunction = {
            name: 'search',
            method: 'POST',
            effect: 'read',
            rows: '',
            options: [{ name: 'q', in: 'body' }, { name: 'trace', wire: 'X-Trace', in: 'header' }],
            paging: { kind: 'url', from: 'header:Link#next' },
        };
        const { fetch, environment } = env([
            json([{ a: 1 }], { headers: { Link: `</results/1?page=0>; rel="first", </results/1?page=1>; rel="next"` } }),
            json([{ a: 2 }]),
        ]);
        const result = await runOverlayCall(spec([fn]), call('search', { q: 'x', trace: 't', _pages: 2 }), environment);
        expect(initOf(fetch, 0).method).toEqual('POST');
        expect(urlOf(fetch, 1)).toEqual(`${BASE}/results/1?page=1`);
        expect(initOf(fetch, 1).method).toEqual('GET');
        expect(initOf(fetch, 1).body).toBeUndefined();
        const headers = new Headers(initOf(fetch, 1).headers);
        expect(headers.get('X-Trace')).toEqual('t');
        expect(headers.get('Authorization')).toEqual('Bearer token');
        expect(headers.has('Content-Type')).toBe(false);
        expect(result.rows.length).toEqual(2);
    });

    it('never sends the token to another origin', async () => {
        const fn: OverlayFunction = { name: 'feed', rows: '/items', options: [{ name: 'required', in: 'path:r' }], path: '/{r}', paging: { kind: 'url', from: '/next' } };
        const fromScript = env([]);
        await expect(runOverlayCall(spec([fn]), call('feed', { _next: 'https://evil.example.com/x' }), fromScript.environment)).rejects.toThrow(/another origin/);
        expect(fromScript.fetch).not.toHaveBeenCalled();
        const fromResponse = env([json({ items: [{}], next: 'https://evil.example.com/x' })]);
        await expect(runOverlayCall(spec([fn]), call('feed', { required: 'a', _pages: 2 }), fromResponse.environment)).rejects.toThrow(/another origin/);
        expect(fromResponse.fetch).toHaveBeenCalledTimes(1);
    });

    it('takes a cursor from the last row, and ends with has_more', async () => {
        const fn: OverlayFunction = {
            name: 'charges',
            rows: '/data',
            options: [{ name: 'starting_after', in: 'query' }],
            paging: { kind: 'token', from: 'last_row:/id', option: 'starting_after', end: { has_more: '/has_more' } },
        };
        const { fetch, environment } = env([json({ data: [{ id: 'a' }, { id: 'b' }], has_more: true }), json({ data: [{ id: 'c' }], has_more: false })]);
        const result = await runOverlayCall(spec([fn]), call('charges', { _pages: 5 }), environment);
        expect(new URL(urlOf(fetch, 1)).searchParams.get('starting_after')).toEqual('b');
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(cell(result, 0, '_next')).toBeNull();
    });

    it('advances offsets by the rows that arrived', async () => {
        const fn = (end: OverlayFunction['paging']): OverlayFunction => ({
            name: 'o',
            rows: '/items',
            options: [{ name: 'offset', in: 'query' }, { name: 'limit', in: 'query' }],
            paging: end,
        });
        const paging = { kind: 'offset', option: 'offset', size: 'limit', start: 0 } as const;
        const capped = env([json({ items: [{}, {}] })]);
        const result = await runOverlayCall(spec([fn(paging)]), call('o', { limit: 100, offset: 10 }), capped.environment);
        expect(cell(result, 0, '_next')).toEqual('12');
        const short = await runOverlayCall(spec([fn({ ...paging, end: 'short_page' })]), call('o', { limit: 100 }), env([json({ items: [{}, {}] })]).environment);
        expect(cell(short, 0, '_next')).toBeNull();
        const total = await runOverlayCall(spec([fn({ ...paging, end: { total: '/totalSize' } })]), call('o', { offset: 8, limit: 2 }), env([json({ items: [{}, {}], totalSize: 10 })]).environment);
        expect(cell(total, 0, '_next')).toBeNull();
        const next = env([json({ items: [{}] })]);
        await runOverlayCall(spec([fn(paging)]), call('o', { _next: '12' }), next.environment);
        expect(new URL(urlOf(next.fetch, 0)).searchParams.get('offset')).toEqual('12');
    });

    it('counts page numbers', async () => {
        const fn: OverlayFunction = { name: 'p', rows: '', options: [{ name: 'page', in: 'query' }], paging: { kind: 'page', option: 'page', start: 1 } };
        const { fetch, environment } = env([json([{}]), json([{}]), json([])]);
        const result = await runOverlayCall(spec([fn]), call('p', { _pages: 9 }), environment);
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(new URL(urlOf(fetch, 2)).searchParams.get('page')).toEqual('3');
        expect(result.rows.length).toEqual(2);
    });

    it('rejects paging a function that does not page', async () => {
        await expect(runOverlayCall(spec([{ name: 'x' }]), call('x', { _next: 'a' }), env([]).environment)).rejects.toThrow(/doesn't page/);
    });
});

describe('overlay results', () => {
    const columns: OverlayFunction['columns'] = [
        { name: 'api_name', wire: 'apiName', type: 'VARCHAR' },
        { name: 'count', type: 'INTEGER' },
        { name: 'size', type: 'BIGINT' },
        { name: 'ratio', type: 'DOUBLE' },
        { name: 'active', type: 'BOOLEAN' },
        { name: 'created', type: 'TIMESTAMPTZ' },
        { name: 'day', type: 'DATE' },
        { name: 'status', type: 'JSON' },
    ];

    it('keeps what a column can not hold in _raw', async () => {
        const { environment } = env([json({ apiName: 'a', count: 'many', size: 5, ratio: 0.5, active: true, status: { queryId: 'q' }, extra: 1 })]);
        const result = await runOverlayCall(spec([{ name: 'one', columns }]), call('one'), environment);
        expect(cell(result, 0, 'api_name')).toEqual('a');
        expect(cell(result, 0, 'count')).toBeNull();
        expect(cell(result, 0, 'status')).toEqual('{"queryId":"q"}');
        expect(JSON.parse(cell(result, 0, '_raw') as string)).toEqual({ count: 'many', extra: 1 });
        expect(cell(result, 0, '_status')).toEqual(200);
    });

    it('returns one row without a body', async () => {
        const { environment } = env([new Response(null, { status: 204 })]);
        const result = await runOverlayCall(spec([{ name: 'n', columns }]), call('n'), environment);
        expect(result.rows.length).toEqual(1);
        expect(cell(result, 0, '_status')).toEqual(204);
        expect(cell(result, 0, 'api_name')).toBeNull();
    });

    it('reports errors from the overlay pointers', async () => {
        const fn = (errors?: OverlayFunction['errors']): OverlayFunction => ({ name: 'e', errors });
        const failure = await runOverlayCall(spec([fn()]), call('e'), env([json({ error: { message: 'nope' } }, { status: 403 })]).environment).catch(e => e);
        expect(failure).toBeInstanceOf(OverlayError);
        expect([failure.message, failure.status]).toEqual(['nope', 403]);
        await expect(runOverlayCall(spec([fn()]), call('e'), env([new Response('', { status: 500 })]).environment)).rejects.toThrow(/status 500/);
        const nested = json([{ message: JSON.stringify({ message: 'inner' }) }], { status: 400 });
        await expect(runOverlayCall(spec([fn({ message: ['/0/message'], message_is_json: true })]), call('e'), env([nested]).environment)).rejects.toThrow('inner');
        await expect(runOverlayCall(spec([fn({ error_if: '/errors', message: ['/errors/0'] })]), call('e'), env([json({ errors: ['bad'] })]).environment)).rejects.toThrow('bad');
        const empty = await runOverlayCall(spec([{ name: 'e', rows: '/items', errors: { empty_on: [404] } }]), call('e'), env([json({}, { status: 404 })]).environment);
        expect(empty.rows.length).toEqual(1);
        expect(cell(empty, 0, '_status')).toEqual(404);
    });

    it('produces Arrow batches', async () => {
        const { environment } = env([json({ apiName: 'a', count: 3, size: '9007199254740993', ratio: 0.5, active: true, created: '2026-01-02T03:04:05Z', day: '2026-01-02', status: { a: 1 } })]);
        const result = await runOverlayCall(spec([{ name: 'one', columns }]), call('one'), environment);
        const stream = new OverlayResultStream(new TestLogger(), result);
        const batches: arrow.RecordBatch[] = [];
        await stream.produce(new AsyncConsumerLambdas((_, batch) => { batches.push(batch); }), new AsyncConsumerLambdas());
        expect(batches.length).toEqual(1);
        const table = new arrow.Table(batches);
        expect(table.numRows).toEqual(1);
        const row = table.get(0)!.toJSON();
        expect(row['api_name']).toEqual('a');
        expect(row['count']).toEqual(3);
        expect(row['size']).toEqual(9007199254740993n);
        expect(row['active']).toEqual(true);
        expect(row['created']).toEqual(Date.parse('2026-01-02T03:04:05Z'));
        expect(row['_status']).toEqual(200);
        expect(stream.getMetadata().size).toEqual(0);
    });
});

describe('overlay pending results', () => {
    const pending = { status: 202, poll: 'header:Location' };
    const fn: OverlayFunction = { name: 'slow', rows: '', columns: [{ name: 'id', type: 'BIGINT' }], pending, options: [{ name: 'required', in: 'query' }] };
    const accepted = (headers: Record<string, string> = { Location: '/results/1' }) => new Response('{}', { status: 202, headers });

    /// A clock that moves when the runtime sleeps
    function clock() {
        let now = 0;
        const sleeps: number[] = [];
        return { sleeps, now: () => now, sleep: async (ms: number) => { sleeps.push(ms); now += ms; } };
    }

    it('reports a call that is not finished as pending', async () => {
        const { fetch, environment } = env([accepted()]);
        const result = await runOverlayCall(spec([fn]), call('slow', { required: 1 }), environment);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(result.pending).toBe(true);
        expect(result.rows.length).toEqual(1);
        expect(cell(result, 0, '_status')).toEqual(202);
        expect(cell(result, 0, '_poll')).toEqual('/results/1');
        expect(new OverlayResultStream(new TestLogger(), result).getMetadata().get(OVERLAY_PENDING_METADATA)).toEqual('true');
    });

    it('polls with _poll, with GET and without other options', async () => {
        const { fetch, environment } = env([json([{ id: 1 }])]);
        const result = await runOverlayCall(spec([fn]), call('slow', { _poll: '/results/1' }), environment);
        expect(urlOf(fetch, 0)).toEqual(`${BASE}/results/1`);
        expect(initOf(fetch, 0).method).toEqual('GET');
        expect(result.pending).toBe(false);
        expect(cell(result, 0, 'id')).toEqual(1);
        expect(cell(result, 0, '_poll')).toBeNull();
    });

    it('waits up to _wait and honors Retry-After', async () => {
        const time = clock();
        const { fetch, environment } = env([accepted({ Location: '/results/1', 'Retry-After': '5' }), accepted(), json([{ id: 1 }])], time);
        const result = await runOverlayCall(spec([fn]), call('slow', { required: 1, _wait: 60 }), environment);
        expect(time.sleeps).toEqual([5000, 2000]);
        expect(urlOf(fetch, 1)).toEqual(`${BASE}/results/1`);
        expect(initOf(fetch, 1).method).toEqual('GET');
        expect(result.pending).toBe(false);
    });

    it('returns the pending row when the time runs out', async () => {
        const time = clock();
        const { environment } = env([accepted(), accepted(), accepted()], time);
        const result = await runOverlayCall(spec([fn]), call('slow', { required: 1, _wait: 3 }), environment);
        expect(result.pending).toBe(true);
        expect(time.sleeps).toEqual([1000, 2000]);
    });

    it('repeats the request for poll rule same', async () => {
        const time = clock();
        const same: OverlayFunction = { ...fn, pending: { status: 202, poll: 'same' } };
        const { fetch, environment } = env([accepted({}), json([{ id: 1 }])], time);
        await runOverlayCall(spec([same]), call('slow', { required: 1, _wait: 5 }), environment);
        expect(urlOf(fetch, 1)).toEqual(urlOf(fetch, 0));
        const pendingResult = await runOverlayCall(spec([same]), call('slow', { required: 1 }), env([accepted({})]).environment);
        expect(cell(pendingResult, 0, '_poll')).toEqual('same');
    });

    it('fails without the header it polls, and on another origin', async () => {
        await expect(runOverlayCall(spec([fn]), call('slow', { required: 1 }), env([accepted({})]).environment)).rejects.toThrow(/without a header:Location/);
        await expect(runOverlayCall(spec([fn]), call('slow', { _poll: 'https://evil.example.com/x' }), env([]).environment)).rejects.toThrow(/another origin/);
    });

    it('treats the status as success without a pending rule', async () => {
        const result = await runOverlayCall(spec([{ name: 'done' }]), call('done'), env([new Response('{"a":1}', { status: 202 })]).environment);
        expect(result.pending).toBe(false);
        expect(cell(result, 0, '_status')).toEqual(202);
    });

    it('stops polling when the statement is canceled', async () => {
        const controller = new AbortController();
        const { environment } = env([accepted()], { sleep: async () => { controller.abort(new Error('canceled')); throw new Error('canceled'); } });
        await expect(runOverlayCall(spec([fn]), call('slow', { required: 1, _wait: 60 }), environment, controller.signal)).rejects.toThrow('canceled');
    });

    it('has a _poll column only with a pending rule', async () => {
        const without = await runOverlayCall(spec([{ name: 'x' }]), call('x'), env([json({})]).environment);
        expect(without.schema.fields.map(f => f.name)).toEqual(['_status', '_next', '_meta', '_raw']);
        await expect(runOverlayCall(spec([{ name: 'x' }]), call('x', { _poll: 'a' }), env([]).environment)).rejects.toThrow(/no option _poll/);
    });
});

describe('overlay EXPLAIN', () => {
    const fn: OverlayFunction = {
        name: 'create',
        method: 'POST',
        path: '/projects/{project}',
        options: [
            { name: 'project', in: 'path:project' },
            { name: 'page_size', wire: 'pageSize', in: 'query' },
            { name: 'signing_key', wire: 'signingKey', in: 'body' },
            { name: 'token', wire: 'X-Token', in: 'header' },
        ],
    };

    it('prints the request with wire names and sends nothing, even for a write', async () => {
        const description = call('create', { project: 'a', page_size: 5, signing_key: null, token: 'abc' }, [{ pointer: '/signing_key', secret: 'k' }]);
        const result = await explainOverlayCall(spec([fn]), description, { variables: () => ({ version: '2' }) });
        expect(cell(result, 0, 'method')).toEqual('POST');
        expect(cell(result, 0, 'host')).toEqual('api');
        expect(cell(result, 0, 'path')).toEqual('/v2/projects/a');
        expect(cell(result, 0, 'query')).toEqual('pageSize=5');
        expect(JSON.parse(cell(result, 0, 'body') as string)).toEqual({ signingKey: 'secret(k)' });
        expect(JSON.parse(cell(result, 0, 'headers') as string)['X-Token']).toEqual('abc');
    });

    it('works without a binding', async () => {
        const result = await explainOverlayCall(spec([fn]), call('create', { project: 'a' }));
        expect(cell(result, 0, 'path')).toEqual('/v{version}/projects/a');
    });

    it('shows a followed URL and what the runtime applies itself', async () => {
        const url: OverlayFunction = { name: 'feed', paging: { kind: 'url', from: '/next' } };
        const result = await explainOverlayCall(spec([url]), call('feed', { _next: '/feed?page=2', _pages: 3 }));
        expect(cell(result, 0, 'method')).toEqual('GET');
        expect(cell(result, 0, 'path')).toEqual('/feed?page=2');
        expect(JSON.parse(cell(result, 0, 'standard_options') as string)).toEqual({ _next: '/feed?page=2', _pages: 3 });
    });
});
