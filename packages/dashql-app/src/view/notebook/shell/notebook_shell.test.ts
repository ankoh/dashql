import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as core from '../../../core/index.js';
import { analyzeScript } from '../../editor/dashql_processor.js';
import { ConnectionHealth, type ConnectionState } from '../../../connection/connection_state.js';
import {
    CONNECTOR_INFOS,
    ConnectorType,
    SALESFORCE_DATA_CLOUD_CONNECTOR,
    TRINO_CONNECTOR,
} from '../../../connection/connector_info.js';
import { ShellInputState, classifyShellInput, getShellInputError } from './notebook_shell.js';
import { getShellConnectionDetails } from './notebook_shell_preamble.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

describe('Notebook Shell input', () => {
    let dql: core.DashQL;
    let catalog: core.DashQLCatalog;
    let script: core.DashQLScript;

    beforeAll(async () => {
        dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        catalog = dql.createCatalog();
        script = dql.createScript(catalog);
    });

    afterAll(() => {
        script.destroy();
        catalog.destroy();
    });

    function classify(text: string): { state: ShellInputState; error: string | null } {
        script.replaceText(text);
        const buffers = analyzeScript(script);
        try {
            return {
                state: classifyShellInput(text, buffers),
                error: getShellInputError(text, buffers),
            };
        } finally {
            buffers.destroy(buffers);
        }
    }

    function statementText(text: string): string | null {
        script.replaceText(text);
        const buffers = analyzeScript(script);
        try {
            const parsed = buffers.parsed?.read();
            if (parsed == null
                || parsed.scannerErrorsLength() > 0
                || parsed.parserErrorsLength() > 0
                || parsed.statementsLength() !== 1) {
                return null;
            }
            const statement = parsed?.statements(0, new core.buffers.parser.Statement());
            const span = statement?.statementSpan(new core.buffers.parser.TextSpan());
            return span == null ? null : script.toString(span.offset(), span.length());
        } finally {
            buffers.destroy(buffers);
        }
    }

    it('continues incomplete input and executes a terminated statement', () => {
        expect(classify('').state).toBe(ShellInputState.Empty);
        expect(classify('select 1').state).toBe(ShellInputState.Incomplete);
        expect(classify('select\n1;').state).toBe(ShellInputState.Complete);
    });

    it('does not execute semicolons inside strings or comments', () => {
        expect(classify("select ';'").state).toBe(ShellInputState.Incomplete);
        expect(classify('select 1 -- ;').state).toBe(ShellInputState.Incomplete);
        expect(classify("select ';';").state).toBe(ShellInputState.Complete);
    });

    it('rejects multiple statements', () => {
        expect(classify('select 1; select 2;').state).toBe(ShellInputState.Multiple);
    });

    it('surfaces parser errors while typing', () => {
        const result = classify('select (1;');
        expect(result.state).toBe(ShellInputState.Incomplete);
        expect(result.error).not.toBeNull();
    });

    it('handles non-ASCII text without confusing byte spans', () => {
        expect(classify("select 'Grüße';").state).toBe(ShellInputState.Complete);
    });

    it('extracts the single statement span without its terminating semicolon', () => {
        expect(statementText("  select 'Grüße;'; -- ignored after the statement"))
            .toBe("select 'Grüße;'");
        expect(statementText('select 1\n  ;')).toBe('select 1');
    });

    it('does not extract invalid or multiple statements', () => {
        expect(statementText('select (1;')).toBeNull();
        expect(statementText('select 1; select 2;')).toBeNull();
    });
});

describe('Notebook Shell preamble', () => {
    it('lists relevant Trino connection details without credentials', () => {
        const connection = {
            connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO],
            connectionHealth: ConnectionHealth.ONLINE,
            details: {
                type: TRINO_CONNECTOR,
                value: {
                    proto: {
                        setupParams: {
                            endpoint: 'https://trino.example.com',
                            catalogName: 'analytics',
                            schemaNames: ['public', 'finance'],
                            auth: {
                                authType: 'AUTH_BASIC',
                                basic: { username: 'analyst', secret: 'hidden' },
                            },
                        },
                    },
                },
            },
        } as unknown as ConnectionState;

        expect(getShellConnectionDetails(connection)).toEqual([
            { label: 'Connector', value: 'Trino' },
            { label: 'Endpoint', value: 'https://trino.example.com' },
            { label: 'Catalog', value: 'analytics' },
            { label: 'Schemas', value: 'public, finance' },
            { label: 'Account', value: 'analyst' },
        ]);
        expect(JSON.stringify(getShellConnectionDetails(connection))).not.toContain('hidden');
    });

    it('lists resolved Salesforce connection identity', () => {
        const connection = {
            connectorInfo: CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD],
            connectionHealth: ConnectionHealth.ONLINE,
            details: {
                type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                value: {
                    proto: {
                        setupParams: {
                            instanceUrl: 'https://example.my.salesforce.com',
                            login: 'user@example.com',
                        },
                        oauthState: {
                            dataCloudAccessToken: {
                                jwt: {
                                    payload: {
                                        orgId: '00D000000000001',
                                        customAttributes: { dataspace: 'production' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        } as unknown as ConnectionState;

        expect(getShellConnectionDetails(connection)).toEqual([
            { label: 'Connector', value: 'Salesforce Data Cloud' },
            { label: 'Instance', value: 'https://example.my.salesforce.com' },
            { label: 'Account', value: 'user@example.com' },
            { label: 'Organization', value: '00D000000000001' },
            { label: 'Data space', value: 'production' },
        ]);
    });

    it('describes a shell without an active connection', () => {
        expect(getShellConnectionDetails(null)).toEqual([
            { label: 'Connection', value: 'Not connected' },
        ]);
    });
});
