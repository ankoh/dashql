import * as React from 'react';

import { classNames } from '../../utils/classnames.js';
import icons from '@ankoh/dashql-svg-symbols';

import * as styles from './vertical_tabs.module.css';

type Key = number;

export interface VerticalTabRenderers<TabProps extends VerticalTabProps> {
    [key: Key]: (props: TabProps) => React.ReactElement;
}

export interface VerticalTabProps {
    tabId: number;
    icon: string;
    iconActive?: string;
    labelShort: string;
    labelLong?: string;
    disabled?: boolean;
}

export enum VerticalTabVariant {
    Stacked = 0,
    Wide = 1,
}

interface Props<TabProps extends VerticalTabProps> {
    className?: string;
    variant: VerticalTabVariant;
    tabKeys: Key[];
    tabProps: Record<Key, TabProps>;
    tabRenderers: VerticalTabRenderers<TabProps>;
    selectedTab: Key;
    selectTab: (tab: Key) => void;

    splitModeEnabled?: boolean;
    splitTab?: Key | null;
    primaryTabKey?: Key;
    onToggleSplitMode?: () => void;
    onSelectSplitTab?: (tab: Key) => void;
}

export function VerticalTabs<TabProps extends VerticalTabProps>(props: Props<TabProps>): React.ReactElement {
    const [splitRatio, setSplitRatio] = React.useState(0.4); // 40/60 by default
    const [isDragging, setIsDragging] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const selectTab = React.useCallback((elem: React.MouseEvent) => {
        const target = elem.currentTarget as HTMLDivElement;
        const tabId = Number.parseInt(target.dataset.tab ?? '0');

        if (props.splitModeEnabled) {
            // In split mode, clicking primary tab does nothing
            if (tabId === props.primaryTabKey) {
                return;
            }
            // Clicking other tabs sets them as the split tab
            if (props.onSelectSplitTab) {
                props.onSelectSplitTab(tabId);
            }
        } else {
            // Normal mode: select the tab as the main tab
            props.selectTab(tabId);
        }
    }, [props.splitModeEnabled, props.primaryTabKey, props.onSelectSplitTab, props.selectTab]);

    const handleResizeStart = React.useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleResizeMove = React.useCallback((e: MouseEvent) => {
        if (!isDragging || !containerRef.current) return;

        const container = containerRef.current;
        const rect = container.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const newRatio = Math.max(0.2, Math.min(0.8, y / rect.height));
        setSplitRatio(newRatio);
    }, [isDragging]);

    const handleResizeEnd = React.useCallback(() => {
        setIsDragging(false);
    }, []);

    React.useEffect(() => {
        if (isDragging) {
            document.addEventListener('mousemove', handleResizeMove);
            document.addEventListener('mouseup', handleResizeEnd);
            return () => {
                document.removeEventListener('mousemove', handleResizeMove);
                document.removeEventListener('mouseup', handleResizeEnd);
            };
        }
    }, [isDragging, handleResizeMove, handleResizeEnd]);

    // Render primary tab body
    const primaryTabKey = props.splitModeEnabled ? props.primaryTabKey ?? props.selectedTab : props.selectedTab;
    const primaryTabRenderer = props.tabRenderers[primaryTabKey];
    const primaryTabBody = primaryTabRenderer ? primaryTabRenderer(props.tabProps[primaryTabKey]) : undefined;

    // Render split tab body if split mode is enabled
    const splitTabRenderer = (props.splitModeEnabled && props.splitTab != null) ? props.tabRenderers[props.splitTab] : null;
    const splitTabBody = (splitTabRenderer && props.splitTab != null) ? splitTabRenderer(props.tabProps[props.splitTab]) : undefined;

    const renderStackedTab = (tabProps: VerticalTabProps) => {
        const isPrimaryTab = props.splitModeEnabled && tabProps.tabId === props.primaryTabKey;
        const isActive = isPrimaryTab || tabProps.tabId == props.selectedTab || (props.splitModeEnabled && tabProps.tabId === props.splitTab);
        const isSplitTab = props.splitModeEnabled && tabProps.tabId === props.splitTab;
        const showSplitIndicator = isPrimaryTab || isSplitTab;
        const splitNumber = isPrimaryTab ? '1' : '2';

        return (
            <div
                key={tabProps.tabId}
                className={classNames(styles.stacked_tab, {
                    [styles.stacked_tab_active]: isActive,
                    [styles.stacked_tab_disabled]: tabProps.disabled,
                })}
                data-tab={tabProps.tabId}
                onClick={tabProps.disabled ? undefined : selectTab}
            >
                <button className={classNames(styles.stacked_tab_icon, {
                    [styles.stacked_tab_icon_split]: showSplitIndicator,
                })}>
                    {showSplitIndicator ? (
                        <>
                            <div className={styles.stacked_tab_icon_half_first}>
                                <span className={styles.stacked_tab_split_number}>{splitNumber}</span>
                            </div>
                            <div className={styles.stacked_tab_icon_half}>
                                <svg width="12px" height="12px">
                                    <use xlinkHref={(isActive && tabProps.iconActive) ? tabProps.iconActive : tabProps.icon} />
                                </svg>
                            </div>
                        </>
                    ) : (
                        <svg width="18px" height="16px">
                            <use xlinkHref={(isActive && tabProps.iconActive) ? tabProps.iconActive : tabProps.icon} />
                        </svg>
                    )}
                </button>
                <div className={styles.stacked_tab_label}>{tabProps.labelShort}</div>
            </div>
        );
    };
    const renderWideTab = (tabProps: VerticalTabProps) => {
        const isPrimaryTab = props.splitModeEnabled && tabProps.tabId === props.primaryTabKey;
        const isActive = isPrimaryTab || tabProps.tabId == props.selectedTab || (props.splitModeEnabled && tabProps.tabId === props.splitTab);
        const isSplitTab = props.splitModeEnabled && tabProps.tabId === props.splitTab;
        const showSplitIndicator = isPrimaryTab || isSplitTab;
        const splitNumber = isPrimaryTab ? '1' : '2';

        return (
            <div
                key={tabProps.tabId}
                className={classNames(styles.wide_tab, {
                    [styles.wide_tab_active]: isActive,
                    [styles.wide_tab_disabled]: tabProps.disabled,
                })}
                data-tab={tabProps.tabId}
                onClick={tabProps.disabled ? undefined : selectTab}
            >
                <button className={classNames(styles.wide_tab_button, {
                    [styles.wide_tab_button_split]: showSplitIndicator,
                })}>
                    {showSplitIndicator ? (
                        <>
                            <div className={styles.wide_tab_icon_half_first}>
                                <span className={styles.wide_tab_split_number}>{splitNumber}</span>
                            </div>
                            <div className={styles.wide_tab_icon_half}>
                                <svg width="14px" height="14px">
                                    <use xlinkHref={(isActive && tabProps.iconActive) ? tabProps.iconActive : tabProps.icon} />
                                </svg>
                            </div>
                        </>
                    ) : (
                        <svg width="18px" height="16px">
                            <use xlinkHref={(isActive && tabProps.iconActive) ? tabProps.iconActive : tabProps.icon} />
                        </svg>
                    )}
                    <div className={styles.wide_tab_label}>{tabProps.labelShort}</div>
                </button>
            </div>
        );
    };
    const tabRenderer = props.variant == VerticalTabVariant.Stacked ? renderStackedTab : renderWideTab;

    // Check if there are at least 2 enabled tabs (so split mode makes sense)
    const enabledTabCount = props.tabKeys.filter(key => !props.tabProps[key]?.disabled).length;
    const canEnableSplit = enabledTabCount >= 2;

    const gridStyle = props.splitModeEnabled ? {
        gridTemplateRows: `${splitRatio * 100}% max-content 1fr`,
    } : undefined;

    return (
        <div
            ref={containerRef}
            className={classNames(props.className, styles.container, {
                [styles.container_split]: props.splitModeEnabled,
            })}
            style={gridStyle}
        >
            <div className={styles.tabs}>
                <div className={styles.tabs_list}>
                    {props.tabKeys.map(t => tabRenderer(props.tabProps[t]))}
                </div>
                {props.onToggleSplitMode && (
                    <div className={styles.tabs_footer}>
                        <div
                            className={classNames(styles.split_toggle, {
                                [styles.split_toggle_active]: props.splitModeEnabled,
                                [styles.split_toggle_disabled]: !canEnableSplit,
                            })}
                            onClick={canEnableSplit ? props.onToggleSplitMode : undefined}
                        >
                            <button className={styles.split_toggle_icon}>
                                <svg width="18px" height="16px">
                                    <use xlinkHref={`${icons}#vsplit_24`} />
                                </svg>
                            </button>
                        </div>
                    </div>
                )}
            </div>
            <div className={styles.primary_body}>{primaryTabBody}</div>
            {props.splitModeEnabled && (
                <>
                    <div
                        className={classNames(styles.resize_handle, {
                            [styles.resize_handle_dragging]: isDragging,
                        })}
                        onMouseDown={handleResizeStart}
                    >
                        <div className={styles.resize_handle_bar} />
                    </div>
                    {splitTabBody && (
                        <div className={styles.split_body}>{splitTabBody}</div>
                    )}
                </>
            )}
        </div>
    );
};
