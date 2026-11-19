import * as React from 'react';
import * as styles from './inspector_overlay.module.css';

import { classNames } from '../dom/classnames.js';

// The frame of the inspectors of the app: the logs, the HTTP requests, the version, the storage writer, the query cache,
// the storage of a workbook and the query history. A header with the title and the controls, optionally the header row
// of the columns, and the list below; the detail of a row with a sidebar of controls.

export interface InspectorHeaderProps {
    title: React.ReactNode;
    /// What follows the title on the left, e.g. a summary or a status
    status?: React.ReactNode;
    /// The controls on the right, e.g. a download and the close button
    actions?: React.ReactNode;
    className?: string;
    titleClassName?: string;
}

/// The header of an inspector: the title with its status on the left, the controls on the right
export function InspectorHeader(props: InspectorHeaderProps): React.ReactElement {
    return (
        <div className={classNames(styles.header, props.className)}>
            <div className={styles.header_left}>
                <div className={classNames(styles.title, props.titleClassName)}>{props.title}</div>
                {props.status}
            </div>
            <div className={styles.header_right}>{props.actions}</div>
        </div>
    );
}

export interface InspectorOverlayProps {
    title: React.ReactNode;
    /// What follows the title on the left, e.g. a summary or a status
    status?: React.ReactNode;
    /// The controls right of the title, e.g. a download and the close button
    actions?: React.ReactNode;
    /// The header row of the columns of the list, none for an inspector without columns
    columns?: React.ReactNode;
    /// The class of the header row of the columns, e.g. its font size and the grid of its columns
    columnsClassName?: string;
    /// The class of the list, e.g. its font size
    bodyClassName?: string;
    bodyRef?: React.Ref<HTMLDivElement>;
    className?: string;
    children?: React.ReactNode;
}

/// An inspector: the header, the header row of the columns and the list
export function InspectorOverlay(props: InspectorOverlayProps): React.ReactElement {
    return (
        <div
            className={classNames(styles.overlay, { [styles.overlay_with_columns]: props.columns != null }, props.className)}
            data-electron-drag-region="false"
        >
            <InspectorHeader title={props.title} status={props.status} actions={props.actions} />
            {props.columns != null && <div className={classNames(styles.columns, props.columnsClassName)}>{props.columns}</div>}
            <div className={classNames(styles.body, props.bodyClassName)} ref={props.bodyRef}>
                {props.children}
            </div>
        </div>
    );
}

/// The class of a row of the list of an inspector, a selected row is highlighted
export function inspectorRowClassName(selected: boolean, className?: string): string {
    return classNames(styles.row, { [styles.row_selected]: selected }, className);
}

/// The list without rows
export function InspectorEmpty(props: { children: React.ReactNode }): React.ReactElement {
    return <div className={styles.empty}>{props.children}</div>;
}

export interface InspectorDetailProps {
    /// The controls at the top of the sidebar, e.g. the close button
    sidebarTop?: React.ReactNode;
    /// The controls at the bottom of the sidebar, e.g. the previous and the next row
    sidebarBottom?: React.ReactNode;
    /// The class of the content, e.g. a padding
    contentClassName?: string;
    children?: React.ReactNode;
}

/// The detail of a row: the content with a sidebar of controls on its right
export function InspectorDetail(props: InspectorDetailProps): React.ReactElement {
    return (
        <div className={styles.detail}>
            <div className={styles.detail_main}>
                <div className={classNames(styles.detail_content, props.contentClassName)}>{props.children}</div>
            </div>
            <div className={styles.detail_sidebar}>
                <div className={styles.detail_sidebar_top}>{props.sidebarTop}</div>
                <div className={styles.detail_sidebar_bottom}>{props.sidebarBottom}</div>
            </div>
        </div>
    );
}
