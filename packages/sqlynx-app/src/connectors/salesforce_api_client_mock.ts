import { PKCEChallenge } from '../utils/pkce.js';
import { sleep } from '../utils/sleep.js';
import { QueryExecutionResponseStream } from './query_execution.js';
import {
    SalesforceAPIClientInterface,
    SalesforceCoreAccessToken,
    SalesforceDataCloudAccessToken,
    SalesforceMetadata,
    SalesforceUserInfo,
} from './salesforce_api_client.js';
import { QueryExecutorMock } from './query_execution_mock.js';
import { SalesforceAuthConfig, SalesforceAuthParams } from './connector_configs.js';

export interface SalesforceConnectorMockConfig {
    enabled: boolean;
    pkceChallenge: PKCEChallenge;
    coreAccess: SalesforceCoreAccessToken;
    coreUserInfo: SalesforceUserInfo;
    dataCloudAccess: SalesforceDataCloudAccessToken;
    dataCloudMetadata: SalesforceMetadata;
}

export class SalesforceAPIClientMock implements SalesforceAPIClientInterface {
    constructor(protected mock: SalesforceConnectorMockConfig) { }

    public async getCoreAccessToken(
        _authConfig: SalesforceAuthConfig,
        _authParams: SalesforceAuthParams,
        _authCode: string,
        _pkceVerifier: string,
        _cancel: AbortSignal,
    ): Promise<SalesforceCoreAccessToken> {
        await sleep(200);
        return this.mock.coreAccess;
    }

    async getCoreUserInfo(_access: SalesforceCoreAccessToken, _cancel: AbortSignal): Promise<SalesforceUserInfo> {
        await sleep(200);
        return this.mock.coreUserInfo;
    }

    public async getDataCloudAccessToken(
        _access: SalesforceCoreAccessToken,
        _cancel: AbortSignal,
    ): Promise<SalesforceDataCloudAccessToken> {
        await sleep(200);
        const expiresAt = new Date();
        expiresAt.setSeconds(expiresAt.getSeconds() + 7200);
        return this.mock.dataCloudAccess;
    }

    public async getDataCloudMetadata(
        _access: SalesforceDataCloudAccessToken,
        _cancel: AbortSignal,
    ): Promise<SalesforceMetadata> {
        console.log('mock(getDataCloudMetadata)');
        await sleep(200);
        return this.mock.dataCloudMetadata;
    }

    public executeQuery(
        _scriptText: string,
        _accessToken: SalesforceDataCloudAccessToken,
    ): QueryExecutionResponseStream {
        return new QueryExecutorMock();
    }
}
