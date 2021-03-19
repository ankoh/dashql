import * as core from "@dashql/core";
import * as model from "./model";
import axios from 'axios';

import example_helloworld from '../static/examples/helloworld.dashql';

import icon_dashboard from '../static/svg/icons/dashboard.svg';
import icon_linechart from '../static/svg/icons/line_chart.svg';
import icon_areachart from '../static/svg/icons/area_chart.svg';
import icon_barchart from '../static/svg/icons/bar_chart.svg';
import icon_histogramchart from '../static/svg/icons/histogram_chart.svg';
import icon_arcchart from '../static/svg/icons/arc_chart.svg';
import icon_scatterchart from '../static/svg/icons/scatter_chart.svg';
import icon_streamgraph from '../static/svg/icons/streamgraph.svg';
import icon_heatmapchart from '../static/svg/icons/heatmap_chart.svg';
import icon_gesture_tap_hold from '../static/svg/icons/gesture_tap_hold.svg';
import icon_database_import from '../static/svg/icons/database_import.svg';
import icon_database_search from '../static/svg/icons/database_search.svg';
import icon_package_down from '../static/svg/icons/package_down.svg';

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
    HTTP_SOURCE,
    DATA_CSV,
    DATA_PARQUET,
    DYNAMIC_EXTRACT,
    DYNAMIC_SQL,
    DYNAMIC_VIZ,
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
        icon: icon_dashboard,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.DATA_CSV),
        url: example_helloworld
    },
    {
        key: "demos/unischema",
        collection: "Demos",
        title: "University Schema",
        description: "A third test hello world script",
        icon: icon_dashboard,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "viz/line",
        collection: "Visualize",
        title: "Line Charts",
        description: "A test hello world script",
        icon: icon_linechart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "viz/area",
        collection: "Visualize",
        title: "Area Charts",
        description: "A second test hello world script",
        icon: icon_areachart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "viz/bar",
        collection: "Visualize",
        title: "Bar Charts",
        description: "Fooo",
        icon: icon_barchart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "viz/scatter",
        collection: "Visualize",
        title: "Scatter Plots",
        description: "Fooo",
        icon: icon_scatterchart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "viz/histogram",
        collection: "Visualize",
        title: "Histograms",
        description: "Fooo",
        icon: icon_histogramchart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "viz/streamgraph",
        collection: "Visualize",
        title: "Streamgraphs",
        description: "Fooo",
        icon: icon_streamgraph,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "viz/pie",
        collection: "Visualize",
        title: "Pie Charts",
        description: "Fooo",
        icon: icon_arcchart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "viz/heatmap",
        collection: "Visualize",
        title: "Heatmaps",
        description: "Fooo",
        icon: icon_heatmapchart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "viz/interaction",
        collection: "Visualize",
        title: "Interactivity",
        description: "FOOOOO",
        icon: icon_gesture_tap_hold,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "load/http",
        collection: "Load",
        title: "Static HTTP",
        description: "FOOOOO",
        icon: icon_package_down,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "load/httpparam",
        collection: "Load",
        title: "Dynamic HTTP",
        description: "FOOOOO",
        icon: icon_package_down,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "extract/csv",
        collection: "Extract",
        title: "CSV Parsing",
        description: "FOOOOO",
        icon: icon_database_import,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "extract/parquet",
        collection: "Extract",
        title: "Parquet Import",
        description: "FOOOOO",
        icon: icon_database_import,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "sql/complexjoins",
        collection: "SQL",
        title: "Complex Joins",
        description: "FOOOOO",
        icon: icon_database_search,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "sql/explicitgrouping",
        collection: "SQL",
        title: "Explicit Grouping",
        description: "FOOOOO",
        icon: icon_database_search,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "sql/movingavg",
        collection: "SQL",
        title: "Moving Avergage",
        description: "FOOOOO",
        icon: icon_database_search,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "sql/runningsum",
        collection: "SQL",
        title: "Running Sum",
        description: "FOOOOO",
        icon: icon_database_search,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "sql/approxmedian",
        collection: "SQL",
        title: "Approximative",
        description: "FOOOOO",
        icon: icon_database_search,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "sql/sampling",
        collection: "SQL",
        title: "Sampling",
        description: "FOOOOO",
        icon: icon_database_search,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
    {
        key: "sql/patternmatching",
        collection: "SQL",
        title: "Pattern Matching",
        description: "FOOOOO",
        icon: icon_database_search,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_helloworld
    },
];

export const EXAMPLE_SCRIPT_MAP: Map<string, ExampleScriptMetadata> = new Map(EXAMPLE_SCRIPTS.map(e => [e.key, e]))