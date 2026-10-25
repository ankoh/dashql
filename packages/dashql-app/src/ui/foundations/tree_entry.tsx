import * as React from 'react';

import { ChevronDownIcon, ChevronRightIcon } from './symbol_icon.js';
import { classNames } from '../../utils/classnames.js';
import * as styles from './tree_entry.module.css';

/// The indentation of a tree level
export const TREE_ENTRY_INDENT_PX = 16;
/// The left padding of an entry at depth 0
const TREE_ENTRY_PADDING_PX = 8;

export interface TreeEntryProps extends Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'style'> {
    /// The level of the entry, the root level is 0
    depth: number;
    /// Is the folder expanded? Files leave it undefined and get no caret.
    expanded?: boolean;
    /// The icon before the label, e.g. a folder or a file. Without one the label starts after the caret.
    icon?: React.ReactElement | null;
    /// The label of the entry, usually a TreeEntryName
    label: React.ReactNode;
    /// Is the entry selected?
    selected?: boolean;
    /// Additional classes, e.g. a grid with trailing columns
    className?: string;
    /// The trailing cells after the label
    children?: React.ReactNode;
}

/// An entry of a file tree: caret, icon and label in a padded, rounded card that highlights on hover.
/// Clickable entries are buttons, folders toggle themselves with their onClick.
export function TreeEntry({ depth, expanded, icon, label, selected, className, children, ...attributes }: TreeEntryProps): React.ReactElement {
    const Caret = expanded == null ? null : expanded ? ChevronDownIcon : ChevronRightIcon;
    const content = (
        <>
            <span className={classNames(styles.cell_name, icon == null && styles.cell_name_without_icon)}>
                <span className={styles.caret}>{Caret && <Caret size={12} />}</span>
                {icon != null && <span className={styles.icon} aria-hidden="true">{icon}</span>}
                {label}
            </span>
            {children}
        </>
    );
    const props = {
        ...attributes,
        className: classNames(styles.entry, attributes.onClick != null && styles.entry_interactive, selected && styles.entry_selected, className),
        style: { paddingLeft: TREE_ENTRY_PADDING_PX + depth * TREE_ENTRY_INDENT_PX },
    };
    return attributes.onClick == null
        ? <div {...props}>{content}</div>
        : <button type="button" aria-expanded={expanded} {...props}>{content}</button>;
}

export interface TreeEntryNameProps {
    /// The name of the entry
    children: string;
    /// The hover text, e.g. the full path
    title?: string;
}

/// The name of a tree entry, cut with an ellipsis instead of wrapping
export function TreeEntryName(props: TreeEntryNameProps): React.ReactElement {
    return <span className={styles.name} title={props.title ?? props.children}>{props.children}</span>;
}
