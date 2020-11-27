#include "dashql/action_planner.h"

#include "dashql/common/topological_sort.h"
#include "dashql/proto/syntax_dashql_generated.h"

namespace dashql {

namespace sxd = dashql::proto::syntax_dashql;
using ActionType = proto::action::ActionType;
using Key = sx::AttributeKey;

using ActionObj = proto::action::ActionT;

// Constructor
ActionPlanner::ActionPlanner(const ProgramInstance& next_program, const ProgramInstance* prev_program,
                             const proto::action::ActionGraph* prev_action_graph,
                             const std::unordered_map<uint32_t, proto::action::ActionStatus>& prev_action_status)
    : next_program_(next_program),
      prev_program_(prev_program),
      prev_action_graph_(prev_action_graph),
      prev_action_status_(prev_action_status),
      diff_(),
      setup_actions_(),
      graph_actions_(),
      graph_action_status_() {}

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

// Canonical translation of statements into actions
struct StatementMapping {
    proto::action::ActionType action_type;
    bool requires_script;
};
static std::unordered_map<sx::StatementType, StatementMapping> STATEMENT_ACTIONS = {
#define X(STMT_TYPE, ACTION_TYPE, SCRIPT) { sx::StatementType::STMT_TYPE, { proto::action::ActionType::ACTION_TYPE, SCRIPT } },
    X(NONE, NONE, false)
    X(PARAMETER, PARAMETER, false)
    X(LOAD_FILE, LOAD_FILE, false)
    X(LOAD_HTTP, LOAD_HTTP, false)
    X(EXTRACT_JSON, EXTRACT_JSON, false)
    X(EXTRACT_CSV, EXTRACT_CSV, false)
    X(SELECT, QUERY_TABLE, true)
    X(SELECT_INTO, TABLE_CREATE, true)
    X(CREATE_TABLE, TABLE_CREATE, true)
    X(CREATE_VIEW, VIEW_CREATE, true)
    X(VIZUALIZE, VIZ_CREATE, false)
#undef X
};

// Translate single statement
Expected<proto::action::ActionT> ActionPlanner::TranslateStatement(size_t stmt_id) {
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
    action.target_id = global_target_counter_++;
    action.target_name_short = stmt->target_name_short;
    action.target_name_qualified = stmt->target_name_qualified;
    action.script = "";

    // Find action type
    if (auto iter = STATEMENT_ACTIONS.find(stmt->statement_type); iter != STATEMENT_ACTIONS.end()) {
        auto [action_type, requires_script] = iter->second;
        action.action_type = action_type;
        if (requires_script) {
            auto script = next_program_.RenderStatementText(stmt_id);
            if (!script.IsOk()) {
                return script.err();
            }
            action.script = script.ReleaseValue();
        }
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
        if (!action.IsOk()) return action.err();
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
    if (!prev_action_graph_) return Signal::OK();
    auto& actions = *prev_action_graph_->actions();

    auto drop = [this](proto::action::ActionType type, size_t stmt_id) {
        auto& target = prev_program_->program().statements[stmt_id];
        proto::action::ActionT action;
        action.action_type = type;
        action.origin_statement = stmt_id;
        action.target_id = ++global_target_counter_;
        action.target_name_qualified = target->target_name_qualified;
        action.target_name_short = target->target_name_short;
        action.depends_on = {};
        action.required_for = {};
        action.script = "";
        setup_actions_.push_back(action);
    };

    auto drop_tables = [this](size_t action_id) {
        std::vector<size_t> pending;
        pending.push_back(action_id);
        while (!pending.empty()) {
            auto top = pending.back();
            pending.pop_back();

            // XXX

            auto* action = prev_action_graph_->actions()->Get(top);
            auto stmt_id = action->origin_statement();
            auto& stmt = prev_program_->program().statements[stmt_id];
            auto stmt_root = prev_program_->program().nodes[stmt->root];

            // XXX
        }
    };

    // Find applicable actions of previous action graph.
    //
    // An action is applicable iff:
    //  1) Diff is either KEEP or MOVE and the action is not affected by a parmeter update
    //  2) All dependencies are applicable
    //
    std::vector<bool> applicable;
    applicable.resize(actions.size(), false);

    // We traverse the previous action graph in topological order.
    // That ensures, that we can determine the applicability by checking the dependencies.
    // ALSO, we do not need to check any following statements since inapplicable statements propagate.
    using ActionID = size_t;
    std::vector<std::pair<ActionID, int>> action_deps;
    for (unsigned i = 0; i < actions.size(); ++i) {
        action_deps[i] = {i, actions[i]->depends_on()->size()};
    }
    TopologicalSort<ActionID> pending_actions{move(action_deps)};

    // Visit all actions
    while (!pending_actions.Empty()) {
        // Pop next action
        auto [action_id, key] = pending_actions.Top();
        pending_actions.Pop();

        // Decrement key of depending actions
        auto& action = *actions[action_id];
        for (auto next : *action.required_for()) {
            pending_actions.DecrementKey(next);
        }

        // Action not completed?
        auto status_iter = prev_action_status_.find(action_id);
        if (status_iter == prev_action_status_.end() ||
            status_iter->second.status_code() != proto::action::ActionStatusCode::COMPLETED) {
            continue;
        }

        // Get the diff
        assert(action_id < diff_.size());
        auto& diff_op = diff_[action_id];
        switch (diff_op.code()) {
            // MOVE or KEEP?
            case DiffOpCode::MOVE:
            case DiffOpCode::KEEP: {
                // Check if all dependencies are applicable
                auto all_applicable = true;
                for (auto dep: *action.depends_on()) {
                    all_applicable &= applicable[dep];
                }
                if (!all_applicable) break;
                auto& target = graph_actions_[action.target_id()];

                // XXX Affected by parameter?

                applicable[action_id] = true;
                graph_action_status_[action.target_id()] = proto::action::ActionStatusCode::COMPLETED;
                break;
            }

            // UPDATE or DELETE?
            case DiffOpCode::UPDATE:
            case DiffOpCode::DELETE: {
                // We have to be very careful here since we must not forget to drop any tables.
                //
                // We are therefore very pessimistic here:
                //  1) SQL statement: DROP all tables before us
                //  2) LOAD statement: DROP load
                //  3) EXTRACT statement: DROP table
                //  3) VIZ statement: DROP viz

                break;
            }

            case DiffOpCode::INSERT:
                // Cannot happen
                assert(false);
                break;
        }
    }

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
