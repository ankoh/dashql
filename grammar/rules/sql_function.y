sql_create_function_stmt:
    CREATE_P FUNCTION sql_qualified_name LRB sql_opt_function_param_list RRB RETURNS sql_function_param_type {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_CREATE_FUNCTION, {
            Attr(Key::SQL_CREATE_FUNCTION_NAME, std::move($3)),
            Attr(Key::SQL_CREATE_FUNCTION_PARAMS, ctx.Array(Loc({@4, @5, @6}), std::move($5))),
            Attr(Key::SQL_CREATE_FUNCTION_RETURNS, std::move($8)),
        });
    }
  | CREATE_P AGGREGATE sql_qualified_name LRB sql_opt_function_param_list RRB RETURNS sql_function_param_type {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_CREATE_FUNCTION, {
            Attr(Key::SQL_CREATE_FUNCTION_NAME, std::move($3)),
            Attr(Key::SQL_CREATE_FUNCTION_PARAMS, ctx.Array(Loc({@4, @5, @6}), std::move($5))),
            Attr(Key::SQL_CREATE_FUNCTION_RETURNS, std::move($8)),
            Attr(Key::SQL_CREATE_FUNCTION_IS_AGGREGATE, Bool(@2, true)),
        });
    }
    ;

sql_opt_function_param_list:
    sql_function_param_list     { $$ = std::move($1); }
  | %empty                      { $$ = ctx.List(); }
    ;

sql_function_param_list:
    sql_function_param                                  { $$ = ctx.List({ $1 }); }
  | sql_function_param_list COMMA sql_function_param    { $1->push_back(std::move($3)); $$ = std::move($1); }
    ;

sql_function_param:
    sql_col_id sql_function_param_type {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_FUNCTION_PARAM, {
            Attr(Key::SQL_FUNCTION_PARAM_NAME, $1),
            Attr(Key::SQL_FUNCTION_PARAM_TYPE, std::move($2)),
        });
    }
    ;

sql_function_param_type:
    sql_typename    { $$ = std::move($1); }
  | ANY {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_TYPENAME, {
            Attr(Key::SQL_TYPENAME_TYPE, ctx.Object(@1, buffers::parser::NodeType::OBJECT_SQL_GENERIC_TYPE, {
                Attr(Key::SQL_GENERIC_TYPE_NAME, ctx.NameFromKeyword(@1, "any")),
            })),
        });
    }
    ;
