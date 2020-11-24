import { AppReduxStore, AppStateMutations } from '../store';
import { EditorController } from './editor';
import { LogController } from './log';
import { InterpreterController } from './interpreter';
import { ParserController } from './parser';

export const DEMO_SCRIPT =
`-- This script outlines basic concepts of the SQL extension DashQL.
-- Delete everything when you're ready and start from scratch.

-- Declare a dynamic input field on top of your dashboard.
-- Ref: https://docs.dashql.com/grammar/param
DECLARE PARAMETER country TYPE TEXT (
    default_value = 'DE'
);

-- Load data from external sources like HTTP REST APIs.
-- Ref: https://docs.dashql.com/grammar/load
LOAD weather_csv FROM http (
    url = format('https://cdn.dashql.com/demo/weather/%s', global.country)
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

/// A controller
export class DemoController {
    /// The Store
    protected _store: AppReduxStore;
    /// The parser
    protected _parser: ParserController;
    /// The logger
    protected _log: LogController;
    /// The editor controller
    protected _editor: EditorController;
    /// The interpreter controller
    protected _interpreter: InterpreterController;

    constructor(store: AppReduxStore, parser: ParserController, log: LogController, editor: EditorController, interpreter: InterpreterController) {
        this._store = store;
        this._parser = parser;
        this._log = log;
        this._editor = editor;
        this._interpreter = interpreter;
    }

    public setup() {
        this._store.dispatch(AppStateMutations.setPlanText(DEMO_SCRIPT));
    }
}
