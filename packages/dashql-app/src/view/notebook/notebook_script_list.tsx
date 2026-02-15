import * as React from 'react';
import * as styles from './notebook_page.module.css';

import type { Icon } from '@primer/octicons-react';

import { ButtonVariant, IconButton } from '../foundations/button.js';
import { IndicatorStatus, StatusIndicator } from '../foundations/status_indicator.js';
import { getSelectedPageEntries, NotebookState } from '../../notebook/notebook_state.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';

export interface NotebookScriptListProps {
    notebook: NotebookState;
    showDetails: () => void;
}

export const NotebookScriptList: React.FC<NotebookScriptListProps> = (props) => {
    const out: React.ReactElement[] = [];
    const ScreenFullIcon: Icon = SymbolIcon('screen_full_16');
    const entries = getSelectedPageEntries(props.notebook);
    for (let wi = 0; wi < entries.length; ++wi) {
        out.push(
            <div key={wi} className={styles.collection_entry_card}>
                <div key={wi} className={styles.collection_entry_header}>
                    <IconButton
                        className={styles.entry_status_indicator_button}
                        variant={ButtonVariant.Invisible}
                        aria-label="expand"
                        aria-labelledby="expand-entry"
                    >
                        <StatusIndicator
                            className={styles.collection_entry_status_indicator_button}
                            fill="black"
                            width={"14px"}
                            height={"14px"}
                            status={IndicatorStatus.Succeeded}
                        />
                    </IconButton>
                    <IconButton
                        className={styles.collection_entry_expand_button}
                        variant={ButtonVariant.Invisible}
                        onClick={props.showDetails}
                        aria-label="expand"
                        aria-labelledby="expand-entry"
                    >
                        <ScreenFullIcon size={16} />
                    </IconButton>
                </div>
                <div className={styles.collection_body} />
            </div>
        );
    }
    return (
        <div className={styles.collection_body_container}>
            <div className={styles.collection_entry_list}>
                {out}
            </div>
        </div>
    );
};
