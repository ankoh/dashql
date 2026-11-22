sql_bare_col_label:
    IDENT                   { name_from_identifier(@1, $1) }
  | sql_bare_label_keywords { ctx.name_from_keyword(@1, $1) }
    ;

sql_opt_aggregation_threshold:
    WITH_LA AGGREGATION_THRESHOLD { bool_node(@$,true) }
  | %empty { null() }
    ;
sql_opt_star_exclude:
    EXCLUDE sql_columnref { ctx.array(@$, &[$2]) }
  | EXCLUDE LRB sql_columnref_list RRB { ctx.array(@$, $3) }
  | %empty { null() }
    ;
sql_columnref_list:
    sql_columnref { ctx.list(&[$1]) }
  | sql_columnref_list COMMA sql_columnref { ctx.push_back($1,$3); $1 }
    ;
sql_opt_not_null:
    NOT NULL_P { bool_node(@$,true) }
  | %empty { null() }
    ;
sql_row_constructor_list:
    sql_row_constructor_item { ctx.list(&[$1]) }
  | sql_row_constructor_list COMMA sql_row_constructor_item { ctx.push_back($1,$3); $1 }
    ;
sql_row_constructor_item:
    sql_a_expr { ctx.expression($1) }
  | sql_a_expr AS sql_col_label {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROW_FIELD,
            &[
                attr(Key::SQL_ROW_FIELD_VALUE, ctx.expression($1)),
                attr(Key::SQL_ROW_FIELD_NAME, $3),
            ],
        )
    }
  | sql_a_expr sql_bare_col_label {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROW_FIELD,
            &[
                attr(Key::SQL_ROW_FIELD_VALUE, ctx.expression($1)),
                attr(Key::SQL_ROW_FIELD_NAME, $2),
            ],
        )
    }
  | sql_param_name EQUALS_GREATER sql_a_expr {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ROW_FIELD,
            &[
                attr(Key::SQL_ROW_FIELD_NAME, $1),
                attr(Key::SQL_ROW_FIELD_VALUE, ctx.expression($3)),
            ],
        )
    }
    ;
sql_opt_null_treatment:
    IGNORE NULLS_P { bool_node(@$,true) }
  | RESPECT NULLS_P { bool_node(@$,false) }
  | %empty { null() }
    ;
sql_opt_from_last:
    FROM FIRST_P { bool_node(@$,false) }
  | FROM LAST_P { bool_node(@$,true) }
  | %empty { null() }
    ;
sql_required_over_clause:
    OVER sql_window_specification { $2 }
  | OVER sql_col_id { $2 }
    ;
sql_opt_window_exclusion:
    EXCLUDE CURRENT_P ROW { enum_node(@$,WindowExclusionMode::CURRENT_ROW) }
  | EXCLUDE GROUP_P { enum_node(@$,WindowExclusionMode::GROUP) }
  | EXCLUDE TIES { enum_node(@$,WindowExclusionMode::TIES) }
  | EXCLUDE NO OTHERS { enum_node(@$,WindowExclusionMode::NO_OTHERS) }
  | %empty { null() }
    ;
sql_opt_null_on_null:
    NULL_P ON NULL_P { bool_node(@$,false) }
  | ABSENT ON NULL_P { bool_node(@$,true) }
  | %empty { null() }
    ;
sql_table_ordinality:
    WITH_LA ORDINALITY sql_opt_ordinality_name {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ORDINALITY,
            &[
                attr(Key::SQL_ORDINALITY_ENABLED, bool_node(@$, true)),
                attr(Key::SQL_ORDINALITY_NAME, $3),
            ],
        )
    }
  | %empty { null() }
    ;
sql_opt_ordinality_name:
    LRB sql_col_id RRB { $2 }
  | %empty { null() }
    ;
sql_table_ref_options:
    WITH_OPTIONS_LA OPTIONS LRB sql_scan_option_list RRB { ctx.array(@$,$4) }
  | %empty { null() }
    ;
sql_scan_option_list:
    sql_scan_option { ctx.list(&[$1]) }
  | sql_scan_option_list COMMA sql_scan_option { ctx.push_back($1,$3);$1 }
    ;
