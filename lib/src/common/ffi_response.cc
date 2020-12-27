// Copyright (c) 2020 The DashQL Authors

#include "dashql/common/ffi_response.h"

namespace dashql {

FFIResponseBuffer& FFIResponseBuffer::GetInstance() {
    static FFIResponseBuffer buffer;
    return buffer;
}

}
