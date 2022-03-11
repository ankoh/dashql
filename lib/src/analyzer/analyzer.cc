// Copyright (c) 2020 The DashQL Authors

#include "dashql/analyzer/analyzer.h"

#include <iomanip>
#include <optional>

#include "arrow/scalar.h"
#include "arrow/type_fwd.h"
#include "arrow/visitor_inline.h"
#include "dashql/analyzer/board_space.h"
#include "dashql/analyzer/function_logic.h"
#include "dashql/analyzer/input_value.h"
#include "dashql/analyzer/program_editor.h"
#include "dashql/analyzer/stmt/input_stmt.h"
#include "dashql/analyzer/stmt/set_stmt.h"
#include "dashql/analyzer/stmt/viz_stmt.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/analyzer/task_planner.h"
#include "dashql/common/substring_buffer.h"
#include "dashql/parser/parser_driver.h"
#include "dashql/proto_generated.h"

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
arrow::Result<std::shared_ptr<arrow::Scalar>> Analyzer::TryEvaluateConstant(ProgramInstance& instance,
                                                                            size_t node_id) const {
    // Already evaluated?
    if (auto* eval = instance.evaluated_nodes_.Find(node_id); !!eval) {
        return eval->value;
    }
    auto& node = instance.program().nodes[node_id];

    // XXX We might need to match more cases here as the grammar evolves.

    switch (node.node_type()) {
        case sx::NodeType::BOOL:
        case sx::NodeType::UI32:
        case sx::NodeType::UI32_BITMAP:
        case sx::NodeType::STRING_REF: {
            auto value = std::make_shared<arrow::StringScalar>(std::string{instance.TextAt(node.location())});
            return instance.evaluated_nodes_.Insert(node_id, {node_id, std::move(value)})->value;
        }
        default:
            return nullptr;
    }
}

