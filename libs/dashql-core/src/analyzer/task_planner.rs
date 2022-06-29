use super::{
    program_diff::{compute_diff, DiffOp, DiffOpCode},
    program_instance::ProgramInstance,
};
use serde::Serialize;
use std::error::Error;
use std::{cell::Cell, collections::HashSet};

use crate::{grammar::Statement, utils::topological_sort::TopologicalSort};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum TaskClass {
    SetupTask,
    ProgramTask,
}

impl Default for TaskClass {
    fn default() -> Self {
        TaskClass::ProgramTask
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum TaskStatusCode {
    Pending,
    Skipped,
    Preparing,
    Prepared,
    Executing,
    Blocked,
    Failed,
    Completed,
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
pub enum SetupTaskType {
    None,
    DropBlob,
    DropInput,
    DropTable,
    DropView,
    DropViz,
    Unset,
}

impl Default for SetupTaskType {
    fn default() -> Self {
        SetupTaskType::None
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
pub struct SetupTask {
    pub task_type: SetupTaskType,
    pub task_status: Cell<TaskStatusCode>,
    pub depends_on: Vec<usize>,
    pub required_for: Vec<usize>,
    pub state_id: usize,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
pub enum ProgramTaskType {
    None,
    CreateAs,
    CreateTable,
    CreateView,
    CreateViz,
    Import,
    Input,
    Load,
    ModifyTable,
    Set,
    UpdateViz,
}

impl Default for ProgramTaskType {
    fn default() -> Self {
        ProgramTaskType::None
    }
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct ProgramTask {
    pub task_type: ProgramTaskType,
    pub task_status: Cell<TaskStatusCode>,
    pub depends_on: Vec<usize>,
    pub required_for: Vec<usize>,
    pub origin_statement: usize,
    pub state_id: usize,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct TaskGraph {
    pub next_state_id: usize,
    pub setup_tasks: Vec<SetupTask>,
    pub program_tasks: Vec<ProgramTask>,
    pub program_task_by_statement: Vec<Option<usize>>,
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
    pub program_task_applicability: Vec<bool>,
    /// The next task graph
    pub next_task_graph: Option<TaskGraph>,
}

fn translate_statements<'a>(ctx: &mut TaskPlannerContext<'a>) -> Result<(), Box<dyn Error + Send + Sync>> {
    let next = ctx.next_program;
    let mut next_state_id = ctx.prev_program.map(|(_, t)| t.next_state_id).unwrap_or_default();

    let mut program_tasks: Vec<ProgramTask> = Vec::with_capacity(next.program.statements.len());
    let mut program_task_by_statement: Vec<Option<usize>> = Vec::new();
    program_task_by_statement.resize(next.program.statements.len(), None);

    for stmt_id in 0..next.program.statements.len() {
        let mixin = ProgramTask {
            task_type: ProgramTaskType::None,
            task_status: if next.statement_liveness[stmt_id] {
                Cell::new(TaskStatusCode::Pending)
            } else {
                Cell::new(TaskStatusCode::Skipped)
            },
            depends_on: Vec::new(),
            required_for: Vec::new(),
            origin_statement: stmt_id,
            state_id: next_state_id,
        };
        let task = match &next.program.statements[stmt_id] {
            Statement::Create(_c) => ProgramTask {
                task_type: ProgramTaskType::CreateTable,
                ..mixin
            },
            Statement::CreateAs(_c) => ProgramTask {
                task_type: ProgramTaskType::CreateAs,
                ..mixin
            },
            Statement::CreateView(_c) => ProgramTask {
                task_type: ProgramTaskType::CreateView,
                ..mixin
            },
            Statement::Input(_i) => ProgramTask {
                task_type: ProgramTaskType::Input,
                ..mixin
            },
            Statement::Import(_f) => ProgramTask {
                task_type: ProgramTaskType::Import,
                ..mixin
            },
            Statement::Load(_l) => ProgramTask {
                task_type: ProgramTaskType::Load,
                ..mixin
            },
            Statement::Viz(_v) => ProgramTask {
                task_type: ProgramTaskType::CreateViz,
                ..mixin
            },
            Statement::Select(_s) => ProgramTask {
                task_type: ProgramTaskType::CreateTable,
                ..mixin
            },
            Statement::Set(_) => ProgramTask {
                task_type: ProgramTaskType::Set,
                ..mixin
            },
        };
        next_state_id += 1;
        program_task_by_statement[stmt_id] = Some(program_tasks.len());
        program_tasks.push(task);
    }

    // Store dependencies
    for ((a, b), _) in next.statement_depends_on.iter() {
        match (program_task_by_statement[*a], program_task_by_statement[*b]) {
            (Some(a), Some(b)) => {
                program_tasks[a].depends_on.push(b);
                program_tasks[b].required_for.push(a);
            }
            (_, _) => continue,
        }
    }

    ctx.next_task_graph = Some(TaskGraph {
        next_state_id,
        setup_tasks: Vec::new(),
        program_tasks,
        program_task_by_statement,
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
    ctx.reverse_task_mapping
        .resize(next_task_graph.program_tasks.len(), None);
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
    ctx.program_task_applicability
        .resize(prev_tasks.program_tasks.len(), false);

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
            let task = &prev_tasks.program_tasks[task_id];

            // Propagates invalidation?
            let propagates = match task.task_type {
                ProgramTaskType::None => false,
                ProgramTaskType::CreateAs => true,
                ProgramTaskType::CreateTable => true,
                ProgramTaskType::CreateView => true,
                ProgramTaskType::CreateViz => false,
                ProgramTaskType::Import => false,
                ProgramTaskType::Input => false,
                ProgramTaskType::Load => false,
                ProgramTaskType::ModifyTable => true,
                ProgramTaskType::Set => false,
                ProgramTaskType::UpdateViz => false,
            };
            if propagates {
                for dep in task.depends_on.iter() {
                    pending.push(*dep);
                }
            }

            // Task is not applicable
            ctx.program_task_applicability[top] = false;
        }
    };

    // We traverse the previous task graph in topological order.
    // That reduces the applicability check to the direct dependencies.
    let mut deps: Vec<(usize, usize)> = Vec::new();
    deps.reserve(prev_tasks.program_tasks.len());
    for (i, t) in prev_tasks.program_tasks.iter().enumerate() {
        deps.push((i, t.depends_on.len()));
    }
    let mut pending_tasks = TopologicalSort::new(deps);
    while !pending_tasks.is_empty() {
        let (prev_task_id, _) = pending_tasks.top().clone();
        pending_tasks.pop();

        // Decrement key of depending tasks
        let a = &prev_tasks.program_tasks[prev_task_id];
        for next in a.required_for.iter() {
            pending_tasks.decrement_key(next);
        }

        // Task not completed?
        // Irrelevant for the graph migration.
        if a.task_status.get() != TaskStatusCode::Completed {
            invalidate(ctx, prev_task_id);
            continue;
        }
        let next_task_graph = ctx.next_task_graph.as_mut().unwrap();

        // Get the diff of the origin statement
        let diff_op = ctx.diff[a.origin_statement].clone();
        match diff_op.op_code {
            // MOVE or KEEP?
            // The statement didn't change so we should try to just reuse the output from before.
            DiffOpCode::Move | DiffOpCode::Keep => {
                // Check if all dependencies are applicable
                let mut all_applicable = true;
                for dep in a.depends_on.iter() {
                    all_applicable &= ctx.program_task_applicability[*dep];
                }
                if !all_applicable {
                    invalidate(ctx, prev_task_id);
                    break;
                }

                // Check diff to find the corresponing new task.
                debug_assert!(diff_op.target.is_some());
                let next_task_id = match next_task_graph.program_task_by_statement[diff_op.target.unwrap()] {
                    Some(tid) => tid,
                    None => {
                        invalidate(ctx, prev_task_id);
                        break;
                    }
                };

                // Does the dependency set differ?
                // The diff is MOVE or KEEP but the dependency set changed.
                // This will happen very rarely but is not impossible since we might introduce dependencies
                // based on the location within the script later.
                //
                // E.g. INSERT or UPDATE statements.
                let mut prev_deps = a.depends_on.clone();
                let mut next_deps = next_task_graph.program_tasks[next_task_id].depends_on.clone();
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

                // Input task?
                // Then we also have to check whether the parameter value stayed the same.
                // A changed parameter will propagate via the applicability.
                if a.task_type == ProgramTaskType::Input {
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
                ctx.program_task_applicability[prev_task_id] = true;
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

    // We know for every previous task whether it is applicable.
    // Emit setup tasks that drop previous state and update the new program tasks.
    //
    // If a task is applicable, there also exists a new task that does not reuse state so far.
    // We update the target id of the new task and mark it as complete.
    // If a task is not applicable, but the diff op is UPDATE, we try to patch the task type.
    // Currently this only affects the VIZ task to explicitly keep the viz state instead of recreating it.
    let mut setup = Vec::new();
    setup.resize(prev_tasks.program_tasks.len(), None);
    for (prev_task_id, prev_task) in prev_tasks.program_tasks.iter().enumerate() {
        // Get the previous program task and the diff
        let prev_stmt_id = prev_task.origin_statement;
        let diff_op = &ctx.diff[prev_stmt_id];

        // Find the task translation
        let (drop_task, update_task) = match prev_task.task_type {
            ProgramTaskType::None => (SetupTaskType::None, ProgramTaskType::None),
            ProgramTaskType::CreateAs => (SetupTaskType::DropTable, ProgramTaskType::None),
            ProgramTaskType::CreateTable => (SetupTaskType::DropTable, ProgramTaskType::None),
            ProgramTaskType::CreateView => (SetupTaskType::DropView, ProgramTaskType::None),
            ProgramTaskType::CreateViz => (SetupTaskType::DropViz, ProgramTaskType::UpdateViz),
            ProgramTaskType::Import => (SetupTaskType::DropBlob, ProgramTaskType::None),
            ProgramTaskType::Input => (SetupTaskType::DropInput, ProgramTaskType::None),
            ProgramTaskType::Load => (SetupTaskType::DropTable, ProgramTaskType::None),
            ProgramTaskType::ModifyTable => (SetupTaskType::DropTable, ProgramTaskType::None),
            ProgramTaskType::Set => (SetupTaskType::Unset, ProgramTaskType::None),
            ProgramTaskType::UpdateViz => (SetupTaskType::DropViz, ProgramTaskType::UpdateViz),
        };

        // Is applicable?
        if ctx.program_task_applicability[prev_task_id] {
            // Map to new task.
            // Diff must be KEEP or MOVE since the previous task is applicable.
            let next_stmt_id = diff_op.target.unwrap_or_default();
            let next_task_id = next_tasks.program_task_by_statement[next_stmt_id];
            debug_assert!((diff_op.op_code == DiffOpCode::Keep) || (diff_op.op_code == DiffOpCode::Move));

            // Update the target id of the new task and mark it as complete
            let next_task = &mut next_tasks.program_tasks[next_task_id.unwrap()];
            next_task.task_status.set(TaskStatusCode::Completed);
            next_task.state_id = prev_task.state_id;
            continue;
        }

        // Is diffed as KEEP, MOVE or UPDATE and has defined UPDATE task?
        //
        // Only relevant for viz tasks at the moment.
        // (In which case the diff is actually never KEEP or MOVE but that doesn't matter)
        // A viz statement that was slightly adjusted will be diffed as UPDATE.
        // We don't want to drop and recreate the viz state in order to reuse the existing react component.
        if (update_task != ProgramTaskType::None)
            && (diff_op.op_code == DiffOpCode::Update
                || diff_op.op_code == DiffOpCode::Move
                || diff_op.op_code == DiffOpCode::Keep)
        {
            debug_assert!(diff_op.target.is_some());
            let next_stmt_id = diff_op.target.unwrap_or_default();
            let next_task_id = next_tasks.program_task_by_statement[next_stmt_id];
            debug_assert!(next_task_id.is_some()); // Applicability
            let next_task = &mut next_tasks.program_tasks[next_task_id.unwrap()];
            next_task.task_type = update_task;
            next_task.state_id = prev_task.state_id;
        }
        // Drop if there's a drop task defined
        else if drop_task != SetupTaskType::None {
            setup[prev_task_id] = Some(SetupTask {
                task_type: drop_task,
                task_status: Cell::new(TaskStatusCode::Pending),
                depends_on: prev_task.depends_on.clone(),
                required_for: Vec::new(),
                state_id: prev_task.state_id,
            });
        }
    }

    // Store setup tasks and remember mapping
    let mut task_mapping = Vec::new();
    task_mapping.resize(setup.len(), None);
    for (task_id, setup) in setup.drain(..).enumerate() {
        match setup {
            Some(task) => {
                if task.task_type == SetupTaskType::None {
                    continue;
                }
                task_mapping[task_id] = Some(next_tasks.setup_tasks.len());
                next_tasks.setup_tasks.push(task);
            }
            None => continue,
        }
    }

    // Patch all setup dependencies
    let patch_ids = |ids: &mut Vec<usize>| {
        let mut writer = 0;
        for i in 0..ids.len() {
            if let Some(mapped) = task_mapping[ids[i]] {
                ids[writer] = mapped;
                writer += 1;
            }
        }
        ids.truncate(writer);
    };
    for task in next_tasks.setup_tasks.iter_mut() {
        patch_ids(&mut task.required_for);
        patch_ids(&mut task.depends_on);
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
        program_task_applicability: Vec::new(),
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
    use duckdbx::DatabaseClient;

    use super::*;
    use crate::analyzer::analysis_settings::ProgramAnalysisSettings;
    use crate::analyzer::program_instance::analyze_program;
    use crate::execution::execution_context::ExecutionContext;
    use crate::execution::scalar_value::ScalarValue;
    use crate::grammar;
    use crate::runtime::create_runtime;
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
        let runtime = create_runtime();
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
            let prev_ast = grammar::parse(&prev_arena, prev.script)?;
            assert!(
                prev_ast.errors().is_none(),
                "{}",
                prev_ast.errors().unwrap().get(0).message().unwrap_or_default()
            );
            let prev_prog = Rc::new(grammar::deserialize_ast(&prev_arena, prev.script, prev_ast).unwrap());
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
            assert_eq!(have.setup_tasks, expected.setup_tasks);
            assert_eq!(have.program_tasks, expected.program_tasks);
            assert_eq!(have.program_task_by_statement, expected.program_task_by_statement);
        };

        // Instantiate next program
        let next_arena = bumpalo::Bump::new();
        let next_context = ExecutionContext::create(settings, runtime, database_instance.clone(), &next_arena);
        let next_instance = {
            let next_ast = grammar::parse(&next_arena, test.next.script)?;
            assert!(
                next_ast.errors().is_none(),
                "{}",
                next_ast.errors().unwrap().get(0).message().unwrap_or_default()
            );
            let next_prog = Rc::new(grammar::deserialize_ast(&next_arena, test.next.script, next_ast).unwrap());
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
        assert_eq!(have.setup_tasks, expected.setup_tasks);
        assert_eq!(have.program_tasks, expected.program_tasks);
        assert_eq!(have.program_task_by_statement, expected.program_task_by_statement);
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
                    setup_tasks: vec![],
                    program_tasks: vec![ProgramTask {
                        task_type: ProgramTaskType::Import,
                        task_status: Cell::new(TaskStatusCode::Skipped),
                        depends_on: vec![],
                        required_for: vec![],
                        origin_statement: 0,
                        state_id: 0,
                    }],
                    program_task_by_statement: vec![Some(0)],
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
                    setup_tasks: vec![],
                    program_tasks: vec![
                        ProgramTask {
                            task_type: ProgramTaskType::Import,
                            task_status: Cell::new(TaskStatusCode::Skipped),
                            depends_on: vec![],
                            required_for: vec![1],
                            origin_statement: 0,
                            state_id: 0,
                        },
                        ProgramTask {
                            task_type: ProgramTaskType::Load,
                            task_status: Cell::new(TaskStatusCode::Skipped),
                            depends_on: vec![0],
                            required_for: vec![],
                            origin_statement: 1,
                            state_id: 1,
                        },
                    ],
                    program_task_by_statement: vec![Some(0), Some(1)],
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
                    setup_tasks: vec![],
                    program_tasks: vec![
                        ProgramTask {
                            task_type: ProgramTaskType::Import,
                            task_status: Cell::new(TaskStatusCode::Skipped),
                            depends_on: vec![],
                            required_for: vec![1],
                            origin_statement: 0,
                            state_id: 0,
                        },
                        ProgramTask {
                            task_type: ProgramTaskType::Load,
                            task_status: Cell::new(TaskStatusCode::Skipped),
                            depends_on: vec![0],
                            required_for: vec![2],
                            origin_statement: 1,
                            state_id: 1,
                        },
                        ProgramTask {
                            task_type: ProgramTaskType::CreateAs,
                            task_status: Cell::new(TaskStatusCode::Skipped),
                            depends_on: vec![1],
                            required_for: vec![],
                            origin_statement: 2,
                            state_id: 2,
                        },
                    ],
                    program_task_by_statement: vec![Some(0), Some(1), Some(2)],
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
                    setup_tasks: vec![],
                    program_tasks: vec![
                        ProgramTask {
                            task_type: ProgramTaskType::Import,
                            task_status: Cell::new(TaskStatusCode::Pending),
                            depends_on: vec![],
                            required_for: vec![1],
                            origin_statement: 0,
                            state_id: 0,
                        },
                        ProgramTask {
                            task_type: ProgramTaskType::Load,
                            task_status: Cell::new(TaskStatusCode::Pending),
                            depends_on: vec![0],
                            required_for: vec![2],
                            origin_statement: 1,
                            state_id: 1,
                        },
                        ProgramTask {
                            task_type: ProgramTaskType::CreateAs,
                            task_status: Cell::new(TaskStatusCode::Pending),
                            depends_on: vec![1],
                            required_for: vec![3],
                            origin_statement: 2,
                            state_id: 2,
                        },
                        ProgramTask {
                            task_type: ProgramTaskType::CreateViz,
                            task_status: Cell::new(TaskStatusCode::Pending),
                            depends_on: vec![2],
                            required_for: vec![],
                            origin_statement: 3,
                            state_id: 3,
                        },
                    ],
                    program_task_by_statement: vec![Some(0), Some(1), Some(2), Some(3)],
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
                    setup_tasks: vec![],
                    program_tasks: vec![
                        ProgramTask {
                            task_type: ProgramTaskType::CreateAs,
                            task_status: Cell::new(TaskStatusCode::Pending),
                            depends_on: vec![],
                            required_for: vec![1],
                            origin_statement: 0,
                            state_id: 0,
                        },
                        ProgramTask {
                            task_type: ProgramTaskType::CreateViz,
                            task_status: Cell::new(TaskStatusCode::Pending),
                            depends_on: vec![0],
                            required_for: vec![],
                            origin_statement: 1,
                            state_id: 1,
                        },
                    ],
                    program_task_by_statement: vec![Some(0), Some(1)],
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
                    setup_tasks: vec![SetupTask {
                        task_type: SetupTaskType::DropTable,
                        task_status: Cell::new(TaskStatusCode::Pending),
                        depends_on: vec![],
                        required_for: vec![],
                        state_id: 0,
                    }],
                    program_tasks: vec![
                        ProgramTask {
                            task_type: ProgramTaskType::CreateAs,
                            task_status: Cell::new(TaskStatusCode::Pending),
                            depends_on: vec![],
                            required_for: vec![1],
                            origin_statement: 0,
                            state_id: 2,
                        },
                        ProgramTask {
                            task_type: ProgramTaskType::UpdateViz,
                            task_status: Cell::new(TaskStatusCode::Pending),
                            depends_on: vec![0],
                            required_for: vec![],
                            origin_statement: 1,
                            state_id: 1,
                        },
                    ],
                    program_task_by_statement: vec![Some(0), Some(1)],
                },
            },
        })
        .await
    }
}
