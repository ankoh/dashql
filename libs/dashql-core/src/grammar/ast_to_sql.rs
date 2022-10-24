use std::cell::Cell;
use std::sync::Mutex;

use crate::execution::constant_folding::is_constant_expression;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::grammar::SetStatement;

use super::ast_cell::*;
use super::ast_nodes_dashql::*;
use super::ast_nodes_sql::*;
use super::dson::*;
use super::program::*;
use super::script_writer::*;
use dashql_proto as proto;
use dashql_proto::ExpressionOperator;
use dashql_proto::KeyActionCommand;
use dashql_proto::KeyActionTrigger;
use dashql_proto::KeyMatch;
use dashql_proto::VizComponentTypeModifier;

impl<'ast> ToSQL<'ast> for Program<'ast> {
    fn to_sql<'writer>(
        &self,
        writer: &'writer ScriptWriter,
        filter: &dyn ToSQLExpressionFilter<'ast>,
    ) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(writer, self.statements.len());
        for stmt in self.statements.iter() {
            let mut inner = ScriptTextArray::with_capacity(writer, 2);
            inner.push(stmt.to_sql(writer, filter));
            inner.push(writer.str_const(";").pad_right());
            a.push(writer.float(inner.finish()));
        }
        writer.stack(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for CommonTableExpression<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 4);
        a.push(w.str(self.name.get()));
        if self.columns.get().len() > 0 {
            let mut cols = ScriptTextArray::with_capacity(w, 2 * self.columns.get().len());
            for (i, col) in self.columns.get().iter().enumerate() {
                if i > 0 {
                    cols.push(w.str(",").pad_right());
                }
                cols.push(w.str(col.get()));
            }
            a.push(w.round_brackets(cols.finish()).pad_left());
        }
        a.push(w.keyword("as").pad_left().pad_right());
        a.push(w.round_brackets_one(self.statement.get().to_sql(w, filter)).pad_left());
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for OrderSpecification<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 3);
        a.push(self.value.get().to_sql(w, filter));
        if let Some(dir) = self.direction.get() {
            a.push(
                match dir {
                    proto::OrderDirection::ASCENDING => w.keyword("asc"),
                    _ => w.keyword("desc"),
                }
                .pad_left(),
            );
        }
        if let Some(nulls) = self.null_rule.get() {
            a.push(
                match nulls {
                    proto::OrderNullRule::NULLS_FIRST => w.keyword("nulls first"),
                    _ => w.keyword("nulls last"),
                }
                .pad_left(),
            );
        }
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for Limit<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        w.float(w.alloc_slice(&[
            w.keyword("limit").pad_right(),
            match self {
                Limit::ALL => w.keyword("all"),
                Limit::Expression(e) => e.to_sql(w, filter),
            },
        ]))
    }
}

impl<'ast> ToSQL<'ast> for DsonKey<'ast> {
    fn to_sql<'writer>(
        &self,
        w: &'writer ScriptWriter,
        _filter: &dyn ToSQLExpressionFilter<'ast>,
    ) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        match self {
            DsonKey::Known(_k) => w.str(self.as_str()),
            DsonKey::Unknown(k) => w.single_quotes(w.str(k)),
        }
    }
}

impl<'ast> ToSQL<'ast> for DsonValue<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        match self {
            DsonValue::Object(fields) => {
                let mut entries = ScriptTextArray::with_capacity(w, fields.len());
                for (i, field) in fields.iter().enumerate() {
                    let mut kv = ScriptTextArray::with_capacity(w, 4);
                    if i > 0 {
                        kv.push(w.str_const(",").pad_right());
                    }
                    kv.push(field.key.to_sql(w, filter).breakpoint_before());
                    kv.push(w.str_const("=").pad_left());
                    kv.push(field.value.to_sql(w, filter).pad_left());
                    entries.push(w.float(kv.finish()))
                }
                w.round_brackets(entries.finish())
            }
            DsonValue::Array(vs) => {
                let mut a = ScriptTextArray::with_capacity(w, vs.len());
                for (i, v) in vs.iter().enumerate() {
                    let mut elem = ScriptTextArray::with_capacity(w, 4);
                    if i > 0 {
                        elem.push(w.str_const(",").pad_right());
                    }
                    elem.push(v.to_sql(w, filter).breakpoint_before());
                    a.push(w.float(elem.finish()))
                }
                w.square_brackets(a.finish())
            }
            DsonValue::Expression(e) => e.to_sql(w, filter),
        }
    }
}

impl<'ast> ToSQL<'ast> for Alias<'ast> {
    fn to_sql<'writer>(
        &self,
        w: &'writer ScriptWriter,
        _filter: &dyn ToSQLExpressionFilter<'ast>,
    ) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 1);
        a.push(w.str(self.name.get()));
        // todo: column defs
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for RelationRef<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 3);
        if !self.inherit.get() {
            a.push(w.keyword("only").pad_right());
        }
        a.push(self.name.get().to_sql(w, filter));
        if let Some(alias) = self.alias.get() {
            a.push(alias.to_sql(w, filter).pad_left())
        }
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for JoinedTable<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 8);
        a.push(self.input.get()[0].get().to_sql(w, filter));
        if (self.join.get().0 & proto::JoinType::NATURAL_.0) != 0_u8 {
            a.push(w.keyword("natural").pad_left());
        }
        match proto::JoinType(self.join.get().0 & (proto::JoinType::OUTER_.0 - 1)) {
            proto::JoinType::NONE => a.push(w.keyword("cross").pad_left()),
            proto::JoinType::INNER => {}
            proto::JoinType::FULL => a.push(w.keyword("full").pad_left()),
            proto::JoinType::LEFT => a.push(w.keyword("left").pad_left()),
            proto::JoinType::RIGHT => a.push(w.keyword("right").pad_left()),
            _ => {}
        }
        if (self.join.get().0 & proto::JoinType::OUTER_.0) != 0_u8 {
            a.push(w.keyword("outer").pad_left());
        }
        a.push(w.keyword("join").pad_left());
        a.push(self.input.get()[1].get().to_sql(w, filter).pad_left());
        match &self.qualifier.get() {
            Some(JoinQualifier::On(expr)) => {
                a.push(w.keyword("on").pad_left());
                a.push(expr.to_sql(w, filter).pad_left());
            }
            Some(JoinQualifier::Using(cols)) => {
                a.push(w.keyword("using").pad_left());
                let mut using = ScriptTextArray::with_capacity(w, cols.len() * 3);
                for (i, col) in cols.iter().enumerate() {
                    if i > 0 {
                        using.push(w.str_const(",").pad_right());
                    }
                    using.push(w.str(col.get()));
                }
                a.push(w.round_brackets(using.finish()).pad_left());
            }
            _ => {}
        }
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for JoinedTableRef<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 2);
        a.push(self.table.get().to_sql(w, filter));
        if let Some(alias) = self.alias.get() {
            a.push(alias.to_sql(w, filter).pad_left());
        }
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for TableRef<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        match self {
            TableRef::Relation(rel) => rel.to_sql(w, filter),
            TableRef::Join(joined) => joined.to_sql(w, filter),
            _ => todo!(),
        }
    }
}

impl<'ast> ToSQL<'ast> for ResultTarget<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        match self {
            ResultTarget::Star => w.str_const("*"),
            ResultTarget::Value { value, alias } => {
                let mut a = ScriptTextArray::with_capacity(w, 2);
                a.push(value.get().to_sql(w, filter));
                if let Some(alias) = alias.get() {
                    a.push(w.str(alias).pad_left());
                }
                w.float(a.finish())
            }
        }
    }
}

