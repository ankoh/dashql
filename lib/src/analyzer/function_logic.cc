#include "dashql/analyzer/function_logic.h"

#include "arrow/result.h"
#include "arrow/type_fwd.h"
#include "arrow/visitor_inline.h"
#include "dashql/common/variant.h"
#include "fmt/core.h"

namespace dashql {

namespace {

struct FormatFunctionLogic final : public FunctionLogic {
    /// Constructor
    FormatFunctionLogic();
    /// Evaluate the function
    arrow::Result<std::shared_ptr<arrow::Scalar>> Evaluate(
        nonstd::span<std::shared_ptr<arrow::Scalar>> arg_values) override;
};

}  // namespace

// Constructor
FormatFunctionLogic::FormatFunctionLogic() {}
// Evaluate the function
arrow::Result<std::shared_ptr<arrow::Scalar>> FormatFunctionLogic::Evaluate(
    nonstd::span<std::shared_ptr<arrow::Scalar>> arg_values) {
    using ctx_t = fmt::format_context;
    using args_t = fmt::basic_format_args<ctx_t>;
    if (arg_values.size() == 0) {
        return arrow::Status::Invalid("invalid input");
    }
    auto tmpl = arg_values[0]->ToString();
    auto tmpl_view = fmt::basic_string_view<char>(tmpl.data(), tmpl.size());

    // Translate formatting arguments
    std::vector<fmt::basic_format_arg<fmt::format_context>> args;
    for (unsigned i = 1; i < arg_values.size(); ++i) {
        switch (arg_values[i]->type->id()) {
            case arrow::Type::INT64:
                args.emplace_back(
                    fmt::detail::make_arg<ctx_t>(reinterpret_cast<arrow::Int64Scalar&>(*arg_values[i]).value));
                break;
            case arrow::Type::DOUBLE:
                args.emplace_back(
                    fmt::detail::make_arg<ctx_t>(reinterpret_cast<arrow::DoubleScalar&>(*arg_values[i]).value));
                break;
            case arrow::Type::STRING:
            default: {
                auto view = arg_values[i]->ToString();
                auto fmt_view = fmt::basic_string_view<char>(view.data(), view.size());
                args.emplace_back(fmt::detail::make_arg<ctx_t>(fmt_view));
                break;
            }
        }
    }

    // Formatting failed
    std::string str;
    try {
        str = fmt::vformat(tmpl_view, args_t(args.data(), static_cast<int>(args.size())));
    } catch (...) {
        return arrow::Status::Invalid("format failed");
    }
    return arrow::MakeScalar(arrow::utf8(), move(str));
}

// Resolve a function logic
std::unique_ptr<FunctionLogic> FunctionLogic::Resolve(std::string_view name,
                                                      nonstd::span<std::shared_ptr<arrow::Scalar>> values) {
    if (name == "format") {
        return std::make_unique<FormatFunctionLogic>();
    }
    return nullptr;
}

}  // namespace dashql
