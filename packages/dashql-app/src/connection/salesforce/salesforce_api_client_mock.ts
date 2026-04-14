import * as auth from '@ankoh/dashql-jsonschema/auth.js';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { sleep } from '../../utils/sleep.js';
import { QueryExecutionResponseStream } from '../query_execution_state.js';
import { SalesforceApiClientInterface } from './salesforce_api_client.js';
import { QueryExecutionResponseStreamMock } from '../query_execution_mock.js';

export interface SalesforceConnectorMockConfig {
    enabled: boolean;
    pkceChallenge: auth.OAuthPKCEChallenge;
    coreAccess: connection.SalesforceCoreAccessToken;
    coreUserInfo: connection.SalesforceCoreUserInfo;
    dataCloudAccess: connection.SalesforceDataCloudAccessToken;
    dataCloudMetadata: connection.SalesforceDataCloudMetadata;
}

export class SalesforceAPIClientMock implements SalesforceApiClientInterface {
    constructor(protected mock: SalesforceConnectorMockConfig) { }

    public async getCoreAccessToken(
        _authConfig: connection.SalesforceOAuthConfig,
        _authParams: connection.SalesforceConnectionParams,
        _authCode: string,
        _pkceVerifier: string,
        _cancel: AbortSignal,
    ): Promise<connection.SalesforceCoreAccessToken> {
        await sleep(200);
        return this.mock.coreAccess;
    }

    async getCoreUserInfo(_access: connection.SalesforceCoreAccessToken, _cancel: AbortSignal): Promise<connection.SalesforceCoreUserInfo> {
        await sleep(200);
        return this.mock.coreUserInfo;
    }

    public async getDataCloudAccessToken(
        _access: connection.SalesforceCoreAccessToken,
        _cancel: AbortSignal,
    ): Promise<connection.SalesforceDataCloudAccessToken> {
        await sleep(200);
        const expiresAt = new Date();
        expiresAt.setSeconds(expiresAt.getSeconds() + 7200);
        return this.mock.dataCloudAccess;
    }

    public async getDataCloudMetadata(
        _access: connection.SalesforceDataCloudAccessToken,
        _cancel: AbortSignal,
    ): Promise<connection.SalesforceDataCloudMetadata> {
        console.log('mock(getDataCloudMetadata)');
        await sleep(200);
        return this.mock.dataCloudMetadata;
    }

    public executeQuery(
        _scriptText: string,
        _accessToken: connection.SalesforceDataCloudAccessToken,
    ): QueryExecutionResponseStream {
        return new QueryExecutionResponseStreamMock();
    }
}
