import * as React from 'react';
import symbols from '@akohn/dashql-svg-symbols';

import {
    ChevronDownIcon,
    ChevronRightIcon,
    DownloadIcon,
    EyeIcon,
    PlugIcon,
    PlusIcon,
    RowsIcon,
    SyncIcon,
    ToolsIcon,
    TrashIcon,
    UnlinkIcon,
    XIcon,
} from '../ui/foundations/symbol_icon.js';
import { useRowContextMenu } from '../ui/foundations/row_context_menu.js';
import { classNames } from '../utils/classnames.js';
import { useLogger } from '../platform/logger_provider.js';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { SELECT_WORKBOOK, useRouterNavigate } from '../app/router.js';
import { connectionLabel } from '../connections/connection_label.js';
import { CONNECTION_HEALTH_COLORS, CONNECTION_HEALTH_NAMES } from '../connections/connection_status.js';
import { CONNECTOR_ICON_STYLE, useConnectorIcon } from '../connections/connector_icon.js';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { useWorkbooks } from '../runtime/runtime_hooks.js';
import { isCloudPreview, workbookCloudLink, type WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { WORKBOOK_LIST_CARET_COLUMN, workbookListRowPadding } from '../workbook/workbook_folder_row.js';
import * as sidebarStyles from '../workbook/workbook_workbench_sidebar.module.css';
import * as styles from './cloud_sidebar.module.css';
import { CloudRowMenu } from './cloud_row_menu.js';
import { useCloudRemoval } from './cloud_deletion.js';
import { useClouds, type CloudState } from './cloud_state.js';
import { useCloudWorkbooks } from './cloud_workbooks.js';
import { useCloudLogin, useLocalCloudAutoLogin } from './cloud_login.js';
import { connectorInfoOf } from '@akohn/dashql/platform/connections/connection_state';

// The clouds in the workbook list of the sidebar: a folder Clouds at the top level, above the folder of the local
// workbooks, with a row per cloud. See docs/design/cloud.md.
//
// The sidebar never lists the workbooks of a cloud, a cloud may hold very many. A click on a cloud opens its overview in
// place of the feed, which reads them a page at a time and searches them. Only the preview that is open is listed, below
// its cloud.

const LOG_CTX = 'cloud_sidebar';

interface Props {
    /// The cloud whose overview is open, null without one
    openCloudId: string | null;
    /// The workbook that the workbench shows, null while it shows something else, e.g. an overview
    currentWorkbookId: string | null;
    /// Open the overview of a cloud
    onOpenCloud: (connectionId: string) => void;
    /// A preview was selected
    onOpened?: () => void;
}

/// The rows of the clouds in the workbook list, an <li> each
export const CloudsFolder: React.FC<Props> = (props) => {
    const { clouds, openSetup } = useClouds();
    const workbooks = useWorkbooks();
    // The clouds are listed at first, there are few
    const [expanded, setExpanded] = React.useState(true);

    // The previews by the cloud they show a version of
    const previews = new Map<string, WorkbookScripts[]>();
    for (const workbook of workbooks.values()) {
        if (!isCloudPreview(workbook)) continue;
        const cloudId = workbookCloudLink(workbook)!.connectionId;
        previews.set(cloudId, [...(previews.get(cloudId) ?? []), workbook]);
    }

    return (
        <>
            <CloudsRootRow
                expanded={expanded}
                count={clouds.length}
                onToggle={() => setExpanded(value => !value)}
                onAdd={() => openSetup()}
            />
            {expanded && clouds.map(cloud => (
                <React.Fragment key={cloud.connectionId}>
                    <CloudRow
                        cloud={cloud}
                        selected={props.openCloudId === cloud.connectionId}
                        onOpen={() => props.onOpenCloud(cloud.connectionId)}
                    />
                    {(previews.get(cloud.connectionId) ?? []).map(preview => (
                        <CloudPreviewRow
                            key={preview.workbookId}
                            workbook={preview}
                            selected={props.currentWorkbookId === preview.workbookId}
                            onOpened={props.onOpened}
                        />
                    ))}
                </React.Fragment>
            ))}
        </>
    );
};

interface CloudsRootRowProps {
    expanded: boolean;
    /// The number of clouds
    count: number;
    onToggle: () => void;
    onAdd: () => void;
}

/// The folder of the clouds at the top level of the workbook list: caret, cloud icon, Clouds, the number of clouds and a
/// menu that adds one
const CloudsRootRow: React.FC<CloudsRootRowProps> = (props) => {
    const contextMenu = useRowContextMenu();
    const Caret = props.expanded ? ChevronDownIcon : ChevronRightIcon;
    return (
        <li
            className={classNames(sidebarStyles.entry_surface, sidebarStyles.entry_interactive, sidebarStyles.workbook_row)}
            style={{ paddingLeft: workbookListRowPadding(0) }}
            data-testid="clouds-folder"
            onContextMenu={contextMenu.onContextMenu}
        >
            <button
                type="button"
                className={classNames(sidebarStyles.tree_button, sidebarStyles.root_button)}
                aria-expanded={props.expanded}
                title="The clouds that keep published workbooks"
                onClick={props.onToggle}
            >
                <span className={sidebarStyles.tree_caret} aria-hidden="true"><Caret size={12} /></span>
                <svg width="14" height="14" aria-hidden="true"><use xlinkHref={`${symbols}#cloud`} /></svg>
                <span className={sidebarStyles.workbook_name}>Clouds</span>
                <span
                    className={sidebarStyles.root_count}
                    data-testid="cloud-count"
                    aria-label={`${props.count} ${props.count === 1 ? 'cloud' : 'clouds'}`}
                >{props.count}</span>
            </button>
            <CloudRowMenu
                label="Clouds"
                contextMenu={contextMenu}
                className={sidebarStyles.workbook_menu_button}
                items={[{ action: 'add', icon: PlusIcon, text: 'Add cloud', run: props.onAdd }]}
            />
        </li>
    );
};

interface CloudRowProps {
    cloud: CloudState;
    /// Is the overview of the cloud open?
    selected: boolean;
    onOpen: () => void;
}

/// A cloud: the logo of its connector, its name, its health, the number of its workbooks and a menu. A click opens its
/// overview.
const CloudRow: React.FC<CloudRowProps> = ({ cloud, selected, onOpen }) => {
    const contextMenu = useRowContextMenu();
    const connectorIcon = useConnectorIcon();
    const { openSetup } = useClouds();
    const removal = useCloudRemoval(cloud.connectionId, cloud.connection.params);
    // The local cloud needs no credentials, it logs in without a click
    const login = useCloudLogin(cloud.connectionId);
    useLocalCloudAutoLogin(cloud.connection, login);
    const health = cloud.connection.connectionHealth;
    const name = connectionLabel(cloud.connection);
    const count = cloud.stats?.workbooks ?? null;
    return (
        <li
            className={classNames(sidebarStyles.entry_surface, sidebarStyles.entry_interactive, sidebarStyles.workbook_row, {
                [sidebarStyles.entry_selected]: selected,
            })}
            // No caret, the icon lines up with the icons of the folders and workbooks of its level
            style={{ paddingLeft: workbookListRowPadding(1) + WORKBOOK_LIST_CARET_COLUMN }}
            data-testid="cloud-row"
            data-cloud={cloud.connectionId}
            onContextMenu={contextMenu.onContextMenu}
        >
            <button
                type="button"
                className={classNames(sidebarStyles.tree_button, styles.cloud_button)}
                aria-current={selected ? 'page' : undefined}
                title={`${name}, ${CONNECTION_HEALTH_NAMES[health]}`}
                onClick={onOpen}
            >
                <svg width="14" height="14" aria-hidden="true">
                    <use xlinkHref={`${symbols}#${connectorIcon(connectorInfoOf(cloud.connection))}`} style={CONNECTOR_ICON_STYLE} />
                </svg>
                <span className={sidebarStyles.workbook_name}>{name}</span>
                <svg className={styles.health} width="6px" height="6px" viewBox="0 0 8 8" role="img" aria-label={CONNECTION_HEALTH_NAMES[health]}>
                    <circle cx="4" cy="4" r="4" style={{ fill: CONNECTION_HEALTH_COLORS[health] }} />
                </svg>
                {count != null && (
                    <span
                        className={sidebarStyles.root_count}
                        data-testid="cloud-workbook-count"
                        aria-label={`${count} published ${count === 1 ? 'workbook' : 'workbooks'}`}
                    >{count}</span>
                )}
            </button>
            <CloudRowMenu
                label={name}
                contextMenu={contextMenu}
                className={sidebarStyles.workbook_menu_button}
                items={[
                    { action: 'overview', icon: RowsIcon, text: 'Open overview', run: onOpen },
                    ...(health === ConnectionHealth.ONLINE || health === ConnectionHealth.CONNECTING ? [] : [
                        { action: 'log-in', icon: PlugIcon, text: 'Log in', run: () => { void login.login(); }, disabled: !login.available },
                    ]),
                    { action: 'refresh', icon: SyncIcon, text: 'Refresh', run: () => { void cloud.refresh(); }, disabled: !cloud.online || cloud.loading },
                    { action: 'setup', icon: ToolsIcon, text: 'Cloud setup', run: () => openSetup(cloud.connectionId) },
                    { action: removal.deletes ? 'delete' : 'stop-using', icon: removal.deletes ? TrashIcon : UnlinkIcon, text: removal.text, run: removal.run, danger: true },
                ]}
            />
        </li>
    );
};

interface CloudPreviewRowProps {
    workbook: WorkbookScripts;
    selected: boolean;
    onOpened?: () => void;
}

/// The preview of a version of a published workbook, below its cloud
const CloudPreviewRow: React.FC<CloudPreviewRowProps> = ({ workbook, selected, onOpened }) => {
    const contextMenu = useRowContextMenu();
    const navigate = useRouterNavigate();
    const workbooks = useCloudWorkbooks();
    const logger = useLogger();
    const name = workbook.name ?? 'Untitled';
    const open = () => {
        navigate({ type: SELECT_WORKBOOK, value: workbook.workbookId });
        onOpened?.();
    };
    const importPreview = () => {
        workbooks.importPreview(workbook.workbookId).catch(error => {
            logger.error(`Importing "${name}" failed`, { workbookId: workbook.workbookId, error: stringifyError(error) }, LOG_CTX);
        });
    };
    return (
        <li
            className={classNames(sidebarStyles.entry_surface, sidebarStyles.entry_interactive, sidebarStyles.workbook_row, {
                [sidebarStyles.entry_selected]: selected,
            })}
            style={{ paddingLeft: workbookListRowPadding(2) + WORKBOOK_LIST_CARET_COLUMN }}
            data-testid="cloud-preview-row"
            onContextMenu={contextMenu.onContextMenu}
        >
            <button
                type="button"
                className={classNames(sidebarStyles.tree_button, styles.preview_button)}
                aria-current={selected ? 'page' : undefined}
                title={`${name}, read-only preview`}
                onClick={open}
            >
                <EyeIcon size={14} aria-hidden="true" />
                <span className={sidebarStyles.workbook_name}>{name}</span>
            </button>
            <CloudRowMenu
                label={name}
                contextMenu={contextMenu}
                className={sidebarStyles.workbook_menu_button}
                items={[
                    { action: 'import', icon: DownloadIcon, text: 'Import', run: importPreview },
                    { action: 'close', icon: XIcon, text: 'Close preview', run: () => { void workbooks.discardPreview(workbook.workbookId); } },
                ]}
            />
        </li>
    );
};
