import * as React from 'react';

import * as styles from './connection_settings_page.module.css';
import icons from '@ankoh/dashql-svg-symbols';
import { motion, AnimatePresence } from 'framer-motion';

import { CONNECTOR_INFOS, ConnectorType } from '../../connection/connector_info.js';
import { DemoConnectorSettings } from './demo_connection_settings.js';
import { HyperConnectorSettings } from './hyper_connection_settings.js';
import { Identicon } from '../../view/foundations/identicon.js';
import { SalesforceConnectorSettings } from './salesforce_connection_settings.js';
import { DatalessConnectorSettings } from './dataless_connection_settings.js';
import { TrinoConnectorSettings } from './trino_connection_settings.js';
import { classNames } from '../../utils/classnames.js';
import { useConnectionRegistry, useConnectionState, useConnectionStateAllocator } from '../../connection/connection_registry.js';
import { CONNECTION_PATH, useRouteContext, useRouterNavigate } from '../../router.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { createConnectionStateFromParams, createDefaultConnectionParamsForConnector } from '../../connection/connection_params.js';
import { useDashQLCoreSetup } from '../../core_provider.js';
import { useNotebookRegistry } from '../../notebook/notebook_state_registry.js';

const LOG_CTX = 'connection_page';

interface ConnectionGroupEntryProps {
    sessionId: string;
    selected: boolean;
}

function ConnectionGroupEntry(props: ConnectionGroupEntryProps): React.ReactElement {
    const navigate = useRouterNavigate();
    // Get the connection state
    const [connState, _dispatchConnState] = useConnectionState(props.sessionId);
    // Compute the connection signature
    const connSig = connState?.connectionSignature.hash.asPrng();

    return (
        <button
            className={classNames(styles.connection_group_entry, {
                [styles.selected]: props.selected
            })}
            onClick={connState != null
                ? () => navigate({
                    type: CONNECTION_PATH,
                    value: props.sessionId
                })
                : undefined
            }
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
    selected: [ConnectorType, string] | null;
}

function ConnectionGroup(props: ConnectionGroupProps): React.ReactElement {
    const coreSetup = useDashQLCoreSetup();
    const navigate = useRouterNavigate();
    const registry = useConnectionRegistry()[0];
    const allocateConnection = useConnectionStateAllocator();

    // Is the group selected?
    const isSelected = props.selected != null && props.selected[0] == props.connector;
    // Resolve the connector info
    const connector = CONNECTOR_INFOS[props.connector as number];
    // Collect non-default connections
    const conns: string[] = registry.connectionsByType[props.connector];

    // We create a new connection whenever someone clicks the connection group
    const selectConnectionGroup = React.useCallback(async () => {
        // Wait for core
        const core = await coreSetup("connection_settings");
        // Create the default parameters
        const defaultParams = createDefaultConnectionParamsForConnector(connector);
        // Construct a connection state from the params
        const stateWithoutId = createConnectionStateFromParams(core, defaultParams, registry.connectionsBySignature);
        // Otherwise we allocate a new one
        const allocatedState = allocateConnection(stateWithoutId);
        // Switch to this new state
        navigate({
            type: CONNECTION_PATH,
            value: allocatedState.sessionId
        })
    }, [conns]);
    return (
        <div
            key={props.connector as number}
            className={styles.connector_group}
        >
            <div
                className={classNames(styles.connector_group_head, {
                    [styles.selected]: false
                })}
                data-tab={props.connector as number}
            >
                <button
                    className={styles.connector_group_button}
                    onClick={selectConnectionGroup}
                >
                    <svg className={styles.connector_icon} width="18px" height="16px">
                        <use xlinkHref={`${icons}#${connector.icons.uncolored}`} style={{ display: isSelected ? 'block' : 'none' }} />
                        <use xlinkHref={`${icons}#${connector.icons.outlines}`} style={{ display: isSelected ? 'none' : 'block' }} />
                    </svg>
                    <div className={styles.connector_name}>{connector.names.displayShort}</div>
                </button>
            </div>
            {conns.length > 0 && (
                <div className={styles.connection_group_entries}>
                    {conns.map(sid => (
                        <ConnectionGroupEntry
                            key={sid}
                            sessionId={sid}
                            selected={props.selected != null && props.selected[1] == sid}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

interface PageProps { }

export const ConnectionSettingsPage: React.FC<PageProps> = (_props: PageProps) => {
    const navigate = useRouterNavigate();
    const route = useRouteContext();
    const logger = useLogger();
    const [conn, _modifyConn] = useConnectionState(route.sessionId ?? null);
    const [connReg, _setConnReg] = useConnectionRegistry();
    let connType = conn?.connectorInfo.connectorType ?? ConnectorType.DATALESS;

    // Tried to navigate to "/", navigate to the correct page
    React.useEffect(() => {
        // Do we have a session id?
        // Then there's nothing to fix.
        if (route.sessionId !== null) {
            return;
        }
        // Otherwise we navigate to the dataless connector
        if (connReg.connectionsByType[ConnectorType.DATALESS].length > 0) {
            logger.info("redirecting to dataless connection", {}, LOG_CTX);
            navigate({
                type: CONNECTION_PATH,
                value: connReg.connectionsByType[ConnectorType.DATALESS].values().next().value!
            });
        }
    }, [route.sessionId]);


    // Render the setttings page
    let settings: React.ReactElement | null = null;
    if (conn?.sessionId !== undefined) {
        switch (connType) {
            case ConnectorType.TRINO:
                settings = <TrinoConnectorSettings sessionId={conn.sessionId} />;
                break;
            case ConnectorType.SALESFORCE_DATA_CLOUD:
                settings = <SalesforceConnectorSettings sessionId={conn.sessionId} />;
                break;
            case ConnectorType.HYPER:
                settings = <HyperConnectorSettings sessionId={conn.sessionId} />;
                break;
            case ConnectorType.DATALESS:
                settings = <DatalessConnectorSettings sessionId={conn.sessionId} />;
                break;
            case ConnectorType.DEMO:
                settings = <DemoConnectorSettings sessionId={conn.sessionId} />;
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
                        {[ConnectorType.SALESFORCE_DATA_CLOUD, ConnectorType.HYPER, ConnectorType.TRINO]
                            .map(t => <ConnectionGroup key={t as number} connector={t} selected={conn == null ? null : [connType, conn.sessionId]} />)}
                    </div>
                    <div className={styles.connection_section}>
                        {[ConnectorType.DATALESS, ConnectorType.DEMO]
                            .map(t => <ConnectionGroup key={t as number} connector={t} selected={conn == null ? null : [connType, conn.sessionId]} />)}
                    </div>
                </div>
                <div className={styles.connection_settings_scroller}>
                    <div className={styles.connection_settings_container}>
                        <AnimatePresence mode="wait">
                            {settings != null && (
                                <motion.div
                                    key={conn?.sessionId}
                                    className={styles.connection_settings_card}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    transition={{
                                        duration: 0.1,
                                        ease: [0.33, 1, 0.68, 1]
                                    }}
                                >
                                    {settings}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </div >
    );
};

