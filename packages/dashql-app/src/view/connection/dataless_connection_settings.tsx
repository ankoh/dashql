import * as React from 'react';
import * as style from './connection_settings.module.css';
import * as settingsStyle from './dataless_connection_settings.module.css';

import { ConnectionInlineHeader } from './connection_inline_header.js';
import { CONNECTOR_INFOS, ConnectorType, DATALESS_CONNECTOR, requiresSwitchingToNative } from '../../connection/connector_info.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useAnyConnectionNotebook } from './connection_notebook.js';
import { DemoDatabaseChannel } from '../../connection/dataless/dataless_demo_channel.js';
import { setupDatalessDemoConnection } from '../../connection/dataless/dataless_demo_setup.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { RESET_CONNECTION } from '../../connection/connection_state.js';
import { isDemoConnector, DATALESS_SET_DEMO_MODE, DatalessConnectionStateDetails } from '../../connection/dataless/dataless_connection_state.js';
import { ToggleSwitch } from '../foundations/toggle_switch.js';
import { classNames } from '../../utils/classnames.js';

interface Props {
    sessionId: string | null;
    onClose?: () => void;
}

export const DatalessConnectorSettings: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const connectorInfo = CONNECTOR_INFOS[ConnectorType.DATALESS];
    const wrongPlatform = requiresSwitchingToNative(connectorInfo);
    const [connectionState, modifyConnection] = useConnectionState(props.sessionId);
    const connectionNotebook = useAnyConnectionNotebook(props.sessionId);

    // Extract dataless-specific state
    const details = connectionState?.details.type === DATALESS_CONNECTOR
        ? connectionState.details.value as DatalessConnectionStateDetails
        : null;
    const demoConnector = details ? isDemoConnector(details) : false;

    const abortCtrl = React.useRef<AbortController | null>(null);

    const setupConnection = demoConnector ? async () => {
        abortCtrl.current?.abort();
        abortCtrl.current = new AbortController();

        const channel = new DemoDatabaseChannel();
        await setupDatalessDemoConnection(modifyConnection, logger, channel, abortCtrl.current.signal);
    } : undefined;

    const cancelSetup = demoConnector ? async () => {
        abortCtrl.current?.abort;
    } : undefined;

    const resetSetup = demoConnector ? () => {
        abortCtrl.current?.abort;
        modifyConnection({
            type: RESET_CONNECTION,
            value: null
        });
    } : undefined;

    const toggleDemoMode = React.useCallback(() => {
        modifyConnection({
            type: DATALESS_SET_DEMO_MODE,
            value: !demoConnector,
        });
    }, [modifyConnection, demoConnector]);

    // Use the connection's own connectorInfo (which reflects demo mode) if available
    const displayInfo = connectionState?.connectorInfo ?? connectorInfo;

    return (
        <div className={style.layout}>
            <ConnectionInlineHeader
                connector={displayInfo}
                connection={connectionState}
                wrongPlatform={wrongPlatform}
                setupConnection={setupConnection}
                cancelSetup={cancelSetup}
                resetSetup={resetSetup}
                notebook={connectionNotebook}
                onClose={props.onClose}
            />
            <div className={style.body_container}>
                <div className={style.section}>
                    <div className={classNames(style.section_layout, style.body_section_layout)}>
                        <div className={classNames(settingsStyle.toggle_group, style.grid_column_1_span_2)}>
                            <div className={settingsStyle.toggle_row}>
                                <div className={settingsStyle.toggle_label}>
                                    <div className={settingsStyle.toggle_name}>Demo Connector</div>
                                    <div className={settingsStyle.toggle_caption}>In-memory random data generation</div>
                                </div>
                                <ToggleSwitch
                                    size="medium"
                                    checked={demoConnector}
                                    onClick={toggleDemoMode}
                                    aria-label="Demo connector"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
