// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/analyzer.h"

#include <iomanip>
#include <optional>

#include "dashql/analyzer/action_planner.h"
#include "dashql/analyzer/function_logic.h"
#include "dashql/analyzer/parameter_value.h"
#include "dashql/analyzer/program_editor.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/analyzer/viz_statement.h"
#include "dashql/common/substring_buffer.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/proto_generated.h"
#include "duckdb/main/client_context.hpp"

using namespace dashql;

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
const Value* Analyzer::TryEvaluateConstant(ProgramInstance& instance, size_t node_id) const {
    // Already evaluated?
    if (auto* eval = instance.evaluated_nodes_.Find(node_id); !!eval) {
        return &eval->value;
    }
    auto& node = instance.program().nodes[node_id];

    // XXX We might need to match more cases here as the grammar evolves.

    switch (node.node_type()) {
        case sx::NodeType::BOOL:
        case sx::NodeType::UI32:
        case sx::NodeType::UI32_BITMAP:
        case sx::NodeType::STRING_REF:
            return &instance.evaluated_nodes_.Insert(node_id, {node_id, Value::VARCHAR(Ref, instance.TextAt(node.location()))})->value;
        default:
            return nullptr;
    }
}

/// Evaluate a function call
const Value* Analyzer::TryEvaluateFunctionCall(ProgramInstance& instance, size_t node_id) const {
    // clang-format off
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_FUNCTION_CALL)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::SQL_FUNCTION_ARGUMENTS, 0)
                .MatchArray(),
            sxm::Attribute(sx::AttributeKey::SQL_FUNCTION_NAME, 1)
                .MatchString(),
        });
    // clang-format on

    auto& eval = instance.evaluated_nodes_;
    auto& program = instance.program();
    std::array<NodeMatch, 2> matches;
    if (!schema.Match(instance, node_id, matches)) {
        return nullptr;
    }
    auto func_name = matches[1].DataAsStringRef();

    // Try to collect all function arguments.
    // Abort if they are not const.
    auto func_args_node_id = matches[0].node_id;
    auto func_args_node = program.nodes[func_args_node_id];
    std::vector<const Value*> func_args;
    std::vector<size_t> func_arg_node_ids;
    for (unsigned i = 0; i < func_args_node.children_count(); ++i) {
        auto arg_node_id = func_args_node.children_begin_or_value() + i;
        auto arg_value = TryEvaluateConstant(instance, arg_node_id);
        if (!arg_value) {
            break;
        }
        func_args.push_back(arg_value);
        func_arg_node_ids.push_back(arg_node_id);
    }

    // Not all arguments const?
    // Abort immediately
    if (func_args.size() != func_args_node.children_count()) return nullptr;

    // Resolve the function
    auto logic = FunctionLogic::Resolve(func_name, func_args);
    if (!logic) return nullptr;

    // Evaluate the function
    auto value = logic->Evaluate(func_args);
    if (!value) {
        instance.AddNodeError({node_id, value.ReleaseError()});
        return nullptr;
    }

    // Merge the evaluated nodes
    eval.Insert(node_id, {});
    return &eval.Merge(node_id, func_arg_node_ids, {node_id, value.ReleaseValue()})->value;
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
    std::unordered_map<size_t, const ParameterValue*> source_values;
    source_values.reserve(parameter_values.size());
    for (auto& p : parameter_values) {
        source_values.insert({p.statement_id, &p});
    }
    // Map parameter statements to referring nodes
    for (auto& dep : program.dependencies) {
        if (auto iter = source_values.find(dep.source_statement()); iter != source_values.end()) {
            auto& param_value = iter->second;
            instance.evaluated_nodes_.Insert(dep.target_node(), {dep.target_node(), param_value->value.CopyDeep()});
        }
    }
}

