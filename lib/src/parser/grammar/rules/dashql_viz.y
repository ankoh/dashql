dashql_viz_component_list:
    dashql_viz_component_list ',' dashql_viz_component  { $1.push_back(std::move($3)); $$ = move($1); }
  | dashql_viz_component                                { $$ = { std::move($1) }; }
    ;

dashql_viz_component:
    dashql_viz_type opt_dashql_options {
        $2.push_back(Key::DASHQL_VIZ_COMPONENT_TYPE << std::move($1));
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT, std::move($2));
    }
 |  dashql_viz_type_modifiers dashql_viz_type opt_dashql_options {
        $3.push_back(Key::DASHQL_VIZ_COMPONENT_TYPE_MODIFIERS << UI32Bitmap(@1, $1));
        $3.push_back(Key::DASHQL_VIZ_COMPONENT_TYPE << $2);
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

dashql_viz_type_modifiers:
    dashql_viz_type_modifiers dashql_viz_type_modifier  { $$ = $1 | $2; }
  | dashql_viz_type_modifier                            { $$ = $1; }

dashql_viz_type_modifier:
    STACKED         { $$ = 1 << static_cast<uint32_t>(sx::VizComponentTypeModifier::STACKED); }
  | CLUSTERED       { $$ = 1 << static_cast<uint32_t>(sx::VizComponentTypeModifier::CLUSTERED); }
  | DEPENDENT       { $$ = 1 << static_cast<uint32_t>(sx::VizComponentTypeModifier::DEPENDENT); }
  | INDEPENDENT     { $$ = 1 << static_cast<uint32_t>(sx::VizComponentTypeModifier::INDEPENDENT); }
  | POLAR           { $$ = 1 << static_cast<uint32_t>(sx::VizComponentTypeModifier::POLAR); }
  | X               { $$ = 1 << static_cast<uint32_t>(sx::VizComponentTypeModifier::X); }
  | Y               { $$ = 1 << static_cast<uint32_t>(sx::VizComponentTypeModifier::Y); }
    ;

dashql_viz_type:
    AREA        { $$ = Enum(@$, sx::VizComponentType::AREA); }
  | AXIS        { $$ = Enum(@$, sx::VizComponentType::AXIS); }
  | BAR         { $$ = Enum(@$, sx::VizComponentType::BAR); }
  | BOX         { $$ = Enum(@$, sx::VizComponentType::BOX); }
  | CANDLESTICK { $$ = Enum(@$, sx::VizComponentType::CANDLESTICK); }
  | ERROR       { $$ = Enum(@$, sx::VizComponentType::ERROR_BAR); }
  | HISTOGRAM   { $$ = Enum(@$, sx::VizComponentType::HISTOGRAM); }
  | LINE        { $$ = Enum(@$, sx::VizComponentType::LINE); }
  | NUMBER      { $$ = Enum(@$, sx::VizComponentType::NUMBER); }
  | PIE         { $$ = Enum(@$, sx::VizComponentType::PIE); }
  | POINT       { $$ = Enum(@$, sx::VizComponentType::SCATTER); }
  | SCATTER     { $$ = Enum(@$, sx::VizComponentType::SCATTER); }
  | TABLE       { $$ = Enum(@$, sx::VizComponentType::TABLE); }
  | TEXT        { $$ = Enum(@$, sx::VizComponentType::TEXT); }
  | VORONOI     { $$ = Enum(@$, sx::VizComponentType::VORONOI); }
  | VEGA        { $$ = Enum(@$, sx::VizComponentType::VEGA); }
  | %empty      { $$ = Enum(@$, sx::VizComponentType::VEGA); }
    ;
