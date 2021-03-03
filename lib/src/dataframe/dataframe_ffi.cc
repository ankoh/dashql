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

/// Analyze a query
DataframeHandle dashql_dataframe(FFIResponse* response, AlgebraTreeHandle algebraTreeHandle) {
    auto& algebraTree = reinterpret_cast<Dataframe::AlgebraTree&>(algebraTreeHandle);
    return reinterpret_cast<AlgebraTreeHandle>(new Dataframe(algebraTree));
}
}
