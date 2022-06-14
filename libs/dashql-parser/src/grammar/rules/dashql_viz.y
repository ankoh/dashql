dashql_viz_component:
    dashql_viz_type opt_dson {
        $$ = {
            Attr(Key::DASHQL_VIZ_COMPONENT_TYPE, std::move($1)),
            Attr(Key::DASHQL_VIZ_COMPONENT_EXTRA, std::move($2)),
        };
    }
 |  dashql_viz_type_modifiers dashql_viz_type opt_dson {
        $$ = {
            Attr(Key::DASHQL_VIZ_COMPONENT_TYPE_MODIFIERS, UI32Bitmap(@1, $1)),
            Attr(Key::DASHQL_VIZ_COMPONENT_TYPE, std::move($2)),
            Attr(Key::DASHQL_VIZ_COMPONENT_EXTRA, std::move($3)),
        };
    }
    ;

dashql_viz_statement:
    dashql_viz_statement_prefix sql_table_ref USING dashql_viz_component {
        $4.push_back(Attr(Key::DASHQL_VIZ_TARGET, $2));
        $$ = ctx.Add(@$, proto::NodeType::OBJECT_DASHQL_VIZ, std::move($4));
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
    STACKED         { $$ = 1 << static_cast<uint32_t>(proto::VizComponentTypeModifier::STACKED); }
  | CLUSTERED       { $$ = 1 << static_cast<uint32_t>(proto::VizComponentTypeModifier::CLUSTERED); }
  | MULTI           { $$ = 1 << static_cast<uint32_t>(proto::VizComponentTypeModifier::CLUSTERED); }
  | DEPENDENT       { $$ = 1 << static_cast<uint32_t>(proto::VizComponentTypeModifier::DEPENDENT); }
  | INDEPENDENT     { $$ = 1 << static_cast<uint32_t>(proto::VizComponentTypeModifier::INDEPENDENT); }
  | POLAR           { $$ = 1 << static_cast<uint32_t>(proto::VizComponentTypeModifier::POLAR); }
  | X               { $$ = 1 << static_cast<uint32_t>(proto::VizComponentTypeModifier::X); }
  | Y               { $$ = 1 << static_cast<uint32_t>(proto::VizComponentTypeModifier::Y); }
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
    AREA dashql_opt_chart { $$ = Enum(@$, proto::VizComponentType::AREA); }
  | AXIS dashql_opt_chart { $$ = Enum(@$, proto::VizComponentType::AXIS); }
  | BAR dashql_opt_chart  { $$ = Enum(@$, proto::VizComponentType::BAR); }
  | BOX dashql_opt_chart  { $$ = Enum(@$, proto::VizComponentType::BOX); }
  | CANDLESTICK dashql_opt_chart { $$ = Enum(@$, proto::VizComponentType::CANDLESTICK); }
  | DUMP                  { $$ = Enum(@$, proto::VizComponentType::HEX); }
  | ERROR dashql_opt_chart { $$ = Enum(@$, proto::VizComponentType::ERROR_BAR); }
  | HEX dashql_opt_dump   { $$ = Enum(@$, proto::VizComponentType::HEX); }
  | JSON                  { $$ = Enum(@$, proto::VizComponentType::JSON); }
  | LINE dashql_opt_chart { $$ = Enum(@$, proto::VizComponentType::LINE); }
  | PIE dashql_opt_chart  { $$ = Enum(@$, proto::VizComponentType::PIE); }
  | POINT dashql_opt_chart { $$ = Enum(@$, proto::VizComponentType::SCATTER); }
  | SCATTER dashql_opt_chart { $$ = Enum(@$, proto::VizComponentType::SCATTER); }
  | TABLE                 { $$ = Enum(@$, proto::VizComponentType::TABLE); }
  | %empty                { $$ = Enum(@$, proto::VizComponentType::SPEC); }
    ;
