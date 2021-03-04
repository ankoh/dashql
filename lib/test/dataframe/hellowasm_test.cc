// Copyright (c) 2020 The DashQL Authors

#include "dashql/test/config.h"
#include "wasm.hh"

#include <v8/v8.h>

#include <sstream>
#include <fstream>

#include "gtest/gtest.h"

using namespace dashql::test;

namespace {

TEST(HelloWasm, Foo) {
    auto wasm_path = SOURCE_DIR / "test" / "dataframe" / "hello.wasm";
    (void)wasm_path;

//    // Initialize.
//    std::cout << "Initializing..." << std::endl;
//    auto engine = wasm::Engine::make();
//    auto store_ = wasm::Store::make(engine.get());
//    auto store = store_.get();
}

}