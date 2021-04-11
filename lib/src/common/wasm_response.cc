// Copyright (c) 2020 The DashQL Authors

#include "dashql/common/wasm_response.h"

namespace dashql {

WASMResponseBuffer& WASMResponseBuffer::GetInstance() {
    static WASMResponseBuffer buffer;
    return buffer;
}

extern "C" {

/// Clear the response
void dashql_clear_response() { WASMResponseBuffer::GetInstance().Clear(); }
}

}  // namespace dashql
