// Copyright (c) 2020 The DashQL Authors

#include "dashql/common/ffi_response.h"
#include "dashql/dataframe/dataframe.h"

using namespace dashql;
using namespace dashql::dataframe;

extern "C" {
using AlgebraTreeHandle = uintptr_t;
using DataframeHandle = uintptr_t;

AlgebraTreeHandle dashql_dataframe_algebra_tree() {
    return reinterpret_cast<AlgebraTreeHandle>(new Dataframe::AlgebraTree());
}

DataframeHandle dashql_dataframe(AlgebraTreeHandle algebraTreeHandle) {
    auto& algebraTree = reinterpret_cast<Dataframe::AlgebraTree&>(algebraTreeHandle);
    return reinterpret_cast<AlgebraTreeHandle>(new Dataframe(algebraTree));
}

void dashql_dataframe_get_module(FFIResponse* response, DataframeHandle dataframeHandle) {
    auto& dataframe = reinterpret_cast<Dataframe&>(dataframeHandle);
    auto& module = dataframe.module;
    response->statusCode = static_cast<size_t>(StatusCode::SUCCESS);
    response->dataPtr = reinterpret_cast<uint64_t>(module.data());
    response->dataSize = module.size();
}
}
