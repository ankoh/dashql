// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_FUNCTION_LOGIC_H_
#define INCLUDE_DASHQL_ANALYZER_FUNCTION_LOGIC_H_

#include <memory>
#include <string_view>

#include "dashql/analyzer/program_instance.h"
#include "dashql/common/expected.h"
#include "dashql/common/span.h"
#include "dashql/proto_generated.h"

namespace dashql {

class FunctionLogic {
   public:
    /// Destructor
    virtual ~FunctionLogic() = default;
    /// Evaluate the function
    virtual Expected<ConstantValue> Evaluate(nonstd::span<ConstantValue> args = {}) = 0;

    /// Resolve function logic
    static std::unique_ptr<FunctionLogic> Resolve(std::string_view name, nonstd::span<proto::syntax_sql::AConstType> args);
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ANALYZER_FUNCTION_LOGIC_H_
