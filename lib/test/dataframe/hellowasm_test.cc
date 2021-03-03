// Copyright (c) 2020 The DashQL Authors

#include "dashql/test/config.h"
#include "wasm.hh"

#include <v8/v8.h>

#include <sstream>
#include <fstream>

#include "gtest/gtest.h"

using namespace dashql::test;

namespace {

// TEST(HelloWasm, Foo) {
//     auto wasm_path = SOURCE_DIR / "test" / "dataframe" / "hello.wasm";
// 
//     std::unique_ptr<v8::Platform> platform = v8::platform::NewDefaultPlatform();
//     v8::V8::InitializePlatform(platform.get());
//     v8::V8::Initialize();
//     Isolate::CreateParams create_params;
//     create_params.array_buffer_allocator = v8::ArrayBuffer::Allocator::NewDefaultAllocator();
//     Isolate* isolate = Isolate::New(create_params);
//     Isolate::Scope isolate_scope(isolate);
//     HandleScope scope(isolate);
//     Local<Context> context = Context::New(isolate);
//     Context::Scope context_scope(context);
// 
//     WasmModuleObjectBuilderStreaming stream(isolate);
// 
//     auto engine = wasm::Engine::make();
//     auto store_ = wasm::Store::make(engine.get());
//     auto store = store_.get();
// 
//     std::ifstream file(wasm_path);
//     file.seekg(0, std::ios_base::end);
//     auto file_size = file.tellg();
//     file.seekg(0);
//     auto binary = wasm::vec<byte_t>::make_uninitialized(file_size);
//     file.read(binary.get(), file_size);
//     file.close();
//     ASSERT_FALSE(file.fail()) << "Error loading module";
// 
// }

}