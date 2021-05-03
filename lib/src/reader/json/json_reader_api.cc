// Copyright (c) 2020 The DashQL Authors

#include "dashql/common/wasm_response.h"
#include "dashql/reader/json/json_reader.h"

using namespace dashql;

extern "C" {

void dashql_json_prepare(WASMResponse* response, const char* input) {}

void dashql_json_prepare_filtered(WASMResponse* response, const char* input, const char* jmespath) {}
}
