import { HyperResultStream, HyperServiceClient } from './hyper_service_client.js';
import { QueryExecutionResponseStream } from './query_execution.js';
import { SalesforceDataCloudAccessToken } from './salesforce_api_client.js';

export function executeQuery(
    scriptText: string,
    accessToken: SalesforceDataCloudAccessToken,
): QueryExecutionResponseStream {
    console.log(accessToken.instanceUrl.toString());
    const client = new HyperServiceClient(accessToken.instanceUrl.toString());
    const iterable = client.executeQuery(scriptText, accessToken.accessToken);
    return new HyperResultStream(iterable[Symbol.asyncIterator]());
}
