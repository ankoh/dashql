// Copyright (c) 2020 The DashQL Authors

#include "dashql/test/config.h"
#include "wasm.h"

#include <v8/v8.h>

#include <sstream>
#include <fstream>

#include "gtest/gtest.h"

using namespace dashql::test;

namespace {

TEST(HelloWasm, Foo) {
    auto wasm_path = SOURCE_DIR / "test" / "dataframe" / "hello.wasm";
    (void)wasm_path;

    // Initialize.
    printf("Initializing...\n");
    wasm_engine_t* engine = wasm_engine_new();
    wasm_store_t* store = wasm_store_new(engine);

    // Shut down.
    printf("Shutting down...\n");
    wasm_store_delete(store);
    wasm_engine_delete(engine);
}

}