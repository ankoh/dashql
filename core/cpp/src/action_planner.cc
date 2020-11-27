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
                             const proto::action::ActionGraphT* prev_action_graph)
    : next_program_(next_program),
      prev_program_(prev_program),
      prev_action_graph_(prev_action_graph),
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

// Canonical translation of statements into actions
struct StatementTranslation {
    ActionType action;
    bool render_script;
};
static std::unordered_map<sx::StatementType, StatementTranslation> STATEMENT_TRANSLATION = {
#define X(STMT_TYPE, ACTION, SCRIPT) { sx::StatementType::STMT_TYPE, { ActionType::ACTION, SCRIPT } },
    X(NONE, NONE, false)
    X(PARAMETER, PARAMETER, false)
    X(LOAD_FILE, LOAD_FILE, false)
    X(LOAD_HTTP, LOAD_HTTP, false)
    X(EXTRACT_JSON, EXTRACT_JSON, false)
    X(EXTRACT_CSV, EXTRACT_CSV, false)
    X(SELECT, VIZ_CREATE, true)
    X(SELECT_INTO, TABLE_CREATE, true)
    X(CREATE_TABLE, TABLE_CREATE, true)
    X(CREATE_VIEW, VIEW_CREATE, true)
    X(VIZUALIZE, VIZ_CREATE, false)
#undef X
};

