#include "dashql/program_instance.h"

#include <iomanip>
#include <sstream>

#include "dashql/common/substring_buffer.h"

namespace dashql {

/// Constructor
ProgramInstance::ProgramInstance(std::string_view text, std::shared_ptr<sx::ProgramT> program)
    : program_text_(std::make_shared<std::string>(text)), program_(move(program)), parameter_values_(), patch_() {

    parameter_values_.reserve(program_->statements.size());
    for (auto i = 0; i < program_->statements.size(); ++i)
        parameter_values_.push_back(nullptr);
}

/// Constructor
ProgramInstance::ProgramInstance(std::shared_ptr<std::string> text, std::shared_ptr<sx::ProgramT> program)
    : program_text_(move(text)), program_(move(program)), parameter_values_(), patch_() {

    parameter_values_.reserve(program_->statements.size());
    for (auto i = 0; i < program_->statements.size(); ++i)
        parameter_values_.push_back(nullptr);
}

/// Set a parameter value
void ProgramInstance::SetParameterValue(std::shared_ptr<proto::session::ParameterValueT> param) {
    if (!param) return;
    if (param->origin_statement < parameter_values_.size()) {
        parameter_values_[param->origin_statement] = move(param);
    }
}

/// Find a parameter value
const proto::session::ParameterValueT* ProgramInstance::FindParameterValue(size_t stmt_id) const {
    return parameter_values_[stmt_id].get();
}

/// Evaluate the program partially
Signal ProgramInstance::EvaluatePartially(dashql::webdb::WebDB& database) {
    // XXX
    return Signal::OK();
}

// Collect the statement options
Expected<std::string> ProgramInstance::RenderStatementText(size_t stmt_id) const {
    auto& target_root = program_->nodes[program_->statements[stmt_id]->root_node];
    SubstringBuffer buffer{*program_text_, target_root.location()};

    // Find all the column refs that occur in the statement
    for (auto& dep : program_->dependencies) {
        auto target = dep.target_statement();
        auto source = dep.source_statement();

        // We only interpolate column refs that refer to parameters for now
        if (target != stmt_id) continue;
        if (dep.type() != sx::DependencyType::COLUMN_REF) continue;
        if (program_->statements[source]->statement_type != sx::StatementType::PARAMETER) continue;
        if (!parameter_values_[source]) continue;

        auto& target_root = program_->nodes[program_->statements[target]->root_node];
        auto& target_node = program_->nodes[dep.target_node()];
        assert(target_node.node_type() == sx::NodeType::OBJECT_SQL_COLUMN_REF);

        // Escape the value based on value type
        auto& param_value = parameter_values_[source];
        std::stringstream value_sql_text;
        using ParameterType = proto::syntax_dashql::ParameterType;
        switch (param_value->type) {
            case ParameterType::NONE:
            case ParameterType::FILE:
                break;
            case ParameterType::INTEGER:
            case ParameterType::FLOAT:
            case ParameterType::DATE:
            case ParameterType::DATETIME:
            case ParameterType::TIME:
                value_sql_text << param_value->value;
                break;
            case ParameterType::TEXT:
                value_sql_text << std::quoted(param_value->value, '\'');
                break;
        }

        // The the source statement a parameter?
        buffer.Replace(target_node.location(), value_sql_text.str());
    }

    // Return the result
    return buffer.Finish();
}

/// Find an attribute
const sx::Node* ProgramInstance::FindAttribute(const sx::Node& origin, sx::AttributeKey key) {
    auto children_begin = origin.children_begin_or_value();
    auto children_count = origin.children_count();
    auto lb = children_begin;
    auto c = children_count;
    while (c > 0) {
        auto step = c / 2;
        auto iter = lb + step;
        auto& n = program_->nodes[iter];
        if (n.attribute_key() < key) {
            lb = iter + 1;
            c -= step + 1;
        } else {
            c = step;
        }
    }
    if (lb >= children_begin + children_count) {
        return nullptr;
    }
    auto& n = program_->nodes[lb];
    return (n.attribute_key() == key) ? &n : nullptr;
}

}  // namespace dashql
