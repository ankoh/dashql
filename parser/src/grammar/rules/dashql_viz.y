dashql_viz_component_list:
    dashql_viz_component_list ',' dashql_viz_component  { $1.push_back(std::move($3)); $$ = move($1); }
  | dashql_viz_component                                { $$ = { std::move($1) }; }
    ;

dashql_viz_component:
    dashql_viz_type opt_dson {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT, {
            Attr(Key::DASHQL_VIZ_COMPONENT_TYPE, std::move($1)),
            Attr(Key::DASHQL_VIZ_COMPONENT_CONFIG, std::move($2)),
        });
    }
 |  dashql_viz_type_modifiers dashql_viz_type opt_dson {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT, {
            Attr(Key::DASHQL_VIZ_COMPONENT_TYPE_MODIFIERS, UI32Bitmap(@1, $1)),
            Attr(Key::DASHQL_VIZ_COMPONENT_TYPE, std::move($2)),
            Attr(Key::DASHQL_VIZ_COMPONENT_CONFIG, std::move($3)),
        });
    }
    ;

dashql_viz_statement:
    dashql_viz_statement_prefix sql_table_ref USING dashql_viz_component_list {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_VIZ, {
            Attr(Key::DASHQL_VIZ_TARGET, $2),
            Attr(Key::DASHQL_VIZ_COMPONENTS, ctx.Add(@4, std::move($4))),
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
  | MULTI           { $$ = 1 << static_cast<uint32_t>(sx::VizComponentTypeModifier::CLUSTERED); }
  | DEPENDENT       { $$ = 1 << static_cast<uint32_t>(sx::VizComponentTypeModifier::DEPENDENT); }
  | INDEPENDENT     { $$ = 1 << static_cast<uint32_t>(sx::VizComponentTypeModifier::INDEPENDENT); }
  | POLAR           { $$ = 1 << static_cast<uint32_t>(sx::VizComponentTypeModifier::POLAR); }
  | X               { $$ = 1 << static_cast<uint32_t>(sx::VizComponentTypeModifier::X); }
  | Y               { $$ = 1 << static_cast<uint32_t>(sx::VizComponentTypeModifier::Y); }
    ;

dashql_opt_chart:
    CHART
  | %empty
    ;

dashql_opt_dump:
    DUMP
  | %empty
    ;

dashql_viz_type:
    AREA dashql_opt_chart { $$ = Enum(@$, sx::VizComponentType::AREA); }
  | AXIS dashql_opt_chart { $$ = Enum(@$, sx::VizComponentType::AXIS); }
  | BAR dashql_opt_chart  { $$ = Enum(@$, sx::VizComponentType::BAR); }
  | BOX dashql_opt_chart  { $$ = Enum(@$, sx::VizComponentType::BOX); }
  | CANDLESTICK dashql_opt_chart { $$ = Enum(@$, sx::VizComponentType::CANDLESTICK); }
  | DUMP                  { $$ = Enum(@$, sx::VizComponentType::HEX); }
  | ERROR dashql_opt_chart { $$ = Enum(@$, sx::VizComponentType::ERROR_BAR); }
  | HEX dashql_opt_dump   { $$ = Enum(@$, sx::VizComponentType::HEX); }
  | JSON                  { $$ = Enum(@$, sx::VizComponentType::JSON); }
  | LINE dashql_opt_chart { $$ = Enum(@$, sx::VizComponentType::LINE); }
  | PIE dashql_opt_chart  { $$ = Enum(@$, sx::VizComponentType::PIE); }
  | POINT dashql_opt_chart { $$ = Enum(@$, sx::VizComponentType::SCATTER); }
  | SCATTER dashql_opt_chart { $$ = Enum(@$, sx::VizComponentType::SCATTER); }
  | TABLE                 { $$ = Enum(@$, sx::VizComponentType::TABLE); }
  | %empty                { $$ = Enum(@$, sx::VizComponentType::SPEC); }
    ;
