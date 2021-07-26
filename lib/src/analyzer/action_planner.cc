#include "dashql/analyzer/action_planner.h"

#include <unordered_set>

#include "dashql/common/topological_sort.h"
#include "dashql/proto_generated.h"

namespace dashql {

namespace sx = dashql::proto::syntax;
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
      reverse_action_mapping_(),
      action_applicability_(),
      action_graph_(std::make_unique<proto::action::ActionGraphT>()) {
    // Continue with next target id of previous graph (if any)
    if (prev_action_graph) {
        action_graph_->next_object_id = prev_action_graph->next_object_id;
    }
}

// Diff programs
arrow::Status ActionPlanner::DiffPrograms() {
    // No previous plan?
    // Then we emit all new statements as INSERT
    if (!prev_program_) {
        for (unsigned i = 0; i < next_program_.program().statements.size(); ++i) {
            diff_.emplace_back(DiffOpCode::INSERT, std::nullopt, i);
        }
        return arrow::Status::OK();
    }

    // Compute the patience diff
    ProgramMatcher matcher{*prev_program_, next_program_};
    diff_ = matcher.ComputeDiff();
    return arrow::Status::OK();
}

// Canonical translation of statements into actions
struct StatementTranslation {
    ProgramActionType action_type;
    bool render_script;
};
static const std::unordered_map<sx::StatementType, StatementTranslation>& StatementTranslationMap() {
    static const std::unordered_map<sx::StatementType, StatementTranslation> mapping = {
// clang-format off
#define X(STMT_TYPE, PROGRAM_ACTION, RENDER_SCRIPT) \
    {sx::StatementType::STMT_TYPE, {proto::action::ProgramActionType::PROGRAM_ACTION, RENDER_SCRIPT}},
    X(NONE, NONE, false)
    X(INPUT, INPUT, false)
    X(FETCH, FETCH, false)
    X(TRANSFORM, TRANSFORM, false)
    X(LOAD, LOAD, false)
    X(SELECT_INTO, CREATE_TABLE, true)
    X(CREATE_TABLE, CREATE_TABLE, true)
    X(CREATE_TABLE_AS, CREATE_TABLE, true)
    X(CREATE_VIEW, CREATE_VIEW, true)
    X(VIZUALIZE, CREATE_VIZ, false)
#undef X
        // clang-format on
    };
    return mapping;
};

// Translate statements
arrow::Status ActionPlanner::TranslateStatements() {
    auto& next = next_program_.program();
    auto& stmts = next.statements;
    auto& liveness = next_program_.statements_liveness();

    std::vector<std::unique_ptr<dashql::proto::action::ProgramActionT>> actions;
    actions.resize(stmts.size());
    action_mapping_.resize(stmts.size(), std::nullopt);

    // Translate statements as if all were new
    for (unsigned stmt_id = 0; stmt_id < stmts.size(); ++stmt_id) {
        auto& stmt = stmts[stmt_id];
        auto& stmt_root = next.nodes[stmt->root_node];

        // Write action
        auto action = std::make_unique<proto::action::ProgramActionT>();
        action->action_type = ProgramActionType::NONE;
        action->action_status_code =
            liveness[stmt_id] ? proto::action::ActionStatusCode::PENDING : proto::action::ActionStatusCode::SKIPPED;
        action->origin_statement = stmt_id;
        action->depends_on = {};
        action->required_for = {};
        action->object_id = action_graph_->next_object_id++;
        action->name_qualified = stmt->name_qualified;
        action->script = "";

        // Find action type
        if (auto iter = StatementTranslationMap().find(stmt->statement_type); iter != StatementTranslationMap().end()) {
            auto [action_type, requires_script] = iter->second;
            action->action_type = action_type;
            if (requires_script) {
                ARROW_ASSIGN_OR_RAISE(action->script, next_program_.RenderStatementText(stmt_id));
            }
            actions[stmt_id] = move(action);
        }
    }

    // Push all actions.
    // Also remember the action mapping to resolve the index by statement id.
    action_graph_->program_actions.reserve(actions.size());
    for (unsigned i = 0; i < actions.size(); ++i) {
        auto& action = actions[i];
        if (!action) continue;
        action_mapping_[i] = action_graph_->program_actions.size();
        action_graph_->program_actions.push_back(std::move(action));
    }

    // Store dependencies
    auto& deps = next.dependencies;
    for (unsigned dep_id = 0; dep_id < deps.size(); ++dep_id) {
        auto& dep = deps[dep_id];
        auto src = getStatementActionId(dep.source_statement());
        auto tgt = getStatementActionId(dep.target_statement());
        if (!src || !tgt) continue;
        action_graph_->program_actions[*src]->required_for.push_back(*tgt);
        action_graph_->program_actions[*tgt]->depends_on.push_back(*src);
    }

    // Build reverse action mapping
    reverse_action_mapping_.resize(action_graph_->program_actions.size(), std::nullopt);
    for (auto diff_op : diff_) {
        if (diff_op.code() != +DiffOpCode::KEEP && diff_op.code() != +DiffOpCode::MOVE &&
            diff_op.code() != +DiffOpCode::UPDATE)
            continue;
        assert(diff_op.source().has_value());
        assert(diff_op.target().has_value());
        auto tgt = getStatementActionId(*diff_op.target());
        auto src = getStatementActionId(*diff_op.source());
        if (!src || !tgt) continue;
        reverse_action_mapping_[*tgt] = *src;
    }

    return arrow::Status::OK();
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
    X(INPUT, IMPORT_INPUT, DROP_INPUT, NONE, false)
    X(FETCH, IMPORT_BLOB, DROP_BLOB, NONE, false)
    X(TRANSFORM, IMPORT_BLOB, DROP_BLOB, NONE, false)
    X(LOAD, IMPORT_TABLE, DROP_TABLE, NONE, false)
    X(CREATE_VIEW, IMPORT_VIEW, DROP_VIEW, NONE, true)
    X(CREATE_TABLE, IMPORT_TABLE, DROP_TABLE, NONE, true)
    X(MODIFY_TABLE, IMPORT_TABLE, DROP_TABLE, NONE, true)
    X(CREATE_VIZ, IMPORT_VIZ, DROP_VIZ, UPDATE_VIZ, false)
    X(UPDATE_VIZ, IMPORT_VIZ, DROP_VIZ, UPDATE_VIZ, false)
#undef X
    // clang-format on
};

arrow::Status ActionPlanner::IdentifyApplicableActions() {
    if (!prev_action_graph_) return arrow::Status::OK();

    using ActionID = size_t;
    auto& prev_actions = prev_action_graph_->program_actions;
    action_applicability_.resize(prev_actions.size(), false);

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

            // No action?
            assert(!!prev_actions[action_id]);

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
            action_applicability_[top] = false;
        }
    };

    // We traverse the previous action graph in topological order.
    // That reduces the applicability check to the direct dependencies.
    std::vector<std::pair<ActionID, int>> deps;
    deps.reserve(prev_actions.size());
    for (unsigned i = 0; i < prev_actions.size(); ++i) {
        auto* action = prev_actions[i].get();
        assert(!!action);
        deps.push_back({i, action->depends_on.size()});  // Topo key is dependency count
    }
    TopologicalSort<ActionID> pending_actions{move(deps)};
    while (!pending_actions.Empty()) {
        auto [prev_action_id, key] = pending_actions.Top();
        pending_actions.Pop();

        // Decrement key of depending actions
        auto& a = prev_actions[prev_action_id];
        assert(!!a);
        for (auto next : a->required_for) {
            // Require_for contains valid action ids, not statement ids!
            // No mapping necessary.
            pending_actions.DecrementKey(next);
        }

        // Action not completed?
        // Irrelevant for the graph migration.
        if (a->action_status_code != proto::action::ActionStatusCode::COMPLETED) {
            invalidate(prev_action_id);
            continue;
        }

        // Get the diff of the origin statement
        assert(prev_action_id < diff_.size());
        auto& diff_op = diff_[a->origin_statement];
        switch (diff_op.code()) {
            // MOVE or KEEP?
            // The statement didn't change so we should try to just reuse the output from before.
            case DiffOpCode::MOVE:
            case DiffOpCode::KEEP: {
                // Check if all dependencies are applicable
                auto all_applicable = true;
                for (auto dep : a->depends_on) {
                    all_applicable &= action_applicability_[dep];
                }
                if (!all_applicable) {
                    invalidate(prev_action_id);
                    break;
                }

                // Check diff to find the corresponing new action.
                assert(diff_op.target());
                auto next_action_id = getStatementActionId(*diff_op.target());
                if (!next_action_id) {
                    invalidate(prev_action_id);
                    break;
                }

                // Does the dependency set differ?
                // The diff is MOVE or KEEP but the dependency set changed.
                // This will happen very rarely but is not impossible since we'll introduce dependencies
                // based on the location within the script later.
                //
                // E.g. INSERT or UPDATE statements.
                auto next_deps = action_graph_->program_actions[*next_action_id]->depends_on;
                bool deps_mapped = true;
                for (auto& dep : next_deps) {
                    if (!reverse_action_mapping_[dep]) {
                        deps_mapped = false;
                        break;
                    }
                    dep = *reverse_action_mapping_[dep];
                }
                std::sort(a->depends_on.begin(), a->depends_on.end());
                std::sort(next_deps.begin(), next_deps.end());
                if (!deps_mapped || next_deps != a->depends_on) {
                    // We should never hit this.
                    invalidate(prev_action_id);
                    break;
                }

                // Input action?
                // Then we also have to check whether the parameter value stayed the same.
                // A changed parameter will propagate via the applicability.
                if (a->action_type == proto::action::ProgramActionType::INPUT) {
                    auto* prev_param = prev_program_->FindInputValue(*diff_op.source());
                    auto* next_param = next_program_.FindInputValue(*diff_op.target());
                    if (*prev_param != *next_param) {
                        invalidate(prev_action_id);
                        break;
                    }
                }

                // The action seems to be applicable, mark it as such
                action_applicability_[prev_action_id] = true;
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
    return arrow::Status::OK();
}

arrow::Status ActionPlanner::MigrateActionGraph() {
    if (!prev_action_graph_) return arrow::Status::OK();

    auto& prev_program_actions = prev_action_graph_->program_actions;
    using ActionID = size_t;

    // We know for every previous action whether it is applicable.
    // Emit setup actions that either import or drop previous state and update the new program actions.
    //
    // If an action is applicable, there also exists a new action that does not reuse state so far.
    // We update the target id of the new action and mark it as complete.
    // If an action is not applicable, but the diff op is UPDATE, we try to patch the action type.
    // Currently this only affects the VIZ action to explicitly keep the viz state instead of recreating it.
    std::vector<std::unique_ptr<proto::action::SetupActionT>> setup;
    setup.reserve(prev_program_actions.size());
    for (unsigned prev_action_id = 0; prev_action_id < prev_program_actions.size(); ++prev_action_id) {
        // Create a setup action placeholder for every previous program action first.
        // We'll compact later.
        setup.push_back(nullptr);

        // Get the previous program action and the diff
        auto& prev_action = prev_program_actions[prev_action_id];
        auto prev_stmt_id = prev_action->origin_statement;
        auto& diff_op = diff_[prev_stmt_id];

        // Find the action translation
        auto iter = ACTION_TRANSLATION.find(prev_action->action_type);
        assert(iter != ACTION_TRANSLATION.end());
        if (iter == ACTION_TRANSLATION.end()) continue;
        auto [import_action, drop_action, update_action, propagates] = iter->second;

        // Is applicable?
        if (action_applicability_[prev_action_id]) {
            // Create import action (if necessary)
            if (import_action != SetupActionType::NONE) {
                setup.back() = std::make_unique<proto::action::SetupActionT>();
                auto& s = setup.back();
                s->action_type = import_action;
                s->object_id = prev_action->object_id;
                s->name_qualified = prev_action->name_qualified;

                // If statement B depends on A, the IMPORT action of B must be executed before A.
                // More relevant for DROP statments as discussed further down below.
                s->depends_on = prev_action->required_for;
                s->required_for = prev_action->depends_on;
            }

            // Map to new action.
            // Diff must be KEEP or MOVE since the previous action is applicable.
            auto next_stmt_id = diff_op.target();
            auto next_action_id = getStatementActionId(*next_stmt_id);
            assert(next_action_id);  // Applicability
            assert((diff_op.code() == +DiffOpCode::KEEP) || (diff_op.code() == +DiffOpCode::MOVE));

            // Update the target id of the new action and mark it as complete
            auto& next_action = action_graph_->program_actions[*next_action_id];
            next_action->action_status_code = proto::action::ActionStatusCode::COMPLETED;
            next_action->object_id = prev_action->object_id;
            assert(next_action->name_qualified == prev_action->name_qualified);
            continue;
        }

        // Is diffed as KEEP, MOVE or UPDATE and has defined UPDATE action?
        //
        // Only relevant for viz actions at the moment.
        // (In which case the diff is actually never KEEP or MOVE but that doesn't matter)
        // A viz statement that was slightly adjusted will be diffed as UPDATE.
        // We don't want to drop and recreate the viz state in order to reuse the existing react component.
        if ((update_action != ProgramActionType::NONE) &&
            (diff_op.code() == +DiffOpCode::UPDATE || diff_op.code() == +DiffOpCode::MOVE ||
             diff_op.code() == +DiffOpCode::KEEP)) {
            assert(diff_op.target());
            auto next_stmt_id = diff_op.target();
            auto next_action_id = getStatementActionId(*next_stmt_id);
            assert(next_action_id);  // Applicability
            auto& next_action = action_graph_->program_actions[*next_action_id];
            next_action->action_type = update_action;
            next_action->object_id = prev_action->object_id;
        }

        // Drop if there's a drop action defined
        else if (drop_action != SetupActionType::NONE) {
            setup.back() = std::make_unique<proto::action::SetupActionT>();
            auto& s = setup.back();
            s->action_type = drop_action;
            s->name_qualified = prev_action->name_qualified;
            s->object_id = prev_action->object_id;

            // Store flipped dependencies.
            //
            // If statement B depends on A, the DROP action of B must be executed before A.
            // This flips the original dependencies to ensure that, for example, derived views are dropped before
            // tables.
            s->depends_on = prev_action->required_for;
            s->required_for = prev_action->depends_on;
        }
    }

    // Store setup actions and remember mapping
    std::vector<std::optional<size_t>> action_mapping;
    action_mapping.resize(setup.size(), std::nullopt);
    for (unsigned i = 0; i < setup.size(); ++i) {
        auto& s = setup[i];
        if (!s || s->action_type == SetupActionType::NONE) continue;
        action_mapping[i] = action_graph_->setup_actions.size();
        action_graph_->setup_actions.push_back(move(setup[i]));
    }

    // Patch all setup dependencies.
    auto patch_ids = [&](std::vector<uint32_t>& ids) {
        auto n = 0;
        for (unsigned i = 0; i < ids.size(); ++i) {
            if (auto mapped = action_mapping[ids[i]]) {
                ids[n++] = *mapped;
            }
        }
        ids.resize(n);
    };
    for (auto& s : action_graph_->setup_actions) {
        patch_ids(s->required_for);
        patch_ids(s->depends_on);
    }
    return arrow::Status::OK();
}

// Plan the new action graph
arrow::Status ActionPlanner::PlanActionGraph() {
    ARROW_RETURN_NOT_OK(DiffPrograms());
    ARROW_RETURN_NOT_OK(TranslateStatements());
    ARROW_RETURN_NOT_OK(IdentifyApplicableActions());
    ARROW_RETURN_NOT_OK(MigrateActionGraph());
    return arrow::Status::OK();
}

// Encode action graph
std::unique_ptr<proto::action::ActionGraphT> ActionPlanner::Finish() { return move(action_graph_); }

}  // namespace dashql
