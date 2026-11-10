import * as React from 'react';

import * as pageStyles from './app_loading_page.module.css';

import { IndicatorStatus, StatusIndicator } from '../ui/foundations/status_indicator.js';

/// A step of a setup, e.g. of the app or of an import
export interface SetupStep {
    /// The key of the step among its steps
    key: string;
    /// The name of the step
    label: string;
    status: IndicatorStatus;
    /// A short detail in front of the status, e.g. a count
    detail?: string | null;
    /// The test id of the status
    testId?: string;
}

/// The steps of a setup with their status, the setup of the app and the import of a session show them alike
export function SetupSteps(props: { steps: SetupStep[]; compact?: boolean }): React.ReactElement {
    return (
        <div className={`${pageStyles.detail_entries} ${props.compact ? pageStyles.detail_entries_compact : ''}`}>
            {props.steps.map(step => (
                <React.Fragment key={step.key}>
                    <div className={pageStyles.detail_entry_key}>
                        {step.label}
                    </div>
                    <div className={pageStyles.detail_entry_value} data-testid={step.testId} data-status={IndicatorStatus[step.status]}>
                        {step.detail != null && <span className={pageStyles.detail_entry_detail}>{step.detail}</span>}
                        <StatusIndicator
                            className={pageStyles.loading_status_indicator}
                            fill="var(--color_fg)"
                            width={"14px"}
                            height={"14px"}
                            status={step.status}
                        />
                    </div>
                </React.Fragment>
            ))}
        </div>
    );
}
