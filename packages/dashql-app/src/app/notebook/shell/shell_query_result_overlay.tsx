import * as React from 'react';
import icons from '@ankoh/dashql-svg-symbols';

import type { QueryExecutionState } from '../connections/query_execution_state.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../../ui/foundations/button.js';
import { useFocusTrap } from '../../../ui/foundations/focus.js';
import { Overlay, OverlaySize } from '../../../ui/foundations/overlay.js';
import { SymbolIcon } from '../../../ui/foundations/symbol_icon.js';
import { VerticalTabs, VerticalTabProps, VerticalTabVariant } from '../../../ui/foundations/vertical_tabs.js';
import { QueryResultDetails } from '../compute/ui/query_result/query_result_details.js';
import { TableColumnHeader } from '../compute/ui/query_result/data_table_cell.js';
import { PlanView } from '../compute/ui/plan/plan_view.js';
import { useHyperPlan } from '../compute/ui/plan/hyper_plan_view.js';
import { TabHeader } from '../ui/tab_header.js';
import { getPlanResultText } from '../../../shell/shell_result.js';
import * as styles from './shell_query_result_overlay.module.css';

interface Props {
    query: QueryExecutionState;
    onClose: () => void;
    dismissOnClickOutside?: boolean;
}

const MAX_OVERLAY_HEIGHT = 600;
const IGNORE_OUTSIDE_CLICK = () => {};

const enum ResultTab {
    Data = 0,
    Plan = 1,
}

export const ShellQueryResultOverlay: React.FC<Props> = ({ query, onClose, dismissOnClickOutside = true }) => {
    const closeRef = React.useRef<HTMLButtonElement>(null);
    const dialogRef = React.useRef<HTMLElement>(null);
    const CloseIcon = SymbolIcon('x_16');
    const planText = React.useMemo(() => getPlanResultText(query.resultTable), [query.resultTable]);
    const { plan } = useHyperPlan(planText);
    const hasPlan = plan != null;
    const [selectedTab, setSelectedTab] = React.useState<ResultTab>(ResultTab.Data);
    const selectedPlanRef = React.useRef(false);
    React.useEffect(() => {
        selectedPlanRef.current = false;
        setSelectedTab(ResultTab.Data);
    }, [query.queryId]);
    React.useEffect(() => {
        if (hasPlan && !selectedPlanRef.current) {
            selectedPlanRef.current = true;
            setSelectedTab(ResultTab.Plan);
        } else if (!hasPlan && selectedTab === ResultTab.Plan) {
            setSelectedTab(ResultTab.Data);
        }
    }, [hasPlan, selectedTab]);

    const closeButton = (
        <IconButton
            ref={closeRef}
            variant={ButtonVariant.Invisible}
            size={ButtonSize.Small}
            aria-label="Close shell query results"
            onClick={onClose}
        >
            <CloseIcon size={16} />
        </IconButton>
    );
    const tabProps = React.useMemo<Record<ResultTab, VerticalTabProps>>(() => ({
        [ResultTab.Data]: {
            tabId: ResultTab.Data,
            icon: `${icons}#table_24`,
            labelShort: 'Data',
            ariaLabel: 'Query results',
            description: 'Query results',
        },
        [ResultTab.Plan]: {
            tabId: ResultTab.Plan,
            icon: `${icons}#plan`,
            labelShort: 'Plan',
            ariaLabel: 'Query plan',
            description: 'Query plan',
            disabled: !hasPlan,
        },
    }), [hasPlan]);
    const tabKeys = React.useMemo(() => hasPlan ? [ResultTab.Data, ResultTab.Plan] : [ResultTab.Data], [hasPlan]);
    const tabRenderers = React.useMemo(() => ({
        [ResultTab.Data]: () => (
            <QueryResultDetails
                query={query}
                debugMode={false}
                fitHeight
                maxHeight={MAX_OVERLAY_HEIGHT}
                columnHeader={TableColumnHeader.WithColumnPlots}
                actions={closeButton}
            />
        ),
        [ResultTab.Plan]: () => (
            <div className={styles.plan_tab}>
                <TabHeader title="Query Plan" actions={closeButton} />
                <div className={styles.plan_body}>{plan != null && <PlanView plan={plan} />}</div>
            </div>
        ),
    }), [closeButton, plan, query]);
    useFocusTrap({
        containerRef: dialogRef as React.RefObject<HTMLElement>,
        initialFocusRef: closeRef as React.RefObject<HTMLElement>,
        restoreFocusOnCleanUp: true,
    });
    return (
        <Overlay
            centered
            width={OverlaySize.XXL}
            height={OverlaySize.AUTO}
            maxHeight={OverlaySize.XL}
            initialFocusRef={closeRef}
            onEscape={onClose}
            onClickOutside={dismissOnClickOutside ? onClose : IGNORE_OUTSIDE_CLICK}
        >
            <section ref={dialogRef} className={styles.card} role="dialog" aria-modal="true" aria-label="Shell query results">
                <VerticalTabs
                    className={styles.tabs}
                    variant={VerticalTabVariant.Stacked}
                    tabKeys={tabKeys}
                    tabProps={tabProps}
                    tabRenderers={tabRenderers}
                    selectedTab={selectedTab}
                    selectTab={tab => setSelectedTab(tab as ResultTab)}
                />
            </section>
        </Overlay>
    );
};
