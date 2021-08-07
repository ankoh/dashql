import * as React from 'react';
import * as arrow from 'apache-arrow';
import { AppState, Dispatch } from '../model';
import { IterableArrayLike, RowLike } from 'apache-arrow/type';
import { Vega } from 'react-vega';
import { connect } from 'react-redux';

import * as v from 'vega';
import { compile as compileVL } from 'vega-lite/build/src/compile/compile.js';
import { Field } from 'vega-lite/build/src/channeldef.js';
import { LayerSpec } from 'vega-lite/build/src/spec/layer.js';
import { TopLevel } from 'vega-lite/build/src/spec/toplevel.js';

type VLLayerSpec = TopLevel<LayerSpec<Field>>;
const VEGA_LITE_SPEC: VLLayerSpec = {
    title: undefined,
    background: 'transparent',
    padding: 0,
    layer: [
        {
            mark: {
                type: 'bar',
                point: true,
                line: true,
                cornerRadiusEnd: 1,
            },
        },
    ],
    encoding: {
        x: {
            field: 'date',
            type: 'temporal',
            axis: null,
        },
        y: {
            field: 'views',
            type: 'quantitative',
            axis: null,
        },
    },
    config: {
        view: {
            stroke: 'transparent',
        },
    },
};
let VEGA_SPEC: v.Spec | null = null;
let VEGA_SPEC_PROMISE: Promise<v.Spec> | null = null;

async function compileVega(): Promise<v.Spec> {
    const compiled = await compileVL(VEGA_LITE_SPEC);
    VEGA_SPEC = compiled.spec;
    return VEGA_SPEC;
}

interface Props {
    data: arrow.Table;
    width: number;
    height: number;
}

interface State {
    data: arrow.Table;
    spec: v.Spec | null;
    rows: IterableArrayLike<RowLike<any>>;
}

class ProgramStatsTeaser extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = ProgramStatsTeaser.getDerivedStateFromProps(props);
        if (this.state.spec == null) {
            VEGA_SPEC_PROMISE!.then(spec => {
                this.setState({
                    spec: spec,
                });
            });
        }
    }

    static getDerivedStateFromProps(props: Props, prevState?: State): State {
        if (!VEGA_SPEC && !VEGA_SPEC_PROMISE) {
            VEGA_SPEC_PROMISE = compileVega();
        }
        if (prevState && props.data == prevState?.data && VEGA_SPEC == prevState?.spec) {
            return prevState;
        }
        if (!prevState || props.data !== prevState?.data) {
            return {
                data: props.data,
                rows: props.data.toArray(),
                spec: VEGA_SPEC,
            };
        }
        return {
            data: prevState.data,
            rows: prevState.rows,
            spec: VEGA_SPEC,
        };
    }

    public render() {
        if (this.state.spec == null) return <div />;
        if (this.state.rows == null) return <div />;
        return (
            <Vega
                spec={this.state.spec as any}
                data={{ source: this.state.rows }}
                height={this.props.height}
                width={this.props.width}
                actions={false}
            />
        );
    }
}

const mapStateToProps = (state: AppState) => ({
    plan: state.core.plan,
    planActions: state.core.planState.actions,
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(ProgramStatsTeaser);
