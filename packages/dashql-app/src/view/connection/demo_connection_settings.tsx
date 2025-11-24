import * as React from 'react';
import * as style from './connection_settings.module.css';

import { ConnectionHeader } from './connection_settings_header.js';
import { CONNECTOR_INFOS, ConnectorType, requiresSwitchingToNative } from '../../connection/connector_info.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useAnyConnectionWorkbook } from './connection_workbook.js';
import { DemoDatabaseChannel } from '../../connection/demo/demo_database_channel.js';
import { setupDemoConnection } from '../../connection/demo/demo_connection_setup.js';
import { useLogger } from '../../platform/logger_provider.js';
import { RESET } from '../../connection/connection_state.js';

interface Props {
    connectionId: number;
}

export const DemoConnectorSettings: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const connectorInfo = CONNECTOR_INFOS[ConnectorType.DEMO];
    const wrongPlatform = requiresSwitchingToNative(connectorInfo);
    const [connectionState, modifyConnection] = useConnectionState(props.connectionId);
    const connectionWorkbook = useAnyConnectionWorkbook(props.connectionId);

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
            type: RESET,
            value: null
        });
    };

    return (
        <div className={style.layout}>
            <ConnectionHeader
                connector={connectorInfo}
                connection={connectionState}
                wrongPlatform={wrongPlatform}
                setupConnection={setupConnection}
                cancelSetup={cancelSetup}
                resetSetup={resetSetup}
                workbook={connectionWorkbook}
            />
        </div>
    );
}