impl<'ast> ToSQL<'ast> for SelectFromStatement<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 3 + self.targets.get().len() * 3 + self.from.get().len() * 3 + 2);
        a.push(w.keyword("select").breakpoint_before());
        for (i, target) in self.targets.get().iter().enumerate() {
            if i > 0 {
                a.push(w.str_const(","));
            }
            a.push(target.get().to_sql(w, filter).pad_left());
        }
        if !self.from.get().is_empty() {
            a.push(w.keyword("from").pad_left().breakpoint_before());
            for (i, table) in self.from.get().iter().enumerate() {
                if i > 0 {
                    a.push(w.str_const(","));
                }
                a.push(table.get().to_sql(w, filter).pad_left().breakpoint_before());
            }
        }
        let where_clause = self.where_clause.get();
        if where_clause != Expression::Null {
            a.push(w.keyword("where").pad_left().breakpoint_before());
            a.push(where_clause.to_sql(w, filter).pad_left());
        }
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for CombineOperation<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 4);
        let input = self.input.get();
        a.push(input[0].get().to_sql(w, filter));
        match self.operation.get() {
            proto::CombineOperation::UNION => a.push(w.keyword("union").pad_left()),
            proto::CombineOperation::EXCEPT => a.push(w.keyword("except").pad_left()),
            proto::CombineOperation::INTERSECT => a.push(w.keyword("intersect").pad_left()),
            _ => (),
        }
        match self.modifier.get() {
            proto::CombineModifier::ALL => a.push(w.keyword("all").pad_left()),
            proto::CombineModifier::DISTINCT => a.push(w.keyword("distinct").pad_left()),
            _ => (),
        }
        a.push(input[1].get().to_sql(w, filter).pad_left());
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for SelectStatement<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 6 + 2 * self.order_by.get().len());
        match &self.data {
            SelectData::From(from) => a.push(from.to_sql(w, filter)),
            SelectData::Combine(c) => a.push(c.to_sql(w, filter)),
            SelectData::Table(t) => a.push(t.get().to_sql(w, filter)),
            SelectData::Values(tuples) => {
                let tuples = tuples.get();
                let mut va = ScriptTextArray::with_capacity(w, 2 * tuples.len());
                va.push(w.keyword("values"));
                for (i, tuple) in tuples.iter().enumerate() {
                    let tuple = tuple.get();
                    let mut ta = ScriptTextArray::with_capacity(w, 2 * tuple.len());
                    for (i, value) in tuple.iter().enumerate() {
                        if i > 0 {
                            ta.push(w.keyword(",").pad_right());
                        }
                        ta.push(value.get().to_sql(w, filter));
                    }
                    if i > 0 {
                        va.push(w.keyword(","));
                    }
                    va.push(w.round_brackets(ta.finish()).pad_left());
                }
                a.push(w.float(va.finish()));
            }
        }
        if !self.order_by.get().is_empty() {
            a.push(w.keyword("order").pad_left());
            a.push(w.keyword("by").pad_left());
            for (i, constraint) in self.order_by.get().iter().enumerate() {
                if i > 0 {
                    a.push(w.str_const(","));
                }
                a.push(constraint.get().to_sql(w, filter).pad_left());
            }
        }
        if let Some(limit) = self.limit.get() {
            a.push(limit.to_sql(w, filter).pad_left());
        }
        let offset = self.offset.get();
        if offset != Expression::Null {
            a.push(w.keyword("offset").pad_left());
            a.push(offset.to_sql(w, filter).pad_left());
        }
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for GenericOption<'ast> {
    fn to_sql<'writer>(
        &self,
        w: &'writer ScriptWriter,
        _filter: &dyn ToSQLExpressionFilter<'ast>,
    ) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut kv = ScriptTextArray::with_capacity(w, 3);
        kv.push(w.str(self.key.get()));
        kv.push(w.str(self.value.get()).pad_left());
        w.float(kv.finish())
    }
}

