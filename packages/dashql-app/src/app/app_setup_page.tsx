import * as React from 'react';

import * as baseStyles from '@akohn/dashql-react/components/banner_page.module.css';
import * as pageStyles from './app_loading_page.module.css';

import { IndicatorStatus } from '@akohn/dashql-react/components/status_indicator';
import { SetupSteps } from './setup_steps.js';
import { CompactNavBar } from './navbar.js';

/// The steps of the setup of the app, in the order they are shown
const APP_SETUP_STEPS = {
    applyMigrations: 'Apply Migrations',
    initializeCore: 'Initialize Core',
    initializeHyperDB: 'Initialize HyperDB',
    discoverWorkbooks: 'Discover Workbooks',
    loadWorkbookScripts: 'Load Workbook Scripts',
};

/// The status of every step of the setup of the app
export type AppSetupStatus = Record<keyof typeof APP_SETUP_STEPS, IndicatorStatus>;

/// The status of a setup that has not started any step
export const APP_SETUP_NOT_STARTED: AppSetupStatus = {
    applyMigrations: IndicatorStatus.None,
    initializeCore: IndicatorStatus.None,
    initializeHyperDB: IndicatorStatus.None,
    discoverWorkbooks: IndicatorStatus.None,
    loadWorkbookScripts: IndicatorStatus.None,
};

interface AppSetupPageProps {
    /// The status of every step
    status: AppSetupStatus;
    /// Why the setup failed, shown below the steps
    error?: string | null;
    /// Show the internals button in the navbar? Its providers may not be set up yet
    showInternals?: boolean;
    /// The actions at the bottom of the card
    actions?: React.ReactNode;
}

/// The page that shows the steps of the setup of the app.
/// It needs no app providers, the storage shows it while it is migrated.
export const AppSetupPage: React.FC<AppSetupPageProps> = (props: AppSetupPageProps) => (
    <div className={`${baseStyles.page} ${pageStyles.page}`} data-electron-drag-region>
        <CompactNavBar showInternals={props.showInternals} />
        <div className={`${baseStyles.banner_and_content_container} ${pageStyles.foreground}`} data-electron-drag-region>
            <div className={baseStyles.content_container} data-electron-drag-region>
                <div className={baseStyles.card}>
                    <div className={baseStyles.card_header} data-electron-drag-region>
                        <div className={baseStyles.card_header_left_container}>
                            <div className={baseStyles.card_header_left_title}>
                                Setup
                            </div>
                        </div>
                    </div>
                    <div className={baseStyles.card_section}>
                        <div className={baseStyles.section_entries}>
                            <SetupSteps steps={(Object.keys(APP_SETUP_STEPS) as (keyof typeof APP_SETUP_STEPS)[]).map(step => ({
                                key: step,
                                label: APP_SETUP_STEPS[step],
                                status: props.status[step],
                                testId: `app-setup-${step}`,
                            }))} />
                            {props.error != null && (
                                <div className={pageStyles.detail_error} data-testid="app-setup-error">{props.error}</div>
                            )}
                        </div>
                        {props.actions}
                    </div>
                </div>
            </div>
        </div>
    </div>
);
