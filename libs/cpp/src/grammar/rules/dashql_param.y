dashql_parameter_declaration:
    DECLARE PARAMETER dashql_identifier dashql_opt_alias TYPE_P dashql_parameter_type  {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_PARAMTER, {
            Key::DASHQL_PARAMETER_IDENTIFIER << ctx.Ref(@3),
            Key::DASHQL_PARAMETER_ALIAS << $4,
            Key::DASHQL_PARAMETER_TYPE << $6,
        });
    }
    ;

dashql_parameter_type:
    INTEGER     { $$ = ctx.RefEnum(@$, sxd::ParameterType::INTEGER); }
  | FLOAT       { $$ = ctx.RefEnum(@$, sxd::ParameterType::FLOAT); }
  | TEXT        { $$ = ctx.RefEnum(@$, sxd::ParameterType::TEXT); }
  | DATE        { $$ = ctx.RefEnum(@$, sxd::ParameterType::DATE); }
  | DATETIME    { $$ = ctx.RefEnum(@$, sxd::ParameterType::DATETIME); }
  | TIME        { $$ = ctx.RefEnum(@$, sxd::ParameterType::TIME); }
  | FILE        { $$ = ctx.RefEnum(@$, sxd::ParameterType::FILE); }
    ;

