import * as React from 'react';
import * as styles from './notebook_page_overview.module.css';

import { CodeIcon, GraphIcon } from '@primer/octicons-react';

import { classNames } from '../../utils/classnames.js';
import { NodePort } from '../../utils/graph_edges.js';
import { ScriptData } from '../../notebook/notebook_state.js';
import { scriptDisplayName } from '../../notebook/notebook_types.js';
import { OverviewRect } from '../../notebook/overview_layout.js';
import { useQueryState } from '../../connection/query_executor.js';
import { SegmentedControl, SegmentedControlSize, SegmentedControlVariant } from '../foundations/segmented_control.js';
import { VisualizationDispatch } from '../visualization/visualization_dispatch.js';
import { ScriptPreview } from './notebook_script_preview.js';

interface OverviewCardProps {
    sessionId: string;
    rect: OverviewRect;
    scriptData: ScriptData | undefined;
    /// Union bitmask of the ports this card has an edge on (NodePort values).
    ports: number;
    /// Subset of `ports` whose edge is focused, so those ports render highlighted.
    focusedPorts: number;
    /// Open this entry's script details. Fired on a single click anywhere on the card except the
    /// header body toggle.
    onOpen: (fileName: string) => void;
}

/// Maps a NodePort to its CSS placement class. Revived from the catalog
/// renderer's `node_port_{north,east,south,west}` rules.
const PORT_PLACEMENT_CLASS: Record<NodePort, string> = {
    [NodePort.North]: styles.node_port_north,
    [NodePort.East]: styles.node_port_east,
    [NodePort.South]: styles.node_port_south,
    [NodePort.West]: styles.node_port_west,
};

/// Render one circular port element for a side the card has an edge on.
function renderPort(port: NodePort, ports: number, focusedPorts: number): React.ReactElement | null {
    if ((ports & port) === 0) return null;
    const focused = (focusedPorts & port) !== 0;
    return (
        <div
            key={port}
            className={classNames(PORT_PLACEMENT_CLASS[port], styles.node_port_border_default, {
                [styles.node_port_focused]: focused,
            })}
            data-port={port}
        />
    );
}

/// Which body a vis card is currently showing. The numeric values are the segmented-control child
/// indices, so `onChange`'s `selectedIndex` maps straight to a `CardBody`.
enum CardBody {
    Visualization = 0,
    Script = 1,
}

/// Uniform down-scale for the chart in the cramped grid card, so labels/marks/axes read as a
/// compact thumbnail rather than a full-size chart squeezed into ~200px.
const GRID_VISUALIZATION_SCALE = 0.7;

/// A single fixed-size overview card: header with the entry's display name, body
/// showing the compact SQL, and a `node_ports` overlay marking exactly where the
/// dependency edges attach. Revived from the catalog renderer's node + ports DOM,
/// but with `ScriptPreview` as the body instead of a plain label.
///
/// A card whose script carries a resolved VISUALIZE query is a "vis card": its header gains a
/// tiny segmented control that toggles the body between the compact script preview and the
/// rendered visualization (defaulting to the visualization). Plain script cards omit the toggle.
export function OverviewCard(props: OverviewCardProps): React.ReactElement {
    const { rect, scriptData, ports, focusedPorts } = props;
    const displayName = scriptDisplayName(rect.fileName);

    const visualizeQuery = scriptData?.annotations.visualizeQuery ?? null;
    const isVisCard = visualizeQuery != null;
    const queryState = useQueryState(props.sessionId, scriptData?.latestQueryId ?? null);

    // Vis cards default to the rendered visualization; script cards only ever show the script.
    const [body, setBody] = React.useState<CardBody>(CardBody.Visualization);
    const showVisualization = isVisCard && body === CardBody.Visualization;

    // Measure the visualization container so the chart can be sized to an exact px box (Vega-Lite
    // overflows its container otherwise). ResizeObserver keeps it correct across grid relayouts.
    const [visSize, setVisSize] = React.useState<{ width: number; height: number } | null>(null);
    const visContainerRef = React.useRef<HTMLDivElement | null>(null);
    React.useLayoutEffect(() => {
        const el = visContainerRef.current;
        if (el == null) return;
        const observer = new ResizeObserver(() => {
            const width = Math.floor(el.clientWidth);
            const height = Math.floor(el.clientHeight);
            if (width > 0 && height > 0) {
                setVisSize(prev => (prev?.width === width && prev?.height === height ? prev : { width, height }));
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [showVisualization]);

    const handleClick = React.useCallback(() => {
        props.onOpen(rect.fileName);
    }, [props.onOpen, rect.fileName]);
    // The body toggle lives inside the card, whose click handler opens the script details. Stop the
    // click at the control so switching the body (script ↔ visualization) doesn't also navigate.
    const stopPropagation = React.useCallback((event: React.SyntheticEvent) => {
        event.stopPropagation();
    }, []);

    return (
        <div
            className={styles.card}
            style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
            }}
            onClick={handleClick}
            data-file={rect.fileName}
        >
            <div className={styles.card_frame}>
                <div className={styles.card_header}>
                    <div className={styles.card_label}>{displayName}</div>
                    {isVisCard && (
                        <SegmentedControl
                            className={styles.card_body_toggle}
                            aria-label="Toggle card body"
                            size={SegmentedControlSize.XXSmall}
                            variant={SegmentedControlVariant.Default}
                            onChange={selectedIndex => setBody(selectedIndex as CardBody)}
                        >
                            <SegmentedControl.IconButton
                                icon={GraphIcon}
                                aria-label="Show visualization"
                                selected={body === CardBody.Visualization}
                                onClick={stopPropagation}
                            />
                            <SegmentedControl.IconButton
                                icon={CodeIcon}
                                aria-label="Show script"
                                selected={body === CardBody.Script}
                                onClick={stopPropagation}
                            />
                        </SegmentedControl>
                    )}
                </div>
                <div className={styles.card_body}>
                    {showVisualization ? (
                        <div className={styles.card_visualization} ref={visContainerRef}>
                            {visSize && (
                                <VisualizationDispatch
                                    query={queryState}
                                    visualizeQuery={visualizeQuery}
                                    width={visSize.width}
                                    height={visSize.height}
                                    scale={GRID_VISUALIZATION_SCALE}
                                    interactive={false}
                                    wheelZoom={false}
                                />
                            )}
                        </div>
                    ) : (
                        scriptData && (
                            <ScriptPreview
                                className={styles.card_preview}
                                sessionId={props.sessionId}
                                scriptData={scriptData}
                            />
                        )
                    )}
                </div>
            </div>
            <div className={styles.node_ports}>
                {renderPort(NodePort.North, ports, focusedPorts)}
                {renderPort(NodePort.East, ports, focusedPorts)}
                {renderPort(NodePort.South, ports, focusedPorts)}
                {renderPort(NodePort.West, ports, focusedPorts)}
            </div>
        </div>
    );
}
