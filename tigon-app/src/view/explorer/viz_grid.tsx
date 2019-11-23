import * as React from 'react';
import * as Model from '../../model';
import * as Immutable from 'immutable';
import * as proto from 'tigon-proto';
import Table from '../viz/table';
import { withAutoSizer } from '../autosizer';
import { TQLInterpreter } from '../../ctrl';
import { connect } from 'react-redux';
import s from './grid.module.scss';

/// A grid element
export class GridElement {
    /// The elements
    elementID: number;
    /// The column start
    columns: [number, number];
    /// The row start
    rows: [number, number];

    /// Constructor
    constructor(elementID: number, columns: [number, number], rows: [number, number]) {
        this.elementID = elementID;
        this.columns = columns;
        this.rows = rows;
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
    /// The elements
    elements: Array<GridElement>;

    /// Constructor
    constructor() {
        this.columns = 12;
        this.rows = [];
        this.gaps = null;
        this.elements = [];
    }
};

/// A viz card
function VizCard(props: {statement: proto.tql.VizStatement, data: proto.duckdb.QueryResult | null}) {
    return (
        <div key={props.statement.getVizName()} className={s.viz}>
            <div className={s.viz_id}>
                {props.statement.getVizName()}
            </div>
            <div className={s.viz_card}>
                <div className={s.viz_card_header}>
                    <div className={s.viz_card_title}>
                        Some Cool Title
                    </div>
                </div>
                <div className={s.viz_card_body}>
                    {props.data ? <Table data={props.data} /> : "foo"}
                </div>
            </div>
        </div>
    );
}

/// Viz grid properties
interface IVizGridProps {
    tqlStatements: Immutable.List<proto.tql.Statement>;
    queryResults: Immutable.Map<string, proto.duckdb.QueryResult>;
    width: number;
    height: number;
}

/// A viz grid state
interface IVizGridState {}

/// A viz grid
export class VizGrid extends React.Component<IVizGridProps, IVizGridState> {
    public render() {
        let vizStmts = TQLInterpreter.mapStatements(
            this.props.tqlStatements,
            proto.tql.Statement.StatementCase.VIZ,
            (_, v: proto.tql.VizStatement) => v
        );
        let vizData = vizStmts.map((v) => this.props.queryResults.get(v.getQueryName()) || null);

        return (
            <div className={s.grid}>
                {vizStmts.map((s, i) => <VizCard statement={s} data={vizData[i]} />)}
            </div>
        );
    }
}

/// Connect the viz grid to redux
function mapStateToProps(state: Model.RootState) {
    return {
        tqlStatements: state.transientTQLStatements,
        queryResults: state.transientQueryResults,
    };
}
export default connect(mapStateToProps, (_dispatch) => {})(withAutoSizer(VizGrid));



