import * as utils from './utils';
import * as model from './model';
import axios from 'axios';

import example_demo_explore_json from '../static/examples/demo_explore_json.dashql';
import example_demo_unischema from '../static/examples/demo_unischema.dashql';
import example_demo_vaccination_germany from '../static/examples/demo_vaccination_germany.dashql';
import example_demo_halowars from '../static/examples/demo_halowars.dashql';
import example_load_csv from '../static/examples/load_csv.dashql';
import example_load_parquet from '../static/examples/load_parquet.dashql';
import example_fetch_http_dynamic from '../static/examples/fetch_http_dynamic.dashql';
import example_fetch_http_static from '../static/examples/fetch_http_static.dashql';
import example_transform_jmespath from '../static/examples/transform_jmespath.dashql';
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
import icon_shape from '../static/svg/icons/shape.svg';

export enum ScriptFeatureTag {
    FETCH_HTTP,
    FETCH_ARCHIVE_ZIP,
    TRANSFORM_JMESPATH,
    DATA_CSV,
    DATA_JSON,
    DATA_PARQUET,
    DYNAMIC_LOAD,
    DYNAMIC_SQL,
    DYNAMIC_VIZ,
    _COUNT_,
}

export interface ExampleScriptMetadata {
    key: string;
    collection: string;
    title: string;
    icon: string;
    description: string;
    features: utils.NativeBitmap;
    url: string;
    enabled: boolean;
}

