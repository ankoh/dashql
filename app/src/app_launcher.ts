import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as core from '@dashql/core';
import * as model from './model';
import * as platform from './platform';
import { IAppContext } from './app_context';

import webdb_wasm from '@dashql/webdb/dist/webdb.wasm';
import webdb_worker from '@dashql/webdb/dist/webdb_async.worker.js';
import analyzer_wasm from '@dashql/core/dist/dashql_analyzer.wasm';

export const DEMO_SCRIPT = `-- This script outlines basic concepts of the SQL extension DashQL.
-- Delete everything when you're ready and start from scratch.

-- Declare a dynamic input field on top of your dashboard.
-- Ref: https://docs.dashql.com/grammar/param
DECLARE PARAMETER country TYPE TEXT (
    default_value = 'DE'
);

-- Load data from external sources like HTTP REST APIs.
-- Ref: https://docs.dashql.com/grammar/load
LOAD weather_csv FROM http (
    url = format('https://cdn.dashql.com/demo/weather/{}', global.country)
);

-- Interpret the data as SQL table.
-- Ref: https://docs.dashql.com/grammar/extract
EXTRACT weather FROM weather_csv USING CSV;

-- Run arbitrary SQL within your browser.
-- Ref: https://docs.dashql.com/grammar/query
SELECT 1 INTO weather_avg FROM weather;

-- Visualize tables and views.
-- Ref: https://docs.dashql.com/grammar/viz
VIZ weather_avg USING LINE;
`;

export async function launchApp(ctx: IAppContext) {
    const dbWorker = webdb.spawnWorker(webdb_worker);
    const db = new webdb.AsyncWebDB(dbWorker);
    await db.open(webdb_wasm);

    const analyzer = new core.analyzer.Analyzer({}, analyzer_wasm);
    await analyzer.init();

    ctx.platform = new platform.BrowserPlatform(ctx.store, db, analyzer);

    model.mutate(ctx.store.dispatch, {
        type: core.model.StateMutationType.SET_PROGRAM_TEXT,
        data: [DEMO_SCRIPT, core.utils.countLines(DEMO_SCRIPT)],
    });
}
