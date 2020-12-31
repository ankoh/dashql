dashql_viz_statement:
    dashql_viz_statement_prefix sql_table_ref USING dashql_viz_type opt_dashql_options {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_VIZ, concat(NodeVector{
            Key::DASHQL_VIZ_TARGET << $2,
            Key::DASHQL_VIZ_TYPE << $4,
        }, move($5)));
    }
    ;

dashql_viz_statement_prefix:
    VIZ
  | VIS
  | VISUALISE
  | VISUALIZE
  | SHOW
    ;

dashql_viz_type:
    AREA        { $$ = Enum(@$, sx::VizType::AREA); }
  | BAR         { $$ = Enum(@$, sx::VizType::BAR); }
  | BOX         { $$ = Enum(@$, sx::VizType::BOX); }
  | BUBBLE      { $$ = Enum(@$, sx::VizType::BUBBLE); }
  | GRID        { $$ = Enum(@$, sx::VizType::GRID); }
  | HISTOGRAM   { $$ = Enum(@$, sx::VizType::HISTOGRAM); }
  | LINE        { $$ = Enum(@$, sx::VizType::LINE); }
  | NUMBER      { $$ = Enum(@$, sx::VizType::NUMBER); }
  | PIE         { $$ = Enum(@$, sx::VizType::PIE); }
  | POINT       { $$ = Enum(@$, sx::VizType::POINT); }
  | SCATTER     { $$ = Enum(@$, sx::VizType::SCATTER); }
  | TABLE       { $$ = Enum(@$, sx::VizType::TABLE); }
  | TEXT        { $$ = Enum(@$, sx::VizType::TEXT); }
    ;
