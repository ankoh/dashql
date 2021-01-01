import * as core from '@dashql/core';
import * as model from '../model';

export class BrowserPlatform extends core.platform.Platform {

    constructor(store: model.AppReduxStore, analyzer: core.analyzer.AnalyzerBindings) {
        super(store, analyzer);
    }
};

