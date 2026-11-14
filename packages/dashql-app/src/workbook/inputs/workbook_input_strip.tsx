import * as React from 'react';

import { classNames } from '../../utils/classnames.js';
import type { WorkbookScripts } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts';
import type { ModifyWorkbookScripts } from '../scripts/workbook_scripts_registry.js';
import { WorkbookInputCard } from './workbook_input_card.js';
import { useApplyWorkbookInput } from './use_apply_workbook_input.js';
import { deriveWorkbookInputs } from '@ankoh/dashql-sdk/workbook/inputs/workbook_inputs';

import * as styles from './workbook_inputs.module.css';

interface Props {
    workbookScripts: WorkbookScripts;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    /// Chips that go before the inputs, e.g. the attachments of the feed
    leading?: React.ReactNode;
    /// Content below the chips, e.g. the open drawer of the attachments
    below?: React.ReactNode;
    className?: string;
}

/// The inputs of a workbook as chips on a bar at the top of a view. Renders nothing
/// without inputs and leading chips.
export function WorkbookInputStrip(props: Props): React.ReactElement | null {
    const inputs = deriveWorkbookInputs(props.workbookScripts);
    const { apply, literalOf, busyInputs } = useApplyWorkbookInput(props.workbookScripts, props.modifyWorkbookScripts);
    const empty = inputs.length === 0 && props.leading == null;
    if (empty) return null;
    return (
        <div className={classNames(styles.strip, props.className)} data-testid="workbook-input-strip">
            <div className={styles.chips} role="group" aria-label="Inputs of the workbook">
                {props.leading}
                {inputs.map(input => (
                    <WorkbookInputCard
                        key={input.name}
                        input={input}
                        busy={busyInputs.has(input.name)}
                        literalOf={literalOf}
                        onCommit={apply}
                    />
                ))}
            </div>
            {props.below}
        </div>
    );
}
