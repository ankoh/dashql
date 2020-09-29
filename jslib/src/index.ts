// Copyright (c) 2020 The DashQL Authors

import { DuckDB } from './duckdb/duckdb_webapi.js';
import duckdb_webapi_wasm from './duckdb/duckdb_webapi.wasm';

const bar = DuckDB({
  locateFile(path) {
    if(path.endsWith('.wasm'))
        return duckdb_webapi_wasm;
    return path;
  }
});

export {};
