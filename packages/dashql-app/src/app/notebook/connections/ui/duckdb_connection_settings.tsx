import * as React from 'react';

import * as style from './connection_settings.module.css';
import { useLogger } from '../../../../platform/logger/logger_provider.js';
import { isNativePlatform } from '../../../../platform/native_globals.js';
import { useConnectionState } from '../connection_registry.js';
import { ConnectionHealth } from '../connection_state.js';
import { CONNECTOR_INFOS, ConnectorType } from '../connector_info.js';
import { getDuckDBConnectionDetails } from '../duckdb/duckdb_connection_state.js';
import { useDuckDBSetup } from '../duckdb/duckdb_connection_setup.js';
import { useAnyConnectionNotebookScripts } from './connection_notebook_scripts.js';
import { ConnectionInlineHeader } from './connection_inline_header.js';

interface Props {
    notebookId: string | null;
    onClose?: () => void;
}

export const DuckDBConnectorSettings: React.FC<Props> = props => {
    const logger = useLogger();
    const setup = useDuckDBSetup();
    const [connectionState, dispatchConnectionState] = useConnectionState(props.notebookId);
    const notebookScripts = useAnyConnectionNotebookScripts(props.notebookId);
    const details = getDuckDBConnectionDetails(connectionState);
    const abortController = React.useRef<AbortController | null>(null);

    const setupConnection = async () => {
        if (!setup || !connectionState) return;
        abortController.current = new AbortController();
        try {
            await setup.setup(
                dispatchConnectionState,
                details?.proto.setupParams ?? {},
                abortController.current.signal,
            );
        } catch (error) {
            logger.warn('DuckDB setup did not complete', { error: String(error) }, 'duckdb_connector');
        } finally {
            abortController.current = null;
        }
    };

    const cancelSetup = () => abortController.current?.abort('abort DuckDB setup');
    const resetSetup = async () => setup?.reset(dispatchConnectionState);
    const freezeInput = connectionState?.connectionHealth === ConnectionHealth.CONNECTING ||
        connectionState?.connectionHealth === ConnectionHealth.ONLINE;

    return (
        <div className={style.layout}>
            <ConnectionInlineHeader
                connector={CONNECTOR_INFOS[ConnectorType.DUCKDB]}
                connection={connectionState}
                wrongPlatform={!isNativePlatform()}
                setupConnection={setupConnection}
                cancelSetup={cancelSetup}
                resetSetup={resetSetup}
                notebookScripts={notebookScripts}
                freezeInput={freezeInput}
                embedded
                onClose={props.onClose}
            />
            <div className={style.body_container}>
                <div className={style.section}>
                    <div className={`${style.section_layout} ${style.body_section_layout}`}>
                        <div className={`${style.grid_column_1_span_2} ${style.embedded_description}`}>
                            DuckDB runs locally inside the native DashQL application.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
