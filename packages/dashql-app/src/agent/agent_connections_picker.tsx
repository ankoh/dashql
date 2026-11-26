import * as React from 'react';
import * as styles from '../workbook/scripts/script_connection_picker.module.css';

import { Button, ButtonSize, ButtonVariant } from '@akohn/dashql-react/components/button';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { ConnectionMenu } from '../workbook/scripts/script_connection_picker.js';
import { useConnectionList, useConnections, useWorkbook } from '@akohn/dashql-react/hooks';
import { agentConnections } from './agent_connections.js';
import type { AgentControls } from './agent_provider.js';

interface Props {
    /// The workbook whose connections come first
    workbookId: string;
    /// The connections of the agent and how to change them
    connect: Pick<AgentControls, 'isConnectionAllowed' | 'toggleConnection'>;
}

/// The connections that the agent may use, `2 / 4 connections`: the menu of the connections with a checkbox each,
/// `dashql run` refuses the unticked ones
export const AgentConnectionsPicker: React.FC<Props> = (props) => {
    const [open, setOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const connections = useConnections();
    const list = useConnectionList();
    const workbook = useWorkbook(props.workbookId);
    const { isConnectionAllowed, toggleConnection } = props.connect;
    const isAllowed = React.useCallback(
        (connectionId: string) => workbook != null && isConnectionAllowed(workbook, connectionId),
        [workbook, isConnectionAllowed],
    );
    const toggle = React.useCallback((connectionId: string) => {
        if (workbook != null) toggleConnection(workbook, connectionId);
    }, [workbook, toggleConnection]);
    const { listed, allowed } = React.useMemo(() => agentConnections(connections, list, isAllowed), [connections, list, isAllowed]);
    const label = `${allowed.length} / ${listed} connections`;
    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            anchorOffset={4}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            renderAnchor={(anchorProps) => (
                <Button
                    {...anchorProps}
                    ref={triggerRef}
                    className={styles.trigger}
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    aria-label={`Connections of the agent: ${label}`}
                    data-testid="composer-agent-connections"
                    title="The connections that the agent may use"
                >
                    <span className={styles.trigger_label}>{label}</span>
                </Button>
            )}
        >
            <ConnectionMenu
                workbookId={props.workbookId}
                label="the agent"
                connectionId={null}
                onPick={toggle}
                checked={isAllowed}
            />
        </AnchoredOverlay>
    );
};
