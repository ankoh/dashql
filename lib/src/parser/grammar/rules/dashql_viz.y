dashql_viz_component_list:
    dashql_viz_component_list ',' dashql_viz_component  { $1.push_back(std::move($3)); $$ = move($1); }
  | dashql_viz_component                                { $$ = { std::move($1) }; }
    ;

dashql_viz_component:
    dashql_viz_type opt_dashql_options {
        $2.push_back(std::move($1));
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT, std::move($2));
    }
 |  dashql_viz_type_specifier dashql_viz_type opt_dashql_options {
        $3.push_back(std::move($1));
        $3.push_back(std::move($2));
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT, std::move($3));
    }
    ;

dashql_viz_statement:
    dashql_viz_statement_prefix sql_table_ref USING dashql_viz_component_list {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_VIZ, {
            Key::DASHQL_VIZ_TARGET << $2,
            Key::DASHQL_VIZ_COMPONENTS << ctx.Add(@4, std::move($4)),
        });
    }
    ;

dashql_viz_statement_prefix:
    VIZ
  | VIS
  | VISUALISE
  | VISUALIZE
  | SHOW
    ;

dashql_viz_type_specifier:
    STACKED         { $$ = Enum(@$, sx::VizComponentTypeSpecifier::STACKED); }
  | DEPENDENT       { $$ = Enum(@$, sx::VizComponentTypeSpecifier::DEPENDENT); }
  | INDEPENDENT     { $$ = Enum(@$, sx::VizComponentTypeSpecifier::INDEPENDENT); }
    ;

dashql_viz_type:
    AREA        { $$ = Enum(@$, sx::VizComponentType::AREA); }
  | AXIS        { $$ = Enum(@$, sx::VizComponentType::AXIS); }
  | BAR         { $$ = Enum(@$, sx::VizComponentType::BAR); }
  | BOX         { $$ = Enum(@$, sx::VizComponentType::BOX); }
  | BUBBLE      { $$ = Enum(@$, sx::VizComponentType::BUBBLE); }
  | GRID        { $$ = Enum(@$, sx::VizComponentType::GRID); }
  | HISTOGRAM   { $$ = Enum(@$, sx::VizComponentType::HISTOGRAM); }
  | LINE        { $$ = Enum(@$, sx::VizComponentType::LINE); }
  | NUMBER      { $$ = Enum(@$, sx::VizComponentType::NUMBER); }
  | PIE         { $$ = Enum(@$, sx::VizComponentType::PIE); }
  | POINT       { $$ = Enum(@$, sx::VizComponentType::POINT); }
  | SCATTER     { $$ = Enum(@$, sx::VizComponentType::SCATTER); }
  | TABLE       { $$ = Enum(@$, sx::VizComponentType::TABLE); }
  | TEXT        { $$ = Enum(@$, sx::VizComponentType::TEXT); }
  | XAXIS       { $$ = Enum(@$, sx::VizComponentType::XAXIS); }
  | YAXIS       { $$ = Enum(@$, sx::VizComponentType::YAXIS); }
    ;
