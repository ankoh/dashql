import * as React from 'react';
import * as buf from "@bufbuild/protobuf";
import * as pb from '@ankoh/dashql-protobuf'

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
import { KeyValueListBuilder, KeyValueListElement, UpdateKeyValueList } from '../foundations/keyvalue_list.js';
import { TextField, VALIDATION_WARNING } from '../foundations/text_field.js';
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
    activeParams: pb.dashql.connection.TrinoConnectionParams | null;
    newParams: pb.dashql.connection.TrinoConnectionParams;
    newParamsMetadata: KeyValueListElement[];
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
    const [pageState, setPageState] = React.useContext(PAGE_STATE_CTX)!;

    const setEndpoint = (v: string) => setPageState(s => ({
        ...s,
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            ...s.newParams,
            endpoint: v
        }),
    }));
    const setBasicAuthUsername: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            ...s.newParams,
            auth: buf.create(pb.dashql.connection.TrinoAuthParamsSchema, {
                username: v,
                secret: s.newParams.auth?.secret,
            }),
        })
    }));
    const setBasicAuthSecret: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            ...s.newParams,
            auth: buf.create(pb.dashql.connection.TrinoAuthParamsSchema, {
                username: s.newParams?.auth?.username,
                secret: v,
            }),
        })
    }));
    const setCatalogName: Dispatch<string> = (v: string) => setPageState(s => ({
        ...s,
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            ...s.newParams,
            catalogName: v
        })
    }));
    const modifySchemaNames: Dispatch<UpdateValueList> = (action: UpdateValueList) => setPageState(s => ({
        ...s,
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            ...s.newParams,
            schemaNames: action(s.newParams.schemaNames)
        })
    }));
    const modifyMetadata: Dispatch<UpdateKeyValueList> = (action: UpdateKeyValueList) => setPageState(s => {
        const metadata = action(s.newParamsMetadata);

        // Flatten the key-value list eagerly for the new params.
        // We could decide to do this lazily but it shouldn't really matter.
        const metadataObj: { [key: string]: string } = {};
        for (const entry of metadata) {
            metadataObj[entry.key] = entry.value;
        }
        return {
            ...s,
            newParamsMetadata: metadata,
            newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
                ...s.newParams,
                metadata: metadataObj
            })
        };
    });

    // Update the page state with the connection params
    React.useEffect(() => {
        if (connectionState?.details.type != TRINO_CONNECTOR) {
            return;
        }
        // Did the channel params change?
        // Then we reset the params of the settings page
        const activeParams = connectionState.details.value.proto.setupParams;
        if (activeParams != null && activeParams !== pageState.activeParams) {
            setPageState({
                activeParams: activeParams,
                newParamsMetadata: Object.entries(activeParams.metadata).map(([k, v]) => ({ key: k, value: v })),
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
            const connectionParams: pb.dashql.connection.TrinoConnectionParams = pageState.newParams;
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
                            value={pageState.newParams.endpoint}
                            placeholder="trino endpoint url"
                            validation={
                                (pageState.newParams.endpoint.length ?? 0) == 0
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
                            value={pageState.newParams.auth?.username ?? ""}
                            placeholder=""
                            validation={
                                (pageState.newParams.auth?.username.length ?? 0) == 0
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
                            value={pageState.newParams.auth?.secret ?? ""}
                            placeholder=""
                            validation={
                                (pageState.newParams.auth?.secret.length ?? 0) == 0
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
                            elements={pageState.newParamsMetadata}
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
        newParamsMetadata: [],
        newParams: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema, {
            endpoint: "http://localhost:8080",
            auth: buf.create(pb.dashql.connection.TrinoAuthParamsSchema, {
                username: "",
                secret: "",
            }),
            metadata: {},
            catalogName: "",
            schemaNames: [],
        })
    });
    return (
        <PAGE_STATE_CTX.Provider value={state}>
            {props.children}
        </PAGE_STATE_CTX.Provider>
    );
};