// Translate statements
Signal ActionPlanner::TranslateStatements() {
    auto& next = next_program_.program();
    auto& stmts = next_program_.program().statements;
    graph_actions_.resize(stmts.size());

    // Translate statements as if all were new
    for (unsigned stmt_id = 0; stmt_id < stmts.size(); ++stmt_id) {
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
        if (auto iter = STATEMENT_TRANSLATION.find(stmt->statement_type); iter != STATEMENT_TRANSLATION.end()) {
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
        graph_actions_[stmt_id] = move(action);
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

/// An action invalidation
struct ActionInvalidation {
    ActionType drop_action;
    bool propagates_backwards;
};
static std::unordered_map<ActionType, ActionInvalidation> ACTION_INVALIDATION = {
#define X(ACTION, UNDO_ACTION, PROPAGATE) { ActionType::ACTION, { ActionType::UNDO_ACTION, PROPAGATE } },
    X(NONE, NONE, false)
    X(PARAMETER, NONE, false)
    X(LOAD_DROP, LOAD_DROP, false)
    X(LOAD_FILE, LOAD_DROP, false)
    X(LOAD_HTTP, LOAD_DROP, false)
    X(EXTRACT_DROP, NONE, false)
    X(EXTRACT_JSON, TABLE_DROP, false)
    X(EXTRACT_CSV, TABLE_DROP, false)
    X(VIEW_DROP, NONE, true)
    X(VIEW_CREATE, VIEW_DROP, true)
    X(TABLE_DROP, NONE, true)
    X(TABLE_CREATE, TABLE_DROP, true)
    X(TABLE_MODIFY, NONE, true)
    X(VIZ_DROP, NONE, false)
    X(VIZ_CREATE, VIZ_DROP, false)
    X(VIZ_UPDATE, VIZ_DROP, false)
    X(QUERY_SCALAR, NONE, false)
    X(QUERY_TABLE, NONE, false)
#undef X
};

// Map previously completed actions to the new graph
Signal ActionPlanner::MapPreviousActions() {
    if (!prev_action_graph_) return Signal::OK();
    auto& actions = prev_action_graph_->actions;

    // Find applicable actions of previous action graph.
    //
    // An action is applicable iff:
    //  1) Diff is either KEEP or MOVE and the statement is not affected by a parmeter update
    //  2) All dependencies are applicable
    //
    std::vector<bool> applicable;
    applicable.resize(actions.size(), false);

    // Helper to generate a drop action.
    auto drop = [this](const proto::action::ActionT& action) {
        auto stmt_id = action.origin_statement;
        auto iter = ACTION_INVALIDATION.find(action.action_type);
        if (iter == ACTION_INVALIDATION.end()) {
            return;
        }
        auto& target = prev_program_->program().statements[stmt_id];
        proto::action::ActionT drop;
        drop.action_type = iter->second.drop_action;
        drop.origin_statement = stmt_id;
        drop.target_id = ++global_target_counter_;
        drop.target_name_qualified = target->target_name_qualified;
        drop.target_name_short = target->target_name_short;
        drop.depends_on = {};
        drop.required_for = {};
        drop.script = "";
        setup_actions_.push_back(move(drop));
    };

    // Invalidate an action.
    // If an action is invalidated, we might have to propagate the invalidation to the actions before us.
    // We are very pessimistic here and invalidate all our incoming dependencies to make sure everything is clean.
    auto invalidate = [&](size_t action_id) {
        std::unordered_set<size_t> visited;
        std::vector<size_t> pending;
        pending.push_back(action_id);
        while (!pending.empty()) {
            auto top = pending.back();
            pending.pop_back();

            // Already visited?
            if (visited.count(top))
                continue;
            visited.insert(top);

            // Get invalidation info
            auto& action = *actions[action_id];
            auto iter = ACTION_INVALIDATION.find(action.action_type);
            if (iter == ACTION_INVALIDATION.end()) {
                continue;
            }
            auto [drop_action_type, propagates] = iter->second;

            // Propagates invalidation?
            if (propagates) {
                for (auto dep: action.depends_on) {
                    pending.push_back(dep);
                }
            }

            // Already marked as not applicable?
            // In that case we already emitted the drop action.
            // (...since we are traversing in toplogical order)
            if (!applicable[top]) {
                continue;
            }
            applicable[top] = false;
            drop(action);
        }
    };

    // We traverse the previous action graph in topological order.
    // That restricts the applicability check to the direct dependencies.
    using ActionID = size_t;
    std::vector<std::pair<ActionID, int>> action_deps;
    for (unsigned i = 0; i < actions.size(); ++i) {
        action_deps[i] = {i, actions[i]->depends_on.size()};
    }
    TopologicalSort<ActionID> pending_actions{move(action_deps)};

    // Visit all actions
    while (!pending_actions.Empty()) {
        auto [action_id, key] = pending_actions.Top();
        pending_actions.Pop();

        // Decrement key of depending actions
        auto& action = *actions[action_id];
        for (auto next : action.required_for) {
            pending_actions.DecrementKey(next);
        }

        // Action not completed?
        // XXX We could detect actions that were NOT started at some point.
        //     Right now we dont, so we just invalidate to be safe.
        if (!action.status || action.status->status_code() != proto::action::ActionStatusCode::COMPLETED) {
            invalidate(action_id);
            continue;
        }

        // Get the diff op
        assert(action_id < diff_.size());
        auto& diff_op = diff_[action.origin_statement];
        switch (diff_op.code()) {
            // MOVE or KEEP?
            // The statement didn't change, so we should try to just reuse the output from before.
            case DiffOpCode::MOVE:
            case DiffOpCode::KEEP: {
                // Check if all dependencies are applicable
                auto all_applicable = true;
                for (auto dep: action.depends_on) {
                    all_applicable &= applicable[dep];
                }
                if (!all_applicable) {
                    invalidate(action_id);
                    break;
                }
                auto& target = graph_actions_[action.target_id];

                // Parameter action?
                // Then we also have to check whether the parameter value stayed the same.
                // A changed parameter will propagate via the applicability.
                if (action.action_type == proto::action::ActionType::PARAMETER) {
                    auto prev_param = prev_program_->FindParameterValue(*diff_op.source());
                    auto next_param = next_program_.FindParameterValue(*diff_op.target());
                    if (!ProgramMatcher::ParameterValuesEqual(prev_param, next_param)) {
                        invalidate(action_id);
                        break;
                    }
                }

                // The action seems to be applicable
                applicable[action_id] = true;
                break;
            }

            // UPDATE or DELETE?
            // The statement did change, so we have to figure out what must be invalidated.
            // We have to be very careful since any leftover tables will lead to broken dashboards.
            case DiffOpCode::UPDATE:
            case DiffOpCode::DELETE:
                invalidate(action_id);
                break;

            // A previous action is marked with INSERT in the diff?
            // Cannot happen, faulty diff.
            case DiffOpCode::INSERT:
                assert(false);
                break;
        }
    }

    // XXX
    // Now we know for every previous action whether it is applicable.
    // Mark the corresponding new actions as completed.

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
