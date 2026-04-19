import * as React from 'react';

import symbols from '@ankoh/dashql-svg-symbols';
import * as styles from './connector_type_picker.module.css';

import { Button, ButtonVariant } from './foundations/button.js';
import { ConnectorType, CONNECTOR_INFOS } from '../connection/connector_info.js';
import { PlatformType, usePlatformType } from '../platform/platform_type.js';

interface Props {
    onConnectorSelected: (connector: ConnectorType) => void;
    onCancel: () => void;
}

export const ConnectorTypePicker: React.FC<Props> = (props: Props) => {
    const platformType = usePlatformType();

    // Filter connectors based on platform
    const availableConnectors = React.useMemo(() => {
        const isNative = platformType === PlatformType.MACOS;
        return CONNECTOR_INFOS.filter(info => {
            // Filter based on platform support
            if (isNative) {
                return info.platforms.native;
            } else {
                return info.platforms.browser;
            }
        }).filter(info => {
            // Only show connectors that can be manually set up
            // DEMO is not manually creatable, DATALESS is always present
            return info.features.manualSetup;
        });
    }, [platformType]);

    const handleConnectorClick = React.useCallback((connectorType: ConnectorType) => {
        props.onConnectorSelected(connectorType);
    }, [props]);

    return (
        <div className={styles.overlay} onClick={props.onCancel}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modal_header}>
                    <h2 className={styles.modal_title}>Create New Session</h2>
                </div>
                <div className={styles.modal_content}>
                    <p className={styles.modal_description}>
                        Select a connector type for your new session:
                    </p>
                    <div className={styles.connector_grid}>
                        {availableConnectors.map((info) => (
                            <button
                                key={info.connectorType}
                                className={styles.connector_card}
                                onClick={() => handleConnectorClick(info.connectorType)}
                            >
                                <div className={styles.connector_card_icon}>
                                    <svg width="32px" height="32px">
                                        <use xlinkHref={`${symbols}#${info.icons.colored}`} />
                                    </svg>
                                </div>
                                <div className={styles.connector_card_content}>
                                    <div className={styles.connector_card_title}>
                                        {info.names.displayLong}
                                    </div>
                                    <div className={styles.connector_card_description}>
                                        {getConnectorDescription(info.connectorType)}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
                <div className={styles.modal_footer}>
                    <Button
                        variant={ButtonVariant.Default}
                        onClick={props.onCancel}
                    >
                        Cancel
                    </Button>
                </div>
            </div>
        </div>
    );
};

function getConnectorDescription(type: ConnectorType): string {
    switch (type) {
        case ConnectorType.DATALESS:
            return 'Schema-only mode for designing queries without data';
        case ConnectorType.DEMO:
            return 'Pre-loaded example data for exploration';
        case ConnectorType.HYPER:
            return 'Connect to Tableau Hyper databases';
        case ConnectorType.SALESFORCE_DATA_CLOUD:
            return 'Connect to Salesforce Data Cloud';
        case ConnectorType.TRINO:
            return 'Connect to Trino query engine';
        default:
            return '';
    }
}
