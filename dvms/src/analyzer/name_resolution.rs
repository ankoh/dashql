use super::analysis_context::*;
use crate::grammar::{ASTNode, Indirection, Statement, TableRef};
use dashql_proto::syntax as sx;

fn normalize_name<'arena, 'text, 'ast>(
    ctx: &mut ProgramAnalysisContext<'arena, 'text, 'ast>,
    name: &'arena [Indirection<'text, 'arena>],
) -> &'arena [Indirection<'text, 'arena>]
where
    'text: 'arena,
{
    let mut path: [&'text str; 3] = [""; 3];
    let mut path_length = 0;
    for (i, elem) in name.iter().enumerate().take(3) {
        match elem {
            Indirection::Name(s) => {
                path[i] = s.clone();
                path_length += 1;
            }
            _ => break,
        }
    }
    let path = &path[0..path_length];
    if path.len() == 1 {
        let node: Indirection<'text, 'arena> = if let Some(schema) = ctx.cached_default_schema {
            Indirection::Name(schema)
        } else {
            let s = ctx.arena.alloc_str(&ctx.settings.default_schema);
            Indirection::Name(s)
        };
        ctx.arena.alloc_slice_clone(&[node, name[0].clone()])
    } else {
        name
    }
}

pub fn normalize_statement_names<'arena, 'text, 'ast>(ctx: &mut ProgramAnalysisContext<'arena, 'text, 'ast>)
where
    'text: 'arena,
{
    let prog = ctx.program_translated.clone();
    let stmts = &prog.statements;
    for (stmt_id, stmt) in stmts.iter().enumerate() {
        let name = match stmt {
            Statement::Create(create) => Some(normalize_name(ctx, create.name)),
            Statement::CreateView(view) => Some(normalize_name(ctx, view.name)),
            Statement::Fetch(fetch) => Some(normalize_name(ctx, fetch.name)),
            Statement::Load(load) => Some(normalize_name(ctx, load.name)),
            Statement::Input(input) => Some(normalize_name(ctx, input.name)),
            _ => None,
        };
        if let Some(name) = name {
            ctx.statement_names[stmt_id] = Some(name);
            ctx.statement_by_name.insert(name, stmt_id);
        }
    }
}

pub fn discover_statement_dependencies<'arena, 'text, 'ast>(ctx: &mut ProgramAnalysisContext<'arena, 'text, 'ast>)
where
    'text: 'arena,
{
    for (node_id, node_flat) in ctx.program_flat.nodes().unwrap_or_default().iter().enumerate() {
        let node_translated = &ctx.program_translated.nodes[node_id];
        match node_flat.node_type() {
            sx::NodeType::OBJECT_SQL_COLUMN_REF => {
                if let ASTNode::ColumnRef(name) = &node_translated {
                    let target = normalize_name(ctx, name);
                    if let Some(stmt) = ctx.statement_by_name.get(target) {
                        ctx.statement_deps.push(sx::DependencyT {
                            type_: sx::DependencyType::COLUMN_REF,
                            source_statement: *stmt as u32,
                            target_statement: 0, // XXX
                            target_node: node_id as u32,
                        });
                    }
                }
            }
            sx::NodeType::OBJECT_SQL_TABLEREF => {
                if let ASTNode::TableRef(TableRef::Relation(rel)) = &node_translated {
                    let target = normalize_name(ctx, rel.name);
                    if let Some(stmt) = ctx.statement_by_name.get(target) {
                        ctx.statement_deps.push(sx::DependencyT {
                            type_: sx::DependencyType::TABLE_REF,
                            source_statement: *stmt as u32,
                            target_statement: 0, // XXX
                            target_node: node_id as u32,
                        });
                    }
                }
            }
            _ => {}
        }
    }
}
