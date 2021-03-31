dashql_input:
    INPUT dashql_statement_name TYPE_P dashql_input_component_type opt_dashql_options { 
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_INPUT, concat(NodeVector{
            Key::DASHQL_STATEMENT_NAME << $2,
            Key::DASHQL_INPUT_COMPONENT_TYPE << $4,
        }, move($5)));
    }
    ;

dashql_input_component_type:
    INTEGER     { $$ = Enum(@$, sx::InputComponentType::INTEGER); }
  | FLOAT       { $$ = Enum(@$, sx::InputComponentType::FLOAT); }
  | TEXT        { $$ = Enum(@$, sx::InputComponentType::TEXT); }
  | DATE        { $$ = Enum(@$, sx::InputComponentType::DATE); }
  | DATETIME    { $$ = Enum(@$, sx::InputComponentType::DATETIME); }
  | TIME        { $$ = Enum(@$, sx::InputComponentType::TIME); }
  | FILE        { $$ = Enum(@$, sx::InputComponentType::FILE); }
    ;
