use super::{
    program_diff::{compute_diff, DiffOp, DiffOpCode},
    program_instance::ProgramInstance,
};
use serde::Serialize;
use std::{collections::HashSet, sync::atomic::Ordering};
use std::{error::Error, sync::atomic::AtomicU8};

use crate::{grammar::Statement, utils::topological_sort::TopologicalSort};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[repr(u8)]
pub enum TaskStatusCode {
    Pending = 0,
    Skipped = 1,
    Preparing = 2,
    Prepared = 3,
    Executing = 4,
    Blocked = 5,
    Failed = 6,
    Completed = 7,
}

impl Default for TaskStatusCode {
    fn default() -> Self {
        TaskStatusCode::Pending
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
pub enum TaskBlocker {
    None,
    Dependency,
    UserInteraction,
    HttpRequest,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
pub enum TaskType {
    None,
    CreateAs,
    CreateTable,
    CreateView,
    CreateViz,
    Declare,
    DropBlob,
    DropInput,
    DropTable,
    DropView,
    DropViz,
    Import,
    Load,
    ModifyTable,
    Set,
    Unset,
    UpdateViz,
}

impl Default for TaskType {
    fn default() -> Self {
        TaskType::None
    }
}

#[derive(Debug, Serialize)]
pub struct Task {
    pub task_type: TaskType,
    pub task_status: AtomicU8,
    pub depends_on: Vec<usize>,
    pub required_for: Vec<usize>,
    pub origin_statement: Option<usize>,
    pub state_id: usize,
}

impl PartialEq for Task {
    fn eq(&self, other: &Self) -> bool {
        self.task_type == other.task_type
            && self.task_status.load(Ordering::SeqCst) == other.task_status.load(Ordering::SeqCst)
            && self.depends_on == other.depends_on
            && self.required_for == other.required_for
            && self.origin_statement == other.origin_statement
            && self.state_id == other.state_id
    }
}

impl Eq for Task {}

impl Clone for Task {
    fn clone(&self) -> Self {
        Self {
            task_type: self.task_type.clone(),
            task_status: AtomicU8::new(self.task_status.load(Ordering::SeqCst)),
            depends_on: self.depends_on.clone(),
            required_for: self.required_for.clone(),
            origin_statement: self.origin_statement.clone(),
            state_id: self.state_id.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct TaskGraph {
    pub next_state_id: usize,
    pub tasks: Vec<Task>,
    pub task_by_statement: Vec<usize>,
}

#[derive(Debug)]
struct TaskPlannerContext<'a> {
    /// The next program
    pub next_program: &'a ProgramInstance<'a>,
    /// The previous program
    pub prev_program: Option<(&'a ProgramInstance<'a>, &'a TaskGraph)>,
    /// The diff between the programs
    pub diff: Vec<DiffOp>,
    /// The reverse task mapping.
    /// Maps an task to the corresponding previous task if the diff was either KEEP, MOVE or UPDATE.
    /// We use this to figure out, whether the set of dependencies changed.
    pub reverse_task_mapping: Vec<Option<usize>>,
    /// The applicability of tasks in the previous task graph.
    /// An task is applicable iff:
    ///  1) The diff is either KEEP or MOVE
    ///  2) The task is not affected by a parmeter update
    ///  3) The dependency set stayed the same
    ///  4) All dependencies are applicable
    pub task_applicability: Vec<bool>,
    /// The next task graph
    pub next_task_graph: Option<TaskGraph>,
}

fn translate_statements<'a>(ctx: &mut TaskPlannerContext<'a>) -> Result<(), Box<dyn Error + Send + Sync>> {
    let next = ctx.next_program;
    let mut next_state_id = ctx.prev_program.map(|(_, t)| t.next_state_id).unwrap_or_default();

    let mut tasks: Vec<Task> = Vec::with_capacity(next.program.statements.len());
    let mut tasks_by_statement: Vec<usize> = Vec::new();
    tasks_by_statement.resize(next.program.statements.len(), usize::MAX);

    for stmt_id in 0..next.program.statements.len() {
        let mixin = Task {
            task_type: TaskType::None,
            task_status: AtomicU8::new(if next.statement_liveness[stmt_id] {
                TaskStatusCode::Pending as u8
            } else {
                TaskStatusCode::Skipped as u8
            }),
            depends_on: Vec::new(),
            required_for: Vec::new(),
            origin_statement: Some(stmt_id),
            state_id: next_state_id,
        };
        let task = match &next.program.statements[stmt_id] {
            Statement::Create(_c) => Task {
                task_type: TaskType::CreateTable,
                ..mixin
            },
            Statement::CreateAs(_c) => Task {
                task_type: TaskType::CreateAs,
                ..mixin
            },
            Statement::CreateView(_c) => Task {
                task_type: TaskType::CreateView,
                ..mixin
            },
            Statement::Declare(_i) => Task {
                task_type: TaskType::Declare,
                ..mixin
            },
            Statement::Import(_f) => Task {
                task_type: TaskType::Import,
                ..mixin
            },
            Statement::Load(_l) => Task {
                task_type: TaskType::Load,
                ..mixin
            },
            Statement::Viz(_v) => Task {
                task_type: TaskType::CreateViz,
                ..mixin
            },
            Statement::Select(_s) => Task {
                task_type: TaskType::CreateTable,
                ..mixin
            },
            Statement::Set(_) => Task {
                task_type: TaskType::Set,
                ..mixin
            },
        };
        next_state_id += 1;
        tasks_by_statement[stmt_id] = tasks.len();
        tasks.push(task);
    }

    // Store dependencies
    for ((a, b), _) in next.statement_depends_on.iter() {
        tasks[*a].depends_on.push(*b);
        tasks[*b].required_for.push(*a);
    }

    ctx.next_task_graph = Some(TaskGraph {
        next_state_id,
        tasks,
        task_by_statement: tasks_by_statement,
    });
    Ok(())
}

fn diff_programs<'a>(ctx: &mut TaskPlannerContext<'a>) -> Result<(), Box<dyn Error + Send + Sync>> {
    // Compute the diff
    let (prev_prog, _) = match &mut ctx.prev_program {
        Some((prog, task)) => (prog, task),
        None => return Ok(()),
    };
    ctx.diff = compute_diff(prev_prog, ctx.next_program);

    // Compute the reverse task mapping
    let next_task_graph = ctx.next_task_graph.as_ref().unwrap();
    ctx.reverse_task_mapping.resize(next_task_graph.tasks.len(), None);
    for diff_op in ctx.diff.iter() {
        match diff_op.op_code {
            DiffOpCode::Keep | DiffOpCode::Move | DiffOpCode::Update => continue,
            _ => (),
        }
        match (diff_op.source, diff_op.target) {
            (Some(src), Some(tgt)) => ctx.reverse_task_mapping[tgt] = Some(src),
            _ => (),
        }
    }
    Ok(())
}

fn identify_applicable_tasks<'a>(ctx: &mut TaskPlannerContext<'a>) -> Result<(), Box<dyn Error + Send + Sync>> {
    let (prev_program, prev_tasks) = match ctx.prev_program {
        Some((prev_program, prev_tasks)) => (prev_program, prev_tasks),
        None => return Ok(()),
    };
    ctx.task_applicability.resize(prev_tasks.tasks.len(), false);

    // Invalidate a task.
    // If a task is invalidated, we might have to propagate the invalidation to the tasks before us.
    // We are very pessimistic here and invalidate all our incoming dependencies to make sure everything is clean.
    // (Except for the cases where it's trivial to see that nobody else is affected)
    let invalidate = |ctx: &mut TaskPlannerContext<'a>, task_id: usize| {
        let mut visited = HashSet::new();
        let mut pending = Vec::new();
        pending.push(task_id);

        while !pending.is_empty() {
            let top = pending.pop().unwrap();

            // Already visited?
            if visited.contains(&top) {
                continue;
            }
            visited.insert(top);

            // Get invalidation info
            assert!(task_id != usize::MAX);
            let task = &prev_tasks.tasks[task_id];

            // Propagates invalidation?
            let propagates = match task.task_type {
                TaskType::ModifyTable => true,
                _ => false,
            };
            if propagates {
                for dep in task.depends_on.iter() {
                    pending.push(*dep);
                }
            }

            // Task is not applicable
            ctx.task_applicability[top] = false;
        }
    };

    // We traverse the previous task graph in topological order.
    // That reduces the applicability check to the direct dependencies.
    let mut deps: Vec<(usize, usize)> = Vec::new();
    deps.reserve(prev_tasks.tasks.len());
    for (i, t) in prev_tasks.tasks.iter().enumerate() {
        deps.push((i, t.depends_on.len()));
    }
    let mut pending_tasks = TopologicalSort::new(deps);
    while !pending_tasks.is_empty() {
        let (prev_task_id, _) = pending_tasks.top().clone();
        pending_tasks.pop();

        // Decrement key of depending tasks
        let a = &prev_tasks.tasks[prev_task_id];
        for next in a.required_for.iter() {
            pending_tasks.decrement_key(next);
        }

        // Task not completed?
        // Irrelevant for the graph migration.
        if a.task_status.load(Ordering::SeqCst) != TaskStatusCode::Completed as u8 {
            invalidate(ctx, prev_task_id);
            continue;
        }
        let next_task_graph = ctx.next_task_graph.as_mut().unwrap();

        // Get the diff of the origin statement
        let diff_op = ctx.diff[a.origin_statement.expect("program tasks must have an origin statement")].clone();
        match diff_op.op_code {
            // MOVE or KEEP?
            // The statement didn't change so we should try to just reuse the output from before.
            DiffOpCode::Move | DiffOpCode::Keep => {
                // Check if all dependencies are applicable
                let mut all_applicable = true;
                for dep in a.depends_on.iter() {
                    all_applicable &= ctx.task_applicability[*dep];
                }
                if !all_applicable {
                    invalidate(ctx, prev_task_id);
                    break;
                }

                // Check diff to find the corresponing new task.
                debug_assert!(diff_op.target.is_some());
                let next_task_id = next_task_graph.task_by_statement[diff_op.target.unwrap()];

                // Does the dependency set differ?
                // The diff is MOVE or KEEP but the dependency set changed.
                // This will happen very rarely but is not impossible since we might introduce dependencies
                // based on the location within the script later.
                //
                // E.g. INSERT or UPDATE statements.
                let mut prev_deps = a.depends_on.clone();
                let mut next_deps = next_task_graph.tasks[next_task_id].depends_on.clone();
                let mut deps_mapped = true;
                for dep in next_deps.iter_mut() {
                    match ctx.reverse_task_mapping[*dep] {
                        Some(prev_task) => *dep = prev_task,
                        None => {
                            deps_mapped = false;
                            break;
                        }
                    }
                }
                prev_deps.sort_unstable();
                next_deps.sort_unstable();
                if !deps_mapped || next_deps != prev_deps {
                    invalidate(ctx, prev_task_id);
                    break;
                }

                // Declare task?
                // Then we also have to check whether the parameter value stayed the same.
                // A changed parameter will propagate via the applicability.
                if a.task_type == TaskType::Declare {
                    let prev_stmt_id = diff_op.source.unwrap_or_default();
                    let next_stmt_id = diff_op.target.unwrap_or_default();
                    let prev_param = prev_program.input.get(&prev_stmt_id);
                    let next_param = prev_program.input.get(&next_stmt_id);
                    if prev_param != next_param {
                        invalidate(ctx, prev_task_id);
                        break;
                    }
                }

                // The task seems to be applicable, mark it as such
                ctx.task_applicability[prev_task_id] = true;
                break;
            }

            // UPDATE or DELETE?
            // The statement did change, so we have to figure out what must be invalidated.
            // We have to be very careful since any leftover tables will lead to broken dashboards.
            DiffOpCode::Update | DiffOpCode::Delete => {
                invalidate(ctx, prev_task_id);
                break;
            }

            // A previous task is marked with INSERT in the diff?
            // Cannot happen, must be a faulty diff.
            DiffOpCode::Insert => {
                unreachable!();
            }
        }
    }

    Ok(())
}

fn migrate_task_graph<'a>(ctx: &mut TaskPlannerContext<'a>) -> Result<(), Box<dyn Error + Send + Sync>> {
    let (_, prev_tasks) = match &mut ctx.prev_program {
        Some((prog, task)) => (prog, task),
        None => return Ok(()),
    };
    let next_tasks = match &mut ctx.next_task_graph {
        Some(t) => t,
        None => unreachable!(),
    };

    // Remember where undo tasks begin
    let undos_begin = next_tasks.tasks.len();
    let mut forward_task_mapping = Vec::new();
    forward_task_mapping.resize(prev_tasks.tasks.len(), None);

    // We know for every previous task whether it is applicable.
    // Emit setup tasks that drop previous state and update the new program tasks.
    //
    // If a task is applicable, there also exists a new task that does not reuse state so far.
    // We update the target id of the new task and mark it as complete.
    // If a task is not applicable, but the diff op is UPDATE, we try to patch the task type.
    // Currently this only affects the VIZ task to explicitly keep the viz state instead of recreating it.
    for (prev_task_id, prev_task) in prev_tasks.tasks.iter().enumerate() {
        // Get the previous program task and the diff
        let prev_stmt_id = prev_task
            .origin_statement
            .expect("program tasks must have an origin statement");
        let diff_op = &ctx.diff[prev_stmt_id];

        // Find the task translation
        let (undo_task, update_task) = match prev_task.task_type {
            TaskType::None => (TaskType::None, TaskType::None),
            TaskType::CreateAs => (TaskType::DropTable, TaskType::None),
            TaskType::CreateTable => (TaskType::DropTable, TaskType::None),
            TaskType::CreateView => (TaskType::DropView, TaskType::None),
            TaskType::CreateViz => (TaskType::DropViz, TaskType::UpdateViz),
            TaskType::Import => (TaskType::DropBlob, TaskType::None),
            TaskType::Declare => (TaskType::DropInput, TaskType::None),
            TaskType::Load => (TaskType::DropTable, TaskType::None),
            TaskType::ModifyTable => (TaskType::DropTable, TaskType::None),
            TaskType::Set => (TaskType::Unset, TaskType::None),
            TaskType::UpdateViz => (TaskType::DropViz, TaskType::UpdateViz),
            TaskType::DropBlob => (TaskType::DropBlob, TaskType::None),
            TaskType::DropInput => (TaskType::DropInput, TaskType::None),
            TaskType::DropTable => (TaskType::DropTable, TaskType::None),
            TaskType::DropView => (TaskType::DropView, TaskType::None),
            TaskType::DropViz => (TaskType::DropViz, TaskType::None),
            TaskType::Unset => (TaskType::Unset, TaskType::None),
        };

        // Is applicable?
        if ctx.task_applicability[prev_task_id] {
            // Map to new task.
            // Diff must be KEEP or MOVE since the previous task is applicable.
            let next_stmt_id = diff_op.target.unwrap_or_default();
            let next_task_id = next_tasks.task_by_statement[next_stmt_id];
            debug_assert!((diff_op.op_code == DiffOpCode::Keep) || (diff_op.op_code == DiffOpCode::Move));

            // Update the target id of the new task and mark it as complete
            let next_task = &mut next_tasks.tasks[next_task_id];
            next_task
                .task_status
                .store(TaskStatusCode::Completed as u8, Ordering::SeqCst);
            next_task.state_id = prev_task.state_id;
            forward_task_mapping[prev_task_id] = Some(next_task_id);
            continue;
        }

        // Is diffed as KEEP, MOVE or UPDATE and has defined UPDATE task?
        //
        // Only relevant for viz tasks at the moment.
        // (In which case the diff is actually never KEEP or MOVE but that doesn't matter)
        // A viz statement that was slightly adjusted will be diffed as UPDATE.
        // We don't want to drop and recreate the viz state in order to reuse the existing react component.
        if (update_task != TaskType::None)
            && (diff_op.op_code == DiffOpCode::Update
                || diff_op.op_code == DiffOpCode::Move
                || diff_op.op_code == DiffOpCode::Keep)
        {
            debug_assert!(diff_op.target.is_some());
            let next_stmt_id = diff_op.target.unwrap_or_default();
            let next_task_id = next_tasks.task_by_statement[next_stmt_id];
            let next_task = &mut next_tasks.tasks[next_task_id];
            next_task.task_type = update_task;
            next_task.state_id = prev_task.state_id;
            forward_task_mapping[prev_task_id] = Some(next_task_id);
            continue;
        }

        // Drop if there's a drop task defined
        if undo_task != TaskType::None {
            let next_task_id = next_tasks.tasks.len();
            next_tasks.tasks.push(Task {
                task_type: undo_task,
                task_status: AtomicU8::new(TaskStatusCode::Pending as u8),
                depends_on: prev_task.depends_on.clone(),
                required_for: Vec::new(),
                origin_statement: None,
                state_id: prev_task.state_id,
            });
            ctx.reverse_task_mapping.push(Some(prev_task_id));
            forward_task_mapping[prev_task_id] = Some(next_task_id);
        }
    }

    // Patch dependencies among undos
    let patch_ids = |ids: &mut Vec<usize>| {
        let mut writer = 0;
        for i in 0..ids.len() {
            if let Some(mapped) = forward_task_mapping[ids[i]] {
                ids[writer] = mapped;
                writer += 1;
            }
        }
        ids.truncate(writer);
    };
    for undo_task_id in undos_begin..next_tasks.tasks.len() {
        patch_ids(&mut next_tasks.tasks[undo_task_id].required_for);
        patch_ids(&mut next_tasks.tasks[undo_task_id].depends_on);
        for new_task_id in 0..undos_begin {
            next_tasks.tasks[undo_task_id].required_for.push(new_task_id);
            next_tasks.tasks[new_task_id].depends_on.push(undo_task_id);
        }
    }

    // Sort all all dependency lists
    for task in next_tasks.tasks.iter_mut() {
        task.depends_on.sort_unstable();
        task.required_for.sort_unstable();
    }
    Ok(())
}

pub fn plan_tasks<'a>(
    next_program: &'a ProgramInstance<'a>,
    prev_program: Option<(&'a ProgramInstance<'a>, &'a TaskGraph)>,
) -> Result<TaskGraph, Box<dyn Error + Send + Sync>> {
    let mut ctx = TaskPlannerContext {
        next_program,
        prev_program,
        diff: Vec::new(),
        reverse_task_mapping: Vec::new(),
        task_applicability: Vec::new(),
        next_task_graph: None,
    };
    translate_statements(&mut ctx)?;
    diff_programs(&mut ctx)?;
    identify_applicable_tasks(&mut ctx)?;
    migrate_task_graph(&mut ctx)?;
    Ok(ctx.next_task_graph.unwrap())
}

#[cfg(test)]
mod test {