impl<'ast> ToSQL<'ast> for SQLType<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let write_modifiers = |out: &mut ScriptTextArray<'writer>, modifiers: &'ast [ASTCell<Expression<'ast>>]| {
            if modifiers.is_empty() {
                return;
            }
            let mut m = ScriptTextArray::with_capacity(w, 2 * modifiers.len());
            for (i, modifier) in modifiers.iter().enumerate() {
                if i > 0 {
                    m.push(w.keyword(",").pad_right());
                }
                m.push(modifier.get().to_sql(w, filter));
            }
            out.push(w.round_brackets(m.finish()));
        };
        let mut a = ScriptTextArray::with_capacity(w, 6);
        match self.base_type.get() {
            SQLBaseType::Invalid => a.push(w.keyword("invalid")),
            SQLBaseType::Bit(t) => {
                a.push(w.keyword("bit"));
                if t.varying.get() {
                    a.push(w.keyword("varying").pad_left());
                }
                if let Some(length) = t.length.get() {
                    let mut l = ScriptTextArray::with_capacity(w, 1);
                    l.push(length.to_sql(w, filter));
                    a.push(w.round_brackets(l.finish()));
                }
            }
            SQLBaseType::Generic(t) => {
                a.push(w.str(t.name.get()));
                write_modifiers(&mut a, t.modifiers.get());
            }
            SQLBaseType::Numeric(t) => {
                match t.base.get() {
                    proto::NumericType::BOOL => a.push(w.keyword("bool")),
                    proto::NumericType::INT1 => a.push(w.keyword("tinyint")),
                    proto::NumericType::INT2 => a.push(w.keyword("smallint")),
                    proto::NumericType::INT4 => a.push(w.keyword("integer")),
                    proto::NumericType::INT8 => a.push(w.keyword("bigint")),
                    proto::NumericType::FLOAT4 => a.push(w.keyword("float")),
                    proto::NumericType::FLOAT8 => a.push(w.keyword("double")),
                    proto::NumericType::NUMERIC => a.push(w.keyword("numeric")),
                    _ => (),
                }
                write_modifiers(&mut a, t.modifiers.get());
            }
            SQLBaseType::Character(t) => {
                let base = t.base.get();
                match base {
                    proto::CharacterType::VARCHAR => a.push(w.keyword("varchar")),
                    proto::CharacterType::BLANK_PADDED_CHAR => a.push(w.keyword("char")),
                    _ => (),
                }
                if let Some(length) = t.length.get() {
                    // XXX lengths are stored as stringref, use const uint in ast
                    a.push(w.round_brackets_one(length.to_sql(w, filter)));
                }
            }
            SQLBaseType::Time(t) => {
                a.push(w.keyword("time"));
                if let Some(precision) = t.precision.get() {
                    // XXX lengths are stored as stringref, use const uint in ast
                    a.push(w.round_brackets_one(w.str(precision)));
                }
                if t.with_timezone.get() {
                    a.push(w.keyword("with").pad_left());
                    a.push(w.keyword("time").pad_left());
                    a.push(w.keyword("zone").pad_left());
                }
            }
            SQLBaseType::Timestamp(t) => {
                a.push(w.keyword("timestamp"));
                if let Some(precision) = t.precision.get() {
                    // XXX lengths are stored as stringref, use const uint in ast
                    a.push(w.round_brackets_one(w.str(precision)));
                }
                if t.with_timezone.get() {
                    a.push(w.keyword("with").pad_left());
                    a.push(w.keyword("time").pad_left());
                    a.push(w.keyword("zone").pad_left());
                }
            }
            SQLBaseType::Interval(t) => {
                if let Some(it) = t.interval_type.get() {
                    match it {
                        proto::IntervalType::DAY => a.push(w.keyword("day")),
                        proto::IntervalType::YEAR => a.push(w.keyword("year")),
                        proto::IntervalType::MONTH => a.push(w.keyword("month")),
                        proto::IntervalType::HOUR => a.push(w.keyword("hour")),
                        proto::IntervalType::MINUTE => a.push(w.keyword("minute")),
                        proto::IntervalType::SECOND => {
                            a.push(w.keyword("second"));
                            if let Some(precision) = t.precision.get() {
                                a.push(w.round_brackets_one(w.str(precision)));
                            }
                        }
                        proto::IntervalType::YEAR_TO_MONTH => {
                            a.push(w.keyword("year"));
                            a.push(w.keyword("to").pad_left());
                            a.push(w.keyword("month").pad_left());
                        }
                        proto::IntervalType::DAY_TO_HOUR => {
                            a.push(w.keyword("day"));
                            a.push(w.keyword("to").pad_left());
                            a.push(w.keyword("hour").pad_left());
                        }
                        proto::IntervalType::DAY_TO_SECOND => {
                            a.push(w.keyword("day"));
                            a.push(w.keyword("to").pad_left());
                            a.push(w.keyword("second").pad_left());
                            if let Some(precision) = t.precision.get() {
                                a.push(w.round_brackets_one(w.str(precision)));
                            }
                        }
                        proto::IntervalType::HOUR_TO_MINUTE => {
                            a.push(w.keyword("hour"));
                            a.push(w.keyword("to").pad_left());
                            a.push(w.keyword("minute").pad_left());
                        }
                        proto::IntervalType::HOUR_TO_SECOND => {
                            a.push(w.keyword("hour"));
                            a.push(w.keyword("to").pad_left());
                            a.push(w.keyword("second").pad_left());
                            if let Some(precision) = t.precision.get() {
                                a.push(w.round_brackets_one(w.str(precision)));
                            }
                        }
                        proto::IntervalType::MINUTE_TO_SECOND => {
                            a.push(w.keyword("minute"));
                            a.push(w.keyword("to").pad_left());
                            a.push(w.keyword("second").pad_left());
                            if let Some(precision) = t.precision.get() {
                                a.push(w.round_brackets_one(w.str(precision)));
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for proto::ConstraintAttribute {
    fn to_sql<'writer>(
        &self,
        w: &'writer ScriptWriter,
        _filter: &dyn ToSQLExpressionFilter<'ast>,
    ) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        match *self {
            proto::ConstraintAttribute::DEFERRABLE => w.keyword("deferrable"),
            proto::ConstraintAttribute::NOT_DEFERRABLE => {
                let mut a = ScriptTextArray::with_capacity(w, 2);
                a.push(w.keyword("not"));
                a.push(w.keyword("deferrable").pad_left());
                w.float(a.finish())
            }
            proto::ConstraintAttribute::INITIALLY_DEFERRED => {
                let mut a = ScriptTextArray::with_capacity(w, 2);
                a.push(w.keyword("initially"));
                a.push(w.keyword("deferred").pad_left());
                w.float(a.finish())
            }
            proto::ConstraintAttribute::INITIALLY_IMMEDIATE => {
                let mut a = ScriptTextArray::with_capacity(w, 2);
                a.push(w.keyword("initially"));
                a.push(w.keyword("immediate").pad_left());
                w.float(a.finish())
            }
            _ => w.float(&[]),
        }
    }
}

impl<'ast> ToSQL<'ast> for GenericDefinition<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 3);
        a.push(w.str(self.key.get()));
        a.push(w.keyword("=").pad_left());
        a.push(self.value.get().to_sql(w, filter));
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for ColumnConstraintSpec<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 8);
        if let Some(name) = self.constraint_name.get() {
            a.push(w.keyword("constraint"));
            a.push(w.str(name).pad_left().pad_right());
        }
        let write_definition = |out: &mut ScriptTextArray<'writer>,
                                args: &'ast [ASTCell<&'ast GenericDefinition<'ast>>]| {
            if args.is_empty() {
                return;
            }
            let mut defs: ScriptTextArray<'writer> = ScriptTextArray::with_capacity(w, 2 * args.len());
            for (i, arg) in args.iter().enumerate() {
                let arg = arg.get();
                if i > 0 {
                    defs.push(w.keyword(",").pad_right());
                }
                defs.push(arg.to_sql(w, filter));
            }
            out.push(w.float(defs.finish()).pad_left());
        };
        match self.constraint_type.get() {
            proto::ColumnConstraint::NOT_NULL => {
                a.push(w.keyword("not"));
                a.push(w.keyword("null").pad_left());
            }
            proto::ColumnConstraint::NULL_ => {
                a.push(w.keyword("null"));
            }
            proto::ColumnConstraint::CHECK => {
                a.push(w.keyword("check"));
                a.push(w.round_brackets_one(self.value.get().to_sql(w, filter)).pad_left());
                if self.no_inherit.get() {
                    a.push(w.keyword("no").pad_left());
                    a.push(w.keyword("inherit").pad_left());
                }
            }
            proto::ColumnConstraint::COLLATE => {
                a.push(w.keyword("collate"));
                for c in self.collate.get().iter() {
                    a.push(w.str(c.get()).pad_left());
                }
            }
            proto::ColumnConstraint::PRIMARY_KEY => {
                a.push(w.keyword("primary"));
                a.push(w.keyword("key").pad_left());
                write_definition(&mut a, self.definition.get());
            }
            proto::ColumnConstraint::UNIQUE => {
                a.push(w.keyword("unique"));
                write_definition(&mut a, self.definition.get());
            }
            proto::ColumnConstraint::DEFAULT => {
                a.push(w.keyword("default"));
                a.push(self.value.get().to_sql(w, filter).pad_left());
            }
            _ => (),
        }
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for ColumnConstraintVariant<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        match &self {
            ColumnConstraintVariant::Attribute(a) => a.to_sql(w, filter),
            ColumnConstraintVariant::Constraint(c) => c.to_sql(w, filter),
        }
    }
}

