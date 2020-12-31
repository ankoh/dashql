dashql_parameter_declaration:
    DECLARE PARAMETER dashql_statement_name TYPE_P dashql_parameter_type opt_dashql_options { 
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_PARAMETER, concat(NodeVector{
            Key::DASHQL_STATEMENT_NAME << $3,
            Key::DASHQL_PARAMETER_TYPE << $5,
        }, move($6)));
    }
    ;

dashql_parameter_type:
    INTEGER     { $$ = Enum(@$, sx::ParameterType::INTEGER); }
  | FLOAT       { $$ = Enum(@$, sx::ParameterType::FLOAT); }
  | TEXT        { $$ = Enum(@$, sx::ParameterType::TEXT); }
  | DATE        { $$ = Enum(@$, sx::ParameterType::DATE); }
  | DATETIME    { $$ = Enum(@$, sx::ParameterType::DATETIME); }
  | TIME        { $$ = Enum(@$, sx::ParameterType::TIME); }
  | FILE        { $$ = Enum(@$, sx::ParameterType::FILE); }
    ;
