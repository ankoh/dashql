import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dashql from '@akohn/dashql';

import type { ConnectionState, NewConnection } from '@akohn/dashql/platform/connections/connection_state';
import { newConnectionFromParams, newDefaultHyperWasmConnection } from '@akohn/dashql/platform/connections/connection_params';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import { testRuntime } from '@akohn/dashql/runtime/testing/test_runtime';
import {
    bindHyperLink,
    confirmHyperLink,
    createHyperLinkConnectionParams,
    hyperLinkChannelParams,
    isHyperLinkParams,
    parseHyperLinkTarget,
    readHyperLinkTabState,
    HyperLinkTabStore,
} from './hyper_link.js';
import type { KeyValueStorage } from '@akohn/dashql/platform/key_value_storage';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: dashql.DashQL;
let runtime: Runtime;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
beforeEach(() => { runtime = testRuntime(dql); });
afterEach(() => {
    runtime.destroy();
});

const TLS = { clientKeyPath: '', clientCertPath: '', caCertsPath: '' };

describe('Hyper link target', () => {
    it('accepts loopback endpoints and https endpoints with a token', () => {
        expect(parseHyperLinkTarget('http://127.0.0.1:7484', 'secret')).toEqual({ endpoint: 'http://127.0.0.1:7484', token: 'secret' });
        expect(parseHyperLinkTarget('http://localhost:7484/', 'secret')?.endpoint).toBe('http://localhost:7484');
        expect(parseHyperLinkTarget('https://[::1]:7484', 'secret')?.endpoint).toBe('https://[::1]:7484');
        expect(parseHyperLinkTarget('https://hyper.example/api', 'secret')?.endpoint).toBe('https://hyper.example');
    });

    it('refuses http to other machines, other schemes and missing tokens', () => {
        expect(parseHyperLinkTarget('http://hyper.example', 'secret')).toBeNull();
        expect(parseHyperLinkTarget('http://127.0.0.1.example:7484', 'secret')).toBeNull();
        expect(parseHyperLinkTarget('file:///tmp/hyperd', 'secret')).toBeNull();
        expect(parseHyperLinkTarget('not a url', 'secret')).toBeNull();
        expect(parseHyperLinkTarget('http://127.0.0.1:7484', '')).toBeNull();
        expect(parseHyperLinkTarget(null, 'secret')).toBeNull();
    });

    it('confirms links to other machines only', () => {
        const confirm = vi.fn(() => false);
        expect(confirmHyperLink({ endpoint: 'http://127.0.0.1:7484', token: 'secret' }, confirm)).toBe(true);
        expect(confirm).not.toHaveBeenCalled();
        expect(confirmHyperLink({ endpoint: 'https://hyper.example', token: 'secret' }, confirm)).toBe(false);
        expect(confirm).toHaveBeenCalledWith(expect.stringContaining('https://hyper.example'));
    });

    it('stores the endpoint but not the token, the channel adds the token', () => {
        expect(createHyperLinkConnectionParams('http://127.0.0.1:7484')).toEqual({ hyper: { protocol: 'V3_HTTP_LINK', endpoint: 'http://127.0.0.1:7484', tls: TLS } });
        const hyper = { protocol: 'V3_HTTP_LINK' as const, endpoint: 'http://127.0.0.1:7484', tls: TLS, metadata: { 'x-custom': '1' } };
        expect(hyperLinkChannelParams(hyper, 'secret')).toEqual({
            protocol: 'V3_HTTP',
            endpoint: 'http://127.0.0.1:7484',
            tls: TLS,
            metadata: { 'x-hyperdb-workload': 'dashql', 'x-custom': '1', authorization: 'Bearer secret' },
        });
    });

    it('reads the links of the tab, also from broken or refused storage', () => {
        const storage = (value: string | null, refuse = false) => ({
            getItem: () => { if (refuse) throw new DOMException('denied', 'SecurityError'); return value; },
        }) as unknown as KeyValueStorage;
        expect(readHyperLinkTabState(storage(JSON.stringify({ tokens: { a: 'secret', b: 1 }, current: 'a' }))))
            .toEqual({ tokens: { a: 'secret' }, current: 'a' });
        expect(readHyperLinkTabState(storage('not json'))).toEqual({ tokens: {}, current: null });
        expect(readHyperLinkTabState(storage(null, true))).toEqual({ tokens: {}, current: null });
        expect(readHyperLinkTabState(null)).toEqual({ tokens: {}, current: null });
    });

    it('keeps the token of a link in the storage of the tab and tells its subscribers', () => {
        const items = new Map<string, string>();
        const storage: KeyValueStorage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value); } };
        const store = new HyperLinkTabStore(storage);
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);
        store.setToken('a', 'secret');
        expect(store.get()).toEqual({ tokens: { a: 'secret' }, current: 'a' });
        expect(listener).toHaveBeenCalledOnce();
        // A reload reads the links again
        expect(new HyperLinkTabStore(storage).get()).toEqual({ tokens: { a: 'secret' }, current: 'a' });
        unsubscribe();
        store.setToken('b', 'other');
        expect(listener).toHaveBeenCalledOnce();
        // Without storage the links last until the reload
        const refused = new HyperLinkTabStore({ getItem: () => null, setItem: () => { throw new DOMException('denied', 'QuotaExceededError'); } });
        refused.setToken('a', 'secret');
        expect(refused.get().current).toBe('a');
    });
});

describe('binding a Hyper link', () => {
    const target = { endpoint: 'http://127.0.0.1:2222', token: 'second' };
    const linked = (connectionId: string, endpoint: string): ConnectionState =>
        runtime.createConnection(newConnectionFromParams(createHyperLinkConnectionParams(endpoint)), connectionId);
    const embedded = (): ConnectionState => runtime.createConnection(newDefaultHyperWasmConnection(), 'embedded');
    const allocator = () => vi.fn((connection: NewConnection): ConnectionState => runtime.createConnection(connection, 'allocated'));

    it('reuses the connection to the endpoint of the link without asking', () => {
        const same = linked('same', target.endpoint);
        const confirm = vi.fn(() => true);
        const binding = bindHyperLink(target, [embedded(), linked('other', 'http://127.0.0.1:1111'), same], allocator(), 'other', confirm);
        expect(binding).toEqual({ connection: same, params: null });
        expect(confirm).not.toHaveBeenCalled();
    });

    it('moves the connection of the latest link to the endpoint of the link if the user reuses it', () => {
        const first = linked('first', 'http://127.0.0.1:1111');
        const latest = linked('latest', 'http://127.0.0.1:3333');
        const confirm = vi.fn(() => true);
        const binding = bindHyperLink(target, [first, latest], allocator(), 'latest', confirm);
        expect(confirm).toHaveBeenCalledWith(latest);
        expect(binding.connection).toBe(latest);
        expect(binding.params).toEqual({ hyper: { protocol: 'V3_HTTP_LINK', endpoint: target.endpoint, tls: TLS } });
    });

    it('creates another connection if the user declines, or if there is none', () => {
        const allocate = allocator();
        const declined = bindHyperLink(target, [linked('first', 'http://127.0.0.1:1111')], allocate, null, () => false);
        expect(declined.connection.connectionId).toBe('allocated');
        expect(declined.connection.active).toBe(true);
        expect(declined.params).toBeNull();
        const confirm = vi.fn(() => true);
        runtime.destroy();
        runtime = testRuntime(dql);
        const created = bindHyperLink(target, [embedded()], allocator(), null, confirm);
        expect(isHyperLinkParams(created.connection.params)).toBe(true);
        expect(JSON.stringify(created.connection.params)).not.toContain(target.token);
        expect(confirm).not.toHaveBeenCalled();
    });
});
