import * as React from 'react';
import * as arrow from 'apache-arrow';
import * as core from '@dashql/core';
import { AppState, Dispatch } from '../model';
import { IterableArrayLike, RowLike } from 'apache-arrow/type';
import { Vega } from 'react-vega';
import { connect } from 'react-redux';

import * as v from 'vega';
import { compile as compileVL } from 'vega-lite/build/src/compile/compile.js';
import { Field } from 'vega-lite/build/src/channeldef.js';
import { LayerSpec } from 'vega-lite/build/src/spec/layer.js';
import { TopLevel } from 'vega-lite/build/src/spec/toplevel.js';

type VegaLiteTLLayerSpec = TopLevel<LayerSpec<Field>>;
const VEGA_LITE_SPEC: VegaLiteTLLayerSpec = {
    autosize: {
        type: 'fit',
        contains: 'padding',
        resize: true,
    },
    title: undefined,
    background: 'transparent',
    padding: 8,
    width: 'container',
    height: 'container',
    layer: [],
    encoding: {
        x: {
            field: 'date',
            type: 'temporal',
        },
        y: {
            field: 'views',
            type: 'nominal',
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
    script: core.model.Script;
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
            data: props.data,
            rows: prevState.rows,
            spec: VEGA_SPEC,
        };
    }

    public render() {
        if (this.state.spec == null) return <div />;
        if (this.state.rows == null) return <div />;
        return (
            <div>
                <Vega
                    spec={this.state.spec as any}
                    data={{ source: this.state.rows }}
                    width={this.props.width}
                    height={this.props.height}
                    actions={false}
                />
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({
    plan: state.core.plan,
    planActions: state.core.planState.actions,
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(ProgramStatsTeaser);
