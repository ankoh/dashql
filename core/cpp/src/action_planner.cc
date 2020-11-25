#include "dashql/action_planner.h"

#include "dashql/proto/syntax_dashql_generated.h"

namespace dashql {

namespace sxd = dashql::proto::syntax_dashql;
using ActionType = proto::action::ActionType;
using Key = sx::AttributeKey;

namespace {

const sx::Node* FindAttribute(const sx::Program& program, const sx::Node& origin, Key key) {
    auto children_begin = origin.children_begin_or_value();
    auto children_count = origin.children_count();
    auto lb = children_begin;
    auto c = children_count;
    while (c > 0) {
        auto step = c / 2;
        auto iter = lb + step;
        auto n = program.nodes()->Get(iter);
        if (n->attribute_key() < key) {
            lb = iter + 1;
            c -= step + 1;
        } else {
            c = step;
        }
    }
    if (lb >= children_begin + children_count) {
        return nullptr;
    }
    auto n = program.nodes()->Get(lb);
    return (n->attribute_key() == key) ? n : nullptr;
}

template <typename F> void IterateChildren(const sx::Program& program, const sx::Node& origin, F fn) {
    auto children_begin = origin.children_begin_or_value();
    auto children_count = origin.children_count();
    auto nodes = program.nodes();
    for (unsigned i = 0; i < children_count; ++i) {
        auto node_id = children_begin + i;
        fn(i, node_id, *nodes->Get(node_id));
    }
}

}  // namespace

using ActionObj = proto::action::ActionT;

// Constructor
ActionPlanner::ActionPlanner(std::string_view next_program_text, const sx::Program& next_program,
                             std::string_view prev_program_text, const proto::session::Plan* prev_plan,
                             const std::unordered_map<uint32_t, proto::action::ActionStatus>& prev_status,
                             const std::unordered_map<std::string_view, std::string_view>& parameter_values)
    : next_program_text_(next_program_text),
      next_program_(next_program),
      prev_program_text_(prev_program_text),
      prev_plan_(prev_plan),
      prev_action_status_(prev_status),
      parameter_values_(parameter_values),
      diff_(),
      setup_actions_(),
      graph_actions_() {}

// Diff programs
void ActionPlanner::DiffPrograms() {
    // No previous plan?
    // Then we emit all new statements as INSERT
    if (!prev_plan_) {
        for (unsigned i = 0; i < next_program_.statements()->size(); ++i) {
            diff_.emplace_back(DiffOpCode::INSERT, std::nullopt, i);
        }
        return;
    }

    // Compute the patience diff
    auto& prev_program = *prev_plan_->program();
    ProgramMatcher matcher{prev_program_text_, next_program_text_, prev_program, next_program_};
    diff_ = matcher.ComputeDiff();
}

// Collect the statement options
std::string ActionPlanner::RenderStatementText(const sx::Statement& stmt) {
    // TODO Render the statement text
}

// Collect the statement options
std::unique_ptr<proto::option::OptionListT> ActionPlanner::CollectOptions(const sx::Node& node) {
    // TODO Build option list
}

// Translate single statement
void ActionPlanner::TranslateStatement(size_t stmt_id) {
    static uint32_t global_target_id = 0;
    auto& stmts = *next_program_.statements();
    auto& stmt = *stmts.Get(stmt_id);
    auto& stmt_root = *next_program_.nodes()->Get(stmt.root());

    // Write action
    auto& action = graph_actions_[stmt_id];
    action.action_type = ActionType::NONE;
    action.origin_statement = stmt_id;
    action.depends_on = {};
    action.required_for = {};
    action.target_id = global_target_id++;
    action.target_name_short = stmt.target_name_short()->str();
    action.target_name_qualified = stmt.target_name_qualified()->str();
    action.script = "";
    action.options = CollectOptions(stmt_root);

    // Identify exact action
    switch (stmt_root.node_type()) {
        // VIZ statement
        case sx::NodeType::OBJECT_DASHQL_VIZ:
            action.action_type = ActionType::VIZ_CREATE;
            break;

        // LOAD statement
        case sx::NodeType::OBJECT_DASHQL_LOAD:
            if (auto m = FindAttribute(next_program_, stmt_root, Key::DASHQL_LOAD_METHOD)) {
                switch (static_cast<sxd::LoadMethodType>(m->children_begin_or_value())) {
                    case sxd::LoadMethodType::FILE:
                        action.action_type = ActionType::LOAD_FILE;
                        break;
                    case sxd::LoadMethodType::HTTP:
                        action.action_type = ActionType::LOAD_HTTP;
                        break;
                    default:
                        action.action_type = ActionType::NONE;
                        break;
                }
            }
            break;

        // EXTRACT statement
        case sx::NodeType::OBJECT_DASHQL_EXTRACT:
            if (auto m = FindAttribute(next_program_, stmt_root, Key::DASHQL_EXTRACT_METHOD)) {
                switch (static_cast<sxd::ExtractMethodType>(m->children_begin_or_value())) {
                    case sxd::ExtractMethodType::JSON:
                        action.action_type = ActionType::EXTRACT_JSON;
                        break;
                    case sxd::ExtractMethodType::CSV:
                        action.action_type = ActionType::EXTRACT_CSV;
                        break;
                    default:
                        action.action_type = ActionType::NONE;
                        break;
                }
            }
            break;

        // PARAMETER statement
        case sx::NodeType::OBJECT_DASHQL_PARAMETER:
            if (auto m = FindAttribute(next_program_, stmt_root, Key::DASHQL_PARAMETER_TYPE)) {
                switch (static_cast<sxd::ParameterType>(m->children_begin_or_value())) {
                    case sxd::ParameterType::FILE:
                        action.action_type = ActionType::PARAM_FILE;
                        break;
                    case sxd::ParameterType::DATE:
                    case sxd::ParameterType::DATETIME:
                    case sxd::ParameterType::FLOAT:
                    case sxd::ParameterType::INTEGER:
                    case sxd::ParameterType::TEXT:
                    case sxd::ParameterType::TIME:
                        action.action_type = ActionType::PARAM_CONSTANT;
                        break;
                    default:
                        action.action_type = ActionType::NONE;
                        break;
                }
            }
            break;

        // QUERY statement
        case sx::NodeType::OBJECT_DASHQL_QUERY:
            if (auto q = FindAttribute(next_program_, stmt_root, Key::DASHQL_QUERY_STATEMENT)) {
                if (auto into = FindAttribute(next_program_, *q, Key::SQL_SELECT_INTO)) {
                    action.action_type = proto::action::ActionType::TABLE_CREATE;
                }
            }
            break;

        // Failed to map the root node of a statement to an action
        default:
            assert(false);
    }
}

// Translate statements
void ActionPlanner::TranslateStatements() {
    auto& stmts = *next_program_.statements();
    graph_actions_.resize(stmts.size());

    // Translate statements to actions as if there all statements were new
    for (unsigned stmt_id = 0; stmt_id < stmts.size(); ++stmt_id) {
        TranslateStatement(stmt_id);
    }

    // Store dependencies
    auto& deps = *next_program_.dependencies();
    for (unsigned dep_id = 0; dep_id < deps.size(); ++dep_id) {
        auto& dep = *deps.Get(dep_id);
        graph_actions_[dep.source_statement()].required_for.push_back(dep.target_statement());
        graph_actions_[dep.target_statement()].depends_on.push_back(dep.source_statement());
    }
}

// Map previously completed actions to the new graph
void ActionPlanner::MapPreviousActions() {
    // TODO
}

// Propage updates/deletes/inserts in the new graph
void ActionPlanner::PropagateUpdates() {
    // TODO
}

// Plan the new action graph
void ActionPlanner::PlanActionGraph() {
    DiffPrograms();
    TranslateStatements();
    MapPreviousActions();
    PropagateUpdates();
}

// Encode action graph
flatbuffers::Offset<proto::action::ActionGraph> ActionPlanner::EncodeActionGraph(
    flatbuffers::FlatBufferBuilder& builder) {
    // Pack setup actions
    std::vector<flatbuffers::Offset<proto::action::Action>> setup_actions;
    for (auto& a : setup_actions_) {
        setup_actions.push_back(proto::action::Action::Pack(builder, &a));
    }
    // Pack the graph actions
    auto setup_actions_vec = builder.CreateVector(setup_actions);
    std::vector<flatbuffers::Offset<proto::action::Action>> graph_actions;
    for (auto& a : graph_actions_) {
        graph_actions.push_back(proto::action::Action::Pack(builder, &a));
    }
    auto graph_actions_vec = builder.CreateVector(graph_actions);
    // Build the graph
    proto::action::ActionGraphBuilder graph{builder};
    graph.add_setup(setup_actions_vec);
    graph.add_actions(graph_actions_vec);
    return graph.Finish();
}

}  // namespace dashql