    use super::*;
    use crate::analyzer::analysis_settings::ProgramAnalysisSettings;
    use crate::analyzer::program_instance::analyze_program;
    use crate::execution::execution_context::ExecutionContext;
    use crate::execution::scalar_value::ScalarValue;
    use crate::external::database::DatabaseClient;
    use crate::external::parser::parse_into;
    use crate::external::runtime;
    use crate::grammar;
    use std::rc::Rc;
    use std::sync::Arc;

    struct ExpectedInstance {
        script: &'static str,
        input: Vec<(usize, ScalarValue)>,
        tasks: TaskGraph,
    }

    struct TaskPlannerTest {
        prev: Option<ExpectedInstance>,
        next: ExpectedInstance,
    }

    async fn test_planner(test: &TaskPlannerTest) -> Result<(), Box<dyn Error + Send + Sync>> {
        let settings = Arc::new(ProgramAnalysisSettings::default());
        let runtime = runtime::create();
        let database = Arc::new(DatabaseClient::create().await?);
        let database_instance = Arc::new(database.open_in_memory().await?);

        // Instantiate previous program
        let prev_arena = bumpalo::Bump::new();
        let prev_context = ExecutionContext::create(
            settings.clone(),
            runtime.clone(),
            database_instance.clone(),
            &prev_arena,
        );
        let mut prev_instance = None;
        let mut prev_tasks = None;
        if let Some(prev) = &test.prev {
            let (prev_ast, prev_ast_data) = parse_into(&prev_arena, prev.script)?;
            assert!(
                prev_ast.errors().is_none(),
                "{}",
                prev_ast.errors().unwrap().get(0).message().unwrap_or_default()
            );
            let prev_prog =
                Rc::new(grammar::deserialize_ast(&prev_arena, prev.script, prev_ast, prev_ast_data).unwrap());
            prev_instance = Some(analyze_program(
                prev_context,
                prev.script,
                prev_ast,
                prev_prog,
                prev.input.iter().cloned().collect(),
            )?);
            prev_tasks = Some(plan_tasks(prev_instance.as_ref().unwrap(), None)?);
            let have = prev_tasks.as_ref().unwrap();
            let expected = &test.prev.as_ref().unwrap().tasks;
            assert_eq!(have.next_state_id, expected.next_state_id);
            assert_eq!(have.tasks, expected.tasks);
            assert_eq!(have.task_by_statement, expected.task_by_statement);
        };

        // Instantiate next program
        let next_arena = bumpalo::Bump::new();
        let next_context = ExecutionContext::create(settings, runtime, database_instance.clone(), &next_arena);
        let next_instance = {
            let (next_ast, next_ast_data) = parse_into(&next_arena, test.next.script)?;
            assert!(
                next_ast.errors().is_none(),
                "{}",
                next_ast.errors().unwrap().get(0).message().unwrap_or_default()
            );
            let next_prog =
                Rc::new(grammar::deserialize_ast(&next_arena, test.next.script, next_ast, next_ast_data).unwrap());
            analyze_program(
                next_context,
                test.next.script,
                next_ast,
                next_prog,
                test.next.input.iter().cloned().collect(),
            )?
        };

        // Plan next tasks
        let prev_state = match (&prev_instance, &prev_tasks) {
            (Some(prev_instance), Some(prev_tasks)) => Some((prev_instance, prev_tasks)),
            (_, _) => None,
        };
        let have = plan_tasks(&next_instance, prev_state)?;
        let expected = &test.next.tasks;
        assert_eq!(have.tasks, expected.tasks);
        assert_eq!(have.task_by_statement, expected.task_by_statement);
        assert_eq!(have.next_state_id, expected.next_state_id);
        Ok(())
    }

