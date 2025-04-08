import * as React from 'react';

import * as styles from './connection_settings_page.module.css';
import * as icons from '../../../static/svg/symbols.generated.svg';

import { CONNECTOR_INFOS, ConnectorType } from '../../connection/connector_info.js';
import { DemoConnectorSettings } from './demo_connection_settings.js';
import { HyperGrpcConnectorSettings } from './hyper_connection_settings.js';
import { SalesforceConnectorSettings } from './salesforce_connection_settings.js';
import { ServerlessConnectorSettings } from './serverless_connection_settings.js';
import { TrinoConnectorSettings } from './trino_connection_settings.js';
import { isDebugBuild } from '../../globals.js';
import { useConnectionRegistry, useConnectionState } from '../../connection/connection_registry.js';
import { useDefaultConnections } from '../../connection/default_connections.js';
import { useCurrentWorkbookState } from '../../workbook/current_workbook.js';
import { classNames } from '../../utils/classnames.js';
import { computeConnectionSignature } from '../../connection/connection_state.js';
import { Cyrb128 } from '../../utils/prng.js';
import { Identicon } from '../../view/foundations/identicon.js';

interface ConnectionGroupEntryProps {
    connectionId: number;
}

function ConnectionGroupEntry(props: ConnectionGroupEntryProps): React.ReactElement {
    // Get the connection state
    const [connState, _dispatchConnState] = useConnectionState(props.connectionId);

    // Compute the connection signature
    const connSig = React.useMemo(() => {
        const seed = new Cyrb128();
        if (connState != null) {
            computeConnectionSignature(connState, seed);
        }
        return seed;
    }, [connState?.details]);

    return (
        <div className={styles.connection_group_entry}>
            <div className={styles.connection_group_entry_name}>
                <Identicon
                    className={styles.connection_group_entry_icon}
                    width={24}
                    height={24}
                    prng={connSig.asSfc32()}
                    layers={2}
                />
            </div>
        </div>
    );
}

interface ConnectionGroupProps {
    connector: ConnectorType;
    selected: [ConnectorType, number] | null;
    select: (conn: [ConnectorType, number] | null) => void;
}

function ConnectionGroup(props: ConnectionGroupProps): React.ReactElement {
    // Is the group connected?
    const groupSelected = props.selected != null && props.selected[0] == props.connector;
    // Resolve the connector info
    const info = CONNECTOR_INFOS[props.connector as number];
    // Resolve the default connections
    const defaultConnections = useDefaultConnections();
    const defaultConnId = defaultConnections.length > 0 ? defaultConnections[props.connector] : null;

    // Collect non-default connections
    let nonDefaultConns: number[] = [];
    const [connReg, _] = useConnectionRegistry();
    for (let cid of connReg.connectionsPerType[props.connector]) {
        if (cid !== defaultConnId) {
            nonDefaultConns.push(cid);
        }
    }

    return (
        <div
            key={props.connector as number}
            className={styles.connector_group}
        >
            <div
                className={classNames(styles.connector_group_head, {
                    [styles.connector_group_active]: groupSelected
                })}
                data-tab={props.connector as number}
            >
                <button
                    className={styles.connector_group_button}
                    onClick={defaultConnId != null ? () => props.select([props.connector, defaultConnId]) : undefined}
                >
                    <svg className={styles.connector_icon} width="18px" height="16px">
                        <use xlinkHref={`${icons}#${groupSelected ? info.icons.uncolored : info.icons.outlines}`} />
                    </svg>
                    <div className={styles.connector_name}>{info.displayName.short}</div>
                </button>
            </div>
            {nonDefaultConns.length > 0 && (
                <div className={styles.connection_group_entries}>
                    {nonDefaultConns.map(i => <ConnectionGroupEntry key={i} connectionId={i} />)}
                </div>
            )}
        </div>
    );
}

interface PageProps { }

export const ConnectionSettingsPage: React.FC<PageProps> = (_props: PageProps) => {
    const [connRegistry, _setConnReg] = useConnectionRegistry();
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
                    <div className={styles.connection_section}>
                        {[ConnectorType.SALESFORCE_DATA_CLOUD, ConnectorType.HYPER_GRPC, ConnectorType.TRINO]
                            .map(t => <ConnectionGroup key={t as number} connector={t} selected={focusedConnection} select={setFocusedConnection} />)}
                    </div>
                    <div className={styles.connection_section}>
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
