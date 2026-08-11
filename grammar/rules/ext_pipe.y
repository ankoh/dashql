// ---------------------------------------------------------------------------
// Relational pipe extension.
//
// A pipeline keeps its source and ordered stages explicit in the AST. Stage
// payloads intentionally reuse SQL expression, target, grouping, ordering,
// table-reference, and CTE nodes without synthesizing SELECT statements.

ext_pipe_query:
    ext_pipe_from_source {
        $$ = ctx.List({
            Attr(Key::SQL_SELECT_EXPRESSION_STATEMENT, std::move($1)),
        });
    }
  | ext_pipe_source ext_pipe_stages {
        auto pipe = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE, {
            Attr(Key::EXT_PIPE_SOURCE, std::move($1)),
            Attr(Key::EXT_PIPE_STAGES, ctx.Array(@2, std::move($2))),
        });
        $$ = ctx.List({
            Attr(Key::SQL_SELECT_EXPRESSION_STATEMENT, std::move(pipe)),
        });
    }
  | sql_with_clause ext_pipe_from_source {
        $$ = Concat(std::move($1), {
            Attr(Key::SQL_SELECT_EXPRESSION_STATEMENT, std::move($2)),
        });
    }
  | sql_with_clause ext_pipe_from_source ext_pipe_stages {
        auto pipe = ctx.Object(Loc({@2, @3}), buffers::parser::NodeType::OBJECT_EXT_PIPE, {
            Attr(Key::EXT_PIPE_SOURCE, std::move($2)),
            Attr(Key::EXT_PIPE_STAGES, ctx.Array(@3, std::move($3))),
        });
        $$ = Concat(std::move($1), {
            Attr(Key::SQL_SELECT_EXPRESSION_STATEMENT, std::move(pipe)),
        });
    }
    ;

ext_pipe_source:
    sql_classical_select_no_parens {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_SELECT, std::move($1));
    }
  | sql_select_with_parens {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_SELECT, std::move($1));
    }
  | ext_pipe_from_source {
        $$ = std::move($1);
    }
    ;

ext_pipe_from_source:
    FROM sql_from_list {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE_FROM, {
            Attr(Key::EXT_PIPE_FROM, ctx.Array(@2, std::move($2))),
        });
    }
    ;

ext_pipe_stages:
    PIPE_GREATER ext_pipe_stage {
        $$ = ctx.List({ std::move($2) });
    }
  | ext_pipe_stages PIPE_GREATER ext_pipe_stage {
        $1->push_back(std::move($3));
        $$ = std::move($1);
    }
    ;

ext_pipe_stage:
    ext_pipe_where      { $$ = std::move($1); }
  | ext_pipe_select     { $$ = std::move($1); }
  | ext_pipe_extend     { $$ = std::move($1); }
  | ext_pipe_aggregate  { $$ = std::move($1); }
  | ext_pipe_distinct   { $$ = std::move($1); }
  | ext_pipe_join       { $$ = std::move($1); }
  | ext_pipe_combine    { $$ = std::move($1); }
  | ext_pipe_order      { $$ = std::move($1); }
  | ext_pipe_limit      { $$ = std::move($1); }
  | ext_pipe_as         { $$ = std::move($1); }
    ;

ext_pipe_where:
    WHERE sql_a_expr {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE_WHERE, {
            Attr(Key::EXT_PIPE_WHERE, ctx.Expression(std::move($2))),
        });
    }
    ;

ext_pipe_select:
    SELECT ext_pipe_target_list {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE_SELECT, {
            Attr(Key::EXT_PIPE_SELECT_TARGETS, ctx.Array(@2, std::move($2))),
        });
    }
    ;

ext_pipe_target_list:
    sql_target_el { $$ = ctx.List({std::move($1)}); }
  | ext_pipe_target_list COMMA sql_target_el {
        $1->push_back(std::move($3));
        $$ = std::move($1);
    }
    ;

ext_pipe_extend:
    EXTEND sql_target_list {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE_EXTEND, {
            Attr(Key::EXT_PIPE_EXTEND_TARGETS, ctx.Array(@2, std::move($2))),
        });
    }
    ;

ext_pipe_group_clause:
    GROUP_P BY sql_group_by_list  { $$ = std::move($3); }
    ;

ext_pipe_aggregate:
    AGGREGATE sql_target_list {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE_AGGREGATE, {
            Attr(Key::EXT_PIPE_AGGREGATE_TARGETS, ctx.Array(@2, std::move($2))),
        });
    }
  | AGGREGATE sql_target_list ext_pipe_group_clause {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE_AGGREGATE, {
            Attr(Key::EXT_PIPE_AGGREGATE_TARGETS, ctx.Array(@2, std::move($2))),
            Attr(Key::EXT_PIPE_AGGREGATE_GROUPS, ctx.Array(@3, std::move($3))),
        });
    }
  | AGGREGATE ext_pipe_group_clause {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE_AGGREGATE, {
            Attr(Key::EXT_PIPE_AGGREGATE_GROUPS, ctx.Array(@2, std::move($2))),
        });
    }
    ;

ext_pipe_distinct:
    DISTINCT {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE_DISTINCT, {
            Attr(Key::EXT_PIPE_DISTINCT, Bool(@1, true)),
        });
    }
    ;

