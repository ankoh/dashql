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
    height: 72,
    background: 'transparent',
    padding: 0,
    layer: [
        {
            mark: {
                type: 'area',
                fill: 'hsl(210deg, 12%, 51%)',
                fillOpacity: 1.0,
                point: {
                    color: 'hsl(210deg, 12%, 31%)',
                },
                line: {
                    color: 'hsl(210deg, 12%, 31%)',
                },
            },
            encoding: {
                x: {
                    field: 'length',
                    type: 'quantitative',
                    title: null,
                    axis: {
                        labelAngle: 0,
                        tickCount: 6,
                        labelExpr: '(datum.value < 60) ? (datum.value + "s") : (floor(datum.value / 60) + "m")',
                    },
                    scale: {
                        type: 'log',
                        base: 2,
                        domainMin: 1,
                        domainMax: 2048,
                    },
                },
                y: {
                    field: 'value',
                    type: 'quantitative',
                    title: 'Views',
                    axis: {
                        format: '~s',
                    },
                },
            },
        },
        //        {
        //            mark: {
        //                type: 'rule',
        //                color: 'red',
        //            },
        //            encoding: {
        //                x: {
        //                    datum: 2,
        //                },
        //            },
        //        },
        //        {
        //            mark: {
        //                type: 'rule',
        //                color: 'red',
        //            },
        //            encoding: {
        //                x: {
        //                    datum: 5,
        //                },
        //            },
        //        },
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
            { length: 1, value: 38000 },
            { length: 2, value: 36000 },
            { length: 4, value: 32000 },

            { length: 8, value: 10000 },
            { length: 16, value: 5000 },
            { length: 32, value: 2000 },

            { length: 64, value: 1000 },
            { length: 128, value: 800 },
            { length: 256, value: 600 },

            { length: 512, value: 400 },
            { length: 1024, value: 300 },
            { length: 2048, value: 200 },
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
