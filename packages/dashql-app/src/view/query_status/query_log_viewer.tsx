import * as React from 'react';
import * as styles from './query_log_viewer.module.css';

import { XIcon } from '@primer/octicons-react';

import { QueryInfoListView } from './query_info_list_view.js';
import { ButtonVariant, IconButton } from '../../view/foundations/button.js';

interface Props {
    onClose: () => void;
}


export function QueryLogViewer(props: Props) {
    return (
        <div className={styles.overlay}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.title}>Queries</div>
                </div>
                <div className={styles.header_right_container}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="Close"
                        onClick={props.onClose}
                    >
                        <XIcon />
                    </IconButton>
                </div>
            </div>
            <div className={styles.query_summary_list}>
                <QueryInfoListView />
            </div>
        </div>
    );
}
