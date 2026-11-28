import * as React from 'react';
import * as styles from './console_results.module.css';

import type { ScriptModel } from '@akohn/dashql-react/models/script_model';
import { Button, ButtonSize, ButtonVariant } from '@akohn/dashql-react/components/button';
import { IndicatorStatus } from '@akohn/dashql-react/components/status_indicator';
import { SymbolIcon } from '@akohn/dashql-react/components/symbol_icon';
import { useObservedSize } from '@akohn/dashql-react/components/size_observer';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import { EntryStatusBar } from '../entry_status_bar.js';
import { deriveEntryStatus, EntryStatusKind } from '../entry_status_model.js';
import { FeedEntryFooter, FeedEntryTabStrip, useFeedEntryTabs } from '../feed/feed_entry_footer.js';

const RunIcon = SymbolIcon('paper_airplane_16');

interface Props {
    model: ScriptModel;
    /// Can the script run? Its connection is online and the workbook isn't read-only.
    runnable: boolean;
}

/// The results of the latest query of the script of the console: the status bar with the result tabs and Run, the
/// panel of the selected tab fills the space below it
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
    const { run, cancel } = model;
    return (
        <div className={styles.results}>
            <EntryStatusBar
                status={status}
                expanded={status.kind !== EntryStatusKind.Idle}
                compact
                onCancel={running ? () => void cancel() : undefined}
                cancelLabel="Cancel query"
                tabs={<FeedEntryTabStrip tabs={tabs} />}
                actions={!running && (
                    <Button
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        leadingVisual={<RunIcon size={12} />}
                        onClick={() => void run()}
                        disabled={!props.runnable || model.runActive}
                        aria-label={`Run ${scriptDisplayName(model.script.fileName)}`}
                        data-testid="console-run"
                    >
                        Run
                    </Button>
                )}
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