void Analyzer::PropagateConstants(ProgramInstance& instance) {
    // We iterate through all nodes from the front to the back.
    // This already ensures that we see all children of a node before we see the parent.
    auto& nodes = instance.program_->nodes;
    for (unsigned n = 0; n < nodes.size(); ++n) {
        switch (nodes[n].node_type()) {
            case sx::NodeType::OBJECT_DASHQL_FUNCTION_CALL:
                TryEvaluateFunctionCall(instance, n);
                break;
            default:
                break;
        }
    }
}

/// Analyze the viz specs
void Analyzer::AnalyzeVizStatements(ProgramInstance& instance) {
    auto& program = instance.program();
    for (size_t stmt_id = 0; stmt_id < program.statements.size(); ++stmt_id) {
        auto viz = viz::VizStatement::ReadFrom(instance, stmt_id);
        if (!viz) continue;
        instance.viz_statements_.push_back(std::move(viz));
    }
}

/// Instantiate a program with parameters
Signal Analyzer::InstantiateProgram(std::vector<ParameterValue> params) {
    // Create program instance.
    // Note that we copy the shared pointer here and leave the parser output intact.
    // That allows us to re-instantiate the program with new parameter values without parsing it again.
    auto next_instance = std::make_unique<ProgramInstance>(volatile_program_text_, volatile_program_, move(params));

    // Evaluate the given parameter values.
    EvaluateParameterValues(*next_instance);
    // Evaluate and propagate constant values.
    PropagateConstants(*next_instance);
    // Analyze the viz specs
    AnalyzeVizStatements(*next_instance);

    // XXX Best-effort semantics check.
    //     Everything that we miss here will crash later in DuckDB.

    // If semantics are ok, replace current program instance
    program_log_[(program_log_writer_++) & PLANNER_LOG_MASK] = std::move(program_instance_);
    program_instance_ = move(next_instance);
    return Signal::OK();
}

/// Edit the last program
Signal Analyzer::EditProgram(const proto::edit::ProgramEdit& edit) {
    if (!program_instance_) return Signal::OK();

    // Apply the edits
    ProgramEditor editor{*program_instance_};
    auto updated_text = editor.Apply(edit);

    // Parse the new program
    ParseProgram(updated_text);

    // Instantiate the new program
    std::vector<ParameterValue> params;
    params.reserve(program_instance_->parameter_values().size());
    for (auto& p : program_instance_->parameter_values()) {
        params.push_back({
            p.statement_id,
            p.value.CopyDeep(),
        });
    }
    InstantiateProgram(std::move(params));

    // XXX Error handling.
    //     Rewriting a syntactically incorrect program?
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

/// Pack the program annotations
flatbuffers::Offset<proto::analyzer::ProgramAnnotations> Analyzer::PackProgramAnnotations(flatbuffers::FlatBufferBuilder& builder) {
    assert(!!program_instance_.get());
    return program_instance_->PackAnnotations(builder);
}

/// Pack the plan
flatbuffers::Offset<proto::analyzer::Plan> Analyzer::PackPlan(flatbuffers::FlatBufferBuilder& builder) {
    assert(!!planned_graph_.get());
    auto graph = proto::action::ActionGraph::Pack(builder, planned_graph_.get());
    proto::analyzer::PlanBuilder plan{builder};
    plan.add_action_graph(graph);
    return plan.Finish();
}

/// Pack a program replacement
flatbuffers::Offset<proto::analyzer::ProgramReplacement> Analyzer::PackReplacement(
    flatbuffers::FlatBufferBuilder& builder) {
    assert(!!program_instance_.get());

    auto program_txt = builder.CreateString(program_instance_->program_text());
    auto program = sx::Program::Pack(builder, &program_instance_->program());
    auto annotations = program_instance_->PackAnnotations(builder);

    proto::analyzer::ProgramReplacementBuilder replacement{builder};
    replacement.add_program_text(program_txt);
    replacement.add_program(program);
    replacement.add_annotations(annotations);
    return replacement.Finish();
}

}  // namespace dashql
