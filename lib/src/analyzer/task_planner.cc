#include "dashql/analyzer/task_planner.h"

#include <unordered_set>

#include "dashql/common/topological_sort.h"
#include "dashql/proto_generated.h"

namespace dashql {

namespace sx = dashql::proto::syntax;
using SetupTaskType = proto::task::SetupTaskType;
using ProgramTaskType = proto::task::ProgramTaskType;
using Key = sx::AttributeKey;

// Constructor
TaskPlanner::TaskPlanner(const ProgramInstance& next_program, const ProgramInstance* prev_program,
                         const proto::task::TaskGraphT* prev_task_graph)
    : next_program_(next_program),
      prev_program_(prev_program),
      prev_task_graph_(prev_task_graph),
      diff_(),
      reverse_task_mapping_(),
      task_applicability_(),
      task_graph_(std::make_unique<proto::task::TaskGraphT>()) {
    // Continue with next target id of previous graph (if any)
    if (prev_task_graph) {
        task_graph_->next_object_id = prev_task_graph->next_object_id;
    }
}

// Diff programs
arrow::Status TaskPlanner::DiffPrograms() {
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

    // Sort the diff by the previous statement ids.
    // Our code is MIGRATING the previous task graph to the new statements.
    // We therefore want to INDEX the diff with the PREVIOUS tasks.
    std::sort(diff_.begin(), diff_.end(), [&](auto& l, auto& r) {
        if (!l.source().has_value()) return false;
        if (!r.source().has_value()) return true;
        return *l.source() < *r.source();
    });
    return arrow::Status::OK();
}

// Canonical translation of statements into tasks
struct StatementTranslation {
    ProgramTaskType task_type;
    bool render_script;
};
static const std::unordered_map<sx::StatementType, StatementTranslation>& StatementTranslationMap() {
    static const std::unordered_map<sx::StatementType, StatementTranslation> mapping = {
// clang-format off
#define X(STMT_TYPE, PROGRAM_ACTION, RENDER_SCRIPT) \
    {sx::StatementType::STMT_TYPE, {proto::task::ProgramTaskType::PROGRAM_ACTION, RENDER_SCRIPT}},
    X(NONE, NONE, false)
    X(INPUT, INPUT, false)
    X(FETCH, FETCH, false)
    X(TRANSFORM, TRANSFORM, false)
    X(LOAD, LOAD, false)
    X(SET, SET, false)
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
arrow::Status TaskPlanner::TranslateStatements() {
    auto& next = next_program_.program();
    auto& stmts = next.statements;
    auto& liveness = next_program_.statements_liveness();

    std::vector<std::unique_ptr<dashql::proto::task::ProgramTaskT>> tasks;
    tasks.resize(stmts.size());
    task_mapping_.resize(stmts.size(), std::nullopt);

    // Translate statements as if all were new
    for (unsigned stmt_id = 0; stmt_id < stmts.size(); ++stmt_id) {
        auto& stmt = stmts[stmt_id];
        auto& stmt_root = next.nodes[stmt->root_node];

        // Write task
        auto task = std::make_unique<proto::task::ProgramTaskT>();
        task->task_type = ProgramTaskType::NONE;
        task->task_status_code =
            liveness[stmt_id] ? proto::task::TaskStatusCode::PENDING : proto::task::TaskStatusCode::SKIPPED;
        task->origin_statement = stmt_id;
        task->depends_on = {};
        task->required_for = {};
        task->object_id = task_graph_->next_object_id++;
        task->name_qualified = stmt->name_qualified;
        task->script = "";

        // Find task type
        if (auto iter = StatementTranslationMap().find(stmt->statement_type); iter != StatementTranslationMap().end()) {
            auto [task_type, requires_script] = iter->second;
            task->task_type = task_type;
            if (requires_script) {
                ARROW_ASSIGN_OR_RAISE(task->script, next_program_.RenderStatementText(stmt_id));
            }
            tasks[stmt_id] = move(task);
        }
    }

    // Push all tasks.
    // Also remember the task mapping to resolve the index by statement id.
    task_graph_->program_tasks.reserve(tasks.size());
    for (unsigned i = 0; i < tasks.size(); ++i) {
        auto& task = tasks[i];
        if (!task) continue;
        task_mapping_[i] = task_graph_->program_tasks.size();
        task_graph_->program_tasks.push_back(std::move(task));
    }

    // Store dependencies
    auto& deps = next.dependencies;
    for (unsigned dep_id = 0; dep_id < deps.size(); ++dep_id) {
        auto& dep = deps[dep_id];
        auto src = getStatementTaskId(dep.source_statement());
        auto tgt = getStatementTaskId(dep.target_statement());
        if (!src || !tgt) continue;
        task_graph_->program_tasks[*src]->required_for.push_back(*tgt);
        task_graph_->program_tasks[*tgt]->depends_on.push_back(*src);
    }

    // Build reverse task mapping
    reverse_task_mapping_.resize(task_graph_->program_tasks.size(), std::nullopt);
    for (auto diff_op : diff_) {
        if (diff_op.code() != +DiffOpCode::KEEP && diff_op.code() != +DiffOpCode::MOVE &&
            diff_op.code() != +DiffOpCode::UPDATE)
            continue;
        assert(diff_op.source().has_value());
        assert(diff_op.target().has_value());
        auto tgt = getStatementTaskId(*diff_op.target());
        auto src = getStatementTaskId(*diff_op.source());
        if (!src || !tgt) continue;
        reverse_task_mapping_[*tgt] = *src;
    }

    return arrow::Status::OK();
}

/// A program task invalidation
struct ProgramTaskInvalidation {
    SetupTaskType drop_task;
    ProgramTaskType update_task;
    bool propagates_backwards;
};
static std::unordered_map<ProgramTaskType, ProgramTaskInvalidation> ACTION_TRANSLATION = {
// clang-format off
#define X(ACTION, DROP_ACTION, UPDATE_ACTION, PROPAGATE) \
    {ProgramTaskType::ACTION,                                         \
     {SetupTaskType::DROP_ACTION, ProgramTaskType::UPDATE_ACTION, PROPAGATE}},
    X(NONE, NONE, NONE, false)
    X(CREATE_TABLE, DROP_TABLE, NONE, true)
    X(CREATE_VIEW, DROP_VIEW, NONE, true)
    X(CREATE_VIZ, DROP_VIZ, UPDATE_VIZ, false)
    X(FETCH, DROP_BLOB, NONE, false)
    X(INPUT, DROP_INPUT, NONE, false)
    X(LOAD, DROP_TABLE, NONE, false)
    X(MODIFY_TABLE, DROP_TABLE, NONE, true)
    X(SET, DROP_SET, NONE, false)
    X(TRANSFORM, DROP_BLOB, NONE, false)
    X(UPDATE_VIZ, DROP_VIZ, UPDATE_VIZ, false)
#undef X
    // clang-format on
};

arrow::Status TaskPlanner::IdentifyApplicableTasks() {
    if (!prev_task_graph_) return arrow::Status::OK();

    using TaskID = size_t;
    auto& prev_tasks = prev_task_graph_->program_tasks;
    task_applicability_.resize(prev_tasks.size(), false);

    // Invalidate a task.
    // If a task is invalidated, we might have to propagate the invalidation to the tasks before us.
    // We are very pessimistic here and invalidate all our incoming dependencies to make sure everything is clean.
    // (Except for the cases where it's trivial to see that nobody else is affected)
    auto invalidate = [&](size_t task_id) {
        std::unordered_set<size_t> visited;
        std::vector<size_t> pending;
        pending.push_back(task_id);
        while (!pending.empty()) {
            auto top = pending.back();
            pending.pop_back();

            // Already visited?
            if (visited.count(top)) continue;
            visited.insert(top);

            // No task?
            assert(!!prev_tasks[task_id]);

            // Get invalidation info
            auto& task = *prev_tasks[task_id];
            auto iter = ACTION_TRANSLATION.find(task.task_type);
            if (iter == ACTION_TRANSLATION.end()) {
                continue;
            }
            auto [drop_task, update_task, propagates] = iter->second;

            // Propagates invalidation?
            if (propagates) {
                for (auto dep : task.depends_on) {
                    pending.push_back(dep);
                }
            }

            // Task is not applicable
            task_applicability_[top] = false;
        }
    };

    // We traverse the previous task graph in topological order.
    // That reduces the applicability check to the direct dependencies.
    std::vector<std::pair<TaskID, int>> deps;
    deps.reserve(prev_tasks.size());
    for (unsigned i = 0; i < prev_tasks.size(); ++i) {
        auto* task = prev_tasks[i].get();
        assert(!!task);
        deps.push_back({i, task->depends_on.size()});  // Topo key is dependency count
    }
    TopologicalSort<TaskID> pending_tasks{move(deps)};
    while (!pending_tasks.Empty()) {
        auto [prev_task_id, key] = pending_tasks.Top();
        pending_tasks.Pop();

        // Decrement key of depending tasks
        auto& a = prev_tasks[prev_task_id];
        assert(!!a);
        for (auto next : a->required_for) {
            // Require_for contains valid task ids, not statement ids!
            // No mapping necessary.
            pending_tasks.DecrementKey(next);
        }

        // Task not completed?
        // Irrelevant for the graph migration.
        if (a->task_status_code != proto::task::TaskStatusCode::COMPLETED) {
            invalidate(prev_task_id);
            continue;
        }

        // Get the diff of the origin statement
        assert(prev_task_id < diff_.size());
        auto& diff_op = diff_[a->origin_statement];
        switch (diff_op.code()) {
            // MOVE or KEEP?
            // The statement didn't change so we should try to just reuse the output from before.
            case DiffOpCode::MOVE:
            case DiffOpCode::KEEP: {
                // Check if all dependencies are applicable
                auto all_applicable = true;
                for (auto dep : a->depends_on) {
                    all_applicable &= task_applicability_[dep];
                }
                if (!all_applicable) {
                    invalidate(prev_task_id);
                    break;
                }

                // Check diff to find the corresponing new task.
                assert(diff_op.target());
                auto next_task_id = getStatementTaskId(*diff_op.target());
                if (!next_task_id) {
                    invalidate(prev_task_id);
                    break;
                }

                // Does the dependency set differ?
                // The diff is MOVE or KEEP but the dependency set changed.
                // This will happen very rarely but is not impossible since we'll introduce dependencies
                // based on the location within the script later.
                //
                // E.g. INSERT or UPDATE statements.
                auto next_deps = task_graph_->program_tasks[*next_task_id]->depends_on;
                bool deps_mapped = true;
                for (auto& dep : next_deps) {
                    if (!reverse_task_mapping_[dep]) {
                        deps_mapped = false;
                        break;
                    }
                    dep = *reverse_task_mapping_[dep];
                }
                std::sort(a->depends_on.begin(), a->depends_on.end());
                std::sort(next_deps.begin(), next_deps.end());
                if (!deps_mapped || next_deps != a->depends_on) {
                    // We should never hit this.
                    invalidate(prev_task_id);
                    break;
                }

                // Input task?
                // Then we also have to check whether the parameter value stayed the same.
                // A changed parameter will propagate via the applicability.
                if (a->task_type == proto::task::ProgramTaskType::INPUT) {
                    auto* prev_param = prev_program_->FindInputValue(*diff_op.source());
                    auto* next_param = next_program_.FindInputValue(*diff_op.target());
                    if (*prev_param != *next_param) {
                        invalidate(prev_task_id);
                        break;
                    }
                }

                // The task seems to be applicable, mark it as such
                task_applicability_[prev_task_id] = true;
                break;
            }

            // UPDATE or DELETE?
            // The statement did change, so we have to figure out what must be invalidated.
            // We have to be very careful since any leftover tables will lead to broken dashboards.
            case DiffOpCode::UPDATE:
            case DiffOpCode::DELETE:
                invalidate(prev_task_id);
                break;

            // A previous task is marked with INSERT in the diff?
            // Cannot happen, must be a faulty diff.
            case DiffOpCode::INSERT:
                assert(false);
                break;
        }
    }
    return arrow::Status::OK();
}

arrow::Status TaskPlanner::MigrateTaskGraph() {
    if (!prev_task_graph_) return arrow::Status::OK();

    auto& prev_program_tasks = prev_task_graph_->program_tasks;
    using TaskID = size_t;

    // We know for every previous task whether it is applicable.
    // Emit setup tasks that drop previous state and update the new program tasks.
    //
    // If a task is applicable, there also exists a new task that does not reuse state so far.
    // We update the target id of the new task and mark it as complete.
    // If a task is not applicable, but the diff op is UPDATE, we try to patch the task type.
    // Currently this only affects the VIZ task to explicitly keep the viz state instead of recreating it.
    std::vector<std::unique_ptr<proto::task::SetupTaskT>> setup;
    setup.reserve(prev_program_tasks.size());
    for (unsigned prev_task_id = 0; prev_task_id < prev_program_tasks.size(); ++prev_task_id) {
        // Create a setup task placeholder for every previous program task first.
        // We'll compact later.
        setup.push_back(nullptr);

        // Get the previous program task and the diff
        auto& prev_task = prev_program_tasks[prev_task_id];
        auto prev_stmt_id = prev_task->origin_statement;
        auto& diff_op = diff_[prev_stmt_id];

        // Find the task translation
        auto iter = ACTION_TRANSLATION.find(prev_task->task_type);
        assert(iter != ACTION_TRANSLATION.end());
        if (iter == ACTION_TRANSLATION.end()) continue;
        auto [drop_task, update_task, propagates] = iter->second;

        // Is applicable?
        if (task_applicability_[prev_task_id]) {
            // Map to new task.
            // Diff must be KEEP or MOVE since the previous task is applicable.
            auto next_stmt_id = diff_op.target();
            auto next_task_id = getStatementTaskId(*next_stmt_id);
            assert(next_task_id);  // Applicability
            assert((diff_op.code() == +DiffOpCode::KEEP) || (diff_op.code() == +DiffOpCode::MOVE));

            // Update the target id of the new task and mark it as complete
            auto& next_task = task_graph_->program_tasks[*next_task_id];
            next_task->task_status_code = proto::task::TaskStatusCode::COMPLETED;
            next_task->object_id = prev_task->object_id;
            assert(next_task->name_qualified == prev_task->name_qualified);
            continue;
        }

        // Is diffed as KEEP, MOVE or UPDATE and has defined UPDATE task?
        //
        // Only relevant for viz tasks at the moment.
        // (In which case the diff is actually never KEEP or MOVE but that doesn't matter)
        // A viz statement that was slightly adjusted will be diffed as UPDATE.
        // We don't want to drop and recreate the viz state in order to reuse the existing react component.
        if ((update_task != ProgramTaskType::NONE) &&
            (diff_op.code() == +DiffOpCode::UPDATE || diff_op.code() == +DiffOpCode::MOVE ||
             diff_op.code() == +DiffOpCode::KEEP)) {
            assert(diff_op.target());
            auto next_stmt_id = diff_op.target();
            auto next_task_id = getStatementTaskId(*next_stmt_id);
            assert(next_task_id);  // Applicability
            auto& next_task = task_graph_->program_tasks[*next_task_id];
            next_task->task_type = update_task;
            next_task->object_id = prev_task->object_id;
        }

        // Drop if there's a drop task defined
        else if (drop_task != SetupTaskType::NONE) {
            setup.back() = std::make_unique<proto::task::SetupTaskT>();
            auto& s = setup.back();
            s->task_type = drop_task;
            s->name_qualified = prev_task->name_qualified;
            s->object_id = prev_task->object_id;

            // Store flipped dependencies.
            //
            // If statement B depends on A, the DROP task of B must be executed before A.
            // This flips the original dependencies to ensure that, for example, derived views are dropped before
            // tables.
            s->depends_on = prev_task->required_for;
            s->required_for = prev_task->depends_on;
        }
    }

    // Store setup tasks and remember mapping
    std::vector<std::optional<size_t>> task_mapping;
    task_mapping.resize(setup.size(), std::nullopt);
    for (unsigned i = 0; i < setup.size(); ++i) {
        auto& s = setup[i];
        if (!s || s->task_type == SetupTaskType::NONE) continue;
        task_mapping[i] = task_graph_->setup_tasks.size();
        task_graph_->setup_tasks.push_back(move(setup[i]));
    }

    // Patch all setup dependencies.
    auto patch_ids = [&](std::vector<uint32_t>& ids) {
        auto n = 0;
        for (unsigned i = 0; i < ids.size(); ++i) {
            if (auto mapped = task_mapping[ids[i]]) {
                ids[n++] = *mapped;
            }
        }
        ids.resize(n);
    };
    for (auto& s : task_graph_->setup_tasks) {
        patch_ids(s->required_for);
        patch_ids(s->depends_on);
    }
    return arrow::Status::OK();
}

// Plan the new task graph
arrow::Status TaskPlanner::PlanTaskGraph() {
    ARROW_RETURN_NOT_OK(DiffPrograms());
    ARROW_RETURN_NOT_OK(TranslateStatements());
    ARROW_RETURN_NOT_OK(IdentifyApplicableTasks());
    ARROW_RETURN_NOT_OK(MigrateTaskGraph());
    return arrow::Status::OK();
}

// Encode task graph
std::unique_ptr<proto::task::TaskGraphT> TaskPlanner::Finish() { return move(task_graph_); }

}  // namespace dashql
