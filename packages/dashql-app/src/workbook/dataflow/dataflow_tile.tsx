import * as React from 'react';

import { QueryExecutionStatus, queryIsDone } from '@akohn/dashql/platform/query/query_execution_state';
import type { ResolvedVisualizeQuery } from '@akohn/dashql/platform/workbook/script_types';
import type { ScriptData } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { readKpi } from '@akohn/dashql/platform/workbook/kpi_reading';
import type { QueryModel } from '@akohn/dashql-react/models/query_model';
import { useResultRows } from '@akohn/dashql-react/components/visualization/result_rows';
import * as styles from './dataflow.module.css';

// The tile of a box of the dataflow canvas (docs/design/dataflow.md): the level of detail of a box whose text would be
// too small to read, and every box of the dense layout of a narrow canvas. A tile shows the name, a status dot and a
// line about the result at a size that stays legible, no rows and no renderers of the result.

/// The text of a tile at the scale of 1, the text of a zoomed out tile keeps this size on the screen
export const TILE_FONT_SIZE = 12;

/// The status of the script of a tile: its latest query, or its stored result
export type DataflowTileStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'stale';

/// The status of a script: its latest query runs, failed or succeeded; a stored result of an earlier text of the
/// script is stale (`current` of the stored result, the core compares the keys)
export function dataflowTileStatus(model: QueryModel | null, storedResult: ScriptData['storedResult']): DataflowTileStatus {
    const query = model?.query ?? null;
    if (query != null && !queryIsDone(query.status)) return 'running';
    if (query != null && query.status !== QueryExecutionStatus.SUCCEEDED) return 'failed';
    if (storedResult != null && !storedResult.current) return 'stale';
    return query != null ? 'succeeded' : 'idle';
}

/// The rows of a result, e.g. "4,000 rows"
function formatRows(rows: number): string {
    return `${rows.toLocaleString('en-US')} ${rows === 1 ? 'row' : 'rows'}`;
}

/// The renderer of a visualization in a word, e.g. "bar" of a bar chart
function rendererLabel(visualize: ResolvedVisualizeQuery): string {
    switch (visualize.renderer) {
        case 'vegalite': {
            const mark = (visualize.vegaLiteSpec as { mark?: string | { type?: string } }).mark;
            const type = typeof mark === 'string' ? mark : mark?.type;
            return type ?? 'chart';
        }
        default:
            return visualize.renderer;
    }
}

/// The line of a tile about the result of its script: what runs or failed, the rows and how they are shown
export function dataflowTileSummary(status: DataflowTileStatus, model: QueryModel | null, visualize: ResolvedVisualizeQuery | null): string {
    if (status === 'running') return 'running…';
    if (status === 'failed') return model?.query.status === QueryExecutionStatus.CANCELLED ? 'cancelled' : 'failed';
    const rows = model?.query.resultTable?.rows ?? model?.result?.numRows ?? null;
    if (rows == null) return status === 'stale' ? 'stale result' : 'not run';
    return visualize != null ? `${rendererLabel(visualize)} · ${formatRows(rows)}` : formatRows(rows);
}

export interface DataflowTileProps {
    /// Where the tile is on the canvas: the box of the layout
    x: number;
    y: number;
    width: number;
    height: number;
    /// The name of the script or the input
    name: string;
    status: DataflowTileStatus;
    summary: React.ReactNode;
    /// Is the tile a tile of the dense layout? Its text has the size of the tile, a tile of a zoomed out box keeps the
    /// size of its text on the screen.
    dense: boolean;
    selected: boolean;
    /// Is the tile outside of the lineage of the selection?
    faded: boolean;
    'aria-label': string;
    'data-testid'?: string;
    /// The node of the tile, `nodeKeyOfScript` or `nodeKeyOfInput`
    'data-dataflow-tile'?: string;
    onSelect: () => void;
    onInspect?: () => void;
    /// A pointer down on the tile, e.g. the start of a drag, absent where the tile pans the canvas
    onPointerDown?: (event: React.PointerEvent) => void;
    onHover: (hovered: boolean) => void;
}

/// The tile of a box: its frame, then the status dot and the name, and the summary below them
export function DataflowTile(props: DataflowTileProps): React.ReactElement {
    const clipId = `dataflow-tile-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    // A tile of the dense layout has the size of its text, the text of a large box grows up to what fits
    const fontMax = props.dense ? TILE_FONT_SIZE : Math.max(TILE_FONT_SIZE, Math.min(props.height / 3.6, props.width / 10));
    // The name fits a tile of the dense layout, a zoomed out box clips it
    const chars = Math.max(4, Math.floor((props.width - 3 * TILE_FONT_SIZE) / (0.6 * TILE_FONT_SIZE)));
    const name = props.dense && props.name.length > chars ? `${props.name.slice(0, chars - 1)}…` : props.name;
    const { onSelect, onInspect } = props;
    return (
        <g
            className={styles.tile}
            role="button"
            tabIndex={0}
            aria-label={props['aria-label']}
            aria-pressed={props.selected}
            data-testid={props['data-testid']}
            data-dataflow-tile={props['data-dataflow-tile']}
            data-selected={props.selected}
            data-faded={props.faded || undefined}
            // A tile of the dense layout pans the canvas, a tap on it selects it
            data-dataflow-pan={props.onPointerDown == null || undefined}
            onPointerDown={props.onPointerDown}
            onPointerEnter={() => props.onHover(true)}
            onPointerLeave={() => props.onHover(false)}
            onClick={event => {
                event.stopPropagation();
                if (props.onPointerDown == null) onSelect();
            }}
            onDoubleClick={event => {
                event.stopPropagation();
                onInspect?.();
            }}
            onKeyDown={event => {
                if (event.key === 'Enter' && onInspect != null) onInspect();
                else if (event.key === ' ' || event.key === 'Enter') onSelect();
                else return;
                event.preventDefault();
            }}
        >
            <clipPath id={clipId}>
                <rect x={props.x} y={props.y} width={props.width} height={props.height} rx={8} ry={8} />
            </clipPath>
            <rect className={styles.tile_frame} x={props.x} y={props.y} width={props.width} height={props.height} rx={8} ry={8} />
            <text
                className={styles.tile_text}
                x={props.x}
                y={props.y}
                clipPath={`url(#${clipId})`}
                style={{ '--tile_font_max': `${fontMax}px` } as React.CSSProperties}
            >
                <tspan className={styles.tile_dot} data-status={props.status} dx="0.9em" dy="1.75em">●</tspan>
                <tspan className={styles.tile_name} dx="0.45em">{name}</tspan>
                <tspan className={styles.tile_summary} x={props.x} dx="0.9em" dy="1.5em">{props.summary}</tspan>
            </text>
        </g>
    );
}

/// The value of a KPI in the summary of a tile, e.g. "KPI 23.42K": the last row of the result
export function DataflowKpiSummary(props: { model: QueryModel | null; visualize: Extract<ResolvedVisualizeQuery, { renderer: 'kpi' }>; fallback: string }): React.ReactElement {
    const { table } = useResultRows(props.model, 'last', 1, false);
    const value = React.useMemo(() => {
        if (table == null) return null;
        try {
            return readKpi(table, props.visualize.kpiSpec).value ?? null;
        } catch {
            return null;
        }
    }, [table, props.visualize.kpiSpec]);
    return <>{value != null ? `KPI ${value}` : props.fallback}</>;
}
