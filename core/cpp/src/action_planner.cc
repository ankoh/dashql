#include "dashql/action_planner.h"

#include "dashql/common/topological_sort.h"
#include "dashql/proto/syntax_dashql_generated.h"

namespace dashql {

namespace sxd = dashql::proto::syntax_dashql;
using SetupActionType = proto::action::SetupActionType;
using ProgramActionType = proto::action::ProgramActionType;
using Key = sx::AttributeKey;

// Constructor
ActionPlanner::ActionPlanner(const ProgramInstance& next_program, const ProgramInstance* prev_program,
                             const proto::action::ActionGraphT* prev_action_graph)
    : next_program_(next_program),
      prev_program_(prev_program),
      prev_action_graph_(prev_action_graph),
      diff_(),
      action_graph_(std::make_unique<proto::action::ActionGraphT>()) {
    // Continue with next target id of previous graph (if any)
    if (prev_action_graph) {
        action_graph_->next_target_id = prev_action_graph->next_target_id;
    }
}

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
    ProgramActionType action_type;
    bool render_script;
};
static std::unordered_map<sx::StatementType, StatementTranslation> STATEMENT_TRANSLATION = {
// clang-format off
#define X(STMT_TYPE, PROGRAM_ACTION, RENDER_SCRIPT) \
    {sx::StatementType::STMT_TYPE, {proto::action::ProgramActionType::PROGRAM_ACTION, RENDER_SCRIPT}},
    X(NONE, NONE, false)
    X(PARAMETER, NONE, false)
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
    // clang-format on
};

// Translate statements
Signal ActionPlanner::TranslateStatements() {
    auto& next = next_program_.program();
    auto& stmts = next_program_.program().statements;
    auto& program_actions = action_graph_->program_actions;
    program_actions.resize(stmts.size());

    // Translate statements as if all were new
    for (unsigned stmt_id = 0; stmt_id < stmts.size(); ++stmt_id) {
        auto& stmt = stmts[stmt_id];
        auto& stmt_root = next.nodes[stmt->root_node];

        // Write action
        auto action = std::make_unique<proto::action::ProgramActionT>();
        action->action_type = ProgramActionType::NONE;
        action->origin_statement = stmt_id;
        action->depends_on = {};
        action->required_for = {};
        action->target_id = action_graph_->next_target_id++;
        action->target_name_qualified = stmt->name_qualified;
        action->target_name_short = stmt->name_short;
        action->script = "";

        // Find action type
        if (auto iter = STATEMENT_TRANSLATION.find(stmt->statement_type); iter != STATEMENT_TRANSLATION.end()) {
            auto [action_type, requires_script] = iter->second;
            action->action_type = action_type;
            if (requires_script) {
                auto script = next_program_.RenderStatementText(stmt_id);
                if (!script.IsOk()) {
                    return script.err();
                }
                action->script = script.ReleaseValue();
            }
        }
        program_actions[stmt_id] = move(action);
    }

    // Store dependencies
    auto& deps = next_program_.program().dependencies;
    for (unsigned dep_id = 0; dep_id < deps.size(); ++dep_id) {
        auto& dep = deps[dep_id];
        program_actions[dep.source_statement()]->required_for.push_back(dep.target_statement());
        program_actions[dep.target_statement()]->depends_on.push_back(dep.source_statement());
    }
    return Signal::OK();
}

/// A program action invalidation
struct ProgramActionInvalidation {
    SetupActionType import_action;
    SetupActionType drop_action;
    ProgramActionType update_action;
    bool propagates_backwards;
};
static std::unordered_map<ProgramActionType, ProgramActionInvalidation> ACTION_TRANSLATION = {
// clang-format off
#define X(ACTION, IMPORT_ACTION, DROP_ACTION, UPDATE_ACTION, PROPAGATE) \
    {ProgramActionType::ACTION,                                         \
     {SetupActionType::IMPORT_ACTION, SetupActionType::DROP_ACTION, ProgramActionType::UPDATE_ACTION, PROPAGATE}},
    X(NONE, NONE, NONE, NONE, false)
    X(PARAMETER, NONE, NONE, NONE, false)
    X(LOAD_FILE, IMPORT_BLOB, DROP_BLOB, NONE, false)
    X(LOAD_HTTP, IMPORT_BLOB, DROP_BLOB, NONE, false)
    X(EXTRACT_JSON, IMPORT_TABLE, DROP_TABLE, NONE, false)
    X(EXTRACT_CSV, IMPORT_TABLE, DROP_TABLE, NONE, false)
    X(VIEW_CREATE, IMPORT_VIEW, DROP_VIEW, NONE, true)
    X(TABLE_CREATE, IMPORT_TABLE, DROP_TABLE, NONE, true)
    X(TABLE_MODIFY, IMPORT_TABLE, DROP_TABLE, NONE, true)
    X(VIZ_CREATE, IMPORT_VIZ, DROP_VIZ, VIZ_UPDATE, false)
    X(VIZ_UPDATE, IMPORT_VIZ, DROP_VIZ, VIZ_UPDATE, false)
#undef X
    // clang-format on
};

