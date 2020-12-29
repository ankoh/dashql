#include "dashql/analyzer/function_logic.h"

#include <iostream>

#include "dashql/common/variant.h"
#include "fmt/core.h"

// Use format library that is bundled with DuckDB.
// https://github.com/cwida/duckdb/blob/abaf6258dd737f397472e911e71af31e01493e00/src/function/scalar/string/printf.cpp

namespace dashql {

namespace {

struct FormatFunctionLogic final : public FunctionLogic {
    /// Constructor
    FormatFunctionLogic();
    /// Evaluate the function
    Expected<ConstantValue> Evaluate(nonstd::span<ConstantValue> args) override;
};

}  // namespace

// Constructor
FormatFunctionLogic::FormatFunctionLogic() {}
// Evaluate the function
Expected<ConstantValue> FormatFunctionLogic::Evaluate(nonstd::span<ConstantValue> arg_values) {
    using ctx_t = duckdb_fmt::format_context;
    using args_t = duckdb_fmt::basic_format_args<ctx_t>;
    if (arg_values.size() == 0) {
        return ErrorCode::FORMAT_INVALID_INPUT;
    }
    auto tmpl = arg_values[0].AsStringRef();
    auto tmpl_view = duckdb_fmt::basic_string_view<char>(tmpl.data(), tmpl.size());

    // Translate formatting arguments
    std::vector<duckdb_fmt::basic_format_arg<duckdb_fmt::format_context>> args;
    for (unsigned i = 1; i < arg_values.size(); ++i) {
        switch (arg_values[i].GetType()) {
            case sxs::AConstType::INTEGER:
                args.emplace_back(duckdb_fmt::internal::make_arg<ctx_t>(arg_values[i].AsInteger()));
                break;
            case sxs::AConstType::BITSTRING: {
                auto view = arg_values[i].AsStringRef();
                auto fmt_view = duckdb_fmt::basic_string_view<char>(view.data(), view.size());
                args.emplace_back(duckdb_fmt::internal::make_arg<ctx_t>(fmt_view));
                break;
            }
            case sxs::AConstType::FLOAT:
                args.emplace_back(duckdb_fmt::internal::make_arg<ctx_t>(arg_values[i].AsDouble()));
                break;
            case sxs::AConstType::STRING: {
                auto view = arg_values[i].AsStringRef();
                auto fmt_view = duckdb_fmt::basic_string_view<char>(view.data(), view.size());
                args.emplace_back(duckdb_fmt::internal::make_arg<ctx_t>(fmt_view));
                break;
            }
            case sxs::AConstType::NULL_:
                return ErrorCode::FORMAT_INVALID_INPUT;
        }
    }

    // Formatting failed
    std::string str;
    try {
        str = duckdb_fmt::vformat(tmpl_view, args_t(args.data(), static_cast<int>(args.size())));
    } catch (...) {
        return ErrorCode::FORMAT_FAILED;
    }
    return ConstantValue{move(str)};
}

// Resolve a function logic
std::unique_ptr<FunctionLogic> FunctionLogic::Resolve(std::string_view name,
                                                      nonstd::span<proto::syntax_sql::AConstType> args) {
    if (name == "format") {
        return std::make_unique<FormatFunctionLogic>();
    }
    return nullptr;
}

}  // namespace dashql
