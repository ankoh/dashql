// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/analyzer.h"

#include <iomanip>

#include "dashql/analyzer/action_planner.h"
#include "dashql/analyzer/function_logic.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/proto_generated.h"
#include "duckdb/main/client_context.hpp"

using namespace dashql;
namespace fb = flatbuffers;
namespace sx = proto::syntax;
namespace sxs = proto::syntax_sql;

namespace dashql {

static constexpr size_t PLANNER_LOG_SIZE = 64;
static constexpr size_t PLANNER_LOG_MASK = PLANNER_LOG_SIZE - 1;
static_assert((PLANNER_LOG_SIZE & PLANNER_LOG_MASK) == 0, "PLANNER_LOG_SIZE must be a power of 2");

static std::unique_ptr<Analyzer> analyzer_instance = nullptr;

/// Get the static webdb instance
Analyzer& Analyzer::GetInstance() {
    if (analyzer_instance == nullptr) {
        analyzer_instance = std::make_unique<Analyzer>();
    }
    return *analyzer_instance;
}

/// Get the static webdb instance
void Analyzer::ResetInstance() { analyzer_instance.reset(); }

/// Evaluate a constant node value
std::optional<webdb::Value> Analyzer::TryEvaluateConstant(ProgramInstance& instance, size_t node_id) const {
    // Already evaluated?
    if (auto eval = instance.evaluated_nodes_.Find(node_id); !!eval) {
        auto& [node_id, value] = *eval;
        return value;
    }
    auto& node = instance.program().nodes[node_id];

    // Try to match a simple SQL constant.
    // XXX We might need to match more cases here as the grammar evolves.

    // clang-format off
    auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_SQL_CONST)
        .MatchChildren(NODE_MATCHERS(
            sxm::Attribute(sx::AttributeKey::SQL_CONST_TYPE, 0)
                .MatchEnum(sx::NodeType::ENUM_SQL_CONST_TYPE),
            sxm::Attribute(sx::AttributeKey::SQL_CONST_VALUE, 1)
                .MatchString(),
        ));
    // clang-format on
    std::array<NodeMatching, 2> matches;
    if (schema.Match(instance, node, matches)) {
        webdb::Value v;
        switch (matches[0].DataAsEnum<proto::syntax_sql::AConstType>()) {
            case proto::syntax_sql::AConstType::INTEGER:
                v = webdb::Value::INTEGER(matches[1].DataAsI64());
                break;
            case proto::syntax_sql::AConstType::FLOAT:
                v = webdb::Value::FLOAT(matches[1].DataAsI64());
                break;
            case proto::syntax_sql::AConstType::BITSTRING:
            case proto::syntax_sql::AConstType::STRING:
                v = webdb::Value::VARCHAR(matches[1].DataAsString());
                break;
            default:
                break;
        }
        instance.evaluated_nodes_.Insert(node_id, {node_id, v});
        return v;
    }
    return std::nullopt;
}

/// Constructor
Analyzer::Analyzer()
    : volatile_program_text_(),
      volatile_program_(),
      program_instance_(),
      program_log_(),
      program_log_writer_(),
      planned_program_(nullptr),
      planned_graph_() {
    program_log_.reserve(PLANNER_LOG_SIZE);
    for (unsigned i = 0; i < PLANNER_LOG_SIZE; ++i) program_log_.push_back(nullptr);
}

void Analyzer::UpdateProgramActionStatus(size_t action_id, proto::action::ActionStatusCode status) {
    if (!planned_graph_ || action_id >= planned_graph_->program_actions.size()) return;
    planned_graph_->program_actions[action_id]->action_status_code = status;
}

void Analyzer::UpdateSetupActionStatus(size_t action_id, proto::action::ActionStatusCode status) {
    if (!planned_graph_ || action_id >= planned_graph_->setup_actions.size()) return;
    planned_graph_->setup_actions[action_id]->action_status_code = status;
}

/// Parse a program
Signal Analyzer::ParseProgram(std::string_view text) {
    // Parse the program
    volatile_program_text_ = std::make_shared<std::string>(text);
    volatile_program_ = parser::ParserDriver::Parse(text);
    return Signal::OK();
}

// Evaluate the parameter values
void Analyzer::EvaluateParameterValues(ProgramInstance& instance) {
    auto& program = instance.program();
    auto& parameter_values = instance.parameter_values();

    // Map parameter values to statements
    std::unordered_map<size_t, const ProgramInstance::ParameterValue*> source_values;
    source_values.reserve(parameter_values.size());
    for (auto& p : parameter_values) {
        source_values.insert({p.statement_id, &p});
    }
    // Map parameter statements to referring nodes
    for (auto& dep : program.dependencies) {
        if (auto iter = source_values.find(dep.source_statement()); iter != source_values.end()) {
            auto& param_value = iter->second;
            instance.evaluated_nodes_.Insert(dep.target_node(), {dep.target_node(), param_value->value});
        }
    }
}

