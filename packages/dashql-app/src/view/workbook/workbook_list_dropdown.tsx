import * as React from 'react';
import { useNavigate } from 'react-router-dom';

import * as ActionList from '../foundations/action_list.js';
import * as styles from './workbook_list_dropdown.module.css';

import { useWorkbookRegistry, useWorkbookState } from '../../workbook/workbook_state_registry.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { Button, ButtonVariant } from '../foundations/button.js';
import {
    HYPER_GRPC_CONNECTOR,
    SALESFORCE_DATA_CLOUD_CONNECTOR,
    SERVERLESS_CONNECTOR,
    DEMO_CONNECTOR,
    TRINO_CONNECTOR,
} from '../../connection/connector_info.js';
import { WorkbookState } from '../../workbook/workbook_state.js';
import { useConnectionRegistry } from '../../connection/connection_registry.js';
import { ConnectionHealth } from '../../connection/connection_state.js';
import { DASHQL_ARCHIVE_FILENAME_EXT } from '../../globals.js';
import { Identicon } from '../../view/foundations/identicon.js';
import { tryParseInt } from '../../utils/number.js';
import { useRouteContext } from '../../router.js';

export function WorkbookListDropdown(props: { className?: string; }) {
    const route = useRouteContext();
    const navigate = useNavigate();
    const workbookRegistry = useWorkbookRegistry();
    const [isOpen, setIsOpen] = React.useState<boolean>(false);
    const [conn, _modifyConn] = useConnectionRegistry();
    const [workbook, _modifyWorkbook] = useWorkbookState(route.workbookId ?? null);
    const workbookFileName = workbook?.workbookMetadata.fileName ?? "_";
    const workbookConnection = workbook
        ? conn.connectionMap.get(workbook.connectionId)
        : null;

    const onWorkbookClick = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const target = e.currentTarget as HTMLLIElement;
        if (target.dataset.item) {
            const workbookId = tryParseInt(target.dataset.item);
            if (workbookId != null && workbookRegistry.workbookMap.has(workbookId)) {
                const workbook = workbookRegistry.workbookMap.get(workbookId)!;
                navigate(`/`, {
                    state: {
                        ...route,
                        workbookId: workbookId,
                        connectionId: workbook.connectionId
                    }
                });
            }
        } else {
            console.warn("click target did not contain a data attribute");
        }
    }, []);

    // Memoize button to prevent svg flickering
    const button = React.useMemo(() => {
        const connSig = workbookConnection?.connectionSignature?.hash.asPrng();
        return (
            <Button
                className={props.className}
                onClick={() => setIsOpen(true)}
                variant={ButtonVariant.Invisible}
                leadingVisual={() => (!workbook?.connectorInfo
                    ? <div />
                    : <Identicon
                        className={styles.workbook_icon}
                        width={24}
                        height={24}
                        layers={[
                            connSig?.next() ?? 0,
                            connSig?.next() ?? 0,
                        ]}
                    />
                )}
            >
                <div>
                    <span className={styles.filename}>{workbookFileName}</span>
                    <span className={styles.filename_ext}>.{DASHQL_ARCHIVE_FILENAME_EXT}</span>
                </div>
            </Button>
        );
    }, [workbook?.connectorInfo, workbookFileName]);

    const renderItem = ([wi, w]: [number, WorkbookState]) => {
        const connection = conn.connectionMap.get(w.connectionId)!;
        let description: React.ReactElement | undefined = undefined;
        let enabled: boolean = true;
        const workbookFileName = w.workbookMetadata.fileName;
        const connSig = connection.connectionSignature.hash.asPrng();

        switch (connection.details.type) {
            case SALESFORCE_DATA_CLOUD_CONNECTOR: {
                enabled = connection.connectionHealth === ConnectionHealth.ONLINE;
                if (enabled) {
                    const dcTenant = connection.details.value.dataCloudAccessToken?.dcTenantId;
                    description = (
                        <ActionList.ItemTextDescription>
                            {dcTenant ? dcTenant : "-"}
                        </ActionList.ItemTextDescription>
                    );
                } else {
                    description = (
                        <ActionList.ItemTextDescription>
                            Not connected
                        </ActionList.ItemTextDescription>
                    );
                }
                break;
            }
            case HYPER_GRPC_CONNECTOR: {
                enabled = connection.connectionHealth === ConnectionHealth.ONLINE;
                if (enabled) {
                    const endpoint = connection.details.value.channelSetupParams?.channelArgs.endpoint;
                    description = (
                        <ActionList.ItemTextDescription>
                            {endpoint ? endpoint : "-"}
                        </ActionList.ItemTextDescription>
                    );
                } else {
                    description = (
                        <ActionList.ItemTextDescription>
                            Not connected
                        </ActionList.ItemTextDescription>
                    );
                }
                break;
            }
            case TRINO_CONNECTOR: {
                enabled = connection.connectionHealth === ConnectionHealth.ONLINE;
                if (enabled) {
                    const endpoint = connection.details.value.channelParams?.channelArgs.endpoint;
                    description = (
                        <ActionList.ItemTextDescription>
                            {endpoint ? endpoint : "-"}
                        </ActionList.ItemTextDescription>
                    );
                } else {
                    description = (
                        <ActionList.ItemTextDescription>
                            Not connected
                        </ActionList.ItemTextDescription>
                    );
                }
                break;
            }
            case SERVERLESS_CONNECTOR:
            case DEMO_CONNECTOR:
                break;
        }

        return (
            <ActionList.ListItem
                key={wi}
                onClick={onWorkbookClick}
                selected={wi === workbook?.workbookId}
                data-item={wi.toString()}
            >
                <ActionList.Leading>
                    <Identicon
                        className={styles.workbook_icon}
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
                            <span className={styles.filename}>{workbookFileName}</span>
                            <span className={styles.filename_ext}>.{DASHQL_ARCHIVE_FILENAME_EXT}</span>
                        </div>
                    </ActionList.ItemTextTitle>
                    {description}
                </ActionList.ItemText>
            </ActionList.ListItem>
        )
    };

    const workbooks = React.useMemo(() => [...workbookRegistry.workbookMap.entries()].sort((l, r) => {
        return l[1].connectorInfo.connectorType - r[1].connectorInfo.connectorType;
    }), [workbookRegistry]);

    return (
        <AnchoredOverlay
            open={isOpen}
            onClose={() => setIsOpen(false)}
            renderAnchor={(p: object) => <div {...p}>{button}</div>}
        >
            <ActionList.List aria-label="Workbooks">
                <ActionList.GroupHeading>Workbooks</ActionList.GroupHeading>
                <>
                    {workbooks.map(renderItem)}
                </>
            </ActionList.List>
        </AnchoredOverlay>
    );
}
