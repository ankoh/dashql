import * as React from 'react';
import * as Model from '../../model';
import * as Immutable from 'immutable';
import * as proto from 'tigon-proto';
import { TQLInterpreter } from '../../ctrl';
import { connect } from 'react-redux';
import s from './viz_renderer.module.scss';

interface IVizRendererProps {
    tqlStatements: Immutable.List<proto.tql.Statement>;
}

interface IVizRendererState {
}

export class VizRenderer extends React.Component<IVizRendererProps, IVizRendererState> {
    constructor(props: IVizRendererProps) {
        super(props);
    }

    public render() {
        let vizStmts = TQLInterpreter.mapStatements(
            this.props.tqlStatements,
            proto.tql.Statement.StatementCase.VIZ,
            (_, v: proto.tql.VizStatement) => v);

        let i = 0;

        return (
            <div className={s.grid}>
                {vizStmts.map(_v => (
                    <div key={++i} className={s.grid_element} />
                ))}
            </div>
        );
    }
}

function mapStateToProps(state: Model.RootState) {
    return {
        tqlStatements: state.transientTQLStatements
    };
}

function mapDispatchToProps(_dispatch: Model.RootState) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(VizRenderer);