sql_scan_option:
    sql_param_name COLON_EQUALS sql_a_expr {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GENERIC_OPTION,
            &[
                attr(Key::SQL_GENERIC_OPTION_KEY, $1),
                attr(Key::SQL_GENERIC_OPTION_VALUE, ctx.expression($3)),
            ],
        )
    }
  | sql_param_name EQUALS_GREATER sql_a_expr {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_GENERIC_OPTION,
            &[
                attr(Key::SQL_GENERIC_OPTION_KEY, $1),
                attr(Key::SQL_GENERIC_OPTION_VALUE, ctx.expression($3)),
            ],
        )
    }
    ;
sql_lambda_arg:
    LAMBDA sql_lambda_labels COLON sql_a_expr {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_LAMBDA_EXPRESSION,
            &[
                attr(Key::SQL_LAMBDA_PARAM, ctx.array(@2, $2)),
                attr(Key::SQL_LAMBDA_BODY, ctx.expression($4)),
            ],
        )
    }
    ;
sql_lambda_labels:
    sql_name_list { $1 }
  | %empty { ctx.list(NO_NODES) }
    ;
sql_table_arg_correlation:
    AS sql_col_id { $2 }
  | %empty { null() }
    ;
sql_table_arg_partition:
    PARTITION BY LRB sql_expr_list RRB { ctx.array(@$,$4) }
  | %empty { null() }
    ;
sql_table_arg_order:
    ORDER BY LRB sql_sortby_list RRB { ctx.array(@$,$4) }
  | %empty %prec TABLE_ARG_EMPTY { null() }
    ;
sql_descriptor_list:
    sql_descriptor_item { ctx.list(&[$1]) }
  | sql_descriptor_list COMMA sql_descriptor_item { ctx.push_back($1,$3);$1 }
    ;
sql_descriptor_item:
    sql_table_func_element { $1 }
  | sql_nonreserved_word { ctx.object(@$,NodeType::OBJECT_SQL_COLUMN_DEF,&[attr(Key::SQL_COLUMN_DEF_NAME,$1)]) }
    ;
sql_nonreserved_word:
    sql_col_id { $1 }
  | sql_type_func_keywords { ctx.name_from_keyword(@1,$1) }
    ;

sql_sample_bounds:
    BETWEEN sql_a_expr_const ROWS AND sql_a_expr_const ROWS { ctx.list(&[attr(Key::SQL_SAMPLE_MIN_ROWS,ctx.expression($2)),attr(Key::SQL_SAMPLE_MAX_ROWS,ctx.expression($5))]) }
  | BETWEEN UNBOUNDED ROWS AND sql_a_expr_const ROWS { ctx.list(&[attr(Key::SQL_SAMPLE_MAX_ROWS,ctx.expression($5))]) }
  | BETWEEN sql_a_expr_const ROWS AND UNBOUNDED ROWS { ctx.list(&[attr(Key::SQL_SAMPLE_MIN_ROWS,ctx.expression($2))]) }
  | %empty { ctx.list(NO_NODES) }
    ;
sql_array_constructor:
    LSB sql_expr_list RSB { ctx.object(@$,NodeType::OBJECT_SQL_ARRAY_EXPRESSION,&[attr(Key::SQL_ARRAY_EXPRESSION_VALUES,ctx.array(@2,$2))]) }
  | LSB sql_array_constructor_list RSB { ctx.object(@$,NodeType::OBJECT_SQL_ARRAY_EXPRESSION,&[attr(Key::SQL_ARRAY_EXPRESSION_VALUES,ctx.array(@2,$2))]) }
  | LSB RSB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_ARRAY_EXPRESSION,
            &[attr(Key::SQL_ARRAY_EXPRESSION_VALUES, ctx.array_ex(@$, NO_NODES, false, false))],
        )
    }
    ;
sql_array_constructor_list:
    sql_array_constructor { ctx.list(&[$1]) }
  | sql_array_constructor_list COMMA sql_array_constructor { ctx.push_back($1,$3);$1 }
    ;


