import * as React from 'react';
import * as ActionList from '../foundations/action_list.js';
import * as styles from './workbook_list_dropdown.module.css';

import { useCurrentWorkbookSelector, useCurrentWorkbookState } from '../../workbook/current_workbook.js';
import { useWorkbookRegistry } from '../../workbook/workbook_state_registry.js';
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

export function WorkbookListDropdown(props: { className?: string; }) {
    const workbookRegistry = useWorkbookRegistry();
    const selectWorkbook = useCurrentWorkbookSelector();
    const [isOpen, setIsOpen] = React.useState<boolean>(false);
    const [connRegistry, _setConnRegistry] = useConnectionRegistry();

    const onWorkbookClick = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const target = e.currentTarget as HTMLLIElement;
        if (target.dataset.item) {
            const workbookId = Number.parseInt(target.dataset.item)!;
            selectWorkbook(workbookId);
        } else {
            console.warn("click target did not contain a data attribute");
        }
    }, []);

    const [currentWorkbook, _modifyWorkbookState] = useCurrentWorkbookState();
    const currentWorkbookFileName = currentWorkbook?.workbookMetadata.fileName ?? "_";
    const currentConnection = currentWorkbook
        ? connRegistry.connectionMap.get(currentWorkbook.connectionId)
        : null;

    // Memoize button to prevent svg flickering
    const button = React.useMemo(() => {
        const connSig = currentConnection?.connectionSignature?.seed.asSfc32();
        return (
            <Button
                className={props.className}
                onClick={() => setIsOpen(true)}
                variant={ButtonVariant.Invisible}
                leadingVisual={() => (!currentWorkbook?.connectorInfo
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
                    <span className={styles.filename}>{currentWorkbookFileName}</span>
                    <span className={styles.filename_ext}>.{DASHQL_ARCHIVE_FILENAME_EXT}</span>
                </div>
            </Button>
        );
    }, [currentWorkbook?.connectorInfo, currentWorkbookFileName]);

    const renderItem = ([workbookId, workbook]: [number, WorkbookState]) => {
        const connection = connRegistry.connectionMap.get(workbook.connectionId)!;
        let description: React.ReactElement | undefined = undefined;
        let enabled: boolean = true;
        const workbookFileName = workbook.workbookMetadata.fileName;
        const connSig = connection.connectionSignature.seed.asSfc32();

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
                key={workbookId}
                data-workbook={workbook.connectionId}
                onClick={onWorkbookClick}
                selected={workbookId === currentWorkbook?.workbookId}
                disabled={!enabled}
                data-item={workbookId.toString()}
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
