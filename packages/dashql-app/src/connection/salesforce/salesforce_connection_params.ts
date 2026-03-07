import * as pb from '../../proto.js';

export function createSalesforceConnectionParamsSignature(params: pb.dashql.connection.SalesforceConnectionParams): any {
    return {
        case: "salesforce",
        instanceUrl: params.instanceUrl,
        appConsumerKey: params.appConsumerKey,
        login: params.login,
    };
}
