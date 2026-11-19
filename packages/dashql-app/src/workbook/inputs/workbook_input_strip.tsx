import * as React from 'react';

import { classNames } from '@akohn/dashql-react/dom/classnames';
import type { ModifyWorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { useWorkbookDerived } from '@akohn/dashql-react/hooks';
import { WorkbookInputCard } from './workbook_input_card.js';
import { useApplyWorkbookInput } from './use_apply_workbook_input.js';
import type { WorkbookInput } from '@akohn/dashql/platform/workbook/workbook_inputs';

import * as styles from './workbook_inputs.module.css';

interface Props {
    workbookId: string;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    /// Chips that go before the inputs, e.g. the attachments of the feed
    leading?: React.ReactNode;
    /// Content below the chips, e.g. the open drawer of the attachments
    below?: React.ReactNode;
    className?: string;
}

const NO_INPUTS: WorkbookInput[] = [];

/// The inputs of a workbook as chips on a bar at the top of a view. Renders nothing
/// without inputs and leading chips.
export function WorkbookInputStrip(props: Props): React.ReactElement | null {
    const inputs = useWorkbookDerived(props.workbookId)?.inputs ?? NO_INPUTS;
    const { apply, literalOf, busyInputs } = useApplyWorkbookInput(props.workbookId, props.modifyWorkbookScripts);
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
