#include "dashql/action_planner.h"

#include "dashql/proto/syntax_dashql_generated.h"

namespace dashql {

namespace sxd = dashql::proto::syntax_dashql;
using ActionType = proto::action::ActionType;
using Key = sx::AttributeKey;

namespace {

const sx::Node* FindAttribute(const sx::ProgramT& program, const sx::Node& origin, Key key) {
    auto children_begin = origin.children_begin_or_value();
    auto children_count = origin.children_count();
    auto lb = children_begin;
    auto c = children_count;
    while (c > 0) {
        auto step = c / 2;
        auto iter = lb + step;
        auto& n = program.nodes[iter];
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
    auto& n = program.nodes[lb];
    return (n.attribute_key() == key) ? &n : nullptr;
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
ActionPlanner::ActionPlanner(const ProgramInstance& next_program,
                  const ProgramInstance* prev_program,
                  const proto::action::ActionGraph* prev_action_graph,
                  const std::unordered_map<uint32_t, proto::action::ActionStatus>& prev_action_status)
    : next_program_(next_program),
      prev_program_(prev_program),
      prev_action_graph_(prev_action_graph),
      prev_action_status_(prev_action_status),
      diff_(),
      setup_actions_(),
      graph_actions_() {}

// Diff programs
Signal ActionPlanner::DiffPrograms() {
    // No previous plan?
    // Then we emit all new statements as INSERT
    if (!prev_program_) {
        for (unsigned i = 0; i < next_program_.program().statements.size(); ++i) {
            diff_.emplace_back(DiffOpCode::INSERT, std::nullopt, i);
        }
        return Signal::OK();
    }

    // Compute the patience diff
    ProgramMatcher matcher{*prev_program_, next_program_};
    diff_ = matcher.ComputeDiff();
    return Signal::OK();
}

// Translate single statement
Expected<proto::action::ActionT> ActionPlanner::TranslateStatement(size_t stmt_id) {
    static uint32_t global_target_id = 0;
    auto& next = next_program_.program();
    auto& stmts = next.statements;
    auto& stmt = stmts[stmt_id];
    auto& stmt_root = next.nodes[stmt->root];

    // Write action
    proto::action::ActionT action;
    action.action_type = ActionType::NONE;
    action.origin_statement = stmt_id;
    action.depends_on = {};
    action.required_for = {};
    action.target_id = global_target_id++;
    action.target_name_short = stmt->target_name_short;
    action.target_name_qualified = stmt->target_name_qualified;
    action.script = "";

    // Identify exact action
    switch (stmt_root.node_type()) {
        case sx::NodeType::OBJECT_DASHQL_VIZ:
            action.action_type = ActionType::VIZ_CREATE;
            break;

        case sx::NodeType::OBJECT_DASHQL_LOAD:
            if (auto m = FindAttribute(next, stmt_root, Key::DASHQL_LOAD_METHOD)) {
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

        case sx::NodeType::OBJECT_DASHQL_EXTRACT:
            if (auto m = FindAttribute(next, stmt_root, Key::DASHQL_EXTRACT_METHOD)) {
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

        case sx::NodeType::OBJECT_DASHQL_PARAMETER:
            if (auto m = FindAttribute(next, stmt_root, Key::DASHQL_PARAMETER_TYPE)) {
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

        case sx::NodeType::OBJECT_DASHQL_QUERY: {
            if (auto q = FindAttribute(next, stmt_root, Key::DASHQL_QUERY_STATEMENT)) {
                if (auto into = FindAttribute(next, *q, Key::SQL_SELECT_INTO)) {
                    action.action_type = proto::action::ActionType::TABLE_CREATE;
                }
            }
            auto script = next_program_.RenderStatementText(stmt_id);
            if (!script.IsOk()) {
                return script.err();
            }
            action.script = script.ReleaseValue();
            break;
        }

        default:
            assert(false);
    }
    return action;
}

// Translate statements
Signal ActionPlanner::TranslateStatements() {
    auto& stmts = next_program_.program().statements;
    graph_actions_.resize(stmts.size());

    // Translate statements to actions as if there all statements were new
    for (unsigned stmt_id = 0; stmt_id < stmts.size(); ++stmt_id) {
        auto action = TranslateStatement(stmt_id);
        if (!action.IsOk())
            return action.err();
        graph_actions_[stmt_id] = action.ReleaseValue();
    }

    // Store dependencies
    auto& deps = next_program_.program().dependencies;
    for (unsigned dep_id = 0; dep_id < deps.size(); ++dep_id) {
        auto& dep = deps[dep_id];
        graph_actions_[dep.source_statement()].required_for.push_back(dep.target_statement());
        graph_actions_[dep.target_statement()].depends_on.push_back(dep.source_statement());
    }
    return Signal::OK();
}

// Map previously completed actions to the new graph
Signal ActionPlanner::MapPreviousActions() {
    // TODO
    return Signal::OK();
}

// Propage updates/deletes/inserts in the new graph
Signal ActionPlanner::PropagateUpdates() {
    // TODO
    return Signal::OK();
}

// Plan the new action graph
void ActionPlanner::PlanActionGraph() {
    DiffPrograms();
    TranslateStatements();
    MapPreviousActions();
    PropagateUpdates();
}

// Encode action graph
flatbuffers::Offset<proto::action::ActionGraph> ActionPlanner::Encode(flatbuffers::FlatBufferBuilder& builder) {
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