// Propagate the parameter values
void Analyzer::PropagateParameterValues(ProgramInstance& instance) {
    auto& program = instance.program();
    auto& parameter_values = instance.parameter_values();
    auto& eval = instance.evaluated_nodes_;

    // Find all the column refs that occur in the statement
    for (auto& dep : program.dependencies) {
        auto target = dep.target_statement();
        auto source = dep.source_statement();

        // Skip non column ref dependencies
        if (dep.type() != sx::DependencyType::COLUMN_REF) continue;
        auto& node_id = program.nodes[program.statements[target]->root_node];
        auto& node = program.nodes[dep.target_node()];
        assert(node.node_type() == sx::NodeType::OBJECT_SQL_COLUMN_REF);

        // Check the parent node.
        auto parent_node_id = node.parent();
        auto& parent_node = program.nodes[parent_node_id];
        if (eval.Find(parent_node_id)) continue;

        // Is the parent a function argument list?
        // In that case, we'll try to evaluate the function.
        if (parent_node.attribute_key() == sx::AttributeKey::SQL_FUNCTION_ARGUMENTS) {
            // clang-format off
            auto schema = sxm::Element()
                .MatchObject(sx::NodeType::OBJECT_DASHQL_FUNCTION_CALL)
                .MatchChildren(NODE_MATCHERS(
                    sxm::Attribute(sx::AttributeKey::SQL_FUNCTION_ARGUMENTS, 0)
                        .MatchArray(),
                    sxm::Attribute(sx::AttributeKey::SQL_FUNCTION_NAME, 1)
                        .MatchString(),
                ));
            // clang-format on

            auto func_node_id = parent_node.parent();
            auto& func_node = program.nodes[func_node_id];
            std::array<NodeMatching, 2> matches;
            if (schema.Match(instance, func_node, matches)) {
                auto func_name = matches[1].DataAsStringRef();
                eval.Insert(func_node_id, {func_node_id, {}});

                // Try to collect all function arguments.
                // Abort if they are not const.
                auto func_args_node = matches[0].node;
                std::vector<webdb::Value> func_args;
                std::vector<size_t> func_arg_node_ids;
                for (unsigned i = 0; i < func_args_node->children_count(); ++i) {
                    auto arg_node_id = func_args_node->children_begin_or_value() + i;
                    auto arg_value = TryEvaluateConstant(instance, arg_node_id);
                    if (!arg_value) break;
                    func_args.push_back(*arg_value);
                    func_arg_node_ids.push_back(arg_node_id);
                }

                // Not all arguments const?
                if (func_args.size() != func_args_node->children_count()) continue;

                // Collect arg types
                std::vector<const proto::webdb::SQLType*> func_arg_types;
                func_arg_types.reserve(func_args.size());
                for (auto& arg : func_args) {
                    func_arg_types.push_back(&arg.sql_type());
                }
                auto logic = FunctionLogic::Resolve(func_name, func_arg_types);
                if (!logic) continue;

                // Evaluate the function
                auto value = logic->Evaluate(func_args);
                if (!value) continue;

                // Merge the evaluated nodes
                eval.Merge(func_node_id, func_arg_node_ids, {func_node_id, value.ReleaseValue()});
            }
        }
    }
}

/// Instantiate a program with parameters
Signal Analyzer::InstantiateProgram(std::vector<ProgramInstance::ParameterValue> params) {
    // Create program instance.
    // Note that we copy the shared pointer here and leave the parser output intact.
    // That allows us to re-instantiate the program with new parameter values without parsing it again.
    auto next_instance = std::make_unique<ProgramInstance>(volatile_program_text_, volatile_program_, move(params));

    // Evaluate the program with the given parameter values.
    EvaluateParameterValues(*next_instance);
    // Try to propagate the parameter values, e.g. function calls that are now constant
    PropagateParameterValues(*next_instance);

    // XXX Best-effort semantics check.
    //     Everything that we miss here will crash later in DuckDB.

    // If semantics are ok, replace current program instance
    program_log_[(program_log_writer_++) & PLANNER_LOG_MASK] = std::move(program_instance_);
    program_instance_ = move(next_instance);
    return Signal::OK();
}

/// Evaluate a program
Signal Analyzer::PlanProgram() {
    // Get previous and next program
    auto prev_program = program_log_[(program_log_writer_ + program_log_.size() - 1) & PLANNER_LOG_MASK].get();
    auto prev_graph = planned_graph_.get();
    auto next_program = program_instance_.get();

    // Plan the action graph
    ActionPlanner action_planner{*next_program, prev_program, prev_graph};
    action_planner.PlanActionGraph();
    planned_graph_ = action_planner.Finish();
    planned_program_ = next_program;

    return Signal::OK();
}

/// Pack the program
flatbuffers::Offset<proto::syntax::Program> Analyzer::PackProgram(flatbuffers::FlatBufferBuilder& builder) {
    assert(!!volatile_program_.get());
    return sx::Program::Pack(builder, volatile_program_.get());
}

/// Pack the plan
flatbuffers::Offset<proto::analyzer::Plan> Analyzer::PackPlan(flatbuffers::FlatBufferBuilder& builder) {
    assert(!!planned_graph_.get());
    auto graph = proto::action::ActionGraph::Pack(builder, planned_graph_.get());

    // Pack parameters
    std::vector<flatbuffers::Offset<proto::analyzer::ParameterValue>> param_offsets;
    param_offsets.reserve(program_instance_->parameter_values().size());
    for (auto& param : program_instance_->parameter_values()) {
        param_offsets.push_back(param.Pack(builder));
    }
    auto param_vec = builder.CreateVector(param_offsets);

    // Pack patch
    auto patch = program_instance_->PackProgramPatch(builder);

    // Encode the plan result
    proto::analyzer::PlanBuilder plan{builder};
    plan.add_action_graph(graph);
    plan.add_parameters(param_vec);
    plan.add_program_evaluation(patch);
    return plan.Finish();
}

}  // namespace dashql