    #[tokio::test]
    async fn test_1() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_planner(&TaskPlannerTest {
            prev: None,
            next: ExpectedInstance {
                script: r#"
IMPORT a FROM 'https://some/remote'
            "#,
                input: vec![],
                tasks: TaskGraph {
                    next_state_id: 1,
                    tasks: vec![Task {
                        task_type: TaskType::Import,
                        task_status: AtomicU8::new(TaskStatusCode::Skipped as u8),
                        depends_on: vec![],
                        required_for: vec![],
                        origin_statement: Some(0),
                        state_id: 0,
                    }],
                    task_by_statement: vec![0],
                },
            },
        })
        .await
    }

    #[tokio::test]
    async fn test_2() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_planner(&TaskPlannerTest {
            prev: None,
            next: ExpectedInstance {
                script: r#"
IMPORT a FROM 'https://some/remote';
LOAD b FROM a USING PARQUET;
            "#,
                input: vec![],
                tasks: TaskGraph {
                    next_state_id: 2,
                    tasks: vec![
                        Task {
                            task_type: TaskType::Import,
                            task_status: AtomicU8::new(TaskStatusCode::Skipped as u8),
                            depends_on: vec![],
                            required_for: vec![1],
                            origin_statement: Some(0),
                            state_id: 0,
                        },
                        Task {
                            task_type: TaskType::Load,
                            task_status: AtomicU8::new(TaskStatusCode::Skipped as u8),
                            depends_on: vec![0],
                            required_for: vec![],
                            origin_statement: Some(1),
                            state_id: 1,
                        },
                    ],
                    task_by_statement: vec![0, 1],
                },
            },
        })
        .await
    }

    #[tokio::test]
    async fn test_3() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_planner(&TaskPlannerTest {
            prev: None,
            next: ExpectedInstance {
                script: r#"
IMPORT a FROM 'https://some/remote';
LOAD b FROM a USING PARQUET;
CREATE TABLE c AS SELECT * FROM b
            "#,
                input: vec![],
                tasks: TaskGraph {
                    next_state_id: 3,
                    tasks: vec![
                        Task {
                            task_type: TaskType::Import,
                            task_status: AtomicU8::new(TaskStatusCode::Skipped as u8),
                            depends_on: vec![],
                            required_for: vec![1],
                            origin_statement: Some(0),
                            state_id: 0,
                        },
                        Task {
                            task_type: TaskType::Load,
                            task_status: AtomicU8::new(TaskStatusCode::Skipped as u8),
                            depends_on: vec![0],
                            required_for: vec![2],
                            origin_statement: Some(1),
                            state_id: 1,
                        },
                        Task {
                            task_type: TaskType::CreateAs,
                            task_status: AtomicU8::new(TaskStatusCode::Skipped as u8),
                            depends_on: vec![1],
                            required_for: vec![],
                            origin_statement: Some(2),
                            state_id: 2,
                        },
                    ],
                    task_by_statement: vec![0, 1, 2],
                },
            },
        })
        .await
    }

    #[tokio::test]
    async fn test_4() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_planner(&TaskPlannerTest {
            prev: None,
            next: ExpectedInstance {
                script: r#"
IMPORT a FROM 'https://some/remote';
LOAD b FROM a USING PARQUET;
CREATE TABLE c AS SELECT * FROM b;
VIZ c USING TABLE;
            "#,
                input: vec![],
                tasks: TaskGraph {
                    next_state_id: 4,
                    tasks: vec![
                        Task {
                            task_type: TaskType::Import,
                            task_status: AtomicU8::new(TaskStatusCode::Pending as u8),
                            depends_on: vec![],
                            required_for: vec![1],
                            origin_statement: Some(0),
                            state_id: 0,
                        },
                        Task {
                            task_type: TaskType::Load,
                            task_status: AtomicU8::new(TaskStatusCode::Pending as u8),
                            depends_on: vec![0],
                            required_for: vec![2],
                            origin_statement: Some(1),
                            state_id: 1,
                        },
                        Task {
                            task_type: TaskType::CreateAs,
                            task_status: AtomicU8::new(TaskStatusCode::Pending as u8),
                            depends_on: vec![1],
                            required_for: vec![3],
                            origin_statement: Some(2),
                            state_id: 2,
                        },
                        Task {
                            task_type: TaskType::CreateViz,
                            task_status: AtomicU8::new(TaskStatusCode::Pending as u8),
                            depends_on: vec![2],
                            required_for: vec![],
                            origin_statement: Some(3),
                            state_id: 3,
                        },
                    ],
                    task_by_statement: vec![0, 1, 2, 3],
                },
            },
        })
        .await
    }

    #[tokio::test]
    async fn test_5() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_planner(&TaskPlannerTest {
            prev: Some(ExpectedInstance {
                script: r#"
CREATE TABLE a AS SELECT 2;
VIZ a USING TABLE;
            "#,
                input: vec![],
                tasks: TaskGraph {
                    next_state_id: 2,
                    tasks: vec![
                        Task {
                            task_type: TaskType::CreateAs,
                            task_status: AtomicU8::new(TaskStatusCode::Pending as u8),
                            depends_on: vec![],
                            required_for: vec![1],
                            origin_statement: Some(0),
                            state_id: 0,
                        },
                        Task {
                            task_type: TaskType::CreateViz,
                            task_status: AtomicU8::new(TaskStatusCode::Pending as u8),
                            depends_on: vec![0],
                            required_for: vec![],
                            origin_statement: Some(1),
                            state_id: 1,
                        },
                    ],
                    task_by_statement: vec![0, 1],
                },
            }),
            next: ExpectedInstance {
                script: r#"
CREATE TABLE a AS SELECT 1;
VIZ a USING TABLE;
            "#,
                input: vec![],
                tasks: TaskGraph {
                    next_state_id: 4,
                    tasks: vec![
                        Task {
                            task_type: TaskType::CreateAs,
                            task_status: AtomicU8::new(TaskStatusCode::Pending as u8),
                            depends_on: vec![2],
                            required_for: vec![1],
                            origin_statement: Some(0),
                            state_id: 2,
                        },
                        Task {
                            task_type: TaskType::UpdateViz,
                            task_status: AtomicU8::new(TaskStatusCode::Pending as u8),
                            depends_on: vec![0, 2],
                            required_for: vec![],
                            origin_statement: Some(1),
                            state_id: 1,
                        },
                        Task {
                            task_type: TaskType::DropTable,
                            task_status: AtomicU8::new(TaskStatusCode::Pending as u8),
                            depends_on: vec![],
                            required_for: vec![0, 1],
                            origin_statement: None,
                            state_id: 0,
                        },
                    ],
                    task_by_statement: vec![0, 1],
                },
            },
        })
        .await
    }
}
