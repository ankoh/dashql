// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_JMESPATH_JMESPATH_H_
#define INCLUDE_DASHQL_JMESPATH_JMESPATH_H_

#include <iostream>
#include <map>
#include <memory>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>

#include "dashql/common/expected.h"
#include "dashql/proto_generated.h"

namespace dashql {

struct JMESPath {
    /// Evaluate a single expression on a given input
    static Expected<std::string> Evaluate(std::string_view input, std::string_view expression);
};

}  // namespace dashql

#endif
