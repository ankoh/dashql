#include "dashql/analyzer/program_instance.h"

#include <iomanip>
#include <sstream>
#include <stack>

#include "dashql/common/substring_buffer.h"

namespace dashql {

/// Constructor
ProgramInstance::ProgramInstance(std::string_view text, std::shared_ptr<sx::ProgramT> program, std::vector<std::unique_ptr<proto::analyzer::ParameterValueT>> params)
    : program_text_(std::make_shared<std::string>(text)), program_(move(program)), parameter_values_(move(params)), patch_() {

    parameter_values_.reserve(program_->statements.size());
    for (auto i = 0; i < program_->statements.size(); ++i)
        parameter_values_.push_back(nullptr);
}

/// Constructor
ProgramInstance::ProgramInstance(std::shared_ptr<std::string> text, std::shared_ptr<sx::ProgramT> program, std::vector<std::unique_ptr<proto::analyzer::ParameterValueT>> params)
    : program_text_(move(text)), program_(move(program)), parameter_values_(move(params)), patch_() {

    parameter_values_.reserve(program_->statements.size());
    for (auto i = 0; i < program_->statements.size(); ++i)
        parameter_values_.push_back(nullptr);
}

/// Find a parameter value
const proto::analyzer::ParameterValueT* ProgramInstance::FindParameterValue(size_t stmt_id) const {
    return parameter_values_[stmt_id].get();
}

/// Evaluate the program partially
Signal ProgramInstance::EvaluatePartially(dashql::webdb::WebDB& database) {
    for (auto& node : program_->nodes) {
        // XXX
    }
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

/// Match a schema
bool ProgramInstance::MatchSchema(const sx::Node& root, NodeSchema& schema) const {
    bool full_match = true;

    // Init the node refs
    std::vector<NodeSchema*> init;
    init.push_back(&schema);
    while (!init.empty()) {
        auto* schema = init.back();
        init.pop_back();
        if (schema->ref) *schema->ref = schema;
        for (auto& s: schema->children) {
            init.push_back(&s);
        }
    }

    // Use a DFS to match the schema
    struct Step { const sx::Node& node; NodeSchema& schema; };
    std::vector<Step> pending;
    pending.reserve(8);
    pending.push_back({root, schema});

    while (!pending.empty()) {
        auto top = pending.back();
        pending.pop_back();
        top.schema.node = &top.node;

        // Compare node type
        if (top.schema.node_type != sx::NodeType::NONE && top.schema.node_type != top.node.node_type()) {
            top.schema.matching = NodeSchemaMatching::TYPE_MISMATCH;
            full_match = false;
            continue;
        }

        // Match the node spec
        switch (top.schema.node_spec) {
            case NodeMatcherType::BOOL:
                top.schema.matching = NodeSchemaMatching::MATCHED;
                top.schema.value = top.node.children_begin_or_value() != 0;
                break;
            case NodeMatcherType::UI32:
                top.schema.matching = NodeSchemaMatching::MATCHED;
                top.schema.value = top.node.children_begin_or_value();
                break;
            case NodeMatcherType::STRING:
                if (top.node.node_type() == sx::NodeType::STRING_REF) {
                    top.schema.matching = NodeSchemaMatching::MATCHED;
                    top.schema.value = TextAt(top.node.location());
                } else {
                    top.schema.matching = NodeSchemaMatching::MISSING;
                    full_match = false;
                }
                break;
            case NodeMatcherType::ENUM:
                top.schema.matching = NodeSchemaMatching::MATCHED;
                top.schema.value = top.node.children_begin_or_value();
                break;
            case NodeMatcherType::ARRAY: {
                top.schema.matching = NodeSchemaMatching::MATCHED;
                auto visit = std::min<size_t>(top.node.children_count(), top.schema.children.size());
                auto unmatched = top.schema.children.size() - visit;
                auto base = top.node.children_begin_or_value();
                for (unsigned i = 0; i < visit; ++i) {
                    pending.push_back({program_->nodes[base + i], top.schema.children[i]});
                }
                for (unsigned i = 0; i < unmatched; ++i) {
                    top.schema.children[visit + i].matching = NodeSchemaMatching::MISSING;
                    full_match = false;
                }
                break;
            }
            case NodeMatcherType::OBJECT: {
                top.schema.matching = NodeSchemaMatching::MATCHED;
                nonstd::span<const sx::Node> children{program_->nodes.data() + top.node.children_begin_or_value(), top.node.children_count()};
                assert(std::is_sorted(children.begin(), children.end(), [](auto& l, auto& r) {
                    return l.attribute_key() < r.attribute_key();
                }));
                size_t h = 0, e = 0;
                while (h < children.size() && e < top.schema.children.size()) {
                    auto& have = children[h];
                    auto& expected = top.schema.children[e];
                    if (have.attribute_key() < expected.attribute_key) {
                        ++h;
                    } else if (have.attribute_key() > expected.attribute_key) {
                        expected.matching = NodeSchemaMatching::MISSING;
                        full_match = false;
                        ++e;
                    } else {
                        pending.push_back({have, expected});
                        ++h;
                        ++e;
                    }
                }
                for (; e < top.schema.children.size(); ++e) {
                    top.schema.children[e].matching = NodeSchemaMatching::MISSING;
                    full_match = false;
                }
                break;
            }
        }
    }
    return full_match;
}

}  // namespace dashql
