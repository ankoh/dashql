import * as React from 'react';
import * as arrow from 'apache-arrow';
import { IterableArrayLike, RowLike } from 'apache-arrow/type';
import { Vega } from 'react-vega';

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
                type: 'line',
                point: false,
            },
        },
    ],
    encoding: {
        x: {
            field: 'timestamp',
            type: 'temporal',
            axis: null,
        },
        y: {
            field: 'sessions',
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

const deriveStateFromProps = (props: Props, prevState?: State): State => {
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
};

export const AccountScriptHitsChart: React.FC<Props> = (props: Props) => {
    const [state, setState] = React.useState<State>(deriveStateFromProps(props));
    if (state.spec == null) {
        VEGA_SPEC_PROMISE!.then(spec => {
            setState({
                ...state,
                spec: spec,
            });
        });
    }
    if (state.spec == null) return <div />;
    if (state.rows == null) return <div />;
    return (
        <Vega
            spec={state.spec as any}
            data={{ source: state.rows }}
            height={props.height}
            width={props.width}
            actions={false}
        />
    );
};