impl<'ast> ToSQL<'ast> for ColumnDefinition<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 5);
        a.push(w.str(self.name.get()));
        a.push(self.sql_type.get().to_sql(w, filter).pad_left());
        let constraints = self.constraints.get();
        for constraint in constraints.iter() {
            a.push(constraint.get().to_sql(w, filter).pad_left());
        }
        let options = self.options.get();
        if !options.is_empty() {
            let mut oa = ScriptTextArray::with_capacity(w, 2 * options.len());
            for (i, option) in options.iter().enumerate() {
                if i > 0 {
                    oa.push(w.keyword(","));
                }
                oa.push(option.get().to_sql(w, filter).pad_left());
            }
            a.push(w.round_brackets(oa.finish()));
        }
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for TableConstraintSpec<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 12);
        match self.constraint_type.get() {
            proto::TableConstraint::CHECK => {
                a.push(w.keyword("check"));
            }
            proto::TableConstraint::FOREIGN_KEY => {
                a.push(w.keyword("foreign"));
                a.push(w.keyword("key").pad_left());
            }
            proto::TableConstraint::PRIMARY_KEY => {
                a.push(w.keyword("primary"));
                a.push(w.keyword("key").pad_left());
            }
            proto::TableConstraint::UNIQUE => {
                a.push(w.keyword("unique"));
            }
            _ => {}
        }
        if let Some(expr) = self.argument.get() {
            a.push(w.round_brackets_one(expr.to_sql(w, filter)).pad_left());
        }
        if let Some(idx) = self.using_index.get() {
            a.push(w.keyword("using").pad_left());
            a.push(w.keyword("index").pad_left());
            a.push(w.str(idx).pad_left());
        }
        let columns = self.columns.get();
        if !columns.is_empty() {
            let mut column_txt = ScriptTextArray::with_capacity(w, 2 * columns.len());
            for (i, col) in columns.iter().enumerate() {
                if i > 0 {
                    column_txt.push(w.keyword(",").pad_right());
                }
                column_txt.push(w.str(col.get()));
            }
            a.push(w.round_brackets(column_txt.finish()).pad_left());
        }
        let ref_name = self.references_name.get();
        if !ref_name.is_empty() {
            a.push(w.keyword("references").pad_left());
            a.push(ref_name.to_sql(w, filter).pad_left());
            let ref_cols = self.references_columns.get();
            if !ref_cols.is_empty() {
                let mut txt = ScriptTextArray::with_capacity(w, 2 * ref_cols.len());
                for (i, col) in ref_cols.iter().enumerate() {
                    if i > 0 {
                        txt.push(w.keyword(",").pad_left());
                    }
                    txt.push(w.str(col.get()).pad_left());
                }
                a.push(w.round_brackets(txt.finish()).pad_left());
            }
        }
        let definition = self.definition.get();
        if !definition.is_empty() {
            a.push(w.keyword("with").pad_left());
            let mut def_text = ScriptTextArray::with_capacity(w, definition.len());
            for (i, def) in definition.iter().enumerate() {
                let def = def.get();
                if i > 0 {
                    def_text.push(w.keyword(",").pad_right());
                }
                def_text.push(def.to_sql(w, filter));
            }
            a.push(w.round_brackets(def_text.finish()).pad_left())
        }
        let attributes = self.attributes.get();
        if !attributes.is_empty() {
            for attr in attributes.iter() {
                let attr = attr.get();
                match attr.0 {
                    proto::ConstraintAttribute::DEFERRABLE => a.push(w.keyword("deferrable").pad_left()),
                    proto::ConstraintAttribute::NOT_DEFERRABLE => {
                        a.push(w.keyword("not").pad_left());
                        a.push(w.keyword("deferrable").pad_left());
                    }
                    proto::ConstraintAttribute::INITIALLY_DEFERRED => {
                        a.push(w.keyword("initially").pad_left());
                        a.push(w.keyword("deferred").pad_left());
                    }
                    proto::ConstraintAttribute::INITIALLY_IMMEDIATE => {
                        a.push(w.keyword("initially").pad_left());
                        a.push(w.keyword("immediate").pad_left());
                    }
                    proto::ConstraintAttribute::NOT_VALID => {
                        a.push(w.keyword("not").pad_left());
                        a.push(w.keyword("valid").pad_left());
                    }
                    proto::ConstraintAttribute::NO_INHERIT => {
                        a.push(w.keyword("no").pad_left());
                        a.push(w.keyword("inherit").pad_left());
                    }
                    _ => {}
                }
            }
        }
        if let Some(key_match) = self.key_match.get() {
            match key_match {
                KeyMatch::FULL => {
                    a.push(w.keyword("match").pad_left());
                    a.push(w.keyword("full").pad_left());
                }
                KeyMatch::PARTIAL => {
                    a.push(w.keyword("match").pad_left());
                    a.push(w.keyword("partial").pad_left());
                }
                KeyMatch::SIMPLE => {
                    a.push(w.keyword("match").pad_left());
                    a.push(w.keyword("simple").pad_left());
                }
                _ => {}
            }
        }
        let key_actions = self.key_actions.get();
        if !key_actions.is_empty() {
            let mut txt = ScriptTextArray::with_capacity(w, 4 * key_actions.len());
            for action in self.key_actions.get().iter() {
                let action = action.get();
                match action.trigger.get() {
                    KeyActionTrigger::DELETE => {
                        txt.push(w.keyword("on").pad_left());
                        txt.push(w.keyword("delete").pad_left());
                    }
                    KeyActionTrigger::UPDATE => {
                        txt.push(w.keyword("on").pad_left());
                        txt.push(w.keyword("update").pad_left());
                    }
                    _ => {}
                }
                match action.command.get() {
                    KeyActionCommand::CASCADE => txt.push(w.keyword("cascade").pad_left()),
                    KeyActionCommand::RESTRICT => txt.push(w.keyword("restrict").pad_left()),
                    KeyActionCommand::NO_ACTION => {
                        txt.push(w.keyword("no").pad_left());
                        txt.push(w.keyword("action").pad_left());
                    }
                    KeyActionCommand::SET_DEFAULT => {
                        txt.push(w.keyword("set").pad_left());
                        txt.push(w.keyword("default").pad_left());
                    }
                    KeyActionCommand::SET_NULL => {
                        txt.push(w.keyword("set").pad_left());
                        txt.push(w.keyword("null").pad_left());
                    }
                    _ => {}
                }
            }
            a.push(w.float(txt.finish()));
        }
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for CreateStatement<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 12);
        a.push(w.keyword("create"));
        match self.temp.get() {
            Some(proto::TempType::DEFAULT) | Some(proto::TempType::LOCAL) => {
                a.push(w.keyword("temp").pad_left());
            }
            Some(proto::TempType::GLOBAL) => {
                a.push(w.keyword("global").pad_left());
                a.push(w.keyword("temp").pad_left());
            }
            Some(proto::TempType::UNLOGGED) => {
                a.push(w.keyword("unlogged").pad_left());
            }
            Some(_) => {}
            None => todo!(),
        }
        a.push(w.keyword("table").pad_left());
        a.push(self.name.get().to_sql(w, filter).pad_left());
        let columns = self.columns.get();
        let constraints = self.constraints.get();
        let mut elements = ScriptTextArray::with_capacity(w, 2 * columns.len() + 2 * constraints.len());
        for column in columns.iter() {
            let column = column.get();
            if elements.len() > 0 {
                elements.push(w.keyword(",").pad_right());
            }
            elements.push(column.to_sql(w, filter).breakpoint_before());
        }
        for constraint in constraints.iter() {
            let constraint = constraint.get();
            if elements.len() > 0 {
                elements.push(w.keyword(",").pad_right());
            }
            elements.push(constraint.to_sql(w, filter).breakpoint_before());
        }
        a.push(w.round_brackets(elements.finish()).pad_left());
        if let Some(on_commit) = self.on_commit.get() {
            match on_commit {
                proto::OnCommitOption::DROP => {
                    a.push(w.keyword("on").pad_left());
                    a.push(w.keyword("commit").pad_left());
                    a.push(w.keyword("drop").pad_left());
                }
                proto::OnCommitOption::DELETE_ROWS => {
                    a.push(w.keyword("on").pad_left());
                    a.push(w.keyword("commit").pad_left());
                    a.push(w.keyword("delete").pad_left());
                    a.push(w.keyword("rows").pad_left());
                }
                proto::OnCommitOption::PRESERVE_ROWS => {
                    a.push(w.keyword("on").pad_left());
                    a.push(w.keyword("commit").pad_left());
                    a.push(w.keyword("preserve").pad_left());
                    a.push(w.keyword("rows").pad_left());
                }
                _ => (),
            }
        }
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for CreateAsStatement<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 14);
        a.push(w.keyword("create"));
        match self.temp.get() {
            Some(proto::TempType::DEFAULT) | Some(proto::TempType::LOCAL) => {
                a.push(w.keyword("temp").pad_left());
            }
            Some(proto::TempType::GLOBAL) => {
                a.push(w.keyword("global").pad_left());
                a.push(w.keyword("temp").pad_left());
            }
            Some(proto::TempType::UNLOGGED) => {
                a.push(w.keyword("unlogged").pad_left());
            }
            Some(_) => {}
            None => todo!(),
        }
        a.push(w.keyword("table").pad_left());
        if self.if_not_exists.get() {
            a.push(w.keyword("if").pad_left());
            a.push(w.keyword("not").pad_left());
            a.push(w.keyword("exists").pad_left());
        }
        a.push(self.name.get().to_sql(w, filter).pad_left());
        let cols = self.columns.get();
        if cols.len() > 0 {
            let mut c = ScriptTextArray::with_capacity(w, cols.len() + 2);
            for (i, col) in cols.iter().enumerate() {
                if i > 0 {
                    c.push(w.str_const(",").pad_right());
                }
                c.push(w.str(col.get()));
            }
            a.push(w.round_brackets(c.finish()).pad_left());
        }
        if let Some(on_commit) = self.on_commit.get() {
            match on_commit {
                proto::OnCommitOption::NOOP => {}
                proto::OnCommitOption::DROP => {
                    a.push(w.keyword("on").pad_left());
                    a.push(w.keyword("commit").pad_left());
                    a.push(w.keyword("drop").pad_left());
                }
                proto::OnCommitOption::DELETE_ROWS => {
                    a.push(w.keyword("on").pad_left());
                    a.push(w.keyword("commit").pad_left());
                    a.push(w.keyword("delete").pad_left());
                    a.push(w.keyword("rows").pad_left());
                }
                proto::OnCommitOption::PRESERVE_ROWS => {
                    a.push(w.keyword("on").pad_left());
                    a.push(w.keyword("commit").pad_left());
                    a.push(w.keyword("preserve").pad_left());
                    a.push(w.keyword("rows").pad_left());
                }
                _ => (),
            }
        }
        a.push(w.keyword("as").pad_left());
        a.push(w.round_brackets_one(self.statement.get().to_sql(w, filter)).pad_left());
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for CreateViewStatement<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 8);
        a.push(w.keyword("create"));
        match self.temp.get() {
            Some(proto::TempType::DEFAULT) | Some(proto::TempType::LOCAL) => {
                a.push(w.keyword("temp").pad_left());
            }
            Some(proto::TempType::GLOBAL) => {
                a.push(w.keyword("global").pad_left());
                a.push(w.keyword("temp").pad_left());
            }
            Some(proto::TempType::UNLOGGED) => {
                a.push(w.keyword("unlogged").pad_left());
            }
            Some(_) => {}
            None => todo!(),
        }
        a.push(w.keyword("view").pad_left());
        a.push(self.name.get().to_sql(w, filter).pad_left());
        let cols = self.columns.get();
        if cols.len() > 0 {
            let mut c = ScriptTextArray::with_capacity(w, cols.len() + 2);
            for (i, col) in cols.iter().enumerate() {
                if i > 0 {
                    c.push(w.str_const(",").pad_right());
                }
                c.push(w.str(col.get()));
            }
            a.push(w.round_brackets(c.finish()).pad_left());
        }
        a.push(w.keyword("as").pad_left());
        a.push(w.round_brackets_one(self.statement.get().to_sql(w, filter)).pad_left());
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for DeclareStatement<'ast> {
    fn to_sql<'writer>(
        &self,
        _w: &'writer ScriptWriter,
        _filter: &dyn ToSQLExpressionFilter<'ast>,
    ) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        todo!()
    }
}

