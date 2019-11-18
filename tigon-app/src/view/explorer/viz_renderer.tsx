import * as React from 'react';
import * as Model from '../../model';
import * as Immutable from 'immutable';
import * as proto from 'tigon-proto';
import { TQLInterpreter } from '../../ctrl';
import { connect } from 'react-redux';
import s from './viz_renderer.module.scss';

interface IVizRendererProps {
    tqlModules: Immutable.List<Model.CoreBuffer<proto.tql.TQLModule>>;
}

interface IVizRendererState {
}

export class VizRenderer extends React.Component<IVizRendererProps, IVizRendererState> {
    constructor(props: IVizRendererProps) {
        super(props);
    }

    public render() {
        let vizStmts = TQLInterpreter.mapStatementsInModuleList(
            this.props.tqlModules,
            new proto.tql.TQLVizStatement(),
            (_, o) => {
                let v = new proto.tql.TQLVizStatement();
                v.bb = o.bb;
                v.bb_pos = o.bb_pos;
                return v;
            }
        );

        return (
            <div className={s.grid}>
                {vizStmts.map(_v => (
                    <div className={s.grid_element} />
                ))}
            </div>
        );
    }
}

function mapStateToProps(state: Model.RootState) {
    return {
        tqlModules: state.transientTQLModules
    };
}

function mapDispatchToProps(_dispatch: Model.RootState) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(VizRenderer);
