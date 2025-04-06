import * as React from 'react';

import { CONNECTOR_INFOS, ConnectorType } from '../../connection/connector_info.js';
import { DemoConnectorSettings } from './demo_connection_settings.js';
import { HyperGrpcConnectorSettings } from './hyper_connection_settings.js';
import { SalesforceConnectorSettings } from './salesforce_connection_settings.js';
import { ServerlessConnectorSettings } from './serverless_connection_settings.js';
import { TrinoConnectorSettings } from './trino_connection_settings.js';
import { isDebugBuild } from '../../globals.js';
import { useConnectionRegistry } from '../../connection/connection_registry.js';
import { useDefaultConnections } from '../../connection/default_connections.js';
import { useCurrentWorkbookState } from '../../workbook/current_workbook.js';
import { classNames } from '../../utils/classnames.js';

import * as styles from './connection_settings_page.module.css';
import * as icons from '../../../static/svg/symbols.generated.svg';

interface ConnectionGroupProps {
    connector: ConnectorType;
    selected: [ConnectorType, number] | null;
    select: (conn: [ConnectorType, number] | null) => void;
}

function ConnectionGroup(props: ConnectionGroupProps): React.ReactElement {
    const info = CONNECTOR_INFOS[props.connector as number];
    const defaultConnections = useDefaultConnections();
    const defaultConnId = defaultConnections != null ? defaultConnections[props.connector] : null;
    const groupSelected = props.selected != null && props.selected[0] == props.connector;
    return (
        <div
            key={props.connector as number}
            className={classNames(styles.connector, {
                [styles.connector_active]: groupSelected
            })}
            data-tab={props.connector as number}
            onClick={console.log}
        >
            <button
                className={styles.connector_button}
                onClick={defaultConnId != null ? () => props.select([props.connector, defaultConnId]) : undefined}
            >
                <svg className={styles.connector_icon} width="18px" height="16px">
                    <use xlinkHref={`${icons}#${groupSelected ? info.icons.uncolored : info.icons.outlines}`} />
                </svg>
                <div className={styles.connector_label}>{info.displayName.short}</div>
            </button>
        </div>
    );
}

interface PageProps { }

export const ConnectionSettingsPage: React.FC<PageProps> = (_props: PageProps) => {
    const connRegistry = useConnectionRegistry();
    const [currentWorkbook, _] = useCurrentWorkbookState();
    const [focusedConnection, setFocusedConnection] = React.useState<[ConnectorType, number] | null>(null);

    React.useEffect(() => {
        // Always try to switch to the current workbook connection
        if (currentWorkbook != null) {
            setFocusedConnection([currentWorkbook.connectorInfo.connectorType, currentWorkbook.connectionId]);
        } else if (focusedConnection == null) {
            // Otherwise pick a fallback connection
            const fallbackType = isDebugBuild() ? ConnectorType.DEMO : ConnectorType.SERVERLESS;
            const defaultConnIds = connRegistry.connectionsPerType[fallbackType];
            if (defaultConnIds.size > 0) {
                const connId = defaultConnIds.values().next().value!;
                setFocusedConnection([fallbackType, connId]);
            }
        }
    }, []);

    // Render the setttings page
    let settings: React.ReactElement = <div />;
    if (focusedConnection != null) {
        const [focusedConnector, focusedConnectionId] = focusedConnection;
        switch (focusedConnector) {
            case ConnectorType.TRINO:
                settings = <TrinoConnectorSettings connectionId={focusedConnectionId} />;
                break;
            case ConnectorType.SALESFORCE_DATA_CLOUD:
                settings = <SalesforceConnectorSettings connectionId={focusedConnectionId} />;
                break;
            case ConnectorType.HYPER_GRPC:
                settings = <HyperGrpcConnectorSettings connectionId={focusedConnectionId} />;
                break;
            case ConnectorType.SERVERLESS:
                settings = <ServerlessConnectorSettings connectionId={focusedConnectionId} />;
                break;
            case ConnectorType.DEMO:
                settings = <DemoConnectorSettings connectionId={focusedConnectionId} />;
                break;
        }
    }

    return (
        <div className={styles.container}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.header_title}>Connection</div>
                </div>
            </div>
            <div className={styles.body_container}>
                <div className={styles.connection_list}>
                    <div className={styles.connector_group}>
                        {[ConnectorType.SALESFORCE_DATA_CLOUD, ConnectorType.HYPER_GRPC, ConnectorType.TRINO]
                            .map(t => <ConnectionGroup key={t as number} connector={t} selected={focusedConnection} select={setFocusedConnection} />)}
                    </div>
                    <div className={styles.connector_group}>
                        {[ConnectorType.SERVERLESS, ConnectorType.DEMO]
                            .map(t => <ConnectionGroup key={t as number} connector={t} selected={focusedConnection} select={setFocusedConnection} />)}
                    </div>
                </div>
                <div className={styles.connection_settings_container}>
                    {settings}
                </div>
            </div>
        </div >
    );
};
