import * as React from 'react';
import * as style from './connection_settings.module.css';

import { ConnectionHeader } from './connection_settings_header.js';
import { CONNECTOR_INFOS, ConnectorType, requiresSwitchingToNative } from '../../connection/connector_info.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useAnyConnectionNotebook } from './connection_notebook.js';

interface Props {
    sessionId: string;
}

export const DatalessConnectorSettings: React.FC<Props> = (props: Props) => {
    const connectorInfo = CONNECTOR_INFOS[ConnectorType.DATALESS];
    const wrongPlatform = requiresSwitchingToNative(connectorInfo);
    const [connectionState, _dispatchConnectionState] = useConnectionState(props.sessionId);
    const connectionNotebook = useAnyConnectionNotebook(props.sessionId);

    return (
        <div className={style.layout}>
            <ConnectionHeader
                connector={connectorInfo}
                connection={connectionState}
                wrongPlatform={wrongPlatform}
                notebook={connectionNotebook}
            />
        </div>
    );
}
