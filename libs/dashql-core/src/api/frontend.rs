use std::sync::Arc;

use crate::{
    analyzer::{program_instance::ProgramInstance, task::TaskStatusCode, task_graph::TaskGraph, viz_spec::VizSpec},
    grammar::ProgramContainer,
};

pub trait Frontend {
    fn flush_updates(self: &Arc<Self>, session_id: u32) -> Result<(), String>;
    fn update_program(self: &Arc<Self>, session_id: u32, text: &str, ast: &ProgramContainer) -> Result<(), String>;
    fn update_program_analysis(self: &Arc<Self>, session_id: u32, analysis: &ProgramInstance) -> Result<(), String>;
    fn update_task_graph(self: &Arc<Self>, session_id: u32, graph: &TaskGraph) -> Result<(), String>;
    fn update_task_status(
        self: &Arc<Self>,
        session_id: u32,
        task_id: u32,
        status: TaskStatusCode,
        error: Option<String>,
    ) -> Result<(), String>;
    fn delete_task_data(self: &Arc<Self>, session_id: u32, data_id: u32) -> Result<(), String>;
    fn update_input_data(self: &Arc<Self>, session_id: u32, data_id: u32) -> Result<(), String>;
    fn update_import_data(self: &Arc<Self>, session_id: u32, data_id: u32) -> Result<(), String>;
    fn update_table_data(self: &Arc<Self>, session_id: u32, data_id: u32) -> Result<(), String>;
    fn update_visualization_data(self: &Arc<Self>, session_id: u32, data_id: u32, viz: &VizSpec) -> Result<(), String>;
}
