import * as React from 'react';

import symbols from '@ankoh/dashql-svg-symbols';
import * as baseStyles from '../banner_page.module.css';
import * as styles from './connection_config_card.module.css';

import { ChevronLeftIcon } from '@primer/octicons-react';
import { Button, IconButton, ButtonVariant } from '../foundations/button.js';
import { ConnectorConfigTabs } from './connector_config_tabs.js';
import { ConnectorType } from '../../connection/connector_info.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { ConnectionHealth } from '../../connection/connection_state.js';
import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { InternalsViewerOverlay } from '../internals/internals_overlay.js';

interface Props {
    sessionId: string;
    onBack: () => void;
    onConnected: (sessionId: string) => void;
    onSkip?: () => void;
    headerTitle?: string;
}

export const ConnectionConfigCard: React.FC<Props> = (props: Props) => {
    const [conn, _modifyConn] = useConnectionState(props.sessionId);
    const [showInternals, setShowInternals] = React.useState<boolean>(false);

    // Default to TRINO or first available connector
    const defaultConnectorType = conn?.connectorInfo.connectorType ?? ConnectorType.TRINO;
    const [selectedConnectorType, setSelectedConnectorType] = React.useState<ConnectorType>(defaultConnectorType);

    // Compute the internals button only once to prevent svg flickering
    const internalsButton = React.useMemo(() => {
        return (
            <IconButton
                variant={ButtonVariant.Invisible}
                aria-label="Show Internals"
                onClick={() => setShowInternals(s => !s)}
            >
                <svg width="16px" height="16px">
                    <use xlinkHref={`${symbols}#processor`} />
                </svg>
            </IconButton>
        );
    }, []);

    // Update selected connector when connection changes
    React.useEffect(() => {
        if (conn) {
            setSelectedConnectorType(conn.connectorInfo.connectorType);
        }
    }, [conn?.connectorInfo.connectorType]);

    // Monitor connection health and auto-navigate when ONLINE
    React.useEffect(() => {
        if (conn?.connectionHealth === ConnectionHealth.ONLINE) {
            props.onConnected(props.sessionId);
        }
    }, [conn?.connectionHealth, props.sessionId, props.onConnected]);

    return (
        <div className={`${baseStyles.card} ${styles.card_wrapper}`}>
            <div className={baseStyles.card_header}>
                <div className={baseStyles.card_header_left_container}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Back to session list"
                        onClick={props.onBack}
                    >
                        <ChevronLeftIcon size={16} />
                    </IconButton>
                    {props.headerTitle ?? "Configure Connection"}
                </div>
                <div className={baseStyles.card_header_right_container}>
                    <InternalsViewerOverlay
                        isOpen={showInternals}
                        onClose={() => setShowInternals(false)}
                        renderAnchor={(p: object) => <div {...p}>{internalsButton}</div>}
                        side={AnchorSide.OutsideBottom}
                        align={AnchorAlignment.End}
                        anchorOffset={16}
                    />
                    {props.onSkip && (
                        <Button variant={ButtonVariant.Invisible} onClick={props.onSkip}>
                            Skip
                        </Button>
                    )}
                </div>
            </div>
            <div className={`${baseStyles.card_section} ${styles.card_body}`}>
                <ConnectorConfigTabs
                    sessionId={props.sessionId}
                    selectedConnectorType={selectedConnectorType}
                    setSelectedConnectorType={setSelectedConnectorType}
                    lockConnectorType={!!props.onSkip}
                />
            </div>
        </div>
    );
};
