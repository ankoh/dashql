// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_FUNCTION_LOGIC_H_
#define INCLUDE_DASHQL_ANALYZER_FUNCTION_LOGIC_H_

#include <memory>
#include <string_view>

#include "dashql/common/span.h"
#include "dashql/proto_generated.h"

namespace dashql {

class FunctionLogic {
   protected:

   public:
    /// Resolve function logic
    static std::unique_ptr<FunctionLogic> Resolve(std::string_view name, nonstd::span<proto::syntax::NodeType> args);
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ANALYZER_FUNCTION_LOGIC_H_
