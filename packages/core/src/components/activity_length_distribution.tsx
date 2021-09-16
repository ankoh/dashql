import * as React from 'react';
import * as v from 'vega';
import { Field } from 'vega-lite/build/src/channeldef.js';
import { LayerSpec } from 'vega-lite/build/src/spec/layer.js';
import { TopLevel } from 'vega-lite/build/src/spec/toplevel.js';
import { compile as compileVL } from 'vega-lite/build/src/compile/compile.js';
import { Vega } from 'react-vega';

//import styles from './activity_piechart.module.css';

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
                type: 'bar',
                clip: true,
            },
            encoding: {
                x: {
                    field: 'label',
                    type: 'nominal',
                    title: null,
                    sort: {
                        field: 'bin',
                    },
                    axis: {
                        labelAngle: 0,
                        values: ['all', '8s', '1m', '8m'],
                    },
                },
                y: {
                    field: 'value',
                    type: 'quantitative',
                    title: null,
                    axis: {
                        format: '~s',
                    },
                },
            },
        },
    ],
};
let VEGA_SPEC: v.Spec | null = null;
let VEGA_SPEC_PROMISE: Promise<v.Spec> | null = null;

async function compileVega(): Promise<v.Spec> {
    const compiled = await compileVL(VEGA_LITE_SPEC);
    VEGA_SPEC = compiled.spec;
    return VEGA_SPEC;
}

interface Props {
    className?: string;
}

interface State {
    spec: v.Spec | null;
    rows: any[];
}

const deriveStateFromProps = (props: Props, prevState?: State): State => {
    if (!VEGA_SPEC && !VEGA_SPEC_PROMISE) {
        VEGA_SPEC_PROMISE = compileVega();
    }
    if (prevState && VEGA_SPEC == prevState?.spec) {
        return prevState;
    }
    return {
        spec: VEGA_SPEC,
        rows: [
            { label: 'all', bin: 0, value: 38000 },
            { label: '2s', bin: 1, value: 36000 },
            { label: '4s', bin: 2, value: 32000 },

            { label: '8s', bin: 3, value: 10000 },
            { label: '16s', bin: 4, value: 5000 },
            { label: '32s', bin: 5, value: 2000 },

            { label: '1m', bin: 6, value: 1000 },
            { label: '2m', bin: 7, value: 800 },
            { label: '4m', bin: 8, value: 600 },

            { label: '8m', bin: 9, value: 400 },
            { label: '17m', bin: 10, value: 300 },
            { label: '34m', bin: 11, value: 200 },
        ],
    };
};

export const ActivityLengthDistribution: React.FC<Props> = (props: Props) => {
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
    return <Vega className={props.className} spec={state.spec as any} data={{ source: state.rows }} actions={false} />;
};
