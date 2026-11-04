import { describe, expect, it } from 'vitest';

import { connectionParamsLabel } from './connection_label.js';
import type { ConnectionParams } from './connection_params.js';

describe('connectionParamsLabel', () => {
    const label = (params: object) => connectionParamsLabel(params as ConnectionParams);

    it('names the embedded Hyper', () => {
        expect(label({ hyper: {} })).toBe('Hyper Wasm');
        expect(label({ hyper: { protocol: 'WASM', endpoint: 'ignored' } })).toBe('Hyper Wasm');
    });

    it('names the endpoint of a remote Hyper', () => {
        expect(label({ hyper: { protocol: 'V3_HTTP', endpoint: 'http://localhost:7484' } })).toBe('Hyper / http://localhost:7484');
        expect(label({ hyper: { protocol: 'V3_GRPC' } })).toBe('Hyper / ');
    });

    it('names the location of the other connectors', () => {
        expect(label({ trino: { endpoint: 'https://trino.example' } })).toBe('Trino / https://trino.example');
        expect(label({ trino: {} })).toBe('Trino / ');
        expect(label({ salesforce: { instanceUrl: 'https://sf.example' } })).toBe('Salesforce Data Cloud / https://sf.example');
        expect(label({ salesforce: {} })).toBe('Salesforce Data Cloud / ');
        expect(label({ sidb: { instanceUrl: 'https://sidb.example' } })).toBe('SIDB / https://sidb.example');
        expect(label({ sidb: {} })).toBe('SIDB / ');
    });

    it('falls back to a generic name', () => {
        expect(label({})).toBe('Connection');
    });
});
