use crate::{
    analyzer::{program_instance::ProgramInstance, task::TaskStatusCode, task_graph::TaskGraph, viz_spec::VizSpec},
    grammar::ProgramContainer,
};

pub trait Frontend {
    fn flush_updates(&self, session_id: u32) -> Result<(), String>;
    fn update_program(&self, session_id: u32, text: &str, ast: &ProgramContainer) -> Result<(), String>;
    fn update_program_analysis(&self, session_id: u32, analysis: &ProgramInstance) -> Result<(), String>;
    fn update_task_graph(&self, session_id: u32, graph: &TaskGraph) -> Result<(), String>;
    fn update_task_status(
        &self,
        session_id: u32,
        task_id: u32,
        status: TaskStatusCode,
        error: Option<String>,
    ) -> Result<(), String>;
    fn delete_task_data(&self, session_id: u32, data_id: u32) -> Result<(), String>;
    fn update_input_data(&self, session_id: u32, data_id: u32) -> Result<(), String>;
    fn update_import_data(&self, session_id: u32, data_id: u32) -> Result<(), String>;
    fn update_table_data(&self, session_id: u32, data_id: u32) -> Result<(), String>;
    fn update_visualization_data(&self, session_id: u32, data_id: u32, viz: &VizSpec) -> Result<(), String>;
}
