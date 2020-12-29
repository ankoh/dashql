// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_PROGRAM_INSTANCE_H_
#define INCLUDE_DASHQL_ANALYZER_PROGRAM_INSTANCE_H_

#include <iostream>
#include <sstream>
#include <unordered_map>
#include <vector>

#include "dashql/common/enum.h"
#include "dashql/common/expected.h"
#include "dashql/common/span.h"
#include "dashql/proto_generated.h"

namespace dashql {

namespace sx = proto::syntax;
namespace sxs = proto::syntax_sql;

/// A constant value
struct ConstantValue {
    /// The constant type
    sxs::AConstType constant_type;
    /// The value
    std::variant<std::monostate, int64_t, double, std::string_view, std::string> value;

    /// Constructor
    ConstantValue();
    /// Constructor
    ConstantValue(int64_t value);
    /// Constructor
    ConstantValue(double value);
    /// Constructor
    ConstantValue(std::string_view value);
    /// Constructor
    ConstantValue(std::string value);
};

/// A program instance.
///
/// A program instance represents the program configured by the user at a given point in time.
/// That includes the program text, the parsed program and the provided parameter values.
/// We primarily use shared references here in order to maintain a shallow undo log.
///
class ProgramInstance {
    friend class Analyzer;

    /// The program text
    std::shared_ptr<std::string> program_text_;
    /// The program
    std::shared_ptr<sx::ProgramT> program_;
    /// The parameter values
    std::vector<std::unique_ptr<proto::analyzer::ParameterValueT>> parameter_values_;
    /// The evaluated nodes (if any)
    std::unordered_map<size_t, ConstantValue> evaluated_nodes_;

    public:
    /// Constructor
    ProgramInstance(std::string_view text, std::shared_ptr<sx::ProgramT> program, std::vector<std::unique_ptr<proto::analyzer::ParameterValueT>> params = {})
        : ProgramInstance(std::make_shared<std::string>(text), move(program), move(params)) {}
    /// Constructor
    ProgramInstance(std::shared_ptr<std::string> text, std::shared_ptr<sx::ProgramT> program, std::vector<std::unique_ptr<proto::analyzer::ParameterValueT>> params = {});

    /// Get the program text
    auto& program_text() const { return *program_text_; }
    /// Get the program
    auto& program() const { return *program_; }
    /// Get the parameter values
    auto& parameter_values() const { return parameter_values_; }

    /// Find the parameter value
    const proto::analyzer::ParameterValueT* FindParameterValue(size_t stmt_id) const;
    /// Get the text at a location
    std::string_view TextAt(sx::Location loc) const { return std::string_view{*program_text_}.substr(loc.offset(), loc.length()); }
    /// Render the statement text
    Expected<std::string> RenderStatementText(size_t stmt_id) const;
    /// Build the patch
    std::unique_ptr<sx::ProgramPatchT> BuildPatch() const;

    /// Find an attribute
    const sx::Node* FindAttribute(const sx::Node& origin, sx::AttributeKey key) const;
    /// Iterate over children
    template <typename F> void IterateChildren(const sx::Node& origin, F fn) {
        auto children_begin = origin.children_begin_or_value();
        auto children_count = origin.children_count();
        auto nodes = program_->nodes;
        for (unsigned i = 0; i < children_count; ++i) {
            auto node_id = children_begin + i;
            fn(i, node_id, nodes[node_id]);
        }
    }
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_PROGRAM_INSTANCE_H_
