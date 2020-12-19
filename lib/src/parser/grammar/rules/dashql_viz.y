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
    AREA        { $$ = Enum(@$, sxd::VizType::AREA); }
  | BAR         { $$ = Enum(@$, sxd::VizType::BAR); }
  | BOX         { $$ = Enum(@$, sxd::VizType::BOX); }
  | BUBBLE      { $$ = Enum(@$, sxd::VizType::BUBBLE); }
  | GRID        { $$ = Enum(@$, sxd::VizType::GRID); }
  | HISTOGRAM   { $$ = Enum(@$, sxd::VizType::HISTOGRAM); }
  | LINE        { $$ = Enum(@$, sxd::VizType::LINE); }
  | NUMBER      { $$ = Enum(@$, sxd::VizType::NUMBER); }
  | PIE         { $$ = Enum(@$, sxd::VizType::PIE); }
  | POINT       { $$ = Enum(@$, sxd::VizType::POINT); }
  | SCATTER     { $$ = Enum(@$, sxd::VizType::SCATTER); }
  | TABLE       { $$ = Enum(@$, sxd::VizType::TABLE); }
  | TEXT        { $$ = Enum(@$, sxd::VizType::TEXT); }
    ;
