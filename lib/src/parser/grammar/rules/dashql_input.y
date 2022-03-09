dashql_input:
    INPUT dashql_statement_name TYPE_P sql_typename dashql_opt_input_component_type opt_dson { 
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_INPUT, concat(NodeVector{
            Key::DASHQL_STATEMENT_NAME << $2,
            Key::DASHQL_INPUT_VALUE_TYPE << $4,
            Key::DASHQL_INPUT_COMPONENT_TYPE << $5,
        }, std::move($6)));
    }
    ;

dashql_opt_input_component_type:
    USING dashql_input_component_type   { $$ = $2; }
  | %empty                              { $$ = Enum(@$, sx::InputComponentType::NONE); }
    ;

dashql_input_component_type:
    TEXT { $$ = Enum(@$, sx::InputComponentType::TEXT); }
  | FILE { $$ = Enum(@$, sx::InputComponentType::FILE); }
    ;
