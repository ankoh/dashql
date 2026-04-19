import * as React from 'react';
import * as style from './connection_settings.module.css';

import { ConnectionInlineHeader } from './connection_inline_header.js';
import { CONNECTOR_INFOS, ConnectorType, requiresSwitchingToNative } from '../../connection/connector_info.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useAnyConnectionNotebook } from './connection_notebook.js';
import { DemoDatabaseChannel } from '../../connection/demo/demo_database_channel.js';
import { setupDemoConnection } from '../../connection/demo/demo_connection_setup.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { RESET_CONNECTION } from '../../connection/connection_state.js';

interface Props {
    sessionId: string | null;
    onClose?: () => void;
}

export const DemoConnectorSettings: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const connectorInfo = CONNECTOR_INFOS[ConnectorType.DEMO];
    const wrongPlatform = requiresSwitchingToNative(connectorInfo);
    const [connectionState, modifyConnection] = useConnectionState(props.sessionId);
    const connectionNotebook = useAnyConnectionNotebook(props.sessionId);

    const abortCtrl = React.useRef<AbortController | null>(null);

    const setupConnection = async () => {
        abortCtrl.current?.abort();
        abortCtrl.current = new AbortController();

        const channel = new DemoDatabaseChannel();
        await setupDemoConnection(modifyConnection, logger, channel, abortCtrl.current.signal);

        // XXX If default & successful, replace default connection
    };
    const cancelSetup = async () => {
        abortCtrl.current?.abort;
    };
    const resetSetup = () => {
        abortCtrl.current?.abort;
        modifyConnection({
            type: RESET_CONNECTION,
            value: null
        });
    };

    return (
        <div className={style.layout}>
            <ConnectionInlineHeader
                connector={connectorInfo}
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
