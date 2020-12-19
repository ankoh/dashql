// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_PROGRAM_INSTANCE_H_
#define INCLUDE_DASHQL_PROGRAM_INSTANCE_H_

#include <iostream>
#include <sstream>
#include <unordered_map>

#include "dashql/common/enum.h"
#include "dashql/common/expected.h"
#include "dashql/proto_generated.h"
#include "dashql/webdb/webdb.h"

namespace dashql {

namespace sx = proto::syntax;

/// A program instance.
///
/// A program instance represents the program configured by the user at a given point in time.
/// That includes the program text, the parsed program and the provided parameter values.
/// We primarily use shared references here in order to maintain a shallow undo log.
///
class ProgramInstance {
    /// The program text
    std::shared_ptr<std::string> program_text_;
    /// The program
    std::shared_ptr<sx::ProgramT> program_;
    /// The parameter values.
    /// Maps the id of parameter statements to parameter values.
    std::vector<std::shared_ptr<proto::session::ParameterValueT>> parameter_values_;
    /// The patch for partial evaluation (if any)
    std::unique_ptr<sx::ProgramPatchT> patch_;

    public:
    /// Constructor
    ProgramInstance(std::string_view text, std::shared_ptr<sx::ProgramT> program);
    /// Constructor
    ProgramInstance(std::shared_ptr<std::string> text, std::shared_ptr<sx::ProgramT> program);

    /// Get the program text
    auto& program_text() const { return *program_text_; }
    /// Get the program
    auto& program() const { return *program_; }
    /// Get the parameter values
    auto& parameter_values() const { return parameter_values_; }
    /// Get the patch
    auto& patch() const { return patch_; }

    /// Set the parameter value
    void SetParameterValue(std::shared_ptr<proto::session::ParameterValueT> param);
    /// Find the parameter value
    const proto::session::ParameterValueT* FindParameterValue(size_t stmt_id) const;
    /// Get the text at a location
    std::string_view TextAt(sx::Location loc) const { return std::string_view{*program_text_}.substr(loc.offset(), loc.length()); }
    /// Evaluate the program partially
    Signal EvaluatePartially(webdb::WebDB& database);
    /// Render the statement text
    Expected<std::string> RenderStatementText(size_t stmt_id) const;

    /// Find an attribute
    const sx::Node* FindAttribute(const sx::Node& origin, sx::AttributeKey key);
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
