import * as React from 'react';
import * as style from './connection_settings.module.css';

import { ConnectionHeader } from './connection_settings_header.js';
import { CONNECTOR_INFOS, ConnectorType, requiresSwitchingToNative } from '../../connection/connector_info.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useAnyConnectionWorkbook } from './connection_workbook.js';
import { DEMO_CHANNEL_READY } from '../../connection/demo/demo_connection_state.js';
import { DemoDatabaseChannel } from '../../connection/demo/demo_database_channel.js';

interface Props {
    connectionId: number;
}

export const DemoConnectorSettings: React.FC<Props> = (props: Props) => {
    const connectorInfo = CONNECTOR_INFOS[ConnectorType.DEMO];
    const wrongPlatform = requiresSwitchingToNative(connectorInfo);
    const [connectionState, modifyConnection] = useConnectionState(props.connectionId);
    const connectionWorkbook = useAnyConnectionWorkbook(props.connectionId);

    const setupConnection = async () => {
        modifyConnection({
            type: DEMO_CHANNEL_READY,
            value: new DemoDatabaseChannel(),
        });
    };
    const cancelSetup = async () => {
    };
    const resetSetup = () => {

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
