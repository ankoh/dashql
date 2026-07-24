import { describe, it, expect } from 'vitest';
import { sanitizeConnectionParamsForSharing, ConnectionParams } from './connection_params.js';

describe('sanitizeConnectionParamsForSharing', () => {
    it('strips the salesforce consumer secret but keeps the identity and login hint', () => {
        const params: ConnectionParams = {
            salesforce: {
                hyperProtocol: 'V3_HTTP',
                instanceUrl: 'https://example.my.salesforce.com',
                appConsumerKey: 'consumer-key',
                appConsumerSecret: 'super-secret',
                login: 'user@example.com',
            },
        };
        const sanitized = sanitizeConnectionParamsForSharing(params) as any;
        expect(sanitized.salesforce.appConsumerSecret).toBe('');
        expect(sanitized.salesforce.appConsumerKey).toBe('consumer-key');
        expect(sanitized.salesforce.instanceUrl).toBe('https://example.my.salesforce.com');
        expect(sanitized.salesforce.login).toBe('user@example.com');
        // The original must not be mutated.
        expect(params.salesforce!.appConsumerSecret).toBe('super-secret');
    });

    it('strips the trino basic-auth secret but keeps the username', () => {
        const params: ConnectionParams = {
            trino: {
                endpoint: 'https://trino.example.com',
                catalogName: 'tpch',
                auth: { authType: 'AUTH_BASIC', basic: { username: 'alice', secret: 'password' } },
            },
        };
        const sanitized = sanitizeConnectionParamsForSharing(params) as any;
        expect(sanitized.trino.auth.basic.secret).toBe('');
        expect(sanitized.trino.auth.basic.username).toBe('alice');
        expect(sanitized.trino.endpoint).toBe('https://trino.example.com');
        expect(params.trino!.auth.basic!.secret).toBe('password');
    });

    it('clears hyper TLS file paths but keeps the endpoint and protocol', () => {
        const params: ConnectionParams = {
            hyper: {
                protocol: 'V3_HTTP',
                endpoint: 'https://hyper.example.com',
                tls: { clientKeyPath: '/k', clientCertPath: '/c', caCertsPath: '/ca' },
            },
        };
        const sanitized = sanitizeConnectionParamsForSharing(params) as any;
        expect(sanitized.hyper.tls.clientKeyPath).toBe('');
        expect(sanitized.hyper.tls.clientCertPath).toBe('');
        expect(sanitized.hyper.tls.caCertsPath).toBe('');
        expect(sanitized.hyper.endpoint).toBe('https://hyper.example.com');
    });

    it('leaves dataless params untouched', () => {
        const params: ConnectionParams = { dataless: { demoConnector: true } as any };
        const sanitized = sanitizeConnectionParamsForSharing(params) as any;
        expect(sanitized.dataless.demoConnector).toBe(true);
    });
});
