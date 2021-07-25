// Copyright (c) 2020 The DashQL Authors

#include "dashql/common/wasm_response.h"
#include "dashql/jmespath/jmespath.h"

namespace dashql {

extern "C" {

void jmespath_clear_response() { WASMResponseBuffer::Get().Clear(); }

void jmespath_evaluate(WASMResponse* response, const char* expression, const char* input) {
    auto result = JMESPath::Evaluate(expression, input);
    WASMResponseBuffer::Get().Store(*response, std::move(result));
}

void jmespath_evaluate_utf8(WASMResponse* response, const char* expression, const uint8_t* input_ptr,
                            size_t input_length) {
    std::string_view input{reinterpret_cast<const char*>(input_ptr), input_length};
    auto result = JMESPath::Evaluate(expression, input);
    WASMResponseBuffer::Get().Store(*response, std::move(result));
}
}

}  // namespace dashql