// Map previously completed actions to the new graph
Signal ActionPlanner::MapPreviousActions() {
    // Nothing to diff against?
    if (!prev_action_graph_) return Signal::OK();

    auto& prev_actions = prev_action_graph_->program_actions;
    auto& next_setup_actions = action_graph_->setup_actions;
    auto& next_program_actions = action_graph_->program_actions;
    using ActionID = size_t;

    // Find applicable actions of previous action graph.
    //
    // An action is applicable iff:
    // The diff is either KEEP or MOVE and the statement is not affected by a parmeter update
    // All dependencies are applicable
    std::vector<bool> applicable;
    applicable.resize(prev_actions.size(), false);

    // Invalidate an action.
    // If an action is invalidated, we might have to propagate the invalidation to the actions before us.
    // We are very pessimistic here and invalidate all our incoming dependencies to make sure everything is clean.
    // (Except for the cases where it's trivial to see that nobody else is affected)
    auto invalidate = [&](size_t action_id) {
        std::unordered_set<size_t> visited;
        std::vector<size_t> pending;
        pending.push_back(action_id);
        while (!pending.empty()) {
            auto top = pending.back();
            pending.pop_back();

            // Already visited?
            if (visited.count(top)) continue;
            visited.insert(top);

            // Get invalidation info
            auto& action = *prev_actions[action_id];
            auto iter = ACTION_TRANSLATION.find(action.action_type);
            if (iter == ACTION_TRANSLATION.end()) {
                continue;
            }
            auto [import_action, drop_action, update_action, propagates] = iter->second;

            // Propagates invalidation?
            if (propagates) {
                for (auto dep : action.depends_on) {
                    pending.push_back(dep);
                }
            }

            // Action is not applicable
            applicable[top] = false;
        }
    };

    // We traverse the previous action graph in topological order.
    // That reduces the applicability check to the direct dependencies.
    {
        std::vector<std::pair<ActionID, int>> deps;
        for (unsigned i = 0; i < prev_actions.size(); ++i) {
            deps[i] = {i, prev_actions[i]->depends_on.size()};
        }

        TopologicalSort<ActionID> pending_actions{move(deps)};
        while (!pending_actions.Empty()) {
            auto [prev_action_id, key] = pending_actions.Top();
            pending_actions.Pop();

            // Decrement key of depending actions
            auto& a = *prev_actions[prev_action_id];
            for (auto next : a.required_for) {
                pending_actions.DecrementKey(next);
            }

            // Action not completed? - Just invalidate
            if (!a.action_status || a.action_status->status_code() != proto::action::ActionStatusCode::COMPLETED) {
                invalidate(prev_action_id);
                continue;
            }

            // Get the diff of the origin statement
            assert(prev_action_id < diff_.size());
            auto& diff_op = diff_[a.origin_statement];
            switch (diff_op.code()) {
                // MOVE or KEEP?
                // The statement didn't change, so we should try to just reuse the output from before.
                case DiffOpCode::MOVE:
                case DiffOpCode::KEEP: {
                    // Check if all dependencies are applicable
                    auto all_applicable = true;
                    for (auto dep : a.depends_on) {
                        all_applicable &= applicable[dep];
                    }
                    if (!all_applicable) {
                        invalidate(prev_action_id);
                        break;
                    }

                    // Parameter action?
                    // Then we also have to check whether the parameter value stayed the same.
                    // A changed parameter will propagate via the applicability.
                    if (a.action_type == proto::action::ProgramActionType::PARAMETER) {
                        auto prev_param = prev_program_->FindParameterValue(*diff_op.source());
                        auto next_param = next_program_.FindParameterValue(*diff_op.target());
                        if (!ProgramMatcher::ParameterValuesEqual(prev_param, next_param)) {
                            invalidate(prev_action_id);
                            break;
                        }
                    }

                    // The action seems to be applicable, mark it as such
                    applicable[prev_action_id] = true;
                    break;
                }

                // UPDATE or DELETE?
                // The statement did change, so we have to figure out what must be invalidated.
                // We have to be very careful since any leftover tables will lead to broken dashboards.
                case DiffOpCode::UPDATE:
                case DiffOpCode::DELETE:
                    invalidate(prev_action_id);
                    break;

                // A previous action is marked with INSERT in the diff?
                // Cannot happen, must be a faulty diff.
                case DiffOpCode::INSERT:
                    assert(false);
                    break;
            }
        }
    }

    // Now we know for every previous action whether it is applicable.
    // Emit all setup actions to either import or drop previous state and update the new program actions.
    //
    // If an action is applicable, there also exists a new action that does not reuse state so far.
    // We update the target id of the new action and mark it as complete.
    // If an action is not applicable, but the diff op is UPDATE, we try to patch the action type as well.
    // Currently this only affects the VIZ action to explicitly keep the viz state instead of recreating it.
    {
        std::vector<std::unique_ptr<proto::action::SetupActionT>> setup;
        setup.reserve(prev_actions.size());
        for (unsigned prev_action_id = 0; prev_action_id < prev_actions.size(); ++prev_action_id) {
            setup.push_back(nullptr);
            auto& prev_action = prev_actions[prev_action_id];
            auto& diff_op = diff_[prev_action_id];

            // Find action translation.
            // If we
            auto iter = ACTION_TRANSLATION.find(prev_action->action_type);
            assert(iter != ACTION_TRANSLATION.end());
            if (iter == ACTION_TRANSLATION.end()) continue;
            auto [import_action, drop_action, update_action, propagates] = iter->second;

            // Is applicable?
            if (applicable[prev_action_id]) {
                // Create import action (if necessary)
                if (import_action != SetupActionType::NONE) {
                    setup.back() = std::make_unique<proto::action::SetupActionT>();
                    auto& s = setup.back();
                    s->action_type = import_action;
                    s->target_id = prev_action->target_id;
                    s->target_name_qualified = prev_action->target_name_qualified;
                    s->target_name_short = prev_action->target_name_short;
                }

                // Map to new action.
                // Diff must be KEEP or MOVE since the previous action is applicable.
                auto next_action_id = diff_op.target();
                assert(next_action_id);
                assert((diff_op.code() == +DiffOpCode::KEEP) || (diff_op.code() == +DiffOpCode::MOVE));

                // Update the target id of the new action and mark it as complete
                auto& next_action = action_graph_->program_actions[*next_action_id];
                next_action->action_status->mutate_status_code(proto::action::ActionStatusCode::COMPLETED);
                next_action->target_id = prev_action->target_id;
                assert(next_action->target_name_short == prev_action->target_name_short);
                assert(next_action->target_name_qualified == prev_action->target_name_qualified);
                continue;
            }

            // Is diffed as KEEP, MOVE or UPDATE and has defined UPDATE action?
            //
            // Only relevant for viz actions at the moment.
            // (In which case the diff is actually never KEEP or MOVE but that doesn't matter)
            // A viz statement that was slightly adjusted will be diffed as UPDATE.
            // We don't want to drop and recreate the viz state in order to reuse the existing react component.
            if ((diff_op.code() == +DiffOpCode::UPDATE || diff_op.code() == +DiffOpCode::KEEP ||
                 diff_op.code() == +DiffOpCode::MOVE) &&
                (update_action != ProgramActionType::NONE)) {
                assert(diff_op.target());
                auto next_action_id = diff_op.target();
                auto& next_action = action_graph_->program_actions[*next_action_id];
                next_action->action_type = update_action;
                next_action->target_id = prev_action->target_id;
            }

            // Drop instead if there's a drop action defined
            else if (drop_action != SetupActionType::NONE) {
                setup.back() = std::make_unique<proto::action::SetupActionT>();
                auto& s = setup.back();
                s->action_type = drop_action;
                s->target_name_qualified = prev_action->target_name_qualified;
                s->target_name_short = prev_action->target_name_short;
            }
        }

        // Now sort the setup actions in reverse topological order.
        // If statement B depends on A, the setup action of B must be executed before A.
        // This flips the original dependencies to ensure that, for example, derived views are dropped before tables.
        std::vector<std::pair<ActionID, int>> deps;
        for (unsigned i = 0; i < prev_actions.size(); ++i) {
            deps[i] = {i, prev_actions[i]->required_for.size()};
        }

        TopologicalSort<ActionID> pending_actions{move(deps)};
        while (!pending_actions.Empty()) {
            auto [prev_action_id, key] = pending_actions.Top();
            pending_actions.Pop();

            // Decrement key of action that the top depends on
            auto& action = *prev_actions[prev_action_id];
            for (auto next : action.depends_on) {
                pending_actions.DecrementKey(next);
            }

            // Emit setup action
            if (setup[prev_action_id]->action_type != SetupActionType::NONE) {
                next_setup_actions.push_back(move(setup[prev_action_id]));
            }
        }
    }
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
std::unique_ptr<proto::action::ActionGraphT> ActionPlanner::Finish() { return move(action_graph_); }

}  // namespace dashql
