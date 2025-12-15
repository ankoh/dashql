import * as React from 'react';

import * as ActionList from '../foundations/action_list.js';
import * as styles from './workbook_list_dropdown.module.css';

import { useWorkbookRegistry, useWorkbookState } from '../../workbook/workbook_state_registry.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { Button, ButtonVariant } from '../foundations/button.js';
import {
    HYPER_GRPC_CONNECTOR,
    SALESFORCE_DATA_CLOUD_CONNECTOR,
    DATALESS_CONNECTOR,
    DEMO_CONNECTOR,
    TRINO_CONNECTOR,
} from '../../connection/connector_info.js';
import { WorkbookState } from '../../workbook/workbook_state.js';
import { useConnectionRegistry } from '../../connection/connection_registry.js';
import { ConnectionHealth } from '../../connection/connection_state.js';
import { DASHQL_ARCHIVE_FILENAME_EXT } from '../../globals.js';
import { Identicon } from '../../view/foundations/identicon.js';
import { tryParseInt } from '../../utils/number.js';
import { useRouteContext, useRouterNavigate, WORKBOOK_PATH } from '../../router.js';

export function WorkbookListDropdown(props: { className?: string; }) {
    const route = useRouteContext();
    const navigate = useRouterNavigate();
    const [workbookRegistry, _modifyWorkbooks] = useWorkbookRegistry();
    const [isOpen, setIsOpen] = React.useState<boolean>(false);
    const [conn, _modifyConn] = useConnectionRegistry();
    const [selectedWorkbook, _modifyWorkbook] = useWorkbookState(route.workbookId ?? null);
    const workbookFileName = selectedWorkbook?.workbookMetadata.originalFileName ?? "_";
    const workbookConnection = selectedWorkbook
        ? conn.connectionMap.get(selectedWorkbook.connectionId)
        : null;

    const onWorkbookClick = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const target = e.currentTarget as HTMLLIElement;
        if (target.dataset.item) {
            const workbookId = tryParseInt(target.dataset.item);
            if (workbookId != null && workbookRegistry.workbookMap.has(workbookId)) {
                const workbook = workbookRegistry.workbookMap.get(workbookId)!;
                navigate({
                    type: WORKBOOK_PATH,
                    value: {
                        connectionId: workbook.connectionId,
                        workbookId: workbookId,
                        workbookEditMode: false,
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
                leadingVisual={() => (!selectedWorkbook?.connectorInfo
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
    }, [selectedWorkbook?.connectorInfo, workbookFileName]);

    const Item = (props: { w: WorkbookState, idx: number }) => {
        const connection = conn.connectionMap.get(props.w.connectionId)!;
        let description: React.ReactElement | undefined = undefined;
        let enabled: boolean = true;
        const workbookFileName = props.w.workbookMetadata.originalFileName;
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
                    const endpoint = connection.details.value.proto.setupParams?.endpoint;
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
                    const endpoint = connection.details.value.proto.setupParams?.endpoint;
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
            case DATALESS_CONNECTOR:
            case DEMO_CONNECTOR:
                break;
        }

        return (
            <ActionList.ListItem
                tabIndex={0}
                onClick={onWorkbookClick}
                selected={props.w.workbookId === selectedWorkbook?.workbookId}
                data-item={props.w.workbookId.toString()}
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

    // Collect the workbook states
    let workbooks: WorkbookState[] = [];
    for (const typeWorkbooks of workbookRegistry.workbooksByConnectionType) {
        for (const workbookId of typeWorkbooks) {
            workbooks.push(workbookRegistry.workbookMap.get(workbookId)!);
        }
    }

    return (
        <AnchoredOverlay
            open={isOpen}
            onClose={() => setIsOpen(false)}
            renderAnchor={(p: object) => <div {...p}>{button}</div>}
            focusZoneSettings={{ disabled: true }}
        >
            <ActionList.List aria-label="Workbooks">
                <ActionList.GroupHeading>Workbooks</ActionList.GroupHeading>
                <>
                    {workbooks.map((w: WorkbookState, idx: number) => (
                        <Item key={w.workbookId} w={w} idx={idx} />
                    ))}
                </>
            </ActionList.List>
        </AnchoredOverlay>
    );
}
