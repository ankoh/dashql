import * as Immutable from 'immutable';
import * as React from 'react';
import * as Store from '../../store';
import * as proto from 'tigon-proto';
import Table from '../viz/table';
import ChartViewer from '../viz/chart_viewer';
import s from './viz_grid.module.scss';
import { connect } from 'react-redux';
import { mapStatements } from '../../proto/tql_access';
import { withAutoSizer } from '../autosizer';

import {
    DeleteIcon,
    EditIcon,
    RefreshIcon,
} from '../../svg/icons';

const ACTION_ICON_WIDTH="16px";
const ACTION_ICON_HEIGHT="16px";

/// A grid element
export class GridElement {
    /// The column start
    columns: [number, number];
    /// The row start
    rows: [number, number];

    /// Constructor
    constructor(columns: [number, number], rows: [number, number]) {
        this.columns = columns;
        this.rows = rows;
    }

    get columnProp() : string {
        return this.columns[0].toString() + " / " + this.columns[1].toString();
    }

    get rowProp() : string {
        return this.rows[0].toString() + " / " + this.rows[1].toString();
    }
};

/// A length unit in the grid
export enum GridLengthUnit {
    FRACTIONAL,
    PIXEL,
    EM,
    AUTO,
    MIN_CONTENT,
    MAX_CONTENT,
    MIN_MAX
};

/// A grid length
export class GridLength {
    /// The value
    value: number;
    /// The unit
    unit: GridLengthUnit;

    /// Constructor
    constructor(value: number, unit: GridLengthUnit) {
        this.value = value;
        this.unit = unit;
    }
};

/// A grid layout
export class GridLayout {
    /// The columns
    columns: number;
    /// The rows
    rows: Array<GridLength>;
    /// The gaps
    gaps: [GridLength, GridLength] | null;

    /// Constructor
    constructor() {
        this.columns = 12;
        this.rows = [];
        this.gaps = null;
    }
};

/// A viz card
function VizCard(props: {
    stmt: proto.tql.VizStatement,
    data: proto.duckdb.QueryResult | null,
    pos: GridElement
}) {
    let viz: React.ReactElement | null = null;
    if (props.data) {
        console.log(props.stmt.getVizType());
        switch (props.stmt.getVizType()) {
            case proto.tql.VizType.VIZ_AREA:
            case proto.tql.VizType.VIZ_BAR:
            case proto.tql.VizType.VIZ_BOX:
            case proto.tql.VizType.VIZ_BUBBLE:
            case proto.tql.VizType.VIZ_GRID:
            case proto.tql.VizType.VIZ_HISTOGRAM:
            case proto.tql.VizType.VIZ_LINE:
            case proto.tql.VizType.VIZ_NUMBER:
            case proto.tql.VizType.VIZ_PIE:
            case proto.tql.VizType.VIZ_SCATTER:
            case proto.tql.VizType.VIZ_POINT:
                viz = <ChartViewer />;
                break;
            case proto.tql.VizType.VIZ_TABLE:
                viz = <Table data={props.data} />;
                break;
            case proto.tql.VizType.VIZ_TEXT:
                break;
        }
    }

    return (
        <div className={s.viz}
            style={{
                gridColumn: props.pos.columnProp,
                gridRow: props.pos.rowProp,
            }}
        >
            <div className={s.viz_id}>
                {props.stmt.getVizId()}
            </div>
            <div className={s.viz_card}>
                <div className={s.viz_card_header}>
                    <div className={s.viz_card_title}>
                        {props.stmt.getTitle()}
                    </div>
                    <div className={s.viz_card_action_refresh}>
                        <RefreshIcon className={s.viz_card_action_icon} width={ACTION_ICON_WIDTH} height={ACTION_ICON_HEIGHT} />
                    </div>
                    <div className={s.viz_card_action_edit}>
                        <EditIcon className={s.viz_card_action_icon} width={ACTION_ICON_WIDTH} height={ACTION_ICON_HEIGHT} />
                    </div>
                    <div className={s.viz_card_action_delete}>
                        <DeleteIcon className={s.viz_card_action_icon} width={ACTION_ICON_WIDTH} height={ACTION_ICON_HEIGHT} />
                    </div>
                </div>
                <div className={s.viz_card_body}>
                    {viz}
                </div>
            </div>
        </div>
    );
}

/// Viz grid properties
interface IVizGridProps {
    statements: Immutable.List<proto.tql.Statement>;
    queryResults: Immutable.Map<string, proto.duckdb.QueryResult>;

    width: number;
    height: number;
}

/// A viz grid state
interface IVizGridState {
    gridLayout: GridLayout;
    vizStmts: Array<proto.tql.VizStatement>;
    vizPositions: Array<GridElement>;
    vizData: Array<proto.duckdb.QueryResult | null>;
}

/// A viz grid
export class VizGrid extends React.Component<IVizGridProps, IVizGridState> {
    constructor(props: IVizGridProps) {
        super(props);
        this.state = VizGrid.computeState(props);
    }

    protected static computeState(props: IVizGridProps): IVizGridState {
        // Get the viz statements
        let vizStmts = mapStatements(
            props.statements,
            proto.tql.Statement.StatementCase.VIZ,
            (_, v: proto.tql.VizStatement) => v
        );
        let vizData = vizStmts.map((v) => props.queryResults.get(v.getQueryId()) || null);

        // Compute the layout
        let gridLayout = new GridLayout();
        let vizPositions = new Array<GridElement>();
        vizPositions.push(new GridElement([1, 4], [1, 1]));

        // Return state
        return {
            gridLayout: gridLayout,
            vizStmts: vizStmts,
            vizPositions: vizPositions,
            vizData: vizData,
        };
    }

    public componentDidUpdate(prevProps: IVizGridProps) {
        if (this.props.statements.equals(prevProps.statements)
            && this.props.queryResults.equals(prevProps.queryResults)
            && this.props.width === prevProps.width
            && this.props.height === prevProps.height
        ) {
            return;
        }
        this.setState(VizGrid.computeState(this.props));
    }

    public render() {
        return (
            <div className={s.container}
                style={{
                    width: this.props.width,
                    height: this.props.height
                }}
            >
                {this.state.vizStmts.map((s, i) =>
                    <VizCard key={s.getVizId()} stmt={s} pos={this.state.vizPositions[i]} data={this.state.vizData[i]} />
                )}
            </div>
        );
    }
}

/// Connect the viz grid to redux
function mapStateToProps(state: Store.RootState) {
    return {
        statements: state.transientTQLStatements,
        queryResults: state.transientQueryResults,
    };
}
export default connect(mapStateToProps, (_dispatch) => { return {}; })(withAutoSizer(VizGrid));
