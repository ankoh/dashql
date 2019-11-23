import * as React from 'react';
import * as Model from '../../model';
import * as Immutable from 'immutable';
import * as proto from 'tigon-proto';
import Table from '../viz/table';
import { TQLInterpreter } from '../../ctrl';
import { connect } from 'react-redux';
import s from './grid.module.scss';

interface IVizGridProps {
    tqlStatements: Immutable.List<proto.tql.Statement>;
    queryResults: Immutable.Map<string, proto.duckdb.QueryResult>;
}

interface IVizGridState {
}

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

function mapStateToProps(state: Model.RootState) {
    return {
        tqlStatements: state.transientTQLStatements,
        queryResults: state.transientQueryResults,
    };
}

function mapDispatchToProps(_dispatch: Model.RootState) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(VizGrid);
