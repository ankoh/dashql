import * as webdb from '@dashql/webdb/dist/webdb.module.js';
import { Analyzer } from '@dashql/core/dist/dashql-core-browser.module.js';
import * as model from './model';
import * as examples from './example_scripts';
import * as platform from './platform';
import { IAppContext } from './app_context';

import analyzer_wasm from '@dashql/core/dist/dashql_analyzer.wasm';
import webdb_wasm from '@dashql/webdb/dist/webdb.wasm';

import axios from 'axios';
import config_url from '../static/config.json';

function startStep(store: model.AppReduxStore, step: model.LaunchStep) {
    model.mutate(store.dispatch, {
        type: model.StateMutationType.UPDATE_LAUNCH_STEP,
        data: [step, model.Status.RUNNING, null],
    });
}

function stepSucceeded(store: model.AppReduxStore, step: model.LaunchStep) {
    model.mutate(store.dispatch, {
        type: model.StateMutationType.UPDATE_LAUNCH_STEP,
        data: [step, model.Status.COMPLETED, null],
    });
}

function stepFailed(store: model.AppReduxStore, step: model.LaunchStep, error: string | null = null) {
    model.mutate(store.dispatch, {
        type: model.StateMutationType.UPDATE_LAUNCH_STEP,
        data: [step, model.Status.FAILED, error],
    });
}

async function configureApp(store: model.AppReduxStore): Promise<model.AppConfig | null> {
    try {
        const resp = await axios.get(config_url);
        if (!model.isAppConfig(resp.data)) {
            stepFailed(store, model.LaunchStep.CONFIGURE_APP, 'invalid app config');
            return null;
        }
        const config = resp.data as model.AppConfig;
        model.mutate(store.dispatch, {
            type: model.StateMutationType.CONFIGURE_APP,
            data: config,
        });
        stepSucceeded(store, model.LaunchStep.CONFIGURE_APP);
        return config;
    } catch (e) {
        console.error(e);
        stepFailed(store, model.LaunchStep.CONFIGURE_APP);
    }
    return null;
}

async function initWebDB(store: model.AppReduxStore, logger: webdb.Logger): Promise<webdb.parallel.AsyncWebDB | null> {
    startStep(store, model.LaunchStep.INIT_WEBDB);
    try {
        const dbWorker = new Worker(new URL('@dashql/webdb/dist/webdb-browser-parallel.worker.js', import.meta.url));
        const db = new webdb.parallel.AsyncWebDB(logger, dbWorker);
        await db.open(webdb_wasm);
        stepSucceeded(store, model.LaunchStep.INIT_WEBDB);
        return db;
    } catch (e) {
        stepFailed(store, model.LaunchStep.INIT_WEBDB);
    }
    return null;
}

async function initAnalyzer(store: model.AppReduxStore): Promise<Analyzer | null> {
    startStep(store, model.LaunchStep.INIT_ANALYZER);
    try {
        const analyzer = new Analyzer({}, analyzer_wasm);
        await analyzer.init();
        stepSucceeded(store, model.LaunchStep.INIT_ANALYZER);
        return analyzer;
    } catch (e) {
        stepFailed(store, model.LaunchStep.INIT_ANALYZER);
    }
    return null;
}

export async function launchApp(ctx: IAppContext) {
    const config = await configureApp(ctx.store);
    if (!config) return;

    const webdbPromise = initWebDB(ctx.store, ctx.logger);
    const analyzerPromise = initAnalyzer(ctx.store);

    const init = await Promise.all([webdbPromise, analyzerPromise]);
    if (init[0] == null || init[1] == null) return;
    const webdb = init[0];
    const analyzer = init[1];

    ctx.platform = new platform.BrowserPlatform(ctx.store, ctx.logger, webdb, analyzer);
    await ctx.platform.init();

    const example = examples.EXAMPLE_SCRIPT_MAP.get('demo_helloworld')!;
    await examples.loadScript(example, ctx.store);
    model.mutate(ctx.store.dispatch, {
        type: model.StateMutationType.MARK_LAUNCH_COMPLETE,
        data: null,
    });
}
