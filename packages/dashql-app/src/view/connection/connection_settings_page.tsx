import * as React from 'react';
import { useNavigate } from 'react-router-dom';

import * as styles from './connection_settings_page.module.css';
import * as icons from '../../../static/svg/symbols.generated.svg';

import { CONNECTOR_INFOS, ConnectorType } from '../../connection/connector_info.js';
import { DemoConnectorSettings } from './demo_connection_settings.js';
import { HyperGrpcConnectorSettings } from './hyper_connection_settings.js';
import { Identicon } from '../../view/foundations/identicon.js';
import { SalesforceConnectorSettings } from './salesforce_connection_settings.js';
import { ServerlessConnectorSettings } from './serverless_connection_settings.js';
import { TrinoConnectorSettings } from './trino_connection_settings.js';
import { classNames } from '../../utils/classnames.js';
import { useConnectionRegistry, useConnectionState } from '../../connection/connection_registry.js';
import { useDefaultConnections } from '../../connection/default_connections.js';
import { useRouteContext } from '../../router.js';

interface ConnectionGroupEntryProps {
    connectionId: number;
    selected: boolean;
}

function ConnectionGroupEntry(props: ConnectionGroupEntryProps): React.ReactElement {
    const navigate = useNavigate();
    const route = useRouteContext();
    // Get the connection state
    const [connState, _dispatchConnState] = useConnectionState(props.connectionId);
    // Compute the connection signature
    const connSig = connState?.connectionSignature.hash.asPrng();

    return (
        <button
            className={classNames(styles.connection_group_entry, {
                [styles.connection_group_entry_active]: props.selected
            })}
            onClick={connState != null ? () => navigate(`/connection`, { state: { ...route, connectionId: props.connectionId } }) : undefined}
        >
            <div className={styles.connection_group_entry_icon_container}>
                <Identicon
                    className={styles.connection_group_entry_icon}
                    width={24}
                    height={24}
                    layers={[
                        connSig?.next() ?? 0,
                        connSig?.next() ?? 0
                    ]}
                />
            </div>
            <div className={styles.connection_group_entry_label}>
                {connState?.connectionSignature.signatureString}
            </div>
        </button>
    );
}

interface ConnectionGroupProps {
    connector: ConnectorType;
    selected: [ConnectorType, number] | null;
}

function ConnectionGroup(props: ConnectionGroupProps): React.ReactElement {
    const navigate = useNavigate();
    const route = useRouteContext();
    // Is the group connected?
    const groupSelected = props.selected != null && props.selected[0] == props.connector;
    // Resolve the connector info
    const info = CONNECTOR_INFOS[props.connector as number];
    // Resolve the default connections
    const defaultConnections = useDefaultConnections();
    const defaultConnId = defaultConnections.length > 0 ? defaultConnections[props.connector] : null;
    const defaultConnSelected = props.selected != null && defaultConnId == props.selected[1];

    // Collect non-default connections
    let nonDefaultConns: number[] = [];
    const [connReg, _] = useConnectionRegistry();
    for (let cid of connReg.connectionsByType[props.connector]) {
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
                    [styles.connector_group_active]: defaultConnSelected
                })}
                data-tab={props.connector as number}
            >
                <button
                    className={styles.connector_group_button}
                    onClick={defaultConnId != null ? () => navigate(`/connection`, { state: { ...route, connectionId: defaultConnId } }) : undefined}
                >
                    <svg className={styles.connector_icon} width="18px" height="16px">
                        <use xlinkHref={`${icons}#${groupSelected ? info.icons.uncolored : info.icons.outlines}`} />
                    </svg>
                    <div className={styles.connector_name}>{info.names.displayShort}</div>
                </button>
            </div>
            {nonDefaultConns.length > 0 && (
                <div className={styles.connection_group_entries}>
                    {nonDefaultConns.map(cid => (
                        <ConnectionGroupEntry
                            key={cid}
                            connectionId={cid}
                            selected={props.selected != null && props.selected[1] == cid}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

interface PageProps { }

export const ConnectionSettingsPage: React.FC<PageProps> = (_props: PageProps) => {
    const navigate = useNavigate();
    const route = useRouteContext();
    const defaultConns = useDefaultConnections();
    const [conn, _modifyConn] = useConnectionState(route.connectionId ?? null);
    let connType = conn?.connectorInfo.connectorType ?? ConnectorType.SERVERLESS;

    // Tried to navigate to "/", navigate to the correct page
    React.useEffect(() => {
        // If the connection parameter is missing, we navigate to the workbook connection
        if (route?.connectionId !== undefined) {
            navigate(`/connection`, {
                state: {
                    ...route,
                    connectionId: route.connectionId,
                    workbookId: route?.workbookId,
                }
            });
            return;
        } else if (defaultConns.length > 0) {
            // Otherwise we navigate to the serverless connector
            navigate(`/connection`, {
                state: {
                    ...route,
                    connectionId: defaultConns[ConnectorType.SERVERLESS],
                    workbookId: null,
                }
            });
        }
    }, [defaultConns]);

    // Render the setttings page
    let settings: React.ReactElement = <div />;
    if (conn?.connectionId !== undefined) {
        switch (connType) {
            case ConnectorType.TRINO:
                settings = <TrinoConnectorSettings connectionId={conn.connectionId} />;
                break;
            case ConnectorType.SALESFORCE_DATA_CLOUD:
                settings = <SalesforceConnectorSettings connectionId={conn.connectionId} />;
                break;
            case ConnectorType.HYPER_GRPC:
                settings = <HyperGrpcConnectorSettings connectionId={conn.connectionId} />;
                break;
            case ConnectorType.SERVERLESS:
                settings = <ServerlessConnectorSettings connectionId={conn.connectionId} />;
                break;
            case ConnectorType.DEMO:
                settings = <DemoConnectorSettings connectionId={conn.connectionId} />;
                break;
        }
    }

    if (conn?.connectionId === undefined) {
        return <div />;
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
                            .map(t => <ConnectionGroup key={t as number} connector={t} selected={[connType, conn.connectionId]} />)}
                    </div>
                    <div className={styles.connection_section}>
                        {[ConnectorType.SERVERLESS, ConnectorType.DEMO]
                            .map(t => <ConnectionGroup key={t as number} connector={t} selected={[connType, conn.connectionId]} />)}
                    </div>
                </div>
                <div className={styles.connection_settings_container}>
                    {settings}
                </div>
            </div>
        </div >
    );
};

