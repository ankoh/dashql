dashql_input:
    INPUT dashql_statement_name TYPE_P dashql_input_type opt_dashql_options { 
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_INPUT, concat(NodeVector{
            Key::DASHQL_STATEMENT_NAME << $2,
            Key::DASHQL_INPUT_TYPE << $4,
        }, move($5)));
    }
    ;

dashql_input_type:
    INTEGER     { $$ = Enum(@$, sx::InputType::INTEGER); }
  | FLOAT       { $$ = Enum(@$, sx::InputType::FLOAT); }
  | TEXT        { $$ = Enum(@$, sx::InputType::TEXT); }
  | DATE        { $$ = Enum(@$, sx::InputType::DATE); }
  | DATETIME    { $$ = Enum(@$, sx::InputType::DATETIME); }
  | TIME        { $$ = Enum(@$, sx::InputType::TIME); }
  | FILE        { $$ = Enum(@$, sx::InputType::FILE); }
    ;
