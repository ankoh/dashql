import * as core from "@dashql/core";
import * as model from "../model";
import axios from 'axios';

import example_helloworld from './helloworld.dashql';

export enum ExampleScript {
    HELLOWORLD
}

export async function loadExampleScript(script: ExampleScript, store: model.AppReduxStore) {
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
                fileName: `examples://${ExampleScript[script].toLowerCase().toString()}`
            }
        });
    } catch(e) {
        // XXX log to platform
        console.error(`Loading example ${script.toString()} failed with error: ${e}`);
    }
}