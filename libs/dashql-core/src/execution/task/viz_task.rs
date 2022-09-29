use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task::Task;
use crate::analyzer::task_graph::TaskGraph;
use crate::api::workflow_frontend::WorkflowFrontend;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::execution::task_state::{TaskData, VizData};
use crate::execution::viz_composer::compose_viz_spec;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{Statement, TableRef, VizStatement};
use async_trait::async_trait;
use dashql_proto::{VizComponentType, VizComponentTypeModifier};
use serde_json as sj;
use std::collections::HashSet;
use std::ops::Shl;
use std::sync::RwLockReadGuard;

pub struct VegaVisTaskOperator<'exec, 'ast> {
    instance: &'exec ProgramInstance<'ast>,
    task_graph: &'exec TaskGraph,
    task: &'exec Task,
    statement: &'ast VizStatement<'ast>,
}

impl<'exec, 'ast> VegaVisTaskOperator<'exec, 'ast> {
    pub fn create(
        instance: &'exec ProgramInstance<'ast>,
        task_graph: &'exec TaskGraph,
        task_id: usize,
    ) -> Result<Self, SystemError> {
        let task = &task_graph.tasks[task_id];
        let stmt_id = task.origin_statement.unwrap();
        let stmt: &'ast VizStatement<'ast> = match instance.program.statements[stmt_id] {
            Statement::Viz(v) => v,
            _ => return Err(SystemError::InvalidStatementType("expected viz".to_string())),
        };
        Ok(Self {
            instance,
            task_graph: task_graph,
            task: task,
            statement: stmt,
        })
    }
}

#[async_trait(?Send)]
impl<'exec, 'ast> TaskOperator<'exec, 'ast> for VegaVisTaskOperator<'exec, 'ast> {
    async fn prepare<'snap>(
        &mut self,
        _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        _frontend: &WorkflowFrontend,
    ) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(
        &mut self,
        ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        frontend: &WorkflowFrontend,
    ) -> Result<(), SystemError> {
        let extra = match self.statement.extra.get().map(|e| e.as_json(ctx)) {
            Some(Ok(sj::Value::Object(extra))) => extra,
            Some(Err(e)) => return Err(e),
            _ => sj::Map::new(),
        };
        let data_lock: RwLockReadGuard<Option<TaskData>> = match self.statement.target.get() {
            TableRef::Relation(rel) => {
                let src = match self.instance.statement_by_name.get(rel.name.get()) {
                    Some(src) => *src,
                    None => {
                        let src_string = print_ast_as_script_with_defaults(&rel.name.get());
                        return Err(SystemError::Generic(src_string));
                    }
                };
                let src_task_id = self.task_graph.task_by_statement[src];
                let src_task = &self.task_graph.tasks[src_task_id];
                src_task.data.read().unwrap()
            }
            TableRef::Select(_) => {
                return Err(SystemError::NotImplemented(
                    "viz statements with embedded select clause".to_string(),
                ))
            }
            TableRef::Function(_) => {
                return Err(SystemError::NotImplemented(
                    "viz statements with embedded function call".to_string(),
                ))
            }
            TableRef::Join(_) => {
                return Err(SystemError::NotImplemented(
                    "viz statements with embedded top-level join".to_string(),
                ))
            }
        };
        let data = match data_lock.as_ref() {
            Some(data) => data,
            None => return Err(SystemError::Generic("missing input data for visualization".to_string())),
        };
        let component = self.statement.component_type.get().unwrap_or(VizComponentType::TABLE);
        let mut type_modifiers: HashSet<VizComponentTypeModifier> = Vec::new();
        let type_modifier_bitmap = self.statement.type_modifiers.get();
        for m in [VizComponentTypeModifier::STACKED, VizComponentTypeModifier::MULTI] {
            if (type_modifier_bitmap & (1_u32 << m.0)) != 0 {
                type_modifiers.push(m);
            }
        }
        let spec = compose_viz_spec(ctx, data, component, &type_modifiers, extra).await?;
        *self.task.data.write().unwrap() = Some(TaskData::VizData(VizData { spec: spec.clone() }));
        frontend.update_visualization_data(self.task.data_id as u32, spec);
        Ok(())
    }
}
