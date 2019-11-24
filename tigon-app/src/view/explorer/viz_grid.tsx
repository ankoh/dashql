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
const DEFAULT_ROW_HEIGHT = 200;

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

    get cssArea() : string {
        return this.columns[0].toString()
            + " / " + this.rows[0].toString()
            + " / " + this.columns[1].toString()
            + " / " + this.rows[1].toString();
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
                gridArea: props.pos.cssArea
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

/// The size class
enum SizeClass {
    SMALL,
    MEDIUM,
    LARGE,
    XLARGE
}

/// A viz grid state
interface IVizGridState {
    sizeClass: SizeClass,
    gridLayout: GridLayout;
    vizStmts: Array<proto.tql.VizStatement>;
    vizPositions: Array<GridElement>;
    vizData: Array<proto.duckdb.QueryResult | null>;
}

/// A viz grid
export class VizGrid extends React.Component<IVizGridProps, IVizGridState> {
    constructor(props: IVizGridProps) {
        super(props);
        this.state = VizGrid.computeLayout(props);
    }

    protected static computeLayout(props: IVizGridProps): IVizGridState {
        let sizeClass = SizeClass.LARGE;

        // Get the viz statements
        let vizStmts = mapStatements(
            props.statements,
            proto.tql.Statement.StatementCase.VIZ,
            (_, v: proto.tql.VizStatement) => v
        );
        let vizData = vizStmts.map((v) => props.queryResults.get(v.getQueryId()) || null);

        // Pick a length value
        let pickLengthValue = (v: proto.tql.VizLength | undefined, sc: SizeClass) => {
            if (!v) {
                return null;
            } 
            let lv: proto.tql.VizLengthValue | undefined;
            switch (sc) {
                case SizeClass.SMALL:
                    lv = v.getSmall();
                    break;
                case SizeClass.MEDIUM:
                    lv = v.getMedium();
                    break;
                case SizeClass.LARGE:
                    lv = v.getLarge();
                    break;
                case SizeClass.XLARGE:
                    lv = v.getXlarge();
                    break;
            }
            if (!lv) {
                lv = v.getWildcard();
            }
            return lv || null;
        }

        // Get the maximum of two row height values
        let maxRowHeight = (a: proto.tql.VizLengthValue | null, b: proto.tql.VizLengthValue | null) => {
            if (!a) { return b; }
            if (!b) { return a; }

            // Same length unit?
            if (a.getUnit() === b.getUnit()) {
                return b.getValue() > a.getValue() ? b : a;
            }
            // Explicit pixels always win
            if (a.getUnit() === proto.tql.VizLengthUnit.PIXEL) { return a; }
            if (b.getUnit() === proto.tql.VizLengthUnit.PIXEL) { return b; }
            // Percent and spans are not supported for row heights
            let d = new proto.tql.VizLengthValue();
            d.setValue(100);
            d.setUnit(proto.tql.VizLengthUnit.PIXEL);
            return d;
        }

        let gridLayout = new GridLayout();

        // The allocation state
        type AllocStateType = { row: number, col: number, height: proto.tql.VizLengthValue | null };
        let allocState: AllocStateType = {
            row: 0, col: 0, height: null
        };

        // Allocate a row
        let allocRow = () => {
            let h = allocState.height;
            if (!h) {
                gridLayout.rows.push(new GridLength(DEFAULT_ROW_HEIGHT, GridLengthUnit.PIXEL));
                return;
            }
            gridLayout.rows.push(new GridLength(h.getValue(), GridLengthUnit.PIXEL));
            ++allocState.row;
            allocState.col = 0;
            allocState.height = null;
        };

        // Allocate a span
        let allocSpan = (span: number, height: proto.tql.VizLengthValue | null = null) => {
            if (allocState.col + span > gridLayout.columns) {
                allocRow();
            }
            allocState.height = maxRowHeight(allocState.height, height);
            return new GridElement([allocState.col, allocState.col + span], [allocState.row, allocState.col + 1]);
        };

        // Compute the viz positions
        let vizPositions = vizStmts.map((v) => {
            let layout = v.getLayout();
            if (!layout) {
                return allocSpan(1);
            }
            let lengthValue = pickLengthValue(layout.getHeight(), sizeClass);
            let width = layout.getWidth();
            if (!width) {
                return allocSpan(1, pickLengthValue(layout.getHeight(), sizeClass));
            } else {
                let widthValue = pickLengthValue(width, sizeClass);
                if (!widthValue || widthValue.getUnit() !== proto.tql.VizLengthUnit.SPAN) {
                    return allocSpan(1, lengthValue);
                } else {
                    return allocSpan(widthValue.getValue(), lengthValue);
                }
            }
        });

        // Return state
        return {
            sizeClass: sizeClass,
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
        this.setState(VizGrid.computeLayout(this.props));
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
