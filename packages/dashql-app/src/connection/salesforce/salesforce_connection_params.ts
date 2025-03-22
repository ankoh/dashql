import * as pb from '@ankoh/dashql-protobuf';

import { WorkbookExportSettings } from '../../workbook/workbook_export_settings.js';

export interface SalesforceConnectionParams {
    /// The foundations URL
    instanceUrl: string;
    /// The client id
    appConsumerKey: string;
    /// The client secret
    appConsumerSecret: string | null;
    /// The login hint (if any)
    login: string | null;
}

export function encodeSalesforceConnectionParamsAsProto(params: SalesforceConnectionParams | null, settings: WorkbookExportSettings | null): pb.dashql.connection.ConnectionParams {
    return new pb.dashql.connection.ConnectionParams({
        connection: {
            case: "salesforce",
            value: new pb.dashql.connection.SalesforceConnectionParams({
                instanceUrl: params?.instanceUrl ?? "",
                appConsumerKey: params?.appConsumerKey ?? "",
                login: settings?.exportUsername ? (params?.login ?? undefined) : undefined,
            })
        }
    });
}

export function readSalesforceConnectionParamsFromProto(params: pb.dashql.connection.SalesforceConnectionParams): SalesforceConnectionParams {
    return {
        instanceUrl: params.instanceUrl,
        appConsumerKey: params.appConsumerKey,
        appConsumerSecret: "",
        login: params.login,
    };
}

export function createSalesforceConnectionParamsSignature(params: SalesforceConnectionParams): any {
    return {
        case: "salesforce",
        instanceUrl: params.instanceUrl,
        appConsumerKey: params.appConsumerKey,
        login: params.login,
    };
}