impl<'ast> ToSQL<'ast> for Statement<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        match &self {
            Statement::CreateAs(s) => s.to_sql(w, filter),
            Statement::CreateView(s) => s.to_sql(w, filter),
            Statement::Create(s) => s.to_sql(w, filter),
            Statement::Select(s) => s.to_sql(w, filter),
            Statement::Set(s) => s.to_sql(w, filter),
            Statement::Import(s) => s.to_sql(w, filter),
            Statement::Load(s) => s.to_sql(w, filter),
            Statement::Viz(s) => s.to_sql(w, filter),
            _ => todo!(),
        }
    }
}

impl<'ast> ToSQL<'ast> for ImportStatement<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 5);
        a.push(w.keyword("import"));
        a.push(self.name.get().to_sql(w, filter).pad_left());
        a.push(w.keyword("from").pad_left());
        if let Some(uri) = self.from_uri.get() {
            a.push(uri.to_sql(w, filter).pad_left());
        } else {
            a.push(
                w.keyword(match self.method.get() {
                    proto::ImportMethodType::FILE => "file",
                    proto::ImportMethodType::HTTP => "http",
                    _ => "none",
                })
                .pad_left(),
            );
        }
        if let Some(extra) = self.extra.get() {
            a.push(extra.to_sql(w, filter).pad_left());
        }
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for LoadStatement<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 7);
        a.push(w.keyword("load"));
        a.push(self.name.get().to_sql(w, filter).pad_left());
        a.push(w.keyword("from").pad_left());
        a.push(self.source.get().to_sql(w, filter).pad_left());
        if self.method.get() != proto::LoadMethodType::NONE {
            a.push(w.keyword("using").pad_left());
            a.push(
                w.keyword(match self.method.get() {
                    proto::LoadMethodType::CSV => "csv",
                    proto::LoadMethodType::JSON => "json",
                    proto::LoadMethodType::PARQUET => "parquet",
                    _ => "none",
                })
                .pad_left(),
            );
        }
        if let Some(extra) = self.extra.get() {
            a.push(extra.to_sql(w, filter).pad_left());
        }
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for VizStatement<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut a = ScriptTextArray::with_capacity(w, 6 + 2 * self.type_modifiers.get().count_ones() as usize);
        a.push(w.keyword("viz"));
        a.push(self.target.get().to_sql(w, filter).pad_left());
        a.push(w.keyword("using").pad_left().breakpoint_before());
        if let Some(ct) = self.component_type.get() {
            if ct != proto::VizComponentType::SPEC {
                let mut mods = self.type_modifiers.get();
                let mut ti = 0;
                while mods != 0 && ti <= proto::VizComponentTypeModifier::ENUM_MAX {
                    if (mods & 0b1) != 0 {
                        a.push(
                            w.keyword(match VizComponentTypeModifier(ti) {
                                VizComponentTypeModifier::STACKED => "stacked",
                                VizComponentTypeModifier::CLUSTERED => "clustered",
                                VizComponentTypeModifier::MULTI => "multi",
                                VizComponentTypeModifier::DEPENDENT => "dependent",
                                VizComponentTypeModifier::INDEPENDENT => "independent",
                                VizComponentTypeModifier::POLAR => "polar",
                                VizComponentTypeModifier::X => "x",
                                VizComponentTypeModifier::Y => "y",
                                _ => "none",
                            })
                            .pad_left(),
                        );
                    }
                    mods >>= 1;
                    ti += 1;
                }
                a.push(
                    w.keyword(match ct.clone() {
                        proto::VizComponentType::AREA => "area chart",
                        proto::VizComponentType::AXIS => "axis",
                        proto::VizComponentType::BAR => "bar chart",
                        proto::VizComponentType::BOX => "box",
                        proto::VizComponentType::CANDLESTICK => "candlestick chart",
                        proto::VizComponentType::ERROR_BAR => "errorbar chart",
                        proto::VizComponentType::HEX => "hex",
                        proto::VizComponentType::JSON => "json",
                        proto::VizComponentType::LINE => "line chart",
                        proto::VizComponentType::PIE => "pie chart",
                        proto::VizComponentType::SCATTER => "scatter plot",
                        proto::VizComponentType::TABLE => "table",
                        _ => "none",
                    })
                    .pad_left(),
                );
            }
        }
        if let Some(extra) = self.extra.get() {
            a.push(extra.to_sql(w, filter).pad_left());
        }
        w.float(a.finish())
    }
}

impl<'ast> ToSQL<'ast> for SetStatement<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let fields = self.fields.get().as_object();
        assert!(!fields.is_empty(), "unexpected set statement value type");
        assert!(fields.len() == 1, "expected exactly one field: {:?}", fields);
        let mut a = ScriptTextArray::with_capacity(w, 4);
        a.push(w.keyword("set"));
        a.push(fields[0].key.to_sql(w, filter).pad_left());
        a.push(w.str_const("=").pad_left());
        a.push(fields[0].value.to_sql(w, filter).pad_left());
        w.float(a.finish())
    }
}

fn get_operator_precedence(op: ExpressionOperatorName) -> usize {
    let op = match op {
        ExpressionOperatorName::Known(op) => op,
        ExpressionOperatorName::Qualified(_name) => return 9,
    };
    match op {
        ExpressionOperator::MULTIPLY => 15,
        ExpressionOperator::DIVIDE => 15,
        ExpressionOperator::MODULUS => 15,

        ExpressionOperator::PLUS => 14,
        ExpressionOperator::MINUS => 14,

        ExpressionOperator::IS_DISTINCT_FROM => 13,
        ExpressionOperator::IS_FALSE => 13,
        ExpressionOperator::IS_NOT_DISTINCT_FROM => 13,
        ExpressionOperator::IS_NOT_OF => 13,
        ExpressionOperator::IS_NOT_TRUE => 13,
        ExpressionOperator::IS_NOT_UNKNOWN => 13,
        ExpressionOperator::IS_OF => 13,
        ExpressionOperator::IS_TRUE => 13,
        ExpressionOperator::IS_UNKNOWN => 13,

        ExpressionOperator::IS_NULL => 12,
        ExpressionOperator::NOT_NULL => 11,
        ExpressionOperator::NOT_IN => 8,
        ExpressionOperator::IN => 7,

        ExpressionOperator::BETWEEN_ASYMMETRIC => 6,
        ExpressionOperator::NOT_BETWEEN_ASYMMETRIC => 6,
        ExpressionOperator::BETWEEN_SYMMETRIC => 6,
        ExpressionOperator::NOT_BETWEEN_SYMMETRIC => 6,

        ExpressionOperator::OVERLAPS => 5,
        ExpressionOperator::NOT_LIKE => 4,
        ExpressionOperator::LIKE => 4,
        ExpressionOperator::NOT_EQUAL => 3,
        ExpressionOperator::EQUAL => 3,
        ExpressionOperator::NOT => 2,
        ExpressionOperator::AND => 1,
        ExpressionOperator::OR => 0,

        _ => 9,
    }
}

