import * as React from 'react';

import type { ConnectionState } from '../../connection/connection_state.js';
import type { NotebookState } from '../../notebook/notebook_state.js';
import * as ActionList from '../foundations/action_list.js';
import { ConnectionCommandList } from './notebook_command_lists.js';
import * as styles from './notebook_connection_section.module.css';

interface Props {
    conn: ConnectionState | null;
    notebook: NotebookState;
    onOpenSettings: (anchor: HTMLButtonElement | null) => void;
    actions: React.ReactElement;
}

export const NotebookConnectionSection: React.FC<Props> = (props) => {
    const settingsRef = React.useRef<HTMLButtonElement>(null);
    return (
        <section className={styles.section} aria-label="Connection">
            <ActionList.List>
                <ConnectionCommandList
                    conn={props.conn}
                    notebook={props.notebook}
                    onOpenSettings={() => props.onOpenSettings(settingsRef.current)}
                    settingsRef={settingsRef}
                />
                {props.actions}
            </ActionList.List>
        </section>
    );
};
