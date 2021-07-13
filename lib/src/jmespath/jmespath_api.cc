// Copyright (c) 2020 The DashQL Authors

#include "dashql/common/wasm_response.h"
#include "dashql/jmespath/jmespath.h"

namespace dashql {

extern "C" {

void jmespath_clear_response() { WASMResponseBuffer::GetInstance().Clear(); }

void jmespath_evaluate(WASMResponse* response, const char* input, const char* expression) {
    auto result = JMESPath::Evaluate(input, expression);
    WASMResponseBuffer::GetInstance().Store(*response, std::move(result));
}
}

}  // namespace dashql
