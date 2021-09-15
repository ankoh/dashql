import * as React from 'react';
import * as arrow from 'apache-arrow';
import * as v from 'vega';
import cn from 'classnames';
import { Field } from 'vega-lite/build/src/channeldef.js';
import { IterableArrayLike, RowLike } from 'apache-arrow/type';
import { LayerSpec } from 'vega-lite/build/src/spec/layer.js';
import { TopLevel } from 'vega-lite/build/src/spec/toplevel.js';
import { Vega } from 'react-vega';
import { compile as compileVL } from 'vega-lite/build/src/compile/compile.js';

import styles from './activity_timeseries.module.css';

import { CenteredRectangleWaveSpinner } from './spinners';

type VLLayerSpec = TopLevel<LayerSpec<Field>>;
const VEGA_LITE_SPEC: VLLayerSpec = {
    autosize: {
        type: 'fit',
        contains: 'padding',
        resize: true,
    },
    width: 'container',
    height: 80,
    title: undefined,
    background: 'transparent',
    padding: 0,
    layer: [
        {
            mark: {
                type: 'line',
                point: true,
                tooltip: false, // buggy
            },
        },
    ],
    encoding: {
        x: {
            field: 'timestamp',
            type: 'temporal',
            title: null,
        },
        y: {
            field: 'sessions',
            type: 'quantitative',
            title: 'Views',
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

interface ChartProps {
    data: arrow.Table;
}

interface ChartState {
    data: arrow.Table;
    spec: v.Spec | null;
    rows: IterableArrayLike<RowLike<any>>;
}

const deriveStateFromProps = (props: ChartProps, prevState?: ChartState): ChartState => {
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

export const ActivityTimeseriesChart: React.FC<ChartProps> = (props: ChartProps) => {
    const [state, setState] = React.useState<ChartState>(deriveStateFromProps(props));
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
    return <Vega style={{ width: '100%' }} spec={state.spec as any} data={{ source: state.rows }} actions={false} />;
};

interface ResolverProps {
    className?: string;
}

interface ResolverState {
    table: arrow.Table;
}

export const ActivityTimeseries: React.FC<ResolverProps> = (props: ResolverProps) => {
    const [state, setState] = React.useState<ResolverState | null>(null);

    // Maintain mount flag
    const isMountedRef = React.useRef<boolean>(true);
    React.useEffect(() => {
        return () => void (isMountedRef.current = false);
    }, []);

    // Fetch summary statistics
    React.useEffect(() => {
        (async () => {
            const url = new URL(`${process.env.DASHQL_API_URL}/activity`);
            url.searchParams.append('short', 'false');
            const response = await fetch(url.href, {
                method: 'GET',
            });
            if (!response.ok) {
                console.error('failed to fetch program stats');
            }
            const dataBuffer = await response.arrayBuffer();
            const dataTable = arrow.Table.from(dataBuffer);
            if (!isMountedRef.current) return;

            const dataArray = dataTable.toArray();
            if (dataArray.length == 0) return;
            setState({
                table: dataTable,
            });
        })();
    }, []);

    if (!state) {
        return (
            <div className={cn(styles.spinner_container, props.className)}>
                <CenteredRectangleWaveSpinner className={styles.spinner} active={true} />;
            </div>
        );
    }
    return (
        <div className={cn(styles.container, props.className)}>
            <ActivityTimeseriesChart data={state.table} />
        </div>
    );
};
