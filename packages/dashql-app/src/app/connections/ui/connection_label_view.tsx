import * as React from 'react';
import * as styles from './connection_label_view.module.css';

import type { ConnectionLabelParts } from './connection_label.js';
import { Tag } from '../../../ui/foundations/tag.js';
import { classNames } from '../../../utils/classnames.js';

/// The label of a connection, the protocol is a small muted tag.
/// The label fills its row and the tag sits at the right end, an inline label puts the tag right
/// after the name, e.g. in a title.
export function ConnectionLabelView(props: { parts: ConnectionLabelParts, inline?: boolean }): React.ReactElement {
    const { name, detail } = props.parts;
    return (
        <span className={classNames(styles.label, props.inline && styles.inline)}>
            <span className={styles.name}>{name}</span> <ConnectionProtocolTag detail={detail} />
        </span>
    );
}

/// The protocol of a connection as a tag, e.g. "wasm"
export function ConnectionProtocolTag(props: { detail: string }): React.ReactElement {
    return <Tag className={styles.detail}>{props.detail}</Tag>;
}
