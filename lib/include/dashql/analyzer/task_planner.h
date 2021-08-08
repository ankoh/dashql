// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_TASK_PLANNER_H_
#define INCLUDE_DASHQL_ANALYZER_TASK_PLANNER_H_

#include <unordered_map>

#include "dashql/analyzer/program_instance.h"
#include "dashql/analyzer/program_matcher.h"
#include "dashql/proto_generated.h"

namespace dashql {

/// The task planner
class TaskPlanner {
   protected:
    /// The next program
    const ProgramInstance& next_program_;
    /// The previous program
    const ProgramInstance* prev_program_;
    /// The previous task graph
    const proto::task::TaskGraphT* prev_task_graph_;

    /// The diff between the programs
    std::vector<ProgramMatcher::DiffOp> diff_;
    /// The statement task mapping
    std::vector<std::optional<size_t>> task_mapping_;
    /// The reverse task mapping.
    /// Maps an task to the corresponding previous task if the diff was either KEEP, MOVE or UPDATE.
    /// We use this to figure out, whether the set of dependencies changed.
    std::vector<std::optional<size_t>> reverse_task_mapping_;
    /// The applicability of tasks in the previous task graph.
    /// An task is applicable iff:
    ///  1) The diff is either KEEP or MOVE
    ///  2) The task is not affected by a parmeter update
    ///  3) The dependency set stayed the same
    ///  4) All dependencies are applicable
    std::vector<bool> task_applicability_;
    /// The new task graph
    std::unique_ptr<proto::task::TaskGraphT> task_graph_;

    /// Get the statement task id
    inline std::optional<size_t> getStatementTaskId(size_t stmt_id) {
        assert(stmt_id < task_mapping_.size());
        return task_mapping_[stmt_id];
    }
    /// Get the statement task
    inline proto::task::ProgramTaskT* getStatementTask(size_t stmt_id) {
        auto id = getStatementTaskId(stmt_id);
        return !id.has_value() ? nullptr : task_graph_->program_tasks[*id].get();
    }

    /// Diff the two programs
    arrow::Status DiffPrograms();
    /// Translate statements canonically
    arrow::Status TranslateStatements();
    /// Identify applicable tasks in the previous task graph
    arrow::Status IdentifyApplicableTasks();
    /// Migrate the previous task graph
    arrow::Status MigrateTaskGraph();

   public:
    /// Constructor
    TaskPlanner(const ProgramInstance& next_program, const ProgramInstance* prev_program = nullptr,
                const proto::task::TaskGraphT* prev_task_graph = nullptr);

    /// Plan the new task graph
    arrow::Status PlanTaskGraph();
    /// Get the task graph
    std::unique_ptr<proto::task::TaskGraphT> Finish();
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_ANALYZER_TASK_PLANNER_H_
