import * as React from 'react';

import * as style from './connection_settings.module.css';

import {
    BookIcon,
    KeyIcon,
    PlugIcon,
    XIcon,
} from '@primer/octicons-react';

import { Button, ButtonVariant } from '../foundations/button.js';
import { ConnectionHealth } from '../../connection/connection_state.js';
import { Dispatch } from '../../utils/variant.js';
import { KeyValueListBuilder, UpdateKeyValueList } from '../foundations/keyvalue_list.js';
import { TextField, VALIDATION_WARNING } from '../foundations/text_field.js';
import { TrinoConnectionParams } from '../../connection/trino/trino_connection_params.js';
import { classNames } from '../../utils/classnames.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useLogger } from '../../platform/logger_provider.js';
import { useTrinoSetup } from '../../connection/trino/trino_connector.js';
import { CONNECTOR_INFOS, ConnectorType, requiresSwitchingToNative, TRINO_CONNECTOR } from '../../connection/connector_info.js';
import { UpdateValueList, ValueListBuilder } from '../../view/foundations/value_list.js';
import { useAnyConnectionWorkbook } from './connection_workbook.js';
import { ConnectionHeader } from './connection_settings_header.js';

const LOG_CTX = "trino_connector";

interface PageState {
    activeParams: TrinoConnectionParams | null;
    newParams: TrinoConnectionParams;
};
type PageStateSetter = Dispatch<React.SetStateAction<PageState>>;
const PAGE_STATE_CTX = React.createContext<[PageState, PageStateSetter] | null>(null);

interface Props {
    connectionId: number;
}

