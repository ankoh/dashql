import * as React from 'react';

import * as ActionList from '../foundations/action_list.js';
import * as styles from './notebook_list_dropdown.module.css';

import { useNotebookRegistry, useNotebookState } from '../../notebook/notebook_state_registry.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { Button, ButtonVariant } from '../foundations/button.js';
import {
    HYPER_CONNECTOR,
    SALESFORCE_DATA_CLOUD_CONNECTOR,
    DATALESS_CONNECTOR,
    DEMO_CONNECTOR,
    TRINO_CONNECTOR,
} from '../../connection/connector_info.js';
import { NotebookState } from '../../notebook/notebook_state.js';
import { useConnectionRegistry } from '../../connection/connection_registry.js';
import { ConnectionHealth } from '../../connection/connection_state.js';
import { DASHQL_ARCHIVE_FILENAME_EXT } from '../../globals.js';
import { Identicon } from '../../view/foundations/identicon.js';
import { tryParseInt } from '../../utils/number.js';
import { useRouteContext, useRouterNavigate, NOTEBOOK_PATH } from '../../router.js';
import { SymbolIcon } from '../../view/foundations/symbol_icon.js';
import { LoggableException } from '../../platform/logger.js';

const LOG_CTX = 'notebooks_dropdown';

export function NotebookListDropdown(props: { className?: string; }) {
    const route = useRouteContext();
    const navigate = useRouterNavigate();
    const [notebookRegistry, _modifyNotebooks] = useNotebookRegistry();
    const [isOpen, setIsOpen] = React.useState<boolean>(false);
    const [conn, _modifyConn] = useConnectionRegistry();
    const [selectedNotebook, _modifyNotebook] = useNotebookState(route.notebookId ?? null);
    const notebookFileName = selectedNotebook?.notebookMetadata.originalFileName ?? "_";
    const notebookConnection = selectedNotebook
        ? conn.connectionMap.get(selectedNotebook.connectionId)
        : null;

    const onNotebookClick = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const target = e.currentTarget as HTMLLIElement;
        if (target.dataset.item) {
            const notebookId = tryParseInt(target.dataset.item);
            if (notebookId != null && notebookRegistry.notebookMap.has(notebookId)) {
                const notebook = notebookRegistry.notebookMap.get(notebookId)!;
                navigate({
                    type: NOTEBOOK_PATH,
                    value: {
                        connectionId: notebook.connectionId,
                        notebookId: notebookId,
                    }
                });
            }
        } else {
            console.warn("click target did not contain a data attribute");
        }
    }, []);

    // Memoize button to prevent svg flickering
    const TrinangleDownIcon = SymbolIcon("triangle_down_16");
    const button = React.useMemo(() => {
        const connSig = notebookConnection?.connectionSignature?.hash.asPrng();
        return (
            <Button
                className={props.className}
                onClick={() => setIsOpen(true)}
                variant={ButtonVariant.Default}
                leadingVisual={() => (!selectedNotebook?.connectorInfo
                    ? <div />
                    : <Identicon
                        className={styles.notebook_icon}
                        width={24}
                        height={24}
                        layers={[
                            connSig?.next() ?? 0,
                            connSig?.next() ?? 0,
                        ]}
                    />
                )}
                trailingVisual={TrinangleDownIcon}
            >
                <div>
                    <span className={styles.filename}>{notebookFileName}</span>
                    <span className={styles.filename_ext}>.{DASHQL_ARCHIVE_FILENAME_EXT}</span>
                </div>
            </Button>
        );
    }, [selectedNotebook?.connectorInfo, notebookFileName]);

    const Item = (props: { w: NotebookState, idx: number }) => {
        const connection = conn.connectionMap.get(props.w.connectionId)!;
        let description: React.ReactElement | undefined = undefined;
        let enabled: boolean = true;
        const notebookFileName = props.w.notebookMetadata.originalFileName;
        const connSig = connection.connectionSignature.hash.asPrng();

        switch (connection.details.type) {
            case SALESFORCE_DATA_CLOUD_CONNECTOR: {
                enabled = connection.connectionHealth === ConnectionHealth.ONLINE;
                if (enabled) {
                    const dcToken = connection.details.value.proto.oauthState?.dataCloudAccessToken;
                    const dcTenant = dcToken?.jwt?.payload?.audienceTenantId;
                    description = (
                        <ActionList.ItemTextDescription>
                            {dcTenant ? dcTenant : "-"}
                        </ActionList.ItemTextDescription>
                    );
                } else {
                    description = undefined;
                }
                break;
            }
            case HYPER_CONNECTOR: {
                enabled = connection.connectionHealth === ConnectionHealth.ONLINE;
                if (enabled) {
                    const _endpoint = connection.details.value.proto.setupParams?.endpoint;
                    description = undefined;
                } else {
                    description = undefined;
                }
                break;
            }
            case TRINO_CONNECTOR: {
                enabled = connection.connectionHealth === ConnectionHealth.ONLINE;
                if (enabled) {
                    const _endpoint = connection.details.value.proto.setupParams?.endpoint;
                    description = undefined;
                } else {
                    description = undefined;
                }
                break;
            }
            case DATALESS_CONNECTOR:
            case DEMO_CONNECTOR:
                break;
        }

        return (
            <ActionList.ListItem
                tabIndex={0}
                onClick={onNotebookClick}
                selected={props.w.notebookId === selectedNotebook?.notebookId}
                data-item={props.w.notebookId.toString()}
            >
                <ActionList.Leading>
                    <Identicon
                        className={styles.notebook_icon}
                        width={24}
                        height={24}
                        layers={[
                            connSig.next(),
                            connSig.next()
                        ]}
                    />

                </ActionList.Leading>
                <ActionList.ItemText>
                    <ActionList.ItemTextTitle>
                        <div>
                            <span className={styles.filename}>{notebookFileName}</span>
                            <span className={styles.filename_ext}>.{DASHQL_ARCHIVE_FILENAME_EXT}</span>
                        </div>
                    </ActionList.ItemTextTitle>
                    {description}
                </ActionList.ItemText>
            </ActionList.ListItem>
        )
    };


    // Collect the notebook states
    let notebooks: NotebookState[] = [];
    for (const typeNotebooks of notebookRegistry.notebooksByConnectionType) {
        for (const notebookId of typeNotebooks) {
            const w = notebookRegistry.notebookMap.get(notebookId)!;
            if (w === undefined) {
                throw new LoggableException('failed to resolve notebook', {
                    notebook: notebookId.toString()
                }, LOG_CTX);
            }
            notebooks.push(notebookRegistry.notebookMap.get(notebookId)!);
        }
    }

    return (
        <AnchoredOverlay
            open={isOpen}
            onClose={() => setIsOpen(false)}
            renderAnchor={(p: object) => <div {...p}>{button}</div>}
            focusZoneSettings={{ disabled: true }}
        >
            <ActionList.List aria-label="Notebooks">
                <ActionList.GroupHeading>Notebooks</ActionList.GroupHeading>
                <>
                    {notebooks.map((w: NotebookState, idx: number) => (
                        <Item key={w.notebookId} w={w} idx={idx} />
                    ))}
                </>
            </ActionList.List>
        </AnchoredOverlay>
    );
}
