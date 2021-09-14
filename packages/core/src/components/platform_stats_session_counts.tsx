import * as React from 'react';
import * as arrow from 'apache-arrow';
import { IterableArrayLike, RowLike } from 'apache-arrow/type';
import { Vega } from 'react-vega';

import * as v from 'vega';
import { compile as compileVL } from 'vega-lite/build/src/compile/compile.js';
import { Field } from 'vega-lite/build/src/channeldef.js';
import { LayerSpec } from 'vega-lite/build/src/spec/layer.js';
import { TopLevel } from 'vega-lite/build/src/spec/toplevel.js';
import { AutoSizer } from '../utils/autosizer';

type VLLayerSpec = TopLevel<LayerSpec<Field>>;
const VEGA_LITE_SPEC: VLLayerSpec = {
    autosize: {
        type: 'fit',
        contains: 'padding',
        resize: true,
    },
    width: 'container',
    height: 'container',
    title: undefined,
    background: 'transparent',
    padding: 0,
    layer: [
        {
            mark: {
                type: 'line',
                point: true,
            },
        },
    ],
    encoding: {
        x: {
            field: 'timestamp',
            type: 'temporal',
        },
        y: {
            field: 'sessions',
            type: 'quantitative',
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

export const PlatformStatsSessionCountChart: React.FC<Props> = (props: Props) => {
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
        <AutoSizer>
            {({ width, height }) => (
                <Vega
                    spec={state.spec as any}
                    data={{ source: state.rows }}
                    width={width}
                    height={height}
                    actions={false}
                />
            )}
        </AutoSizer>
    );
};
