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

    /// CSS values
    get cssColumnsBegin() { return this.columns[0] + 1; }
    get cssColumnsEnd() { return this.columns[1] + 1; }
    get cssRowsBegin() { return this.rows[0] + 1; }
    get cssRowsEnd() { return this.rows[1] + 1; }
    get cssArea() : string {
        return this.cssRowsBegin
            + " / " + this.cssColumnsBegin
            + " / " + this.cssRowsEnd
            + " / " + this.cssColumnsEnd;
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
        this.z = value;
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

    sizeClass: Store.SizeClass,
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
        this.state = VizGrid.computeLayout(props);
    }

    protected static computeLayout(props: IVizGridProps): IVizGridState {
        // Get the viz statements
        let vizStmts = mapStatements(
            props.statements,
            proto.tql.Statement.StatementCase.VIZ,
            (_, v: proto.tql.VizStatement) => v
        );
        let vizData = vizStmts.map((v) => props.queryResults.get(v.getQueryId()) || null);

        // Pick a length value
        let pickArea = (v: proto.tql.VizResponsiveGridArea | undefined) => {
            if (!v) {
                return null;
            } 
            let lv: proto.tql.VizGridArea | undefined;
            switch (props.sizeClass) {
                case Store.SizeClass.SMALL:
                    lv = v.getSmall();
                    break;
                case Store.SizeClass.MEDIUM:
                    lv = v.getMedium();
                    break;
                case Store.SizeClass.LARGE:
                    lv = v.getLarge();
                    break;
                case Store.SizeClass.XLARGE:
                    lv = v.getXlarge();
                    break;
            }
            if (!lv) {
                lv = v.getWildcard();
            }
            return lv || null;
        }

        let gridLayout = new GridLayout();

        let vizAreas = vizStmts.map((v) => pickArea(v.getArea()));
        let vizPositions = vizAreas.map((a) => {
            if (!a || !a.getX() || !a.getY()) { return null; }
            let x = a.getX()!.getValue();
            let y = a.getY()!.getValue();
            let width = a.getWidth() ? a.getWidth()!.getValue() : 6;
            let height = a.getHeight() ? a.getHeight()!.getValue() : 20;
            return new GridElement([x, x + width], [y, y + height]);
        });
        let [maxCol, maxRow] = vizPositions.reduce((acc, elem) => {
            return elem
                ? [Math.max(acc[0], elem.columns[1]), Math.max(acc[1], elem.rows[1])]
                : [acc[0], acc[1]];
        }, [0, 0]);

        // Return state
        return {
            gridLayout: gridLayout,
            vizStmts: vizStmts,
            vizPositions: vizPositions.filter(v => v != null) as GridElement[],
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
