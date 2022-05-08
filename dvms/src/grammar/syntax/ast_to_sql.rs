use super::ast_nodes_dashql::*;
use super::ast_nodes_sql::*;
use super::sql_writer::*;

impl<'a> SQLWritable for Expression<'a> {
    fn as_sql<'writer, 'ast: 'writer>(&'ast self, w: &SQLWriter<'writer>) -> SQLText<'writer> {
        match self {
            Expression::Null => w.str_const("null"),
            Expression::Boolean(b) => {
                if *b {
                    w.str_const("true")
                } else {
                    w.str_const("false")
                }
            }
            Expression::Array(elems) => {
                let mut a = SQLTextArray::with_capacity(w, 3 * elems.len());
                for (i, e) in elems.iter().enumerate() {
                    if i > 0 {
                        a.push(w.str_const(","));
                        a.push(w.space());
                    }
                    a.push(e.as_sql(w));
                }
                w.round_brackets(a.finish())
            }
            Expression::Case(c) => {
                let mut f = SQLTextArray::with_capacity(w, 8 + 8 * c.cases.len());
                f.push(w.keyword("case"));
                if let Some(arg) = &c.argument {
                    f.push(w.space());
                    f.push(arg.as_sql(w));
                }
                f.push(w.space());
                for case in c.cases.iter() {
                    f.push(w.keyword("when"));
                    f.push(w.space());
                    f.push(case.when.as_sql(w));
                    f.push(w.space());
                    f.push(w.keyword("then"));
                    f.push(w.space());
                    f.push(case.then.as_sql(w));
                    f.push(w.space());
                }
                if let Some(default) = &c.default {
                    f.push(w.keyword("else"));
                    f.push(default.as_sql(w));
                    f.push(w.space());
                }
                f.push(w.keyword("end"));
                w.float(f.finish())
            }
            Expression::ColumnRef(name) => {
                let mut t = SQLTextArray::with_capacity(w, 5 * name.len());
                for (i, e) in name.iter().enumerate() {
                    match e {
                        Indirection::Name(n) => {
                            if i > 0 {
                                t.push(w.str_const("."));
                            }
                            t.push(w.str(n));
                        }
                        Indirection::Index(idx) => {
                            t.push(w.str_const("["));
                            t.push(idx.value.as_sql(w));
                            t.push(w.str_const("]"));
                        }
                        Indirection::Bounds(bounds) => {
                            t.push(w.str_const("["));
                            t.push(bounds.lower_bound.as_sql(w));
                            t.push(w.str_const(", "));
                            t.push(bounds.upper_bound.as_sql(w));
                            t.push(w.str_const("]"));
                        }
                    }
                }
                w.float(t.finish())
            }
            Expression::ConstCast(_) => todo!(),
            Expression::Exists(_) => todo!(),
            Expression::FunctionCall(_) => todo!(),
            Expression::Indirection(_) => todo!(),
            Expression::Nary(_) => todo!(),
            Expression::ParameterRef(_) => todo!(),
            Expression::SelectStatement(_) => todo!(),
            Expression::StringRef(s) => w.str(s.clone()),
            Expression::Subquery(_) => todo!(),
            Expression::TypeCast(_) => todo!(),
            Expression::TypeTest(_) => todo!(),
        }
    }
}
