// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/analyzer.h"

#include "dashql/analyzer/action_planner.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/analyzer/function_logic.h"
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

/// Constructor
ConstantValue::ConstantValue()
    : constant_type(sxs::AConstType::NULL_), value(std::monostate{}) {}
/// Constructor
ConstantValue::ConstantValue(sxs::AConstType type, bool value)
    : constant_type(type), value(value) {}
/// Constructor
ConstantValue::ConstantValue(sxs::AConstType type, int64_t value)
    : constant_type(type), value(value) {}
/// Constructor
ConstantValue::ConstantValue(sxs::AConstType type, double value)
    : constant_type(type), value(value) {}
/// Constructor
ConstantValue::ConstantValue(sxs::AConstType type, std::string_view value)
    : constant_type(type), value(value) {}

/// Get the static webdb instance
Analyzer& Analyzer::GetInstance() {
    if (analyzer_instance == nullptr) {
        analyzer_instance = std::make_unique<Analyzer>();
    }
    return *analyzer_instance;
}

/// Get the static webdb instance
void Analyzer::ResetInstance() {
    analyzer_instance.reset();
}

/// Evaluate a constant node value
std::optional<ConstantValue> Analyzer::TryEvaluateConstant(ProgramInstance& instance, const sx::Node& node) const {
    // Catch simple case

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
        auto type = matches[0].ValueAsEnum<proto::syntax_sql::AConstType>();
        switch (type) {
            case proto::syntax_sql::AConstType::INTEGER:
                return ConstantValue{type, matches[1].ValueAsI64()};
            case proto::syntax_sql::AConstType::FLOAT:
                return ConstantValue{type, matches[1].ValueAsDouble()};
            case proto::syntax_sql::AConstType::STRING:
                return ConstantValue{type, matches[1].ValueAsString()};
            case proto::syntax_sql::AConstType::BITSTRING:
                return ConstantValue{type, matches[1].ValueAsStringRef()};
            case proto::syntax_sql::AConstType::NULL_:
                return ConstantValue{};
        }
    }
    return std::nullopt;
}

/// Constructor
Analyzer::Analyzer() : volatile_program_text_(), volatile_program_(), program_instance_(), program_log_(), program_log_writer_(), planned_program_(nullptr), planned_graph_() {
    program_log_.reserve(PLANNER_LOG_SIZE);
    for (unsigned i = 0; i < PLANNER_LOG_SIZE; ++i)
        program_log_.push_back(nullptr);
}

/// Evaluate a program
ExpectedBuffer<proto::syntax::Program> Analyzer::ParseProgram(std::string_view text) {
    // Parse the program
    volatile_program_text_ = std::make_shared<std::string>(text);
    volatile_program_ = parser::ParserDriver::Parse(text);

    // Encode the program
    flatbuffers::FlatBufferBuilder builder{text.size()};
    auto program_ofs = sx::Program::Pack(builder, volatile_program_.get());
    builder.Finish(program_ofs);
    return builder.Release();
}

Signal Analyzer::EvaluateProgram(ProgramInstance& instance) {
    auto& program = instance.program();
    auto& parameter_values = instance.parameter_values();

    // Maps the node ids to the parameter values
    std::unordered_map<size_t, const proto::analyzer::ParameterValueT*> parameter_nodes;
    // Contains all nodes that we tried to evaluate (not necessarily successful!)
    std::unordered_set<size_t> evaluated_nodes;
    // Map parameter values to statements
    std::unordered_map<size_t, const proto::analyzer::ParameterValueT*> source_values;
    source_values.reserve(parameter_values.size());
    for (auto& p: parameter_values) {
        source_values.insert({p->origin_statement, p.get()});
    }
    // Map parameter statements to referring nodes
    parameter_nodes.reserve(parameter_values.size());
    for (auto& dep: program.dependencies) {
        if (auto iter = source_values.find(dep.source_statement()); iter != source_values.end()) {
            parameter_nodes.insert({dep.target_node(), iter->second});
        }
    }

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
        if (evaluated_nodes.count(parent_node_id)) continue;

        // Is the parent a function argument list?
        // In that case, we'll try to evaluate the function.
        if (parent_node.attribute_key() == sx::AttributeKey::SQL_FUNCTION_ARGUMENTS)  {
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
            auto& func_node = program.nodes[parent_node.parent()];
            std::array<NodeMatching, 2> matches;
            if (schema.Match(instance, func_node, matches)) {
                auto func_name = matches[1].ValueAsStringRef();
                auto func_args = matches[0].node;

                for (unsigned i = 0; i < func_args->children_count(); ++i) {
                    auto node_id = func_args->children_begin_or_value() + i;
                    auto arg_value = TryEvaluateConstant(instance, func_node);
                    (void)arg_value;
                }
            }
        }


        // XXX Otherwise just replace the whole column ref.


    }

    return Signal::OK();
}

/// Instantiate a program with parameters
Signal Analyzer::InstantiateProgram(proto::analyzer::ProgramParametersT& params) {
    // Create program instance.
    // Note that we copy the shared pointer here and leave the parser output in tact. 
    // This allows us to re-instantiate the program with new parameter values without parsing it again.
    auto next_instance = std::make_unique<ProgramInstance>(volatile_program_text_, volatile_program_, move(params.values));
    if (auto rc = EvaluateProgram(*next_instance); !rc) {
        return rc.ReleaseError();
    }

    // XXX Best-effort semantics check.
    //     Everything that we can miss here will crash later in DuckDB.

    // If semantics are ok, replace current program instance
    program_log_[(program_log_writer_++) & PLANNER_LOG_MASK] = std::move(program_instance_);
    program_instance_ = move(next_instance);
    return Signal::OK();
}

/// Evaluate a program
ExpectedBuffer<proto::analyzer::Plan> Analyzer::PlanProgram() {
    // Get previous and next program
    auto prev_program = program_log_.empty() ? nullptr : program_log_.back().get();
    auto prev_graph = planned_graph_.get();
    auto next_program = program_instance_.get();

    // Plan the action graph
    ActionPlanner action_planner{*next_program, prev_program, prev_graph};
    action_planner.PlanActionGraph();
    planned_graph_ = action_planner.Finish();
    planned_program_ = next_program;

    // Pack action graph
    flatbuffers::FlatBufferBuilder builder;
    auto graph = proto::action::ActionGraph::Pack(builder, planned_graph_.get());

    // Pack parameters
    std::vector<flatbuffers::Offset<proto::analyzer::ParameterValue>> param_offsets;
    param_offsets.reserve(program_instance_->parameter_values().size());
    for (auto& param: program_instance_->parameter_values()) {
        auto ofs = proto::analyzer::ParameterValue::Pack(builder, param.get());
        param_offsets.push_back(ofs);
    }
    auto param_vec = builder.CreateVector(param_offsets);

    // Pack patch
    auto& patch = program_instance_->patch();
    auto patch_ofs = proto::syntax::ProgramPatch::Pack(builder, patch.get());

    // Encode the plan result
    proto::analyzer::PlanBuilder plan{builder};
    plan.add_action_graph(graph);
    plan.add_parameters(param_vec);
    plan.add_program_evaluation(patch_ofs);
    auto plan_ofs = plan.Finish();
    builder.Finish(plan_ofs);
    return builder.Release();
}

}  // namespace dashql
