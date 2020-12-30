#include "dashql/analyzer/program_instance.h"
#include "dashql/common/variant.h"

#include <iomanip>
#include <sstream>
#include <stack>

#include "dashql/common/substring_buffer.h"

namespace dashql {

/// Constructor
ConstantValue::ConstantValue()
    : constant_type(sxs::AConstType::NULL_), value(std::monostate{}) {}
/// Constructor
ConstantValue::ConstantValue(int64_t value)
    : constant_type(sxs::AConstType::INTEGER), value(value) {}
/// Constructor
ConstantValue::ConstantValue(double value)
    : constant_type(sxs::AConstType::FLOAT), value(value) {}
/// Constructor
ConstantValue::ConstantValue(std::string_view value)
    : constant_type(sxs::AConstType::STRING), value(value) {}
/// Constructor
ConstantValue::ConstantValue(std::string value)
    : constant_type(sxs::AConstType::STRING), value(move(value)) {}

/// Get the value as integer
int64_t ConstantValue::AsInteger() const {
    return std::visit(overload {
        [](int64_t v) { return v; },
        [](double v) { return static_cast<int64_t>(v); },
        [](std::string_view v) { return static_cast<int64_t>(0); },
        [](std::string& v) { return static_cast<int64_t>(0); },
        [](std::monostate v) { return static_cast<int64_t>(0); }
    }, value);
}

/// Get the value as double
double ConstantValue::AsDouble() const {
    return std::visit(overload {
        [](int64_t v) { return static_cast<double>(v); },
        [](double v) { return v; },
        [](std::string_view v) { return static_cast<double>(0); },
        [](std::string& v) { return static_cast<double>(0); },
        [](std::monostate v) { return static_cast<double>(0); }
    }, value);
}

/// Get the value as string ref
std::string_view ConstantValue::AsStringRef() const {
    return std::visit(overload {
        [](int64_t v) { return std::string_view{""}; },
        [](double v) { return std::string_view{""}; },
        [](std::string_view v) { return v; },
        [](std::string& v) { return std::string_view{v}; },
        [](std::monostate v) { return std::string_view{""}; }
    }, value);
}

/// Constructor
ProgramInstance::ProgramInstance(std::shared_ptr<std::string> text, std::shared_ptr<sx::ProgramT> program, std::vector<std::unique_ptr<proto::analyzer::ParameterValueT>> params)
    : program_text_(move(text)), program_(move(program)), parameter_values_(move(params)), evaluated_nodes_(program_->nodes.size()) {
}

/// Find a parameter value
const proto::analyzer::ParameterValueT* ProgramInstance::FindParameterValue(size_t stmt_id) const {
    return parameter_values_[stmt_id].get();
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

/// Build the patch
std::unique_ptr<sx::ProgramPatchT> ProgramInstance::BuildPatch() const {
    auto patch = std::make_unique<sx::ProgramPatchT>();
    /// XXX
    return patch;
}

/// Find an attribute
const sx::Node* ProgramInstance::FindAttribute(const sx::Node& origin, sx::AttributeKey key) const {
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
