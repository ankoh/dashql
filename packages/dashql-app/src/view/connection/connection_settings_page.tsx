import * as React from 'react';

import * as styles from './connection_settings_page.module.css';
import { motion, AnimatePresence } from 'framer-motion';

import { CONNECTOR_INFOS, ConnectorType } from '../../connection/connector_info.js';
import { DemoConnectorSettings } from './demo_connection_settings.js';
import { HyperConnectorSettings } from './hyper_connection_settings.js';
import { SalesforceConnectorSettings } from './salesforce_connection_settings.js';
import { DatalessConnectorSettings } from './dataless_connection_settings.js';
import { TrinoConnectorSettings } from './trino_connection_settings.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { CHANGE_SESSION, useRouteContext, useRouterNavigate } from '../../router.js';
import { Button, ButtonVariant } from '../foundations/button.js';

const LOG_CTX = 'connection_page';

interface PageProps { }

export const ConnectionSettingsPage: React.FC<PageProps> = (_props: PageProps) => {
    const navigate = useRouterNavigate();
    const route = useRouteContext();
    const [conn, _modifyConn] = useConnectionState(route.sessionId ?? null);
    let connType = conn?.connectorInfo.connectorType ?? ConnectorType.DATALESS;

    const handleChangeSession = React.useCallback(() => {
        navigate({
            type: CHANGE_SESSION,
            value: null
        });
    }, [navigate]);

    // Render the settings page
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
                <div className={styles.header_right_container}>
                    <Button
                        variant={ButtonVariant.Default}
                        onClick={handleChangeSession}
                    >
                        Change Session
                    </Button>
                </div>
            </div>
            <div className={styles.body_container}>
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

