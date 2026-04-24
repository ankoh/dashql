import * as React from 'react';
import * as style from './connection_settings.module.css';

import { ConnectionInlineHeader } from './connection_inline_header.js';
import { CONNECTOR_INFOS, ConnectorType, DATALESS_CONNECTOR, requiresSwitchingToNative } from '../../connection/connector_info.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useAnyConnectionNotebook } from './connection_notebook.js';
import { DemoDatabaseChannel } from '../../connection/dataless/dataless_demo_channel.js';
import { setupDatalessDemoConnection } from '../../connection/dataless/dataless_demo_setup.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { RESET_CONNECTION } from '../../connection/connection_state.js';
import { isDemoMode, DatalessConnectionStateDetails } from '../../connection/dataless/dataless_connection_state.js';

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

    // Check if this is a demo-mode dataless connection
    const demoMode = connectionState?.details.type === DATALESS_CONNECTOR
        ? isDemoMode(connectionState.details.value as DatalessConnectionStateDetails)
        : false;

    const abortCtrl = React.useRef<AbortController | null>(null);

    const setupConnection = demoMode ? async () => {
        abortCtrl.current?.abort();
        abortCtrl.current = new AbortController();

        const channel = new DemoDatabaseChannel();
        await setupDatalessDemoConnection(modifyConnection, logger, channel, abortCtrl.current.signal);
    } : undefined;

    const cancelSetup = demoMode ? async () => {
        abortCtrl.current?.abort;
    } : undefined;

    const resetSetup = demoMode ? () => {
        abortCtrl.current?.abort;
        modifyConnection({
            type: RESET_CONNECTION,
            value: null
        });
    } : undefined;

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
        </div>
    );
}