/// Evaluate a function call
arrow::Result<std::shared_ptr<arrow::Scalar>> Analyzer::TryEvaluateFunctionCall(ProgramInstance& instance,
                                                                                size_t node_id) const {
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
    auto matches = schema.Match(instance, node_id, 2);
    if (!matches.IsFullMatch()) {
        return nullptr;
    }
    auto func_name = matches[1].DataAsStringRef();

    // Try to collect all function arguments.
    // Abort if they are not const.
    auto func_args_node_id = matches[0].node_id;
    auto func_args_node = program.nodes[func_args_node_id];
    std::vector<std::shared_ptr<arrow::Scalar>> func_args;
    std::vector<size_t> func_arg_node_ids;
    for (unsigned i = 0; i < func_args_node.children_count(); ++i) {
        auto arg_node_id = func_args_node.children_begin_or_value() + i;
        ARROW_ASSIGN_OR_RAISE(auto arg_value, TryEvaluateConstant(instance, arg_node_id));
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
    if (!value.ok()) {
        instance.AddNodeError({node_id, value.status()});
        return value.status();
    }

    // Merge the evaluated nodes
    eval.Insert(node_id, {});
    return eval.Merge(node_id, func_arg_node_ids, {node_id, value.ValueUnsafe()})->value;
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

arrow::Status Analyzer::UpdateTaskStatus(proto::task::TaskClass task_class, size_t task_id,
                                         proto::task::TaskStatusCode status) {
    if (task_class == proto::task::TaskClass::SETUP_TASK) {
        if (!planned_graph_ || task_id >= planned_graph_->setup_tasks.size()) return arrow::Status::OK();
        planned_graph_->setup_tasks[task_id]->task_status_code = status;
    } else {
        if (!planned_graph_ || task_id >= planned_graph_->program_tasks.size()) return arrow::Status::OK();
        planned_graph_->program_tasks[task_id]->task_status_code = status;
    }
    return arrow::Status::OK();
}

/// Parse a program
arrow::Status Analyzer::ParseProgram(std::string_view text) {
    // Parse the program
    volatile_program_text_ = std::make_shared<std::string>(text);
    volatile_program_ = parser::ParserDriver::Parse(text);
    return arrow::Status::OK();
}

// Evaluate the input values
arrow::Status Analyzer::EvaluateInputValues(ProgramInstance& instance) {
    auto& program = instance.program();
    auto& input_values = instance.input_values();

    // Map input values to statements
    std::unordered_map<size_t, const InputValue*> source_values;
    source_values.reserve(input_values.size());
    for (auto& p : input_values) {
        source_values.insert({p.statement_id, &p});
    }
    // Map input statements to referring nodes
    for (auto& dep : program.dependencies) {
        if (auto iter = source_values.find(dep.source_statement()); iter != source_values.end()) {
            auto& input_value = iter->second;
            instance.evaluated_nodes_.Insert(dep.target_node(), {dep.target_node(), input_value->value});
        }
    }
    return arrow::Status::OK();
}

arrow::Status Analyzer::PropagateConstants(ProgramInstance& instance) {
    // We iterate through all nodes from the front to the back.
    // This already ensures that we see all children of a node before we see the parent.
    auto& nodes = instance.program_->nodes;
    for (unsigned n = 0; n < nodes.size(); ++n) {
        switch (nodes[n].node_type()) {
            case sx::NodeType::OBJECT_DASHQL_FUNCTION_CALL:
                ARROW_RETURN_NOT_OK(TryEvaluateFunctionCall(instance, n));
                break;
            default:
                break;
        }
    }
    return arrow::Status::OK();
}

/// Identify all statements that do not contribute to a viz and mark them as dead
arrow::Status Analyzer::IdentifyDeadStatements(ProgramInstance& instance) {
    std::vector<bool> liveness;
    liveness.resize(instance.program_->statements.size(), false);

    // Mark input statements as live

    // Collect dependencies
    std::unordered_multimap<size_t, size_t> depends_on;
    depends_on.reserve(instance.program_->dependencies.size());
    for (auto& dep : instance.program_->dependencies) {
        depends_on.insert({dep.target_statement(), dep.source_statement()});
    }

    // Prepare DFSs starting from viz and input statements
    std::vector<size_t> pending;
    std::unordered_set<size_t> visited;
    pending.reserve(liveness.size());
    visited.reserve(liveness.size());
    for (auto& viz : instance.viz_statements()) {
        pending.push_back(viz->statement_id());
    }
    for (auto& input : instance.input_statements()) {
        pending.push_back(input->statement_id());
    }

    // Traverse all dependencies
    while (!pending.empty()) {
        // Pop from stack and mark as visited
        auto next = pending.back();
        pending.pop_back();
        liveness[next] = true;

        // Mark as visisted
        if (visited.count(next)) continue;
        visited.insert(next);

        // Push pending statement
        auto deps = depends_on.equal_range(next);
        for (auto iter = deps.first; iter != deps.second; ++iter) {
            pending.push_back(iter->second);
        }
    }

    // Store liveness
    instance.statements_liveness_ = std::move(liveness);
    return arrow::Status::OK();
}

/// Analyze the input statements
arrow::Status Analyzer::AnalyzeInputStatements(ProgramInstance& instance) {
    auto& program = instance.program();
    for (size_t stmt_id = 0; stmt_id < program.statements.size(); ++stmt_id) {
        auto input = InputStatement::ReadFrom(instance, stmt_id);
        if (!input) continue;
        instance.input_statements_.push_back(std::move(input));
    }
    return arrow::Status::OK();
}

/// Analyze the fetch statements
arrow::Status Analyzer::AnalyzeFetchStatements(ProgramInstance& instance) {
    auto& program = instance.program();
    for (size_t stmt_id = 0; stmt_id < program.statements.size(); ++stmt_id) {
        auto input = FetchStatement::ReadFrom(instance, stmt_id);
        if (!input) continue;
        instance.fetch_statements_.push_back(std::move(input));
    }
    return arrow::Status::OK();
}

/// Analyze the set statements
arrow::Status Analyzer::AnalyzeSetStatements(ProgramInstance& instance) {
    auto& program = instance.program();
    for (size_t stmt_id = 0; stmt_id < program.statements.size(); ++stmt_id) {
        auto input = SetStatement::ReadFrom(instance, stmt_id);
        if (!input) continue;
        instance.set_statements_.push_back(std::move(input));
    }
    return arrow::Status::OK();
}

/// Analyze the load statements
arrow::Status Analyzer::AnalyzeLoadStatements(ProgramInstance& instance) {
    auto& program = instance.program();
    for (size_t stmt_id = 0; stmt_id < program.statements.size(); ++stmt_id) {
        auto load = LoadStatement::ReadFrom(instance, stmt_id);
        if (!load) continue;
        instance.load_statements_.push_back(std::move(load));
    }
    return arrow::Status::OK();
}

/// Analyze the viz statements
arrow::Status Analyzer::AnalyzeVizStatements(ProgramInstance& instance) {
    auto& program = instance.program();
    for (size_t stmt_id = 0; stmt_id < program.statements.size(); ++stmt_id) {
        auto viz = VizStatement::ReadFrom(instance, stmt_id);
        if (!viz) continue;
        instance.viz_statements_.push_back(std::move(viz));
    }
    return arrow::Status::OK();
}

/// Compute the viz positions
arrow::Status Analyzer::ComputeCardPositions(ProgramInstance& instance) {
    static constexpr uint32_t DEFAULT_INPUT_CARD_WIDTH = 2;
    static constexpr uint32_t DEFAULT_INPUT_CARD_HEIGHT = 1;
    static constexpr uint32_t DEFAULT_VIZ_CARD_WIDTH = 12;
    static constexpr uint32_t DEFAULT_VIZ_CARD_HEIGHT = 6;

    BoardSpace space;

    // Collect input positions
    for (auto& stmt : instance.input_statements()) {
        auto& specified = stmt->specified_position();
        stmt->computed_position() = !!specified ? *specified : proto::analyzer::CardPosition(0, 0, 0, 0);
        auto& pos = stmt->computed_position().value();
        auto alloc = space.Allocate({
            .width = pos.width() == 0 ? DEFAULT_INPUT_CARD_WIDTH : pos.width(),
            .height = pos.height() == 0 ? DEFAULT_INPUT_CARD_HEIGHT : pos.height(),
            .row = pos.row(),
            .column = pos.column(),
        });
        pos.mutate_width(alloc.width);
        pos.mutate_height(alloc.height);
        pos.mutate_row(alloc.row);
        pos.mutate_column(alloc.column);
    }

    // Collect viz positions
    for (auto& stmt : instance.viz_statements()) {
        auto& specified = stmt->specified_position();
        stmt->computed_position() = !!specified ? *specified : proto::analyzer::CardPosition(0, 0, 0, 0);
        auto& pos = stmt->computed_position().value();
        auto alloc = space.Allocate({
            .width = pos.width() == 0 ? DEFAULT_VIZ_CARD_WIDTH : pos.width(),
            .height = pos.height() == 0 ? DEFAULT_VIZ_CARD_HEIGHT : pos.height(),
            .row = pos.row(),
            .column = pos.column(),
        });
        pos.mutate_width(alloc.width);
        pos.mutate_height(alloc.height);
        pos.mutate_row(alloc.row);
        pos.mutate_column(alloc.column);
    }

    return arrow::Status::OK();
}

/// Instantiate a program with inputs
arrow::Status Analyzer::InstantiateProgram(std::vector<InputValue> inputs) {
    // Create program instance.
    // Note that we copy the shared pointer here and leave the parser output intact.
    // That allows us to re-instantiate the program with new input values without parsing it again.
    auto next_instance = std::make_unique<ProgramInstance>(volatile_program_text_, volatile_program_, move(inputs));

    // Evaluate the given input values.
    ARROW_RETURN_NOT_OK(EvaluateInputValues(*next_instance));
    // Evaluate and propagate constant values.
    ARROW_RETURN_NOT_OK(PropagateConstants(*next_instance));
    // Analyze the statements
    ARROW_RETURN_NOT_OK(AnalyzeInputStatements(*next_instance));
    ARROW_RETURN_NOT_OK(AnalyzeFetchStatements(*next_instance));
    ARROW_RETURN_NOT_OK(AnalyzeSetStatements(*next_instance));
    ARROW_RETURN_NOT_OK(AnalyzeLoadStatements(*next_instance));
    ARROW_RETURN_NOT_OK(AnalyzeVizStatements(*next_instance));
    // Analyze liveness
    ARROW_RETURN_NOT_OK(IdentifyDeadStatements(*next_instance));
    // Compute the card positions
    ARROW_RETURN_NOT_OK(ComputeCardPositions(*next_instance));

    // XXX Best-effort semantics check.
    //     Everything that we miss here will crash later in DuckDB.

    // If semantics are ok, replace current program instance
    program_log_[(program_log_writer_++) & PLANNER_LOG_MASK] = std::move(program_instance_);
    program_instance_ = move(next_instance);
    return arrow::Status::OK();
}

/// Edit the last program
arrow::Status Analyzer::EditProgram(const proto::edit::ProgramEdit& edit) {
    if (!program_instance_) return arrow::Status::OK();

    // Apply the edits
    ProgramEditor editor{*program_instance_};
    auto updated_text = editor.Apply(edit);

    // Parse the new program
    ARROW_RETURN_NOT_OK(ParseProgram(updated_text));

    // Instantiate the new program
    std::vector<InputValue> inputs;
    inputs.reserve(program_instance_->input_values().size());
    for (auto& p : program_instance_->input_values()) {
        inputs.push_back({
            p.statement_id,
            p.value,
        });
    }
    ARROW_RETURN_NOT_OK(InstantiateProgram(std::move(inputs)));

    // XXX Error handling.
    //     Rewriting a syntactically incorrect program?
    return arrow::Status::OK();
}

/// Evaluate a program
arrow::Status Analyzer::PlanProgram() {
    // Get previous and next program
    auto prev_program = planned_program_;
    auto prev_graph = planned_graph_.get();
    auto next_program = program_instance_.get();

    // Plan the task graph
    TaskPlanner task_planner{*next_program, prev_program, prev_graph};
    ARROW_RETURN_NOT_OK(task_planner.PlanTaskGraph());
    planned_graph_ = task_planner.Finish();
    planned_program_ = next_program;

    return arrow::Status::OK();
}

/// Pack the program
arrow::Result<flatbuffers::Offset<proto::syntax::Program>> Analyzer::PackProgram(
    flatbuffers::FlatBufferBuilder& builder) {
    assert(!!volatile_program_.get());
    return sx::Program::Pack(builder, volatile_program_.get());
}

/// Pack the program annotations
arrow::Result<flatbuffers::Offset<proto::analyzer::ProgramAnnotations>> Analyzer::PackProgramAnnotations(
    flatbuffers::FlatBufferBuilder& builder) {
    assert(!!program_instance_.get());
    return program_instance_->PackAnnotations(builder);
}

/// Pack the plan
arrow::Result<flatbuffers::Offset<proto::analyzer::Plan>> Analyzer::PackPlan(flatbuffers::FlatBufferBuilder& builder) {
    assert(!!planned_graph_.get());
    auto graph = proto::task::TaskGraph::Pack(builder, planned_graph_.get());
    proto::analyzer::PlanBuilder plan{builder};
    plan.add_task_graph(graph);
    return plan.Finish();
}

/// Pack a program replacement
arrow::Result<flatbuffers::Offset<proto::analyzer::ProgramReplacement>> Analyzer::PackReplacement(
    flatbuffers::FlatBufferBuilder& builder) {
    assert(!!program_instance_.get());

    auto program_txt = builder.CreateString(program_instance_->program_text());
    auto program = sx::Program::Pack(builder, &program_instance_->program());
    ARROW_ASSIGN_OR_RAISE(auto annotations, program_instance_->PackAnnotations(builder));

    proto::analyzer::ProgramReplacementBuilder replacement{builder};
    replacement.add_program_text(program_txt);
    replacement.add_program(program);
    replacement.add_annotations(annotations);
    return replacement.Finish();
}

}  // namespace dashql
