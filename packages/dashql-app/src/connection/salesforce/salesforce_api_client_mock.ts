import * as pb from '@ankoh/dashql-protobuf';

import { sleep } from '../../utils/sleep.js';
import { QueryExecutionResponseStream } from '../query_execution_state.js';
import { SalesforceApiClientInterface } from './salesforce_api_client.js';
import { QueryExecutionResponseStreamMock } from '../query_execution_mock.js';

export interface SalesforceConnectorMockConfig {
    enabled: boolean;
    pkceChallenge: pb.dashql.auth.OAuthPKCEChallenge;
    coreAccess: pb.dashql.connection.SalesforceCoreAccessToken;
    coreUserInfo: pb.dashql.connection.SalesforceCoreUserInfo;
    dataCloudAccess: pb.dashql.connection.SalesforceDataCloudAccessToken;
    dataCloudMetadata: pb.dashql.connection.SalesforceDataCloudMetadata;
}

export class SalesforceAPIClientMock implements SalesforceApiClientInterface {
    constructor(protected mock: SalesforceConnectorMockConfig) { }

    public async getCoreAccessToken(
        _authConfig: pb.dashql.connection.SalesforceOAuthConfig,
        _authParams: pb.dashql.connection.SalesforceConnectionParams,
        _authCode: string,
        _pkceVerifier: string,
        _cancel: AbortSignal,
    ): Promise<pb.dashql.connection.SalesforceCoreAccessToken> {
        await sleep(200);
        return this.mock.coreAccess;
    }

    async getCoreUserInfo(_access: pb.dashql.connection.SalesforceCoreAccessToken, _cancel: AbortSignal): Promise<pb.dashql.connection.SalesforceCoreUserInfo> {
        await sleep(200);
        return this.mock.coreUserInfo;
    }

    public async getDataCloudAccessToken(
        _access: pb.dashql.connection.SalesforceCoreAccessToken,
        _cancel: AbortSignal,
    ): Promise<pb.dashql.connection.SalesforceDataCloudAccessToken> {
        await sleep(200);
        const expiresAt = new Date();
        expiresAt.setSeconds(expiresAt.getSeconds() + 7200);
        return this.mock.dataCloudAccess;
    }

    public async getDataCloudMetadata(
        _access: pb.dashql.connection.SalesforceDataCloudAccessToken,
        _cancel: AbortSignal,
    ): Promise<pb.dashql.connection.SalesforceDataCloudMetadata> {
        console.log('mock(getDataCloudMetadata)');
        await sleep(200);
        return this.mock.dataCloudMetadata;
    }

    public executeQuery(
        _scriptText: string,
        _accessToken: pb.dashql.connection.SalesforceDataCloudAccessToken,
    ): QueryExecutionResponseStream {
        return new QueryExecutionResponseStreamMock();
    }
}
