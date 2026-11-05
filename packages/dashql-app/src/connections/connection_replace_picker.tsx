import * as React from 'react';
import symbols from '@ankoh/dashql-svg-symbols';

import * as ActionList from '../ui/foundations/action_list.js';
import { Button, ButtonSize, ButtonVariant } from '../ui/foundations/button.js';
import { ConnectionHealth, type ConnectionState } from './connection_state.js';
import { CONNECTION_HEALTH_COLORS } from './connection_status.js';
import { connectionLabelText, type ConnectionLabelParts } from './connection_label.js';
import { ConnectionLabelView } from './connection_label_view.js';
import type { ConnectionReplaceCandidates } from './connection_replace.js';
import * as styles from './connection_replace_picker.module.css';
import { CONNECTOR_ICON_STYLE, useConnectorIcon } from './connector_icon.js';

interface Props {
    /// The connection that is replaced
    source: ConnectionState;
    /// The connections that can replace it
    candidates: ConnectionReplaceCandidates;
    /// Label a connection
    labelOf: (database: ConnectionState) => ConnectionLabelParts;
    /// Go back without replacing
    onCancel: () => void;
    /// Replace the connection with the picked one
    onConfirm: (targetId: string) => void;
}

/// Pick the connection that replaces a connection, the connections of the same connector first
export const ConnectionReplacePicker: React.FC<Props> = ({ source, candidates, labelOf, onCancel, onConfirm }) => {
    const connectorIcon = useConnectorIcon();
    const [selected, setSelected] = React.useState<string | null>(null);
    const sourceLabel = connectionLabelText(labelOf(source));
    const renderItem = (connection: ConnectionState) => (
        <ActionList.ListItem
            key={connection.connectionId}
            data-testid="connection-replace-option"
            data-connection-id={connection.connectionId}
            selected={connection.connectionId === selected}
            onClick={() => setSelected(connection.connectionId)}
            onDoubleClick={() => onConfirm(connection.connectionId)}
        >
            <ActionList.Leading>
                <svg className={styles.connector_icon} width="16px" height="16px" aria-hidden="true">
                    <use xlinkHref={`${symbols}#${connectorIcon(connection.connectorInfo)}`} style={CONNECTOR_ICON_STYLE} />
                </svg>
            </ActionList.Leading>
            <ActionList.ItemText>
                <ActionList.ItemTextTitle>
                    <ConnectionLabelView parts={labelOf(connection)} />
                </ActionList.ItemTextTitle>
            </ActionList.ItemText>
            <ActionList.Trailing>
                <svg width="16px" height="16px" viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="8" r="4" style={{ fill: CONNECTION_HEALTH_COLORS[connection.connectionHealth] ?? CONNECTION_HEALTH_COLORS[ConnectionHealth.NOT_STARTED] }} />
                </svg>
            </ActionList.Trailing>
        </ActionList.ListItem>
    );
    return (
        <div className={styles.picker} role="dialog" aria-label={`Replace ${sourceLabel}`} data-testid="connection-replace-picker">
            <div className={styles.header}>
                <span className={styles.title}>Replace with</span>
                <span className={styles.subtitle}>{sourceLabel}</span>
            </div>
            <ActionList.List className={styles.list} aria-label={`Connections that replace ${sourceLabel}`}>
                {/* The list takes elements only, the fragments wrap the optional groups */}
                <>{candidates.sameConnector.length > 0 && (
                    <>
                        <ActionList.GroupHeading>{source.connectorInfo.names.displayShort}</ActionList.GroupHeading>
                        {candidates.sameConnector.map(renderItem)}
                    </>
                )}</>
                <>{candidates.otherConnectors.length > 0 && (
                    <>
                        <ActionList.GroupHeading>Other connectors</ActionList.GroupHeading>
                        {candidates.otherConnectors.map(renderItem)}
                    </>
                )}</>
            </ActionList.List>
            <div className={styles.footer}>
                <span className={styles.note}>The sessions move to the picked connection, then this one is removed.</span>
                <div className={styles.actions}>
                    <Button size={ButtonSize.Small} onClick={onCancel} data-testid="connection-replace-cancel">Cancel</Button>
                    <Button
                        size={ButtonSize.Small}
                        variant={ButtonVariant.Primary}
                        disabled={selected == null}
                        onClick={() => { if (selected != null) onConfirm(selected); }}
                        data-testid="connection-replace-confirm"
                    >
                        Replace
                    </Button>
                </div>
            </div>
        </div>
    );
};
