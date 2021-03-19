import * as core from "@dashql/core";
import * as model from "./model";
import axios from 'axios';

import example_helloworld from '../static/examples/helloworld.dashql';

import icon_linechart from '../static/svg/icons/line_chart.svg';
import icon_areachart from '../static/svg/icons/area_chart.svg';
import icon_script from '../static/svg/icons/script_solid.svg';
import icon_barchart from '../static/svg/icons/bar_chart.svg';
import icon_scatterchart from '../static/svg/icons/scatter_chart.svg';

export enum ExampleScriptTag {
    HELLOWORLD
}

export async function loadExampleScript(script: ExampleScriptTag, store: model.AppReduxStore) {
    try {
        const resp = await axios.get(example_helloworld);
        if (resp.status != 200) {
            console.error(`Loading example ${script.toString()} failed with error: ${resp.statusText}`);
            return;
        }
        const text = resp.data as string;
        model.mutate(store.dispatch, {
            type: core.model.StateMutationType.SET_SCRIPT,
            data: {
                text,
                modified: false,
                lineCount: core.utils.countLines(text),
                bytes: core.utils.estimateUTF16Length(text),
                uriPrefix: core.model.ScriptURIPrefix.EXAMPLES,
                uriName: ExampleScriptTag[script].toLowerCase().toString()
            }
        });
    } catch(e) {
        // XXX log to platform
        console.error(`Loading example ${script.toString()} failed with error: ${e}`);
    }
}

export enum ScriptFeatureTag {
    LOAD_HTTP,
    EXTRACT_CSV,
    EXTRACT_PARQUET,
    VIZ_TABLE,
    VIZ_MAP,
    VIZ_STREAMGRAPH,
    VIZ_PIE,
    VIZ_HEATMAP,
    VIZ_SCATTER_PLOT,
    VIZ_LINE_CHART,
    VIZ_AREA_CHART,
    VIZ_BAR_CHART,
    _COUNT_
}

export interface ExampleScriptMetadata {
    key: string;
    collection: string;
    title: string;
    icon: string;
    description: string
    features: core.utils.NativeBitmap;
    url: string;
}

export const EXAMPLE_SCRIPTS: ExampleScriptMetadata[] = [
    {
        key: "demos/helloworld",
        collection: "Demos",
        title: "Hello World",
        description: "A third test hello world script",
        icon: icon_script,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.EXTRACT_CSV)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "demos/unischema",
        collection: "Demos",
        title: "University Schema",
        description: "A third test hello world script",
        icon: icon_script,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.EXTRACT_CSV)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "viz/line",
        collection: "Visualize",
        title: "Line Charts",
        description: "A test hello world script",
        icon: icon_linechart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "viz/area",
        collection: "Visualize",
        title: "Area Charts",
        description: "A second test hello world script",
        icon: icon_areachart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_AREA_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "viz/bar",
        collection: "Visualize",
        title: "Bar Charts",
        description: "Fooo",
        icon: icon_barchart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_BAR_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "viz/scatter",
        collection: "Visualize",
        title: "Scatter Plots",
        description: "Fooo",
        icon: icon_scatterchart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_BAR_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "viz/streamgraph",
        collection: "Visualize",
        title: "Streamgraphs",
        description: "Fooo",
        icon: icon_areachart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_STREAMGRAPH)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "viz/pie",
        collection: "Visualize",
        title: "Pie Charts",
        description: "Fooo",
        icon: icon_areachart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_MAP)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "viz/heatmap",
        collection: "Visualize",
        title: "Heatmaps",
        description: "Fooo",
        icon: icon_areachart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_HEATMAP)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "viz/interaction",
        collection: "Visualize",
        title: "Interactivity",
        description: "FOOOOO",
        icon: icon_script,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "load/http",
        collection: "Load",
        title: "Static HTTP",
        description: "FOOOOO",
        icon: icon_script,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "load/httpparam",
        collection: "Load",
        title: "Dynamic HTTP",
        description: "FOOOOO",
        icon: icon_script,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "extract/csv",
        collection: "Extract",
        title: "CSV Parsing",
        description: "FOOOOO",
        icon: icon_script,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "extract/parquet",
        collection: "Extract",
        title: "Parquet Import",
        description: "FOOOOO",
        icon: icon_script,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "sql/complexjoins",
        collection: "SQL",
        title: "Complex Joins",
        description: "FOOOOO",
        icon: icon_script,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "sql/explicitgrouping",
        collection: "SQL",
        title: "Explicit Grouping",
        description: "FOOOOO",
        icon: icon_script,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "sql/movingavg",
        collection: "SQL",
        title: "Moving Avergage",
        description: "FOOOOO",
        icon: icon_script,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "sql/runningsum",
        collection: "SQL",
        title: "Running Sum",
        description: "FOOOOO",
        icon: icon_script,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "sql/generateseries",
        collection: "SQL",
        title: "Sequence",
        description: "FOOOOO",
        icon: icon_script,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "sql/approxmedian",
        collection: "SQL",
        title: "Approximative",
        description: "FOOOOO",
        icon: icon_script,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "sql/sampling",
        collection: "SQL",
        title: "Sampling",
        description: "FOOOOO",
        icon: icon_script,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "sql/patternmatching",
        collection: "SQL",
        title: "Pattern Matching",
        description: "FOOOOO",
        icon: icon_script,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "sql/indexes",
        collection: "SQL",
        title: "Indexes",
        description: "FOOOOO",
        icon: icon_script,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
];

export const EXAMPLE_SCRIPT_MAP: Map<string, ExampleScriptMetadata> = new Map(EXAMPLE_SCRIPTS.map(e => [e.key, e]))