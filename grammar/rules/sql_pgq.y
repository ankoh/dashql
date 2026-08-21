// SQL/PGQ property graph definitions and GRAPH_TABLE queries.

sql_common_element_expr:
    sql_common_table_expr { $$ = $1; }
  | sql_name AS SECURE LRB sql_select_stmt RRB {
        auto select = ctx.Object(@5, buffers::parser::NodeType::OBJECT_SQL_SELECT, std::move($5));
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_CTE, {
            Attr(Key::SQL_CTE_NAME, $1),
            Attr(Key::SQL_CTE_STATEMENT, select),
            Attr(Key::SQL_CTE_SECURE, Bool(@3, true)),
        });
    }
  | sql_name LRB sql_name_list RRB AS SECURE LRB sql_select_stmt RRB {
        auto select = ctx.Object(@8, buffers::parser::NodeType::OBJECT_SQL_SELECT, std::move($8));
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_CTE, {
            Attr(Key::SQL_CTE_NAME, $1),
            Attr(Key::SQL_CTE_COLUMNS, ctx.Array(@3, std::move($3))),
            Attr(Key::SQL_CTE_STATEMENT, select),
            Attr(Key::SQL_CTE_SECURE, Bool(@6, true)),
        });
    }
  | sql_name AS PROPERTY GRAPH LRB sql_property_graph_definition RRB {
        auto graph = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_PROPERTY_GRAPH, std::move($6), false);
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_CTE, {
            Attr(Key::SQL_CTE_NAME, $1),
            Attr(Key::SQL_CTE_PROPERTY_GRAPH, graph),
        });
    }
    ;

sql_property_graph_definition:
    sql_opt_graph_vertex_tables_clause sql_opt_graph_edge_tables_clause {
        $$ = ctx.List({
            Attr(Key::SQL_PROPERTY_GRAPH_VERTEX_TABLES, ctx.Array(@1, std::move($1))),
            Attr(Key::SQL_PROPERTY_GRAPH_EDGE_TABLES, ctx.Array(@2, std::move($2))),
        });
    }
    ;

sql_opt_graph_vertex_tables_clause:
    NODE TABLES LRB sql_graph_vertex_table_list RRB   { $$ = std::move($4); }
  | VERTEX TABLES LRB sql_graph_vertex_table_list RRB { $$ = std::move($4); }
  | %empty                                             { $$ = ctx.List(); }
    ;

sql_graph_vertex_table_list:
    sql_graph_vertex_table_definition { $$ = ctx.List({$1}); }
  | sql_graph_vertex_table_list COMMA sql_graph_vertex_table_definition {
        $1->push_back($3); $$ = std::move($1);
    }
    ;

sql_graph_vertex_table_definition:
    sql_qualified_name sql_opt_graph_element_table_alias sql_opt_graph_element_table_key_clause
        sql_graph_element_table_label_and_properties {
        auto table = ctx.Object(@1, buffers::parser::NodeType::OBJECT_SQL_TABLEREF, {
            Attr(Key::SQL_TABLEREF_NAME, $1),
            Attr(Key::SQL_TABLEREF_ALIAS, $2),
        });
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_ELEMENT_TABLE, {
            Attr(Key::SQL_GRAPH_ELEMENT_TABLE_TABLE, table),
            Attr(Key::SQL_GRAPH_ELEMENT_TABLE_KEY, $3),
            Attr(Key::SQL_GRAPH_ELEMENT_TABLE_LABELS, $4),
        });
    }
  | sql_select_with_parens AS sql_name sql_opt_graph_element_table_key_clause
        sql_graph_element_table_label_and_properties {
        auto select = ctx.Object(@1, buffers::parser::NodeType::OBJECT_SQL_SELECT, std::move($1));
        auto alias = ctx.Object(@3, buffers::parser::NodeType::OBJECT_SQL_ALIAS, {
            Attr(Key::SQL_ALIAS_NAME, $3),
        });
        auto table = ctx.Object(Loc({@1, @2, @3}), buffers::parser::NodeType::OBJECT_SQL_TABLEREF, {
            Attr(Key::SQL_TABLEREF_TABLE, select),
            Attr(Key::SQL_TABLEREF_ALIAS, alias),
        });
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_ELEMENT_TABLE, {
            Attr(Key::SQL_GRAPH_ELEMENT_TABLE_TABLE, table),
            Attr(Key::SQL_GRAPH_ELEMENT_TABLE_KEY, $4),
            Attr(Key::SQL_GRAPH_ELEMENT_TABLE_LABELS, $5),
        });
    }
    ;

sql_opt_graph_element_table_key_clause:
    KEY LRB sql_column_list RRB { $$ = ctx.Array(@$, std::move($3)); }
  | %empty                      { $$ = Null(); }
    ;

sql_opt_graph_element_table_alias:
    AS sql_name { $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_ALIAS, {
        Attr(Key::SQL_ALIAS_NAME, $2),
    }); }
  | %empty { $$ = Null(); }
    ;

sql_opt_graph_edge_tables_clause:
    EDGE TABLES LRB sql_graph_edge_table_list RRB         { $$ = std::move($4); }
  | RELATIONSHIP TABLES LRB sql_graph_edge_table_list RRB { $$ = std::move($4); }
  | %empty                                                   { $$ = ctx.List(); }
    ;

sql_graph_edge_table_list:
    sql_graph_edge_table_definition { $$ = ctx.List({$1}); }
  | sql_graph_edge_table_list COMMA sql_graph_edge_table_definition {
        $1->push_back($3); $$ = std::move($1);
    }
    ;

sql_graph_edge_table_definition:
    sql_qualified_name sql_opt_graph_element_table_alias sql_opt_graph_element_table_key_clause
        sql_graph_source_vertex_table sql_graph_destination_vertex_table
        sql_graph_element_table_label_and_properties {
        auto table = ctx.Object(@1, buffers::parser::NodeType::OBJECT_SQL_TABLEREF, {
            Attr(Key::SQL_TABLEREF_NAME, $1),
            Attr(Key::SQL_TABLEREF_ALIAS, $2),
        });
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_ELEMENT_TABLE, {
            Attr(Key::SQL_GRAPH_ELEMENT_TABLE_TABLE, table),
            Attr(Key::SQL_GRAPH_ELEMENT_TABLE_KEY, $3),
            Attr(Key::SQL_GRAPH_ELEMENT_TABLE_SOURCE, $4),
            Attr(Key::SQL_GRAPH_ELEMENT_TABLE_DESTINATION, $5),
            Attr(Key::SQL_GRAPH_ELEMENT_TABLE_LABELS, $6),
        });
    }
  | sql_select_with_parens AS sql_name sql_opt_graph_element_table_key_clause
        sql_graph_source_vertex_table sql_graph_destination_vertex_table
        sql_graph_element_table_label_and_properties {
        auto select = ctx.Object(@1, buffers::parser::NodeType::OBJECT_SQL_SELECT, std::move($1));
        auto alias = ctx.Object(@3, buffers::parser::NodeType::OBJECT_SQL_ALIAS, {
            Attr(Key::SQL_ALIAS_NAME, $3),
        });
        auto table = ctx.Object(Loc({@1, @2, @3}), buffers::parser::NodeType::OBJECT_SQL_TABLEREF, {
            Attr(Key::SQL_TABLEREF_TABLE, select),
            Attr(Key::SQL_TABLEREF_ALIAS, alias),
        });
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_ELEMENT_TABLE, {
            Attr(Key::SQL_GRAPH_ELEMENT_TABLE_TABLE, table),
            Attr(Key::SQL_GRAPH_ELEMENT_TABLE_KEY, $4),
            Attr(Key::SQL_GRAPH_ELEMENT_TABLE_SOURCE, $5),
            Attr(Key::SQL_GRAPH_ELEMENT_TABLE_DESTINATION, $6),
            Attr(Key::SQL_GRAPH_ELEMENT_TABLE_LABELS, $7),
        });
    }
    ;

sql_graph_source_vertex_table:
    SOURCE sql_name { $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_VERTEX_REFERENCE, {
        Attr(Key::SQL_GRAPH_VERTEX_REFERENCE_NAME, $2),
    }); }
  | SOURCE KEY LRB sql_column_list RRB REFERENCES sql_name sql_opt_column_list {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_VERTEX_REFERENCE, {
            Attr(Key::SQL_GRAPH_VERTEX_REFERENCE_NAME, $7),
            Attr(Key::SQL_GRAPH_VERTEX_REFERENCE_KEY, ctx.Array(@4, std::move($4))),
            Attr(Key::SQL_GRAPH_VERTEX_REFERENCE_COLUMNS, ctx.Array(@8, std::move($8))),
        });
    }
    ;

sql_graph_destination_vertex_table:
    DESTINATION sql_name { $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_VERTEX_REFERENCE, {
        Attr(Key::SQL_GRAPH_VERTEX_REFERENCE_NAME, $2),
    }); }
  | DESTINATION KEY LRB sql_column_list RRB REFERENCES sql_name sql_opt_column_list {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_VERTEX_REFERENCE, {
            Attr(Key::SQL_GRAPH_VERTEX_REFERENCE_NAME, $7),
            Attr(Key::SQL_GRAPH_VERTEX_REFERENCE_KEY, ctx.Array(@4, std::move($4))),
            Attr(Key::SQL_GRAPH_VERTEX_REFERENCE_COLUMNS, ctx.Array(@8, std::move($8))),
        });
    }
    ;

sql_graph_element_table_label_and_properties:
    sql_graph_element_table_properties {
        auto label = ctx.Object(@1, buffers::parser::NodeType::OBJECT_SQL_GRAPH_LABEL, {
            Attr(Key::SQL_GRAPH_LABEL_DEFAULT, Bool(@1, true)),
            Attr(Key::SQL_GRAPH_LABEL_PROPERTIES, $1),
        });
        $$ = ctx.Array(@$, {label});
    }
  | sql_graph_label_and_properties_list { $$ = ctx.Array(@$, std::move($1)); }
  | %empty {
        auto properties = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_PROPERTIES, {
            Attr(Key::SQL_GRAPH_PROPERTIES_ALL, Bool(@$, true)),
        });
        auto label = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_LABEL, {
            Attr(Key::SQL_GRAPH_LABEL_DEFAULT, Bool(@$, true)),
            Attr(Key::SQL_GRAPH_LABEL_PROPERTIES, properties),
        });
        $$ = ctx.Array(@$, {label});
    }
    ;

sql_graph_label_and_properties_list:
    sql_graph_label_and_properties { $$ = ctx.List({$1}); }
  | sql_graph_label_and_properties_list sql_graph_label_and_properties {
        $1->push_back($2); $$ = std::move($1);
    }
    ;

sql_graph_label_and_properties:
    LABEL sql_name {
        auto properties = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_PROPERTIES, {
            Attr(Key::SQL_GRAPH_PROPERTIES_ALL, Bool(@$, true)),
        });
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_LABEL, {
            Attr(Key::SQL_GRAPH_LABEL_NAME, $2),
            Attr(Key::SQL_GRAPH_LABEL_PROPERTIES, properties),
        });
    }
  | LABEL sql_name sql_graph_element_table_properties {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_LABEL, {
            Attr(Key::SQL_GRAPH_LABEL_NAME, $2),
            Attr(Key::SQL_GRAPH_LABEL_PROPERTIES, $3),
        });
    }
  | DEFAULT LABEL {
        auto properties = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_PROPERTIES, {
            Attr(Key::SQL_GRAPH_PROPERTIES_ALL, Bool(@$, true)),
        });
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_LABEL, {
            Attr(Key::SQL_GRAPH_LABEL_DEFAULT, Bool(@1, true)),
            Attr(Key::SQL_GRAPH_LABEL_PROPERTIES, properties),
        });
    }
  | DEFAULT LABEL sql_graph_element_table_properties {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_LABEL, {
            Attr(Key::SQL_GRAPH_LABEL_DEFAULT, Bool(@1, true)),
            Attr(Key::SQL_GRAPH_LABEL_PROPERTIES, $3),
        });
    }
    ;

sql_graph_element_table_properties:
    NO PROPERTIES {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_PROPERTIES, {}, false);
    }
  | PROPERTIES sql_opt_are ALL COLUMNS sql_opt_graph_except_clause {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_PROPERTIES, {
            Attr(Key::SQL_GRAPH_PROPERTIES_ALL, Bool(@3, true)),
            Attr(Key::SQL_GRAPH_PROPERTIES_EXCLUDE, $5),
        });
    }
  | PROPERTIES LRB sql_graph_property_list RRB {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_PROPERTIES, {
            Attr(Key::SQL_GRAPH_PROPERTIES_COLUMNS, ctx.Array(@3, std::move($3))),
        });
    }
    ;

sql_opt_are:
    ARE
  | %empty
    ;

sql_opt_graph_except_clause:
    EXCEPT LRB sql_column_list RRB { $$ = ctx.Array(@$, std::move($3)); }
  | %empty                         { $$ = Null(); }
    ;

sql_graph_property_list:
    sql_graph_property { $$ = ctx.List({$1}); }
  | sql_graph_property_list COMMA sql_graph_property { $1->push_back($3); $$ = std::move($1); }
    ;

sql_graph_property:
    sql_name { $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_PROPERTY, {
        Attr(Key::SQL_GRAPH_PROPERTY_VALUE, ColumnRef(ctx, @1, ctx.List({$1}))),
    }); }
  | sql_a_expr AS sql_col_id { $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_PROPERTY, {
        Attr(Key::SQL_GRAPH_PROPERTY_VALUE, ctx.Expression(std::move($1))),
        Attr(Key::SQL_GRAPH_PROPERTY_NAME, $3),
    }); }
    ;

sql_graph_table_ref:
    GRAPH_TABLE LRB sql_qualified_name MATCH sql_graph_match
        sql_opt_graph_table_rows_clause sql_opt_graph_columns_clause RRB {
        auto graph = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_TABLE, {
            Attr(Key::SQL_GRAPH_TABLE_GRAPH, $3),
            Attr(Key::SQL_GRAPH_TABLE_MATCH, $5),
            Attr(Key::SQL_GRAPH_TABLE_ROWS, $6),
            Attr(Key::SQL_GRAPH_TABLE_COLUMNS, $7),
        });
        $$ = graph;
    }
    ;

sql_graph_match:
    sql_graph_path_pattern_list sql_where_clause {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_MATCH, {
            Attr(Key::SQL_GRAPH_MATCH_PATTERNS, ctx.Array(@1, std::move($1))),
            Attr(Key::SQL_GRAPH_MATCH_WHERE, $2),
        });
    }
    ;

sql_graph_path_pattern_list:
    sql_graph_path_pattern { $$ = ctx.List({ctx.Array(@1, std::move($1))}); }
  | sql_graph_path_pattern_list COMMA sql_graph_path_pattern {
        $1->push_back(ctx.Array(@3, std::move($3))); $$ = std::move($1);
    }
    ;

sql_graph_path_pattern:
    sql_graph_path_term { $$ = std::move($1); }
    ;

sql_graph_path_term:
    sql_graph_path_factor { $$ = ctx.List({$1}); }
  | sql_graph_path_term sql_graph_path_factor { $1->push_back($2); $$ = std::move($1); }
    ;

sql_graph_path_factor:
    sql_graph_path_primary { $$ = $1; }
    ;

sql_graph_path_primary:
    LRB sql_opt_col_id sql_opt_graph_label_expression sql_where_clause RRB {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_PATH_ELEMENT, {
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_VERTEX, Bool(@1, true)),
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_VARIABLE, $2),
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_LABEL, $3),
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_WHERE, $4),
        });
    }
  | LESS_THAN MINUS LSB sql_opt_col_id sql_opt_graph_label_expression sql_where_clause RSB MINUS
        sql_opt_graph_pattern_quantifier {
        ctx.RequireAdjacent(@1, @2, "<-");
        ctx.RequireAdjacent(@2, @3, "-[");
        ctx.RequireAdjacent(@7, @8, "]-");
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_PATH_ELEMENT, {
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_EDGE_LEFT, Bool(Loc({@1, @2}), true)),
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_VARIABLE, $4),
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_LABEL, $5),
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_WHERE, $6),
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_QUANTIFIER, $9),
        });
    }
  | MINUS LSB sql_opt_col_id sql_opt_graph_label_expression sql_where_clause RSB Op
        sql_opt_graph_pattern_quantifier {
        ctx.RequireAdjacent(@1, @2, "-[");
        ctx.RequireAdjacent(@6, @7, "]->");
        ctx.RequireOperator(@7, "->");
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_PATH_ELEMENT, {
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_EDGE_RIGHT, Bool(@7, true)),
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_VARIABLE, $3),
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_LABEL, $4),
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_WHERE, $5),
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_QUANTIFIER, $8),
        });
    }
  | MINUS LSB sql_opt_col_id sql_opt_graph_label_expression sql_where_clause RSB MINUS
        sql_opt_graph_pattern_quantifier {
        ctx.RequireAdjacent(@1, @2, "-[");
        ctx.RequireAdjacent(@6, @7, "]-");
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_PATH_ELEMENT, {
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_EDGE_ANY, Bool(@7, true)),
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_VARIABLE, $3),
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_LABEL, $4),
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_WHERE, $5),
            Attr(Key::SQL_GRAPH_PATH_ELEMENT_QUANTIFIER, $8),
        });
    }
    ;

sql_opt_graph_pattern_quantifier:
    sql_graph_pattern_quantifier { $$ = $1; }
  | %empty                       { $$ = Null(); }
    ;

sql_graph_pattern_quantifier:
    LCB ICONST RCB { $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_QUANTIFIER, {
        Attr(Key::SQL_GRAPH_QUANTIFIER_LOWER, Const(@2, buffers::parser::AConstType::INTEGER)),
        Attr(Key::SQL_GRAPH_QUANTIFIER_UPPER, Const(@2, buffers::parser::AConstType::INTEGER)),
        Attr(Key::SQL_GRAPH_QUANTIFIER_FIXED, Bool(@2, true)),
    }); }
  | LCB ICONST COMMA ICONST RCB { $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_QUANTIFIER, {
        Attr(Key::SQL_GRAPH_QUANTIFIER_LOWER, Const(@2, buffers::parser::AConstType::INTEGER)),
        Attr(Key::SQL_GRAPH_QUANTIFIER_UPPER, Const(@4, buffers::parser::AConstType::INTEGER)),
    }); }
  | LCB COMMA ICONST RCB { $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_QUANTIFIER, {
        Attr(Key::SQL_GRAPH_QUANTIFIER_UPPER, Const(@3, buffers::parser::AConstType::INTEGER)),
    }); }
  | LCB ICONST COMMA RCB { $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_QUANTIFIER, {
        Attr(Key::SQL_GRAPH_QUANTIFIER_LOWER, Const(@2, buffers::parser::AConstType::INTEGER)),
    }); }
  | LCB COMMA RCB { $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_QUANTIFIER, {}, false); }
    ;

sql_opt_col_id:
    sql_col_id { $$ = $1; }
  | %empty     { $$ = Null(); }
    ;

sql_opt_graph_label_expression:
    IS sql_graph_label_expression    { $$ = $2; }
  | COLON sql_graph_label_expression { $$ = $2; }
  | %empty                           { $$ = Null(); }
    ;

sql_graph_label_expression:
    sql_graph_label_term { $$ = $1; }
  | sql_graph_label_expression PIPE sql_graph_label_term {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_LABEL_EXPRESSION, {
            Attr(Key::SQL_GRAPH_LABEL_EXPRESSION_LEFT, $1),
            Attr(Key::SQL_GRAPH_LABEL_EXPRESSION_RIGHT, $3),
            Attr(Key::SQL_GRAPH_LABEL_EXPRESSION_DISJUNCTION, Bool(@2, true)),
        });
    }
    ;

sql_graph_label_term:
    sql_graph_label_factor { $$ = $1; }
  | sql_graph_label_term AMPERSAND sql_graph_label_factor {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_LABEL_EXPRESSION, {
            Attr(Key::SQL_GRAPH_LABEL_EXPRESSION_LEFT, $1),
            Attr(Key::SQL_GRAPH_LABEL_EXPRESSION_RIGHT, $3),
        });
    }
    ;

sql_graph_label_factor:
    sql_graph_label_primary { $$ = $1; }
  | EXCLAMATION_MARK sql_graph_label_primary {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_LABEL_EXPRESSION, {
            Attr(Key::SQL_GRAPH_LABEL_EXPRESSION_LEFT, $2),
            Attr(Key::SQL_GRAPH_LABEL_EXPRESSION_NEGATED, Bool(@1, true)),
        });
    }
    ;

sql_graph_label_primary:
    sql_name { $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_LABEL_EXPRESSION, {
        Attr(Key::SQL_GRAPH_LABEL_EXPRESSION_LABEL, $1),
    }); }
  | MODULO { $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_LABEL_EXPRESSION, {
        Attr(Key::SQL_GRAPH_LABEL_EXPRESSION_WILDCARD, Bool(@1, true)),
    }); }
  | LRB sql_graph_label_expression RRB { $$ = $2; }
    ;

sql_opt_graph_table_rows_clause:
    sql_graph_table_rows_clause { $$ = $1; }
  | %empty                     { $$ = Null(); }
    ;

sql_graph_table_rows_clause:
    ONE ROW PER MATCH { $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_ROWS, {
        Attr(Key::SQL_GRAPH_ROWS_PER_MATCH, Bool(@$, true)),
    }); }
  | ONE ROW PER STEP LRB sql_col_id COMMA sql_col_id COMMA sql_col_id RRB {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_GRAPH_ROWS, {
            Attr(Key::SQL_GRAPH_ROWS_PER_STEP, Bool(Loc({@1, @2, @3, @4}), true)),
            Attr(Key::SQL_GRAPH_ROWS_SOURCE, $6),
            Attr(Key::SQL_GRAPH_ROWS_EDGE, $8),
            Attr(Key::SQL_GRAPH_ROWS_DESTINATION, $10),
        });
    }
    ;

sql_opt_graph_columns_clause:
    COLUMNS LRB sql_graph_columns_list RRB { $$ = ctx.Array(@$, std::move($3)); }
  | %empty                                { $$ = Null(); }
    ;

sql_graph_columns_list:
    sql_graph_column { $$ = ctx.List({$1}); }
  | sql_graph_columns_list COMMA sql_graph_column { $1->push_back($3); $$ = std::move($1); }
    ;

sql_graph_column:
    sql_a_expr AS sql_col_label { $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_RESULT_TARGET, {
        Attr(Key::SQL_RESULT_TARGET_VALUE, ctx.Expression(std::move($1))),
        Attr(Key::SQL_RESULT_TARGET_NAME, $3),
    }); }
  | sql_a_expr { $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_RESULT_TARGET, {
        Attr(Key::SQL_RESULT_TARGET_VALUE, ctx.Expression(std::move($1))),
    }); }
  | sql_columnref DOT STAR sql_opt_graph_star_exclude {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_RESULT_TARGET, {
            Attr(Key::SQL_RESULT_TARGET_STAR, Bool(@3, true)),
            Attr(Key::SQL_RESULT_TARGET_VALUE, $1),
            Attr(Key::SQL_RESULT_TARGET_EXCLUDE, $4),
        });
    }
    ;

sql_opt_graph_star_exclude:
    sql_graph_star_exclude { $$ = $1; }
  | %empty                 { $$ = Null(); }
    ;

sql_graph_star_exclude:
    EXCLUDE sql_columnref { $$ = ctx.Array(@$, {$2}); }
  | EXCLUDE LRB sql_graph_columnref_list RRB { $$ = ctx.Array(@$, std::move($3)); }
    ;

sql_graph_columnref_list:
    sql_columnref { $$ = ctx.List({$1}); }
  | sql_graph_columnref_list COMMA sql_columnref { $1->push_back($3); $$ = std::move($1); }
    ;
