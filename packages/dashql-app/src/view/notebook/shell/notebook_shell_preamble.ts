import type { ConnectionState } from '../../../connection/connection_state.js';
import {
    DATALESS_CONNECTOR,
    HYPER_CONNECTOR,
    SALESFORCE_DATA_CLOUD_CONNECTOR,
    TRINO_CONNECTOR,
} from '../../../connection/connector_info.js';
import { getSalesforceDataSpace } from '../../../connection/salesforce/salesforce_api_client.js';

export interface ShellConnectionDetail {
    label: string;
    value: string;
}

export function getShellConnectionDetails(connection: ConnectionState | null): ShellConnectionDetail[] {
    if (connection == null) {
        return [{ label: 'Connection', value: 'Not connected' }];
    }

    const details: ShellConnectionDetail[] = [
        { label: 'Connector', value: connection.connectorInfo.names.displayLong },
    ];
    const add = (label: string, value: string | null | undefined) => {
        if (value != null && value.length > 0) details.push({ label, value });
    };

    switch (connection.details.type) {
        case TRINO_CONNECTOR: {
            const params = connection.details.value.proto.setupParams;
            add('Endpoint', params?.endpoint);
            add('Catalog', params?.catalogName);
            add('Schemas', params?.schemaNames?.join(', '));
            add('Account', params?.auth?.basic?.username);
            break;
        }
        case HYPER_CONNECTOR: {
            const params = connection.details.value.proto.setupParams;
            add('Endpoint', params?.endpoint);
            add('Protocol', params?.protocol?.replace('V3_', ''));
            break;
        }
        case SALESFORCE_DATA_CLOUD_CONNECTOR: {
            const proto = connection.details.value.proto;
            const params = proto.setupParams;
            const accessToken = proto.oauthState?.dataCloudAccessToken;
            add('Instance', params?.instanceUrl);
            add('Account', params?.login);
            add('Organization', accessToken?.jwt?.payload?.orgId);
            if (accessToken?.jwt != null) add('Data space', getSalesforceDataSpace(accessToken));
            break;
        }
        case DATALESS_CONNECTOR:
            if (connection.details.value.proto.setupParams?.demoConnector) {
                add('Mode', 'Demo');
            }
            break;
    }
    return details;
}