impl<'ast> ToSQL<'ast> for &[ASTCell<Indirection<'ast>>] {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut t = ScriptTextArray::with_capacity(w, 5 * self.len());
        for (i, e) in self.iter().enumerate() {
            match e.get() {
                Indirection::Name(n) => {
                    if i > 0 {
                        t.push(w.str_const("."));
                    }
                    t.push(w.str(n));
                }
                Indirection::Index(idx) => {
                    t.push(w.str_const("["));
                    t.push(idx.value.get().to_sql(w, filter));
                    t.push(w.str_const("]"));
                }
                Indirection::Bounds(bounds) => {
                    t.push(w.str_const("["));
                    t.push(bounds.lower_bound.get().to_sql(w, filter));
                    t.push(w.str_const(", "));
                    t.push(bounds.upper_bound.get().to_sql(w, filter));
                    t.push(w.str_const("]"));
                }
            }
        }
        w.float(t.finish())
    }
}

impl<'ast> ToSQL<'ast> for Expression<'ast> {
    fn to_sql<'writer>(&self, w: &'writer ScriptWriter, filter: &dyn ToSQLExpressionFilter<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        filter.write_expression(w, self)
    }
}

#[derive(Default)]
pub struct ExpressionWriteContext {
    pub precedence: Cell<Option<usize>>,
}

#[derive(Default)]
pub struct NoopExpressionFilter {
    ctx: ExpressionWriteContext,
}

impl<'ast> ToSQLExpressionFilter<'ast> for NoopExpressionFilter {
    fn write_expression<'writer>(&self, writer: &'writer ScriptWriter, expr: &Expression<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        expr_to_sql(writer, self, &self.ctx, expr)
    }
}

pub struct EvaluatingExpressionFilter<'ast, 'snap> {
    ctx: ExpressionWriteContext,
    snap: Mutex<ExecutionContextSnapshot<'ast, 'snap>>,
}

impl<'ast, 'snap> EvaluatingExpressionFilter<'ast, 'snap> {
    pub fn from_snapshot(snap: ExecutionContextSnapshot<'ast, 'snap>) -> Self {
        Self {
            ctx: ExpressionWriteContext::default(),
            snap: Mutex::new(snap),
        }
    }
}

impl<'ast, 'snap> ToSQLExpressionFilter<'ast> for EvaluatingExpressionFilter<'ast, 'snap> {
    fn write_expression<'writer>(&self, writer: &'writer ScriptWriter, expr: &Expression<'ast>) -> ScriptText<'writer>
    where
        'ast: 'writer,
    {
        let mut snap = self.snap.lock().unwrap();
        if is_constant_expression(*expr, &snap) {
            match expr.evaluate(&mut snap) {
                Ok(None) => return writer.str_const("null"),
                Ok(Some(value)) => return value.to_sql(writer, self),
                Err(_) => (),
            }
        }
        drop(snap);
        expr_to_sql(writer, self, &self.ctx, expr)
    }
}

