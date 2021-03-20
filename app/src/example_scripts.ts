import * as core from "@dashql/core";
import * as model from "./model";
import axios from 'axios';

import example_demo_helloworld from '../static/examples/demo_helloworld.dashql';
import example_demo_unischema from '../static/examples/demo_unischema.dashql';
import example_extract_csv from '../static/examples/extract_csv.dashql';
import example_extract_parquet from '../static/examples/extract_parquet.dashql';
import example_load_http_dynamic from '../static/examples/load_http_dynamic.dashql';
import example_load_http_static from '../static/examples/load_http_static.dashql';
import example_sql_approxmedian from '../static/examples/sql_approxmedian.dashql';
import example_sql_complexjoins from '../static/examples/sql_complexjoins.dashql';
import example_sql_explicitgrouping from '../static/examples/sql_explicitgrouping.dashql';
import example_sql_movingavg from '../static/examples/sql_movingavg.dashql';
import example_sql_patternmatching from '../static/examples/sql_patternmatching.dashql';
import example_sql_runningsum from '../static/examples/sql_runningsum.dashql';
import example_sql_sampling from '../static/examples/sql_sampling.dashql';
import example_viz_area_charts from '../static/examples/viz_area_charts.dashql';
import example_viz_bar_charts from '../static/examples/viz_bar_charts.dashql';
import example_viz_heatmaps from '../static/examples/viz_heatmaps.dashql';
import example_viz_histograms from '../static/examples/viz_histograms.dashql';
import example_viz_interaction from '../static/examples/viz_interaction.dashql';
import example_viz_line_charts from '../static/examples/viz_line_charts.dashql';
import example_viz_pie_charts from '../static/examples/viz_pie_charts.dashql';
import example_viz_scatter_charts from '../static/examples/viz_scatter_charts.dashql';
import example_viz_streamgraphs from '../static/examples/viz_streamgraphs.dashql';

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
import { key } from "vega";


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
    enabled: boolean;
}

export const EXAMPLE_SCRIPTS: ExampleScriptMetadata[] = [
    {
        key: "demo_helloworld",
        collection: "Demos",
        title: "Hello World",
        description: "A third test hello world script",
        icon: icon_dashboard,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.DATA_CSV),
        url: example_demo_helloworld,
        enabled: true
    },
    {
        key: "demo_unischema",
        collection: "Demos",
        title: "University Schema",
        description: "A third test hello world script",
        icon: icon_dashboard,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_demo_unischema,
        enabled: false
    },
    {
        key: "viz_line",
        collection: "Visualize",
        title: "Line Charts",
        description: "A test hello world script",
        icon: icon_linechart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_line_charts,
        enabled: true
    },
    {
        key: "viz_area",
        collection: "Visualize",
        title: "Area Charts",
        description: "A second test hello world script",
        icon: icon_areachart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_area_charts,
        enabled: false
    },
    {
        key: "viz_bar",
        collection: "Visualize",
        title: "Bar Charts",
        description: "Fooo",
        icon: icon_barchart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_bar_charts,
        enabled: false
    },
    {
        key: "viz_pie",
        collection: "Visualize",
        title: "Pie Charts",
        description: "Fooo",
        icon: icon_arcchart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_pie_charts,
        enabled: false
    },
    {
        key: "viz_scatter",
        collection: "Visualize",
        title: "Scatter Plots",
        description: "Fooo",
        icon: icon_scatterchart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_scatter_charts,
        enabled: false
    },
    {
        key: "viz_histogram",
        collection: "Visualize",
        title: "Histograms",
        description: "Fooo",
        icon: icon_histogramchart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_histograms,
        enabled: false
    },
    {
        key: "viz_streamgraph",
        collection: "Visualize",
        title: "Streamgraphs",
        description: "Fooo",
        icon: icon_streamgraph,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_streamgraphs,
        enabled: false
    },
    {
        key: "viz_heatmap",
        collection: "Visualize",
        title: "Heatmaps",
        description: "Fooo",
        icon: icon_heatmapchart,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_heatmaps,
        enabled: false
    },
    {
        key: "viz_interaction",
        collection: "Visualize",
        title: "Interactivity",
        description: "FOOOOO",
        icon: icon_gesture_tap_hold,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_interaction,
        enabled: false
    },
    {
        key: "load_http_static",
        collection: "Load",
        title: "Static HTTP",
        description: "FOOOOO",
        icon: icon_package_down,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_load_http_static,
        enabled: false
    },
    {
        key: "load_http_dynamic",
        collection: "Load",
        title: "Dynamic HTTP",
        description: "FOOOOO",
        icon: icon_package_down,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_load_http_dynamic,
        enabled: false
    },
    {
        key: "extract_csv",
        collection: "Extract",
        title: "CSV Parsing",
        description: "FOOOOO",
        icon: icon_database_import,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_extract_csv,
        enabled: false
    },
    {
        key: "extract_parquet",
        collection: "Extract",
        title: "Parquet Import",
        description: "FOOOOO",
        icon: icon_database_import,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_extract_parquet,
        enabled: false
    },
    {
        key: "sql_complex_joins",
        collection: "SQL",
        title: "Complex Joins",
        description: "FOOOOO",
        icon: icon_database_search,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_sql_complexjoins,
        enabled: false
    },
    {
        key: "sql_explicit_grouping",
        collection: "SQL",
        title: "Explicit Grouping",
        description: "FOOOOO",
        icon: icon_database_search,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_sql_explicitgrouping,
        enabled: false
    },
    {
        key: "sql_movingavg",
        collection: "SQL",
        title: "Moving Avergage",
        description: "FOOOOO",
        icon: icon_database_search,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_sql_movingavg,
        enabled: false
    },
    {
        key: "sql_runningsum",
        collection: "SQL",
        title: "Running Sum",
        description: "FOOOOO",
        icon: icon_database_search,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_sql_runningsum,
        enabled: false
    },
    {
        key: "sql_approxmedian",
        collection: "SQL",
        title: "Approximative",
        description: "FOOOOO",
        icon: icon_database_search,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_sql_approxmedian,
        enabled: false
    },
    {
        key: "sql_sampling",
        collection: "SQL",
        title: "Sampling",
        description: "FOOOOO",
        icon: icon_database_search,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_sql_sampling,
        enabled: false
    },
    {
        key: "sql_pattern_matching",
        collection: "SQL",
        title: "Pattern Matching",
        description: "FOOOOO",
        icon: icon_database_search,
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_sql_patternmatching,
        enabled: false
    },
];

export const EXAMPLE_SCRIPT_MAP: Map<string, ExampleScriptMetadata> = new Map(EXAMPLE_SCRIPTS.map(e => [e.key, e]))

export async function loadScript(example: ExampleScriptMetadata, store: model.AppReduxStore) {
    try {
        const resp = await axios.get(example.url);
        if (resp.status != 200) {
            console.error(`Loading example ${example.key.toString()} failed with error: ${resp.statusText}`);
            return;
        }
        const text = resp.data as string;
        model.mutate(store.dispatch, {
            type: core.model.StateMutationType.SET_SCRIPT,
            data: {
                text,
                uriPrefix: core.model.ScriptURIPrefix.EXAMPLES,
                uriName: example.key,
                modified: false,
                lineCount: core.utils.countLines(text),
                bytes: core.utils.estimateUTF16Length(text),
            }
        });
    } catch(e) {
        // XXX log to platform
        console.error(`Loading example ${example.key.toString()} failed with error: ${e}`);
    }
}