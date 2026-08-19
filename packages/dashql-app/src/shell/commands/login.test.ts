// @vitest-environment node
import {
    createLoginCommand,
    type SalesforceLoginAuthentication,
    type SalesforceLoginCatalog,
    type SalesforceLoginCommandDependencies,
    type SalesforceLoginCommandContext,
} from './login.js';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

function createDependencies(overrides: Partial<SalesforceLoginCommandDependencies> = {}) {
    const authentication: SalesforceLoginAuthentication = {
        coreAccessToken: { createdAt: '', accessToken: 'core-token' } as connection.SalesforceCoreAccessToken,
        dataCloudAccessToken: {
            jwt: { raw: 'data-cloud-token', header: {}, payload: {} },
        } as connection.SalesforceDataCloudAccessToken,
    };
    const catalog: SalesforceLoginCatalog = {
        tableCount: 2,
        columnCount: 5,
        tables: [],
        functionsSQL: 'functions',
    };
    const dependencies: SalesforceLoginCommandDependencies = {
        requestForm: vi.fn().mockResolvedValue({
            alias: 'salesforce',
            instanceUrl: 'https://example.my.salesforce.com',
            appConsumerKey: 'consumer-key',
            loginHint: '',
        }),
        hasAlias: vi.fn().mockReturnValue(false),
        authenticate: vi.fn().mockResolvedValue(authentication),
        resolveCatalog: vi.fn().mockResolvedValue(catalog),
        attach: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
    return { dependencies, authentication, catalog };
}

function execute(dependencies: SalesforceLoginCommandDependencies, context: SalesforceLoginCommandContext = {}) {
    return createLoginCommand(dependencies)[2]([], context);
}

describe('Salesforce login command', () => {
    it('rejects arguments with usage before opening the form', async () => {
        const { dependencies } = createDependencies();
        await expect(createLoginCommand(dependencies)[2](['unexpected'], {})).rejects.toThrow('usage: .login');
        expect(dependencies.requestForm).not.toHaveBeenCalled();
    });

    it('returns no text when the form is cancelled', async () => {
        const { dependencies } = createDependencies({ requestForm: vi.fn().mockResolvedValue(null) });
        await expect(execute(dependencies)).resolves.toBeUndefined();
        expect(dependencies.authenticate).not.toHaveBeenCalled();
    });

    it('rejects duplicate aliases case-insensitively before authentication', async () => {
        const { dependencies } = createDependencies({
            requestForm: vi.fn().mockResolvedValue({
                alias: 'SaLeSfOrCe',
                instanceUrl: 'https://example.my.salesforce.com',
                appConsumerKey: 'consumer-key',
                loginHint: '',
            }),
            hasAlias: vi.fn(alias => alias.toLowerCase() === 'salesforce'),
        });
        await expect(execute(dependencies)).rejects.toThrow('Salesforce alias already exists: SaLeSfOrCe');
        expect(dependencies.authenticate).not.toHaveBeenCalled();
    });

    it('authenticates, resolves the optimized catalog, attaches, and reports counts', async () => {
        const { dependencies, authentication, catalog } = createDependencies();
        const onProgress = vi.fn();
        await expect(execute(dependencies, { onProgress })).resolves.toBe(
            'Attached Salesforce as salesforce: 2 tables, 5 columns',
        );
        expect(dependencies.authenticate).toHaveBeenCalledWith(
            {
                alias: 'salesforce',
                instanceUrl: 'https://example.my.salesforce.com',
                appConsumerKey: 'consumer-key',
                loginHint: '',
            },
            undefined,
            onProgress,
        );
        expect(dependencies.resolveCatalog).toHaveBeenCalledWith(authentication, undefined, onProgress);
        expect(dependencies.attach).toHaveBeenCalledWith(
            'salesforce',
            authentication,
            catalog,
            undefined,
            onProgress,
        );
        expect(onProgress).toHaveBeenNthCalledWith(1, 'Authenticating with Salesforce');
        expect(onProgress).toHaveBeenNthCalledWith(2, 'Resolving optimized Salesforce catalog');
        expect(onProgress).toHaveBeenNthCalledWith(3, 'Attaching Salesforce connection as salesforce');
    });

    it('returns no text when authentication is aborted', async () => {
        const abort = new AbortController();
        const { dependencies } = createDependencies({
            authenticate: vi.fn(async () => {
                abort.abort();
                abort.signal.throwIfAborted();
                throw new Error('unreachable');
            }),
        });
        await expect(execute(dependencies, { signal: abort.signal })).resolves.toBeUndefined();
        expect(dependencies.resolveCatalog).not.toHaveBeenCalled();
    });

    it('restarts the login flow after a handled error', async () => {
        const firstForm = {
            alias: 'salesforce',
            instanceUrl: 'https://example.my.salesforce.com',
            appConsumerKey: 'consumer-key',
            loginHint: '',
        };
        const secondForm = { ...firstForm };
        const requestForm = vi.fn()
            .mockResolvedValueOnce(firstForm)
            .mockResolvedValueOnce(secondForm);
        const authenticate = vi.fn()
            .mockRejectedValueOnce(new Error('authorization failed'));
        const onError = vi.fn(() => 'retry' as const);
        const { dependencies, authentication } = createDependencies({ requestForm, authenticate, onError });
        authenticate.mockResolvedValueOnce(authentication);

        await expect(execute(dependencies)).resolves.toBe(
            'Attached Salesforce as salesforce: 2 tables, 5 columns',
        );
        expect(requestForm).toHaveBeenCalledTimes(2);
        expect(authenticate).toHaveBeenNthCalledWith(1, firstForm, undefined, undefined);
        expect(authenticate).toHaveBeenNthCalledWith(2, secondForm, undefined, undefined);
        expect(onError).toHaveBeenCalledOnce();
        expect(dependencies.attach).toHaveBeenCalledOnce();
    });
});