pub fn expr_to_sql<'ast, 'writer>(
    w: &'writer ScriptWriter,
    filter: &dyn ToSQLExpressionFilter<'ast>,
    ctx: &ExpressionWriteContext,
    expr: &Expression<'ast>,
) -> ScriptText<'writer>
where
    'ast: 'writer,
{
    let op_prec = ctx.precedence.get();
    let text = match expr {
        Expression::Null => w.str_const("null"),
        Expression::Boolean(b) => {
            if *b {
                w.str_const("true")
            } else {
                w.str_const("false")
            }
        }
        Expression::Array(elems) => {
            let mut a = ScriptTextArray::with_capacity(w, 3 * elems.len());
            for (i, e) in elems.iter().enumerate() {
                if i > 0 {
                    a.push(w.str_const(",").pad_right());
                }
                a.push(e.get().to_sql(w, filter));
            }
            w.round_brackets(a.finish())
        }
        Expression::Case(c) => {
            let mut f = ScriptTextArray::with_capacity(w, 5 + 8 * c.cases.get().len());
            f.push(w.keyword("case"));
            let arg = c.argument.get();
            if arg != Expression::Null {
                f.push(arg.to_sql(w, filter).pad_left());
            }
            for case in c.cases.get().iter() {
                f.push(w.keyword("when").pad_left());
                f.push(case.get().when.get().to_sql(w, filter).pad_left());
                f.push(w.keyword("then").pad_left());
                f.push(case.get().then.get().to_sql(w, filter).pad_left());
            }
            let default = c.default.get();
            if default != Expression::Null {
                f.push(w.keyword("else").pad_left());
                f.push(default.to_sql(w, filter).pad_left());
            }
            f.push(w.keyword("end").pad_left());
            w.float(f.finish())
        }
        Expression::ColumnRef(name) => name.to_sql(w, filter),
        Expression::ConstCast(_) => todo!(),
        Expression::Exists(e) => {
            let mut t = ScriptTextArray::with_capacity(w, 3);
            t.push(w.keyword("EXISTS"));
            t.push(e.statement.get().to_sql(w, filter).pad_left());
            w.float(t.finish())
        }
        Expression::FunctionCall(_) => todo!(),
        Expression::Indirection(_i) => todo!(),
        Expression::Conjunction(exprs) => {
            let own_prec = get_operator_precedence(ExpressionOperatorName::Known(ExpressionOperator::AND));
            let prev_prec = ctx.precedence.replace(Some(own_prec));

            let mut a = ScriptTextArray::with_capacity(w, 2 * exprs.length);
            let mut iter = exprs.first.get();
            a.push(iter.value.get().to_sql(w, filter));
            while let Some(next) = iter.next.get() {
                a.push(w.keyword("and").pad_left());
                a.push(next.value.get().to_sql(w, filter).pad_left());
                iter = next;
            }
            if prev_prec.map(|prev_prec| own_prec <= prev_prec).unwrap_or_default() {
                w.round_brackets(a.finish())
            } else {
                w.float(a.finish())
            }
        }
        Expression::Disjunction(exprs) => {
            let own_prec = get_operator_precedence(ExpressionOperatorName::Known(ExpressionOperator::OR));
            let prev_prec = ctx.precedence.replace(Some(own_prec));

            let mut a = ScriptTextArray::with_capacity(w, 2 * exprs.length);
            let mut iter = exprs.first.get();
            a.push(iter.value.get().to_sql(w, filter));
            while let Some(next) = iter.next.get() {
                a.push(w.keyword("or").pad_left());
                a.push(next.value.get().to_sql(w, filter).pad_left());
                iter = next;
            }
            if prev_prec.map(|prev_prec| own_prec <= prev_prec).unwrap_or_default() {
                w.round_brackets(a.finish())
            } else {
                w.float(a.finish())
            }
        }
        Expression::Nary(nary) => match nary.operator.get() {
            ExpressionOperatorName::Known(op) => match op {
                // Unary operations
                ExpressionOperator::NOT => {
                    let own_prec = get_operator_precedence(ExpressionOperatorName::Known(op));
                    let prev_prec = ctx.precedence.replace(Some(own_prec));

                    let mut a = ScriptTextArray::with_capacity(w, 5);
                    match op {
                        ExpressionOperator::NOT => a.push(w.keyword("not")),
                        _ => todo!(),
                    }
                    a.push(nary.args[0].get().to_sql(w, filter).pad_left());

                    if prev_prec.map(|prev_prec| own_prec <= prev_prec).unwrap_or_default() {
                        w.round_brackets(a.finish())
                    } else {
                        w.float(a.finish())
                    }
                }

                // Binary operations
                ExpressionOperator::PLUS
                | ExpressionOperator::MINUS
                | ExpressionOperator::MULTIPLY
                | ExpressionOperator::MODULUS
                | ExpressionOperator::XOR
                | ExpressionOperator::GLOB
                | ExpressionOperator::NOT_GLOB
                | ExpressionOperator::LIKE
                | ExpressionOperator::ILIKE
                | ExpressionOperator::NOT_LIKE
                | ExpressionOperator::NOT_ILIKE
                | ExpressionOperator::SIMILAR_TO
                | ExpressionOperator::NOT_SIMILAR_TO
                | ExpressionOperator::DIVIDE
                | ExpressionOperator::EQUAL
                | ExpressionOperator::GREATER_EQUAL
                | ExpressionOperator::GREATER_THAN
                | ExpressionOperator::LESS_EQUAL
                | ExpressionOperator::LESS_THAN
                | ExpressionOperator::IN
                | ExpressionOperator::NOT_IN => {
                    let own_prec = get_operator_precedence(ExpressionOperatorName::Known(op));
                    let prev_prec = ctx.precedence.replace(Some(own_prec));

                    let mut a = ScriptTextArray::with_capacity(w, 5);
                    a.push(nary.args[0].get().to_sql(w, filter));
                    match op {
                        ExpressionOperator::PLUS => a.push(w.keyword("+").pad_left()),
                        ExpressionOperator::MINUS => a.push(w.keyword("-").pad_left()),
                        ExpressionOperator::MULTIPLY => a.push(w.keyword("*").pad_left()),
                        ExpressionOperator::DIVIDE => a.push(w.keyword("/").pad_left()),
                        ExpressionOperator::MODULUS => a.push(w.keyword("%").pad_left()),
                        ExpressionOperator::XOR => a.push(w.keyword("^").pad_left()),
                        ExpressionOperator::GLOB => a.push(w.keyword("glob").pad_left()),
                        ExpressionOperator::NOT_GLOB => {
                            a.push(w.keyword("not").pad_left());
                            a.push(w.keyword("glob").pad_left());
                        }
                        ExpressionOperator::LIKE => a.push(w.keyword("like").pad_left()),
                        ExpressionOperator::ILIKE => a.push(w.keyword("ilike").pad_left()),
                        ExpressionOperator::SIMILAR_TO => {
                            a.push(w.keyword("similar").pad_left());
                            a.push(w.keyword("to").pad_left());
                        }
                        ExpressionOperator::NOT_LIKE => {
                            a.push(w.keyword("not").pad_left());
                            a.push(w.keyword("like").pad_left());
                        }
                        ExpressionOperator::NOT_ILIKE => {
                            a.push(w.keyword("not").pad_left());
                            a.push(w.keyword("ilike").pad_left());
                        }
                        ExpressionOperator::NOT_SIMILAR_TO => {
                            a.push(w.keyword("not").pad_left());
                            a.push(w.keyword("similar").pad_left());
                            a.push(w.keyword("to").pad_left());
                        }
                        ExpressionOperator::EQUAL => a.push(w.keyword("=").pad_left()),
                        ExpressionOperator::NOT_EQUAL => a.push(w.keyword("!=").pad_left()),
                        ExpressionOperator::GREATER_THAN => a.push(w.keyword(">").pad_left()),
                        ExpressionOperator::GREATER_EQUAL => a.push(w.keyword(">=").pad_left()),
                        ExpressionOperator::LESS_EQUAL => a.push(w.keyword("<=").pad_left()),
                        ExpressionOperator::LESS_THAN => a.push(w.keyword("<").pad_left()),
                        ExpressionOperator::IN => a.push(w.keyword("in").pad_left()),
                        ExpressionOperator::NOT_IN => {
                            a.push(w.keyword("not").pad_left());
                            a.push(w.keyword("in").pad_left());
                        }
                        _ => todo!(),
                    }
                    a.push(nary.args[1].get().to_sql(w, filter).pad_left());
                    if prev_prec.map(|prev_prec| own_prec <= prev_prec).unwrap_or_default() {
                        w.round_brackets(a.finish())
                    } else {
                        w.float(a.finish())
                    }
                }
                _ => todo!("{}", op.variant_name().unwrap_or_default()),
            },
            ExpressionOperatorName::Qualified(_name) => todo!(),
        },
        Expression::ParameterRef(p) => {
            let mut a = ScriptTextArray::with_capacity(w, 2);
            a.push(w.str_const("$"));
            a.push(p.name.get().to_sql(w, filter));
            w.block(a.finish())
        }
        Expression::SelectStatement(_) => todo!(),
        Expression::LiteralNull => w.str_const("null"),
        Expression::LiteralString(s) => w.single_quotes(w.str(s.clone())),
        Expression::LiteralInteger(s) | Expression::LiteralFloat(s) | Expression::LiteralInterval(s) => {
            w.str(s.clone())
        }
        Expression::Subquery(_) => todo!(),
        Expression::TypeCast(_) => todo!(),
        Expression::TypeTest(_) => todo!(),
    };
    ctx.precedence.set(op_prec);
    text
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::execution::execution_context::ExecutionContext;
    use crate::execution::scalar_value::ScalarValue;
    use crate::external::parser::parse_into;
    use crate::grammar;
    use std::error::Error;
    use std::rc::Rc;

    async fn test_pipe(text: &'static str) -> Result<(), Box<dyn Error + Send + Sync>> {
        test_with_input(text, Vec::new(), text).await
    }

    async fn test_with_input(
        text: &'static str,
        input: Vec<(&'static str, Rc<ScalarValue>)>,
        expected: &'static str,
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        let arena = bumpalo::Bump::new();
        let (ast, ast_data) = parse_into(&arena, text).await?;
        assert!(
            ast.errors().is_none(),
            "{}",
            ast.errors().unwrap().get(0).message().unwrap_or_default()
        );
        let prog = grammar::deserialize_ast(&arena, text, ast, ast_data).unwrap();
        assert_eq!(prog.statements.len(), 1, "{:?} {:?}", text, prog);

        let ctx = ExecutionContext::create_simple(&arena).await?;
        {
            let mut state = ctx.state.write().unwrap();
            state.named_values = input
                .iter()
                .map(|(name, value)| {
                    let key = ASTCell::with_value(Indirection::Name(arena.alloc_str(&name)));
                    let key_path: &[ASTCell<Indirection>] = arena.alloc_slice_clone(&[key]);
                    (key_path, value.clone())
                })
                .collect();
        }
        let expr_filter: Box<dyn ToSQLExpressionFilter> = if input.is_empty() {
            Box::new(NoopExpressionFilter::default())
        } else {
            Box::new(EvaluatingExpressionFilter::from_snapshot(ctx.snapshot()))
        };
        let writer_arena = bumpalo::Bump::new();
        let writer = ScriptWriter::with_arena(writer_arena);
        let script_text = prog.statements[0].to_sql(&writer, expr_filter.as_ref());
        let script_string = print_script(&script_text, &ScriptTextConfig::default());

        assert_eq!(expected, &script_string, "{:?}", prog);
        Ok(())
    }

    #[tokio::test]
    async fn test_expressions() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe(&r#"select a + b"#).await?;
        test_pipe(&r#"select a - b"#).await?;
        test_pipe(&r#"select a * b"#).await?;
        test_pipe(&r#"select a / b"#).await?;
        test_pipe(&r#"select a % b"#).await?;
        test_pipe(&r#"select a ^ b"#).await?;
        test_pipe(&r#"select a and b"#).await?;
        test_pipe(&r#"select a or b"#).await?;
        test_pipe(&r#"select a like b"#).await?;
        test_pipe(&r#"select a ilike b"#).await?;
        test_pipe(&r#"select a not like b"#).await?;
        test_pipe(&r#"select a not ilike b"#).await?;
        test_pipe(&r#"select not a and b"#).await?;
        test_pipe(&r#"select not a or b"#).await?;
        test_pipe(&r#"select not a + b"#).await?;
        test_pipe(&r#"select (a + b) * c"#).await?;
        test_pipe(&r#"select a * (b + c)"#).await?;
        test_pipe(&r#"select a + (b + c)"#).await?;
        test_pipe(&r#"select a + b * c"#).await?;
        test_pipe(&r#"select a + b and b + c and c + d"#).await?;
        test_pipe(&r#"select $someparam"#).await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_set() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe("set 'foo' = 42").await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_from() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe("import foo from 'http://someremote'").await?;
        test_pipe("import foo from http (url = 'http://someremote')").await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_load() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe("load a from b using json").await?;
        test_pipe("load a from b using csv").await?;
        test_pipe("load a from b using parquet").await?;
        test_pipe("load a from b using parquet ('someextra' = 'foo')").await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_viz() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe("viz a using table").await?;
        test_pipe("viz a using stacked bar chart").await?;
        test_pipe("viz a using stacked bar chart ('some' = 'config')").await?;
        test_pipe("viz a using clustered bar chart").await?;
        test_pipe("viz a using (mark = 'bar')").await?;
        test_pipe("viz a using (encoding = ('x' = ('some' = 'thing')), mark = 'bar')").await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_select() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe("select 1").await?;
        test_pipe("select null").await?;
        test_pipe("select * from foo").await?;
        test_pipe("select * from only foo f").await?;
        test_pipe("select * from main.foo").await?;
        test_pipe("select f.g from main.foo f").await?;
        test_pipe("select * from A cross join B").await?;
        test_pipe("select * from A join B using (a, b)").await?;
        test_pipe("select * from A join B on a = b").await?;
        test_pipe("select * from A left join B on a = b").await?;
        test_pipe("select * from A left outer join B on a = b").await?;
        test_pipe("select * from A right join B on a = b").await?;
        test_pipe("select * from A right outer join B on a = b").await?;
        test_pipe("select * from A order by a").await?;
        test_pipe("select * from A order by a, b").await?;
        test_pipe("select * from A order by a asc").await?;
        test_pipe("select * from A order by a asc nulls first").await?;
        test_pipe("select * from A order by a desc").await?;
        test_pipe("select * from A order by a nulls first").await?;
        test_pipe("select * from A order by a asc nulls first, b desc").await?;
        test_pipe("select * from A order by a limit 10").await?;
        test_pipe("select * from A order by a limit 10 offset 10").await?;
        test_pipe("select * from A order by a limit all").await?;
        test_pipe("select 1 union select 2").await?;
        test_pipe("select 1 union all select 2").await?;
        test_pipe("select 1 union distinct select 2").await?;
        test_pipe("select 1 except select 2").await?;
        test_pipe("select 1 intersect select 2").await?;

        test_with_input(
            "select $test",
            vec![("test", ScalarValue::Utf8("foo".to_string()).as_rc())],
            "select 'foo'",
        )
        .await?;
        test_with_input(
            "select * from A where a = $test",
            vec![("test", ScalarValue::Int64(42).as_rc())],
            "select * from A where a = 42",
        )
        .await?;
        test_with_input(
            "select * from A, B where a = b and c = $test",
            vec![("test", ScalarValue::Int64(42).as_rc())],
            "select * from A, B where a = b and c = 42",
        )
        .await?;
        test_with_input(
            "select * from A where a = $test limit 10",
            vec![("test", ScalarValue::Int64(42).as_rc())],
            "select * from A where a = 42 limit 10",
        )
        .await?;
        test_with_input(
            "select * from A where a = $test order by a limit 10",
            vec![("test", ScalarValue::Int64(42).as_rc())],
            "select * from A where a = 42 order by a limit 10",
        )
        .await?;
        test_with_input(
            "select * from A where a = $test order by a limit 10 offset 10",
            vec![("test", ScalarValue::Int64(42).as_rc())],
            "select * from A where a = 42 order by a limit 10 offset 10",
        )
        .await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_values() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe("values (1)").await?;
        test_pipe("values (1, 'foo')").await?;
        test_pipe("values (1), (2)").await?;
        test_pipe("values (1, 'foo'), (2, 'bar')").await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_linebreaks() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe(
            &r#"viz a using table (
    position = (row = 0, column = 1, width = 10, height = 4),
    encoding = (x = ('foo' = 'bar'), y = ('foo' = 'bar2'))
)"#,
        )
        .await?;
        Ok(())
    }

    #[tokio::test]
    async fn create_table_as() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe(&r#"create table foo as (select 1)"#).await?;
        test_pipe(&r#"create temp table foo as (select 1)"#).await?;
        test_pipe(&r#"create global temp table foo as (select 1)"#).await?;
        test_pipe(&r#"create table if not exists foo as (select 1)"#).await?;
        test_pipe(&r#"create table if not exists foo on commit drop as (select 1)"#).await?;
        test_pipe(&r#"create table foo (a) as (select 1)"#).await?;
        test_pipe(&r#"create table foo (a, b) as (select 1, 2)"#).await?;
        Ok(())
    }

    #[tokio::test]
    async fn creat_view() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe(&r#"create view foo as (select 1)"#).await?;
        test_pipe(&r#"create temp view foo as (select 1)"#).await?;
        test_pipe(&r#"create global temp view foo as (select 1)"#).await?;
        Ok(())
    }

    #[tokio::test]
    async fn create_table() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_pipe(&r#"create table foo ()"#).await?;
        test_pipe(&r#"create table foo (a integer)"#).await?;
        test_pipe(&r#"create table foo (a integer, b varchar)"#).await?;
        test_pipe(&r#"create table foo (a integer primary key, b varchar)"#).await?;
        test_pipe(&r#"create table foo (a varchar collate noaccent)"#).await?;
        test_pipe(&r#"create table foo (a varchar initially deferred)"#).await?;
        test_pipe(&r#"create table foo (a varchar deferrable)"#).await?;
        test_pipe(&r#"create table foo (a varchar not deferrable)"#).await?;
        test_pipe(&r#"create table foo (a varchar not null)"#).await?;
        test_pipe(&r#"create table foo (a varchar null)"#).await?;
        test_pipe(&r#"create table foo (a varchar check (a = 42))"#).await?;
        test_pipe(&r#"create table foo (a integer default 1)"#).await?;
        test_pipe(&r#"create table foo (a integer not null unique)"#).await?;
        test_pipe(&r#"create table foo (a bit(1))"#).await?;
        test_pipe(&r#"create table foo (a bool)"#).await?;
        test_pipe(&r#"create table foo (a float)"#).await?;
        test_pipe(&r#"create table foo (a double)"#).await?;
        test_pipe(&r#"create table foo (a time(2))"#).await?;
        test_pipe(&r#"create table foo (a char(20))"#).await?;
        test_pipe(&r#"create table foo (a numeric(12, 2))"#).await?;
        test_pipe(&r#"create table foo (a time with time zone)"#).await?;
        test_pipe(&r#"create table foo (a integer, b varchar, primary key (a))"#).await?;
        test_pipe(&r#"create table foo (a integer, b varchar, primary key (a, b))"#).await?;
        test_pipe(&r#"create table foo (a integer, b varchar, primary key (a), unique (b))"#).await?;
        test_pipe(
            &r#"create table foo (
    a integer,
    b varchar,
    primary key (a),
    unique (b),
    foreign key (b) references c
)"#,
        )
        .await?;
        test_pipe(
            &r#"create table foo (
    a integer,
    b varchar,
    primary key (a),
    unique (b),
    foreign key (b) references c on delete cascade
)"#,
        )
        .await?;
        Ok(())
    }
}
