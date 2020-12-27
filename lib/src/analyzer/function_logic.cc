#include "dashql/analyzer/function_logic.h"

#include <iostream>

// Use format library that is bundled with DuckDB.
// https://github.com/cwida/duckdb/blob/abaf6258dd737f397472e911e71af31e01493e00/src/function/scalar/string/printf.cpp

namespace dashql {

std::unique_ptr<FunctionLogic> FunctionLogic::Resolve(std::string_view name, nonstd::span<proto::syntax::NodeType> args) {
    std::cout << "resolve function '" << name << "' with " << args.size() << " arguments";
    return nullptr;
}

}
