import * as core from "@dashql/core";
import * as model from "../model";
import axios from 'axios';

import example_helloworld from './helloworld.dashql';

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
    EXTRACT_CSV,
    EXTRACT_JSON,
    VIZ_TABLE,
    VIZ_LINE_CHART,
    _COUNT_
}

export interface ExampleScriptMetadata {
    key: string;
    collection: string;
    title: string;
    description: string
    features: core.utils.NativeBitmap;
    url: string;
}

export const EXAMPLE_SCRIPTS: ExampleScriptMetadata[] = [
    {
        key: "helloworld",
        collection: "Visualization",
        title: "Hello World",
        description: "A test hello world script",
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "helloworld2",
        collection: "Visualization",
        title: "Hello World 2",
        description: "A second test hello world script",
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    },
    {
        key: "demos/greeter",
        collection: "Demos",
        title: "Greeter Script",
        description: "A third test hello world script",
        features: new core.utils.NativeBitmap(ScriptFeatureTag._COUNT_)
            .set(ScriptFeatureTag.VIZ_LINE_CHART)
            .set(ScriptFeatureTag.VIZ_TABLE),
        url: example_helloworld
    }
];

export const EXAMPLE_SCRIPT_MAP: Map<string, ExampleScriptMetadata> = new Map(EXAMPLE_SCRIPTS.map(e => [e.key, e]))