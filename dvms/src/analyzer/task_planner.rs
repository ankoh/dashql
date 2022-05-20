use super::program_analysis::ProgramAnalysis;
use serde::Serialize;
use std::error::Error;

use crate::grammar::{
    syntax::script_writer::{print_ast_as_script_with_defaults, ScriptTextConfig},
    Statement,
};

#[derive(Debug, Clone, Serialize)]
pub enum TaskClass {
    SetupTask,
    ProgramTask,
}

#[derive(Debug, Clone, Serialize)]
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
    DropSet,
    DropTable,
    DropView,
    DropViz,
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

#[derive(Debug, Clone, Serialize)]
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
    Transform,
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
    pub program_task_mapping: Vec<usize>,
}

pub struct TaskPlannerContext {}

fn translate_statements<'a>(
    ctx: &mut ProgramAnalysis<'a>,
    mut next_object_id: usize,
) -> Result<TaskGraph, Box<dyn Error + Send + Sync>> {
    let mut program_tasks: Vec<ProgramTask> = Vec::with_capacity(ctx.program.statements.len());
    let mut program_task_mapping: Vec<usize> = Vec::new();
    program_task_mapping.resize(ctx.program.statements.len(), usize::MAX);

    for stmt_id in 0..ctx.program.statements.len() {
        let mixin = ProgramTask {
            task_type: ProgramTaskType::None,
            task_status_code: if ctx.statement_liveness[stmt_id] {
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
        let task = match &ctx.program.statements[stmt_id] {
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
        program_task_mapping[stmt_id] = program_tasks.len();
        program_tasks.push(task);
    }

    // Store dependencies
    for ((a, b), _) in ctx.statement_depends_on.iter() {
        let a_mapped = program_task_mapping[*a];
        let b_mapped = program_task_mapping[*b];
        if a_mapped == usize::MAX || b_mapped == usize::MAX {
            continue;
        }
        program_tasks[a_mapped].depends_on.push(b_mapped);
        program_tasks[b_mapped].required_for.push(a_mapped);
    }

    Ok(TaskGraph {
        next_object_id,
        setup_tasks: Vec::new(),
        program_tasks,
        program_task_mapping,
    })
}

fn identify_applicable_tasks<'a>(ctx: &mut ProgramAnalysis<'a>) -> Result<(), Box<dyn Error + Send + Sync>> {
    Ok(())
}

fn migrate_task_graph<'a>(ctx: &mut ProgramAnalysis<'a>) -> Result<(), Box<dyn Error + Send + Sync>> {
    Ok(())
}