ext_pipe_qualified_join_type:
    FULL OUTER_P     { $$ = buffers::parser::JoinType::OUTER_FULL; }
  | FULL             { $$ = buffers::parser::JoinType::FULL; }
  | LEFT OUTER_P     { $$ = buffers::parser::JoinType::OUTER_LEFT; }
  | LEFT             { $$ = buffers::parser::JoinType::LEFT; }
  | RIGHT OUTER_P    { $$ = buffers::parser::JoinType::OUTER_RIGHT; }
  | RIGHT            { $$ = buffers::parser::JoinType::RIGHT; }
  | INNER_P          { $$ = buffers::parser::JoinType::INNER; }
  | %empty           { $$ = buffers::parser::JoinType::INNER; }
    ;

ext_pipe_join_qual:
    USING LRB sql_name_list RRB {
        $$ = ctx.Array(@$, std::move($3));
    }
  | ON sql_a_expr {
        $$ = ctx.Expression(std::move($2));
    }
    ;

ext_pipe_join:
    ext_pipe_qualified_join_type JOIN sql_table_ref ext_pipe_join_qual {
        auto qual = std::move($4);
        auto qual_key = qual.node_type() == buffers::parser::NodeType::ARRAY
            ? Key::EXT_PIPE_JOIN_USING
            : Key::EXT_PIPE_JOIN_ON;
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE_JOIN, {
            Attr(Key::EXT_PIPE_JOIN_TYPE, Enum(@1, $1)),
            Attr(Key::EXT_PIPE_JOIN_INPUT, std::move($3)),
            Attr(qual_key, std::move(qual)),
        });
    }
  | CROSS JOIN sql_table_ref {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE_JOIN, {
            Attr(Key::EXT_PIPE_JOIN_TYPE, Enum(@1, buffers::parser::JoinType::NONE)),
            Attr(Key::EXT_PIPE_JOIN_INPUT, std::move($3)),
        });
    }
    ;

ext_pipe_all_or_distinct:
    ALL       { $$ = Enum(@1, buffers::parser::CombineModifier::ALL); }
  | DISTINCT  { $$ = Enum(@1, buffers::parser::CombineModifier::DISTINCT); }
    ;

ext_pipe_distinct_only:
    DISTINCT  { $$ = Enum(@1, buffers::parser::CombineModifier::DISTINCT); }
    ;

ext_pipe_combine_inputs:
    sql_select_with_parens {
        $$ = ctx.List({
            ctx.Object(@1, buffers::parser::NodeType::OBJECT_SQL_SELECT, std::move($1)),
        });
    }
  | ext_pipe_combine_inputs COMMA sql_select_with_parens {
        $1->push_back(ctx.Object(@3, buffers::parser::NodeType::OBJECT_SQL_SELECT, std::move($3)));
        $$ = std::move($1);
    }
    ;

ext_pipe_combine:
    UNION ext_pipe_all_or_distinct ext_pipe_combine_inputs {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE_COMBINE, {
            Attr(Key::EXT_PIPE_COMBINE_OPERATION,
                 Enum(@1, buffers::parser::CombineOperation::UNION)),
            Attr(Key::EXT_PIPE_COMBINE_MODIFIER, std::move($2)),
            Attr(Key::EXT_PIPE_COMBINE_INPUTS, ctx.Array(@3, std::move($3))),
        });
    }
  | INTERSECT ext_pipe_distinct_only ext_pipe_combine_inputs {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE_COMBINE, {
            Attr(Key::EXT_PIPE_COMBINE_OPERATION,
                 Enum(@1, buffers::parser::CombineOperation::INTERSECT)),
            Attr(Key::EXT_PIPE_COMBINE_MODIFIER, std::move($2)),
            Attr(Key::EXT_PIPE_COMBINE_INPUTS, ctx.Array(@3, std::move($3))),
        });
    }
  | EXCEPT ext_pipe_distinct_only ext_pipe_combine_inputs {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE_COMBINE, {
            Attr(Key::EXT_PIPE_COMBINE_OPERATION,
                 Enum(@1, buffers::parser::CombineOperation::EXCEPT)),
            Attr(Key::EXT_PIPE_COMBINE_MODIFIER, std::move($2)),
            Attr(Key::EXT_PIPE_COMBINE_INPUTS, ctx.Array(@3, std::move($3))),
        });
    }
    ;

ext_pipe_order:
    ORDER BY sql_sortby_list {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE_ORDER, {
            Attr(Key::EXT_PIPE_ORDER, ctx.Array(@3, std::move($3))),
        });
    }
    ;

ext_pipe_opt_offset:
    OFFSET sql_select_offset_value { $$ = std::move($2); }
  | %empty                         { $$ = Null(); }
    ;

ext_pipe_limit:
    LIMIT sql_a_expr ext_pipe_opt_offset {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE_LIMIT, {
            Attr(Key::EXT_PIPE_LIMIT, ctx.Expression(std::move($2))),
            Attr(Key::EXT_PIPE_OFFSET, std::move($3)),
        });
    }
    ;

ext_pipe_as:
    AS sql_col_id {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_PIPE_AS, {
            Attr(Key::EXT_PIPE_ALIAS, std::move($2)),
        });
    }
    ;
