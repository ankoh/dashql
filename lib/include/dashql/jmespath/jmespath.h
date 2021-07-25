// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_JMESPATH_JMESPATH_H_
#define INCLUDE_DASHQL_JMESPATH_JMESPATH_H_

#include <string>

#include "arrow/result.h"
#include "dashql/proto_generated.h"

namespace dashql {

struct JMESPath {
    /// Evaluate a single expression on a given input
    static arrow::Result<std::string> Evaluate(const char* expression, std::string_view input);
};

}  // namespace dashql

#endif
