import * as React from 'react';
import * as styles from './console_results.module.css';

import type { ScriptModel } from '@akohn/dashql-react/models/script_model';
import { IndicatorStatus } from '@akohn/dashql-react/components/status_indicator';
import { useObservedSize } from '@akohn/dashql-react/components/size_observer';
import { EntryStatusBar } from '../entry_status_bar.js';
import { deriveEntryStatus, EntryStatusKind } from '../entry_status_model.js';
import { FeedEntryFooter, FeedEntryTabStrip, useFeedEntryTabs } from '../feed/feed_entry_footer.js';

interface Props {
    model: ScriptModel;
}

/// The results of the latest query of the script of the console: the status bar with the result tabs and Cancel, the
/// panel of the selected tab fills the space below it. The script runs from the bar of the workbook.
export function ConsoleResults(props: Props): React.ReactElement {
    const { model } = props;
    const query = model.query;
    const state = query?.query ?? null;
    const status = deriveEntryStatus(state, state?.progress ?? null);
    const visualizeQuery = model.script.annotations.visualizeQuery ?? null;
    const tabs = useFeedEntryTabs(query, visualizeQuery);
    const panelRef = React.useRef<HTMLDivElement>(null);
    const panelHeight = Math.floor(useObservedSize(panelRef)?.height ?? 0);
    const running = status.indicator === IndicatorStatus.Running;
    const { cancel } = model;
    return (
        <div className={styles.results}>
            <EntryStatusBar
                status={status}
                expanded={status.kind !== EntryStatusKind.Idle}
                compact
                onCancel={running ? () => void cancel() : undefined}
                cancelLabel="Cancel query"
                tabs={<FeedEntryTabStrip tabs={tabs} />}
            />
            <div ref={panelRef} className={styles.panel}>
                {query != null && panelHeight > 0 && (
                    <FeedEntryFooter
                        workbookId={model.workbookId}
                        model={query}
                        visualizeQuery={visualizeQuery}
                        selectedTab={tabs.selectedTab}
                        panelHeight={panelHeight}
                    />
                )}
            </div>
        </div>
    );
}
