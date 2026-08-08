import * as React from 'react';

import { ScreenNormalIcon } from '@primer/octicons-react';

import type { QueryExecutionState } from '../../../connection/query_execution_state.js';
import type { ResolvedVisualizeQuery } from '../../../scripts/script_types.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../foundations/button.js';
import { ScriptOutputDetails } from '../script_output_details.js';
import * as styles from './notebook_shell.module.css';

interface Props {
    query: QueryExecutionState;
    visualizeQuery: ResolvedVisualizeQuery | null;
    onCancel: () => void;
    onClose: () => void;
}

export const ShellResultDetails: React.FC<Props> = ({ query, visualizeQuery, onCancel, onClose }) => (
    <section className={styles.result_details} aria-label="Shell query result details">
        <div className={styles.result_details_card}>
            <ScriptOutputDetails
                query={query}
                visualizeQuery={visualizeQuery}
                tableDebugMode={false}
                onCancelQuery={onCancel}
                onClose={onClose}
                statusActions={(
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        onClick={onClose}
                        aria-label="Collapse query results"
                    >
                        <ScreenNormalIcon size={16} />
                    </IconButton>
                )}
            />
        </div>
    </section>
);