sql_select_node: sql_select_stmt { ctx.object(@$,NodeType::OBJECT_SQL_SELECT,$1) } ;
sql_select_parens_node: sql_select_with_parens { ctx.object(@$,NodeType::OBJECT_SQL_SELECT,$1) } ;
sql_expression_node: sql_a_expr { ctx.expression($1) } ;
sql_word_or_string: sql_nonreserved_word { $1 } | SCONST { const_node(@1,AConstType::STRING) } ;
sql_integer_literal: ICONST { const_node(@1,AConstType::INTEGER) } ;
sql_string_literal: SCONST { const_node(@1,AConstType::STRING) } | DCONST { const_node(@1,AConstType::STRING) } ;
sql_optional_with_clause: sql_with_clause { $1 } | %empty { ctx.list(NO_NODES) } ;
sql_column_def_list: sql_column_def { ctx.list(&[$1]) } | sql_column_def_list COMMA sql_column_def { ctx.push_back($1,$3);$1 } ;
sql_partition_expressions: PARTITION BY sql_expr_list { ctx.array(@$,$3) } | %empty { null() } ;
sql_optional_table_columns: sql_table_func_element_list { $1 } | %empty { ctx.list(NO_NODES) } ;
sql_argument_value: sql_a_expr { ctx.expression($1) } | sql_relation_arg { $1 } | sql_descriptor_arg { $1 } | sql_lambda_arg { $1 } ;
sql_setting_value: sql_word_or_string { $1 } | TRUE_P { bool_node(@1,true) } | FALSE_P { bool_node(@1,false) } | ON { bool_node(@1,true) } ;

sql_cardinality_hint:
    LRB WITH LRB CARDINALITY sql_numeric_only RRB RRB { $5 }
  | WITH CARDINALITY sql_integer_literal { $3 }
  | %empty %prec SET { null() }
    ;
sql_semantic_view: sql_func_name LRB sql_col_id sql_semantic_clauses RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEMANTIC_VIEW,
            &[
                attr(Key::SQL_SEMANTIC_VIEW_NAME, ctx.array(@1, $1)),
                attr(Key::SQL_SEMANTIC_VIEW_MODEL, $3),
                attr(Key::SQL_SEMANTIC_VIEW_CLAUSES, ctx.array(@4, $4)),
            ],
        )
    }
 | sql_func_name LRB SCONST sql_semantic_clauses RRB {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_SEMANTIC_VIEW,
            &[
                attr(Key::SQL_SEMANTIC_VIEW_NAME, ctx.array(@1, $1)),
                attr(Key::SQL_SEMANTIC_VIEW_SPECIFICATION, const_node(@3, AConstType::STRING)),
                attr(Key::SQL_SEMANTIC_VIEW_CLAUSES, ctx.array(@4, $4)),
            ],
        )
    };
sql_semantic_clauses: sql_semantic_clause { ctx.list(&[$1]) } | sql_semantic_clauses sql_semantic_clause { ctx.push_back($1,$2); $1 };
sql_semantic_clause: DIMENSIONS sql_semantic_targets { ctx.object(@$,NodeType::OBJECT_SQL_SEMANTIC_DIMENSIONS,&[attr(Key::SQL_SEMANTIC_CLAUSE_TARGETS,ctx.array(@2,$2))]) }
 | MEASURES sql_semantic_targets { ctx.object(@$,NodeType::OBJECT_SQL_SEMANTIC_MEASURES,&[attr(Key::SQL_SEMANTIC_CLAUSE_TARGETS,ctx.array(@2,$2))]) }
 | FACTS sql_semantic_targets { ctx.object(@$,NodeType::OBJECT_SQL_SEMANTIC_FACTS,&[attr(Key::SQL_SEMANTIC_CLAUSE_TARGETS,ctx.array(@2,$2))]) }
 | WHERE sql_a_expr { ctx.object(@$,NodeType::OBJECT_SQL_SEMANTIC_FILTER,&[attr(Key::SQL_SEMANTIC_CLAUSE_CONDITION,ctx.expression($2))]) };
sql_semantic_targets: sql_semantic_target { ctx.list(&[$1]) } | sql_semantic_targets COMMA sql_semantic_target { ctx.push_back($1,$3); $1 };
sql_semantic_target: sql_a_expr { ctx.object(@$,NodeType::OBJECT_SQL_RESULT_TARGET,&[attr(Key::SQL_RESULT_TARGET_VALUE,ctx.expression($1))]) }
 | sql_a_expr AS sql_col_label {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_RESULT_TARGET,
            &[
                attr(Key::SQL_RESULT_TARGET_VALUE, ctx.expression($1)),
                attr(Key::SQL_RESULT_TARGET_NAME, $3),
            ],
        )
    };
