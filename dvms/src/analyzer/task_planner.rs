use serde::Serialize;
use std::error::Error;

use crate::grammar::{
    syntax::script_writer::{print_ast_as_script_with_defaults, ScriptTextConfig},
    Statement,
};

use super::program_analysis::ProgramAnalysis;

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
    pub depends_on: Vec<u32>,
    pub required_for: Vec<u32>,
    pub origin_statement: u32,
    pub object_id: u32,
    pub name_qualified: Option<String>,
    pub script: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskGraph {
    pub next_object_id: u32,
    pub setup_tasks: Vec<SetupTask>,
    pub program_tasks: Vec<ProgramTask>,
}

pub struct TaskPlannerContext {}

fn translate_statements<'a>(ctx: &mut ProgramAnalysis<'a>) -> Result<(), Box<dyn Error + Send + Sync>> {
    let config = ScriptTextConfig::default();
    let mut tasks: Vec<ProgramTask> = Vec::with_capacity(ctx.program.statements.len());

    for stmt_id in 0..ctx.program.statements.len() {
        let mixin = ProgramTask {
            task_type: ProgramTaskType::None,
            task_status_code: TaskStatusCode::Pending,
            depends_on: Vec::new(),
            required_for: Vec::new(),
            origin_statement: 0,
            object_id: 0,
            name_qualified: None,
            script: None,
        };
        let task = match &ctx.program.statements[stmt_id] {
            Statement::Create(c) => ProgramTask {
                task_type: ProgramTaskType::CreateTable,
                name_qualified: Some(print_ast_as_script_with_defaults(&c.name.get())),
                ..mixin
            },
            Statement::CreateAs(c) => ProgramTask {
                task_type: ProgramTaskType::CreateTable,
                name_qualified: Some(print_ast_as_script_with_defaults(&c.name.get())),
                ..mixin
            },
            Statement::CreateView(c) => ProgramTask {
                task_type: ProgramTaskType::CreateView,
                name_qualified: Some(print_ast_as_script_with_defaults(&c.name.get())),
                ..mixin
            },
            Statement::Input(i) => ProgramTask {
                task_type: ProgramTaskType::Input,
                name_qualified: Some(print_ast_as_script_with_defaults(&i.name.get())),
                ..mixin
            },
            Statement::Fetch(f) => ProgramTask {
                task_type: ProgramTaskType::Fetch,
                name_qualified: Some(print_ast_as_script_with_defaults(&f.name.get())),
                ..mixin
            },
            Statement::Load(l) => ProgramTask {
                task_type: ProgramTaskType::Load,
                name_qualified: Some(print_ast_as_script_with_defaults(&l.name.get())),
                ..mixin
            },
            Statement::Viz(l) => ProgramTask {
                task_type: ProgramTaskType::CreateViz,
                name_qualified: None,
                ..mixin
            },
            Statement::Select(s) => ProgramTask {
                task_type: ProgramTaskType::CreateTable,
                name_qualified: None,
                ..mixin
            },
            Statement::Set(s) => ProgramTask {
                task_type: ProgramTaskType::Set,
                name_qualified: None,
                ..mixin
            },
        };
    }
    Ok(())
}

fn identify_applicable_tasks<'a>(ctx: &mut ProgramAnalysis<'a>) -> Result<(), Box<dyn Error + Send + Sync>> {
    Ok(())
}

fn migrate_task_graph<'a>(ctx: &mut ProgramAnalysis<'a>) -> Result<(), Box<dyn Error + Send + Sync>> {
    Ok(())
}
