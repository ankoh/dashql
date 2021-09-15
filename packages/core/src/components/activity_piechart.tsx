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
    height: 64,
    title: undefined,
    background: 'transparent',
    padding: 0,
    layer: [
        {
            mark: {
                type: 'arc',
            },
        },
    ],
    encoding: {
        color: {
            field: 'key',
            type: 'nominal',
            title: 'Device',
        },
        theta: {
            field: 'value',
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
            { key: 'desktop', value: 420 },
            { key: 'tablet', value: 1234 },
            { key: 'mobile', value: 4321 },
        ],
    };
};

export const ActivityPieChart: React.FC<Props> = (props: Props) => {
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
