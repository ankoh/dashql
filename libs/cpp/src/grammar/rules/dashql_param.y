dashql_parameter_declaration:
    DECLARE PARAMETER dashql_identifier dashql_opt_alias TYPE_P dashql_parameter_type  {
        $$ = ctx.Object(@$, sx::NodeType::DASHQL_PARAMTER, {
            {Key::DASHQL_PARAMETER_IDENTIFIER, ctx.String(@3)},
            {Key::DASHQL_PARAMETER_ALIAS, $4},
            {Key::DASHQL_PARAMETER_TYPE, $6},
        });
    }
    ;

dashql_parameter_type:
    INTEGER     { $$ = ctx.Enum(@$, sxd::ParameterType::INTEGER); }
  | FLOAT       { $$ = ctx.Enum(@$, sxd::ParameterType::FLOAT); }
  | TEXT        { $$ = ctx.Enum(@$, sxd::ParameterType::TEXT); }
  | DATE        { $$ = ctx.Enum(@$, sxd::ParameterType::DATE); }
  | DATETIME    { $$ = ctx.Enum(@$, sxd::ParameterType::DATETIME); }
  | TIME        { $$ = ctx.Enum(@$, sxd::ParameterType::TIME); }
  | FILE        { $$ = ctx.Enum(@$, sxd::ParameterType::FILE); }
    ;