export const EXAMPLE_SCRIPTS: ExampleScriptMetadata[] = [
    {
        key: 'demo_unischema',
        collection: 'Demos',
        title: 'University Schema',
        description: 'A script with the university schema',
        icon: icon_dashboard,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.DATA_PARQUET)
            .set(ScriptFeatureTag.FETCH_HTTP)
            .set(ScriptFeatureTag.FETCH_ARCHIVE_ZIP),
        url: example_demo_unischema,
        enabled: true,
    },
    {
        key: 'demo_explore_json',
        collection: 'Demos',
        title: 'Explore JSON',
        description: 'A script that explores a JSON document',
        icon: icon_dashboard,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.DATA_JSON)
            .set(ScriptFeatureTag.TRANSFORM_JMESPATH),
        url: example_demo_explore_json,
        enabled: true,
    },
    {
        key: 'demo_vaccination_germany',
        collection: 'Demos',
        title: 'Vaccination Germany',
        description: 'A script that displays official vaccination data',
        icon: icon_dashboard,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_).set(ScriptFeatureTag.DATA_CSV),
        url: example_demo_vaccination_germany,
        enabled: true,
    },
    {
        key: 'demo_halowards',
        collection: 'Demos',
        title: 'HaloWars Player',
        description: 'A script that shows how to query REST APIs',
        icon: icon_dashboard,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_).set(ScriptFeatureTag.DATA_CSV),
        url: example_demo_halowars,
        enabled: true,
    },
    {
        key: 'transform_jmespath',
        collection: 'Transform',
        title: 'JMESPath',
        description: 'JMESPath Expressions',
        icon: icon_shape,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_).set(ScriptFeatureTag.TRANSFORM_JMESPATH),
        url: example_transform_jmespath,
        enabled: true,
    },
    {
        key: 'viz_line',
        collection: 'Visualize',
        title: 'Line Charts',
        description: 'A test hello world script',
        icon: icon_linechart,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_line_charts,
        enabled: false,
    },
    {
        key: 'viz_area',
        collection: 'Visualize',
        title: 'Area Charts',
        description: 'A second test hello world script',
        icon: icon_areachart,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_area_charts,
        enabled: false,
    },
    {
        key: 'viz_bar',
        collection: 'Visualize',
        title: 'Bar Charts',
        description: 'Fooo',
        icon: icon_barchart,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_bar_charts,
        enabled: false,
    },
    {
        key: 'viz_pie',
        collection: 'Visualize',
        title: 'Pie Charts',
        description: 'Fooo',
        icon: icon_arcchart,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_pie_charts,
        enabled: false,
    },
    {
        key: 'viz_scatter',
        collection: 'Visualize',
        title: 'Scatter Plots',
        description: 'Fooo',
        icon: icon_scatterchart,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_scatter_charts,
        enabled: false,
    },
    {
        key: 'viz_histogram',
        collection: 'Visualize',
        title: 'Histograms',
        description: 'Fooo',
        icon: icon_histogramchart,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_histograms,
        enabled: false,
    },
    {
        key: 'viz_streamgraph',
        collection: 'Visualize',
        title: 'Streamgraphs',
        description: 'Fooo',
        icon: icon_streamgraph,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_streamgraphs,
        enabled: false,
    },
    {
        key: 'viz_heatmap',
        collection: 'Visualize',
        title: 'Heatmaps',
        description: 'Fooo',
        icon: icon_heatmapchart,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_heatmaps,
        enabled: false,
    },
    {
        key: 'viz_interaction',
        collection: 'Visualize',
        title: 'Interactivity',
        description: 'FOOOOO',
        icon: icon_gesture_tap_hold,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_viz_interaction,
        enabled: false,
    },
    {
        key: 'fetch_http_static',
        collection: 'Fetch',
        title: 'Static HTTP',
        description: 'FOOOOO',
        icon: icon_package_down,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_fetch_http_static,
        enabled: false,
    },
    {
        key: 'fetch_http_dynamic',
        collection: 'Fetch',
        title: 'Dynamic HTTP',
        description: 'FOOOOO',
        icon: icon_package_down,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_fetch_http_dynamic,
        enabled: false,
    },
    {
        key: 'load_csv',
        collection: 'Load',
        title: 'CSV Parsing',
        description: 'FOOOOO',
        icon: icon_database_import,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_load_csv,
        enabled: false,
    },
    {
        key: 'load_parquet',
        collection: 'Load',
        title: 'Parquet Import',
        description: 'FOOOOO',
        icon: icon_database_import,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_load_parquet,
        enabled: false,
    },
    {
        key: 'sql_complex_joins',
        collection: 'SQL',
        title: 'Complex Joins',
        description: 'FOOOOO',
        icon: icon_database_search,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_sql_complexjoins,
        enabled: false,
    },
    {
        key: 'sql_explicit_grouping',
        collection: 'SQL',
        title: 'Explicit Grouping',
        description: 'FOOOOO',
        icon: icon_database_search,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_sql_explicitgrouping,
        enabled: false,
    },
    {
        key: 'sql_movingavg',
        collection: 'SQL',
        title: 'Moving Avergage',
        description: 'FOOOOO',
        icon: icon_database_search,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_sql_movingavg,
        enabled: false,
    },
    {
        key: 'sql_runningsum',
        collection: 'SQL',
        title: 'Running Sum',
        description: 'FOOOOO',
        icon: icon_database_search,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_sql_runningsum,
        enabled: false,
    },
    {
        key: 'sql_approxmedian',
        collection: 'SQL',
        title: 'Approximative',
        description: 'FOOOOO',
        icon: icon_database_search,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_sql_approxmedian,
        enabled: false,
    },
    {
        key: 'sql_sampling',
        collection: 'SQL',
        title: 'Sampling',
        description: 'FOOOOO',
        icon: icon_database_search,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_sql_sampling,
        enabled: false,
    },
    {
        key: 'sql_pattern_matching',
        collection: 'SQL',
        title: 'Pattern Matching',
        description: 'FOOOOO',
        icon: icon_database_search,
        features: new utils.NativeBitmap(ScriptFeatureTag._COUNT_),
        url: example_sql_patternmatching,
        enabled: false,
    },
];

export const EXAMPLE_SCRIPT_MAP: Map<string, ExampleScriptMetadata> = new Map(EXAMPLE_SCRIPTS.map(e => [e.key, e]));

export async function getScript(example: ExampleScriptMetadata): Promise<model.Script> {
    const resp = await axios.get(example.url);
    if (resp.status != 200) {
        throw new Error(`Loading example ${example.key.toString()} failed with error: ${resp.statusText}`);
    }
    const text = resp.data as string;
    return {
        text,
        uriPrefix: model.ScriptURIPrefix.EXAMPLES,
        uriName: example.key,
        modified: false,
        lineCount: utils.countLines(text),
        bytes: utils.estimateUTF16Length(text),
    };
}