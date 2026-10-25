import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as dashql from '@ankoh/dashql-core';

import type { ConnectionState, ConnectionStateWithoutId } from '../connections/connection_state.js';
import { createConnectionStateFromParams, createDefaultHyperWasmConnectionState } from '../connections/connection_params.js';
import {
    bindHyperLink,
    confirmHyperLink,
    createHyperLinkConnectionParams,
    hyperLinkChannelParams,
    isHyperLinkParams,
    parseHyperLinkTarget,
    readHyperLinkTabState,
} from './hyper_link.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: dashql.DashQL;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => {
    dql.resetUnsafe();
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
        }) as unknown as Storage;
        expect(readHyperLinkTabState(storage(JSON.stringify({ tokens: { a: 'secret', b: 1 }, current: 'a' }))))
            .toEqual({ tokens: { a: 'secret' }, current: 'a' });
        expect(readHyperLinkTabState(storage('not json'))).toEqual({ tokens: {}, current: null });
        expect(readHyperLinkTabState(storage(null, true))).toEqual({ tokens: {}, current: null });
        expect(readHyperLinkTabState(null)).toEqual({ tokens: {}, current: null });
    });
});

describe('binding a Hyper link', () => {
    const target = { endpoint: 'http://127.0.0.1:2222', token: 'second' };
    const linked = (connectionId: string, endpoint: string): ConnectionState =>
        ({ ...createConnectionStateFromParams(dql, createHyperLinkConnectionParams(endpoint)), connectionId });
    const embedded = (): ConnectionState => ({ ...createDefaultHyperWasmConnectionState(dql), connectionId: 'embedded' });
    const allocator = () => vi.fn((state: ConnectionStateWithoutId): ConnectionState => ({ ...state, connectionId: 'allocated' }));

    it('reuses the connection to the endpoint of the link without asking', () => {
        const same = linked('same', target.endpoint);
        const confirm = vi.fn(() => true);
        const binding = bindHyperLink(target, [embedded(), linked('other', 'http://127.0.0.1:1111'), same], allocator(), dql, 'other', confirm);
        expect(binding).toEqual({ connection: same, params: null });
        expect(confirm).not.toHaveBeenCalled();
    });

    it('moves the connection of the latest link to the endpoint of the link if the user reuses it', () => {
        const first = linked('first', 'http://127.0.0.1:1111');
        const latest = linked('latest', 'http://127.0.0.1:3333');
        const confirm = vi.fn(() => true);
        const binding = bindHyperLink(target, [first, latest], allocator(), dql, 'latest', confirm);
        expect(confirm).toHaveBeenCalledWith(latest);
        expect(binding.connection).toBe(latest);
        expect(binding.params).toEqual({ hyper: { protocol: 'V3_HTTP_LINK', endpoint: target.endpoint, tls: TLS } });
    });

    it('creates another connection if the user declines, or if there is none', () => {
        const allocate = allocator();
        const declined = bindHyperLink(target, [linked('first', 'http://127.0.0.1:1111')], allocate, dql, null, () => false);
        expect(declined.connection.connectionId).toBe('allocated');
        expect(declined.connection.active).toBe(true);
        expect(declined.params).toBeNull();
        const confirm = vi.fn(() => true);
        const created = bindHyperLink(target, [embedded()], allocate, dql, null, confirm);
        expect(isHyperLinkParams(created.connection.params)).toBe(true);
        expect(JSON.stringify(created.connection.params)).not.toContain(target.token);
        expect(confirm).not.toHaveBeenCalled();
    });
});
