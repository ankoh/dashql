import * as React from 'react';

import type { ModifyWorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { useWorkbookDerived } from '@akohn/dashql-react/hooks';
import { StageSection } from '../stage_section.js';
import { WorkbookInputCard } from './workbook_input_card.js';
import { useApplyWorkbookInput } from './use_apply_workbook_input.js';
import type { WorkbookInput } from '@akohn/dashql/platform/workbook/workbook_inputs';

import * as styles from './workbook_inputs.module.css';

interface Props {
    workbookId: string;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    className?: string;
}

const NO_INPUTS: WorkbookInput[] = [];

/// The inputs of a workbook as chips in the section "Parameters" at the top of a view. Renders nothing without inputs.
export function WorkbookInputStrip(props: Props): React.ReactElement | null {
    const inputs = useWorkbookDerived(props.workbookId)?.inputs ?? NO_INPUTS;
    const { apply, literalOf, busyInputs } = useApplyWorkbookInput(props.workbookId, props.modifyWorkbookScripts);
    if (inputs.length === 0) return null;
    return (
        <StageSection label="Parameters" className={props.className} testId="workbook-input-strip">
            <div className={styles.chips} role="group" aria-label="Inputs of the workbook">
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
        </StageSection>
    );
}
