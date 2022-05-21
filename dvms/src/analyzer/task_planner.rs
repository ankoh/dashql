use super::{
    program_diff::{compute_diff, DiffOp, DiffOpCode},
    program_instance::ProgramInstance,
};
use serde::Serialize;
use std::collections::HashSet;
use std::error::Error;

use crate::{
    grammar::{
        syntax::script_writer::{print_ast_as_script_with_defaults, ScriptTextConfig},
        Statement,
    },
    utils::topological_sort::TopologicalSort,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum TaskClass {
    SetupTask,
    ProgramTask,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum TaskStatusCode {
    Pending,
    Skipped,
    Running,
    Blocked,
    Failed,
    Completed,
}

impl Default for TaskStatusCode {
    fn default() -> Self {
        TaskStatusCode::Pending
    }
}

#[derive(Debug, Clone, Serialize)]
pub enum TaskBlocker {
    None,
    Dependency,
    UserInteraction,
    HttpRequest,
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
pub struct SetupTask {
    pub task_type: SetupTaskType,
    pub task_status_code: TaskStatusCode,
    pub depends_on: Vec<u32>,
    pub required_for: Vec<u32>,
    pub object_id: u32,
    pub name_qualified: u32,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
pub enum ProgramTaskType {
    None,
    CreateTable,
    CreateView,
    CreateViz,
    Fetch,
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

#[derive(Debug, Clone, Serialize)]
pub struct ProgramTask {
    pub task_type: ProgramTaskType,
    pub task_status_code: TaskStatusCode,
    pub depends_on: Vec<usize>,
    pub required_for: Vec<usize>,
    pub origin_statement: usize,
    pub object_id: usize,
    pub name_qualified: Option<String>,
    pub script: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskGraph {
    pub next_object_id: usize,
    pub setup_tasks: Vec<SetupTask>,
    pub program_tasks: Vec<ProgramTask>,
    pub program_task_by_statement: Vec<Option<usize>>,
}

#[derive(Debug)]
pub struct TaskPlannerContext<'a> {
    /// The next progra
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

fn translate_statements<'a>(ctx: &mut TaskPlannerContext<'a>) -> Result<TaskGraph, Box<dyn Error + Send + Sync>> {
    let next = ctx.next_program;
    let mut next_object_id = ctx.prev_program.map(|(_, t)| t.next_object_id).unwrap_or_default();

    let mut program_tasks: Vec<ProgramTask> = Vec::with_capacity(next.program.statements.len());
    let mut program_task_by_statement: Vec<Option<usize>> = Vec::new();
    program_task_by_statement.resize(next.program.statements.len(), None);

    for stmt_id in 0..next.program.statements.len() {
        let mixin = ProgramTask {
            task_type: ProgramTaskType::None,
            task_status_code: if next.statement_liveness[stmt_id] {
                TaskStatusCode::Pending
            } else {
                TaskStatusCode::Skipped
            },
            depends_on: Vec::new(),
            required_for: Vec::new(),
            origin_statement: stmt_id,
            object_id: next_object_id,
            name_qualified: None,
            script: None,
        };
        let task = match &next.program.statements[stmt_id] {
            Statement::Create(c) => ProgramTask {
                task_type: ProgramTaskType::CreateTable,
                name_qualified: Some(print_ast_as_script_with_defaults(&c.name.get())),
                script: Some(print_ast_as_script_with_defaults(*c)),
                ..mixin
            },
            Statement::CreateAs(c) => ProgramTask {
                task_type: ProgramTaskType::CreateTable,
                name_qualified: Some(print_ast_as_script_with_defaults(&c.name.get())),
                script: Some(print_ast_as_script_with_defaults(*c)),
                ..mixin
            },
            Statement::CreateView(c) => ProgramTask {
                task_type: ProgramTaskType::CreateView,
                name_qualified: Some(print_ast_as_script_with_defaults(&c.name.get())),
                script: Some(print_ast_as_script_with_defaults(*c)),
                ..mixin
            },
            Statement::Input(i) => ProgramTask {
                task_type: ProgramTaskType::Input,
                name_qualified: Some(print_ast_as_script_with_defaults(&i.name.get())),
                script: Some(print_ast_as_script_with_defaults(*i)),
                ..mixin
            },
            Statement::Fetch(f) => ProgramTask {
                task_type: ProgramTaskType::Fetch,
                name_qualified: Some(print_ast_as_script_with_defaults(&f.name.get())),
                script: Some(print_ast_as_script_with_defaults(*f)),
                ..mixin
            },
            Statement::Load(l) => ProgramTask {
                task_type: ProgramTaskType::Load,
                name_qualified: Some(print_ast_as_script_with_defaults(&l.name.get())),
                script: Some(print_ast_as_script_with_defaults(*l)),
                ..mixin
            },
            Statement::Viz(v) => ProgramTask {
                task_type: ProgramTaskType::CreateViz,
                name_qualified: None,
                script: Some(print_ast_as_script_with_defaults(*v)),
                ..mixin
            },
            Statement::Select(s) => ProgramTask {
                task_type: ProgramTaskType::CreateTable,
                name_qualified: None,
                script: Some(print_ast_as_script_with_defaults(*s)),
                ..mixin
            },
            Statement::Set(_) => ProgramTask {
                task_type: ProgramTaskType::Set,
                name_qualified: None,
                ..mixin
            },
        };
        next_object_id += 1;
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

    Ok(TaskGraph {
        next_object_id,
        setup_tasks: Vec::new(),
        program_tasks,
        program_task_by_statement,
    })
}

fn diff_programs<'a>(ctx: &mut TaskPlannerContext<'a>) -> Result<(), Box<dyn Error + Send + Sync>> {
    // Compute the diff
    let (prev_prog, prev_task) = match &mut ctx.prev_program {
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
            // let (drop_task, update_task, propagates) = match task.task_type {
            //     ProgramTaskType::None => (SetupTaskType::None, ProgramTaskType::None, false),
            //     ProgramTaskType::CreateTable => (SetupTaskType::DropTable, ProgramTaskType::None, true),
            //     ProgramTaskType::CreateView => (SetupTaskType::DropView, ProgramTaskType::None, true),
            //     ProgramTaskType::CreateViz => (SetupTaskType::DropViz, ProgramTaskType::UpdateViz, false),
            //     ProgramTaskType::Fetch => (SetupTaskType::DropBlob, ProgramTaskType::None, false),
            //     ProgramTaskType::Input => (SetupTaskType::DropInput, ProgramTaskType::None, false),
            //     ProgramTaskType::Load => (SetupTaskType::DropTable, ProgramTaskType::None, false),
            //     ProgramTaskType::ModifyTable => (SetupTaskType::DropTable, ProgramTaskType::None, true),
            //     ProgramTaskType::Set => (SetupTaskType::Unset, ProgramTaskType::None, false),
            //     ProgramTaskType::UpdateViz => (SetupTaskType::DropViz, ProgramTaskType::UpdateViz, false),
            // };

            // Propagates invalidation?
            let propagates = match task.task_type {
                ProgramTaskType::None => false,
                ProgramTaskType::CreateTable => true,
                ProgramTaskType::CreateView => true,
                ProgramTaskType::CreateViz => false,
                ProgramTaskType::Fetch => false,
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
        let (prev_task_id, prio) = pending_tasks.top().clone();
        pending_tasks.pop();

        // Decrement key of depending tasks
        let a = &prev_tasks.program_tasks[prev_task_id];
        for next in a.required_for.iter() {
            pending_tasks.decrement_key(next);
        }

        // Task not completed?
        // Irrelevant for the graph migration.
        if a.task_status_code != TaskStatusCode::Completed {
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
            _ => todo!(),
        }
    }

    Ok(())
}

fn migrate_task_graph<'a>(ctx: &mut ProgramInstance<'a>) -> Result<(), Box<dyn Error + Send + Sync>> {
    Ok(())
}