export const TrinoConnectorSettings: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const trinoSetup = useTrinoSetup();

    // Can we use the connector here?
    const connectorInfo = CONNECTOR_INFOS[ConnectorType.TRINO];
    const wrongPlatform = requiresSwitchingToNative(connectorInfo);

    // Resolve connection state
    const [connectionState, dispatchConnectionState] = useConnectionState(props.connectionId);
    const connectionWorkbook = useAnyConnectionWorkbook(props.connectionId);

    // Wire up the page state
    const [pageState, setPageState] = React.useContext(PAGE_STATE_CTX)!;
    const setEndpoint = (v: string) => setPageState(s => ({ ...s, newParams: { ...s.newParams, channelArgs: { ...s.newParams.channelArgs, endpoint: v } } }));
    const setBasicAuthUsername = (v: string) => setPageState(s => ({ ...s, newParams: { ...s.newParams, authParams: { ...s.newParams.authParams, username: v } } }));
    const setBasicAuthSecret = (v: string) => setPageState(s => ({ ...s, newParams: { ...s.newParams, authParams: { ...s.newParams.authParams, secret: v } } }));
    const setCatalogName = (v: string) => setPageState(s => ({ ...s, newParams: { ...s.newParams, catalogName: v } }));

    const modifySchemaNames: Dispatch<UpdateValueList> = (action: UpdateValueList) => setPageState(s => ({ ...s, newParams: { ...s.newParams, schemaNames: action(s.newParams.schemaNames) } }));
    const modifyMetadata: Dispatch<UpdateKeyValueList> = (action: UpdateKeyValueList) => setPageState(s => ({ ...s, newParams: { ...s.newParams, metadata: action(s.newParams.metadata) } }));

    // Update the page state with the connection params
    React.useEffect(() => {
        if (connectionState?.details.type != TRINO_CONNECTOR) {
            return;
        }
        // Did the channel params change?
        // Then we reset the params of the settings page
        const activeParams = connectionState.details.value.channelParams;
        if (activeParams != null && activeParams !== pageState.activeParams) {
            setPageState({
                activeParams: activeParams,
                newParams: activeParams
            });
        }
    }, [connectionState?.details]);

    // Helper to setup the connection
    const setupAbortController = React.useRef<AbortController | null>(null);
    const setupConnection = async () => {
        // Is there a Trino client?
        if (trinoSetup == null) {
            logger.error("Trino connector is unavailable", {}, LOG_CTX);
            return;
        }
        // Is there a connection id?
        if (connectionState == null) {
            logger.warn("Trino connection state is null", {}, LOG_CTX);
            return;
        }

        try {
            // Setup the Trino connection
            setupAbortController.current = new AbortController();
            const connectionParams: TrinoConnectionParams = pageState.newParams;
            const _channel = await trinoSetup.setup(dispatchConnectionState, connectionParams, setupAbortController.current.signal);

        } catch (error: any) {
            // XXX
        }
        setupAbortController.current = null;
    };

    // Helper to cancel and reset the authorization
    const cancelSetup = () => {
        if (setupAbortController.current) {
            setupAbortController.current.abort("abort the Hyper setup");
            setupAbortController.current = null;
        }
    };
    const resetSetup = async () => {
        if (trinoSetup) {
            await trinoSetup.reset(dispatchConnectionState);
        }
    };

    // Get the action button
    let connectButton: React.ReactElement = <div />;
    let freezeInput = false;
    switch (connectionState?.connectionHealth) {
        case ConnectionHealth.NOT_STARTED:
        case ConnectionHealth.FAILED:
            connectButton = <Button variant={ButtonVariant.Primary} leadingVisual={PlugIcon} onClick={setupConnection}>Connect</Button>;
            break;
        case ConnectionHealth.CONNECTING:
            connectButton = <Button variant={ButtonVariant.Danger} leadingVisual={XIcon} onClick={cancelSetup}>Cancel</Button>;
            freezeInput = true;
            break;
        case ConnectionHealth.ONLINE:
            connectButton = <Button variant={ButtonVariant.Danger} leadingVisual={XIcon} onClick={resetSetup}>Disconnect</Button>;
            freezeInput = true;
            break;
    }

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
            <div className={style.body_container}>
                <div className={style.section}>
                    <div className={classNames(style.section_layout, style.body_section_layout)}>
                        <TextField
                            name="Endpoint"
                            caption="Endpoint of the Trino Api as 'https://host:port'"
                            value={pageState.newParams.channelArgs.endpoint}
                            placeholder="trino endpoint url"
                            validation={
                                (pageState.newParams.channelArgs.endpoint.length ?? 0) == 0
                                    ? { type: VALIDATION_WARNING, value: "Endpoint is empty" }
                                    : undefined
                            }
                            leadingVisual={() => <div>URL</div>}
                            onChange={(e) => setEndpoint(e.target.value)}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                            autoComplete={false}
                            logContext={LOG_CTX}
                        />
                        <TextField
                            name="Username"
                            className={style.grid_column_1}
                            caption="Username for the Trino Api"
                            value={pageState.newParams.authParams.username}
                            placeholder=""
                            validation={
                                (pageState.newParams.authParams.username.length ?? 0) == 0
                                    ? { type: VALIDATION_WARNING, value: "Username is empty" }
                                    : undefined
                            }
                            leadingVisual={() => <div>ID</div>}
                            onChange={(e) => setBasicAuthUsername(e.target.value)}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                            autoComplete={false}
                            logContext={LOG_CTX}
                        />
                        <TextField
                            name="Secret"
                            caption="Password for the Trino Api"
                            value={pageState.newParams.authParams.secret}
                            placeholder=""
                            validation={
                                (pageState.newParams.authParams.secret.length ?? 0) == 0
                                    ? { type: VALIDATION_WARNING, value: "Secret is empty" }
                                    : undefined
                            }
                            leadingVisual={KeyIcon}
                            onChange={(e) => setBasicAuthSecret(e.target.value)}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                            concealed={true}
                            logContext={LOG_CTX}
                        />
                    </div>
                </div>
                <div className={style.section}>
                    <div className={classNames(style.section_layout, style.body_section_layout)}>
                        <TextField
                            name="Catalog"
                            caption="Name of the Trino Catalog"
                            value={pageState.newParams.catalogName}
                            placeholder=""
                            validation={
                                (pageState.newParams.catalogName.length ?? 0) == 0
                                    ? { type: VALIDATION_WARNING, value: "Catalog is empty" }
                                    : undefined
                            }
                            leadingVisual={BookIcon}
                            onChange={(e) => setCatalogName(e.target.value)}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                            autoComplete={false}
                            logContext={LOG_CTX}
                        />
                        <ValueListBuilder
                            title="Schemas"
                            caption="Names of the Trino Schemas"
                            valueIcon={() => <div>Value</div>}
                            addButtonLabel="Add Value"
                            elements={pageState.newParams.schemaNames}
                            modifyElements={modifySchemaNames}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                        />
                    </div>
                </div>
                <div className={style.section}>
                    <div className={classNames(style.section_layout, style.body_section_layout)}>
                        <KeyValueListBuilder
                            title="Additional Metadata"
                            caption="Extra HTTP headers that are added to each request"
                            keyIcon={() => <div>Header</div>}
                            valueIcon={() => <div>Value</div>}
                            addButtonLabel="Add Header"
                            elements={pageState.newParams.metadata}
                            modifyElements={modifyMetadata}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                        />
                    </div>
                </div>
            </div>
        </ div>
    );
};

interface ProviderProps { children: React.ReactElement };

export const TrinoConnectorSettingsStateProvider: React.FC<ProviderProps> = (props: ProviderProps) => {
    const state = React.useState<PageState>({
        activeParams: null,
        newParams: {
            channelArgs: {
                endpoint: "http://localhost:8080",
            },
            authParams: {
                username: "",
                secret: "",
            },
            metadata: [],
            catalogName: "",
            schemaNames: [],
        }
    });
    return (
        <PAGE_STATE_CTX.Provider value={state}>
            {props.children}
        </PAGE_STATE_CTX.Provider>
    );
};
