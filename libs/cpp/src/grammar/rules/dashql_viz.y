dashql_viz_statement:
    dashql_viz_statement_prefix dashql_identifier FROM dashql_identifier USING dashql_viz_attributes  {
        $$ = ctx.CreateObject(@$, syntax::ObjectType::VIZ_STATEMENT, move($6));
    }
    ;

dashql_viz_statement_prefix:
    VIZ
  | VIS
  | VISUALISE
  | VISUALIZE
  | SHOW
    ;

dashql_viz_attributes:
    AREA dashql_viz_attrs_all      { $$ = ctx.CollectViz(@1, VizType::AREA, {$2}); }
  | BAR dashql_viz_attrs_all       { $$ = ctx.CollectViz(@1, VizType::BAR, {$2}); }
  | BOX dashql_viz_attrs_all       { $$ = ctx.CollectViz(@1, VizType::BOX, {$2}); }
  | BUBBLE dashql_viz_attrs_all    { $$ = ctx.CollectViz(@1, VizType::BUBBLE, {$2}); }
  | GRID dashql_viz_attrs_all      { $$ = ctx.CollectViz(@1, VizType::GRID, {$2}); }
  | HISTOGRAM dashql_viz_attrs_all { $$ = ctx.CollectViz(@1, VizType::HISTOGRAM, {$2}); }
  | LINE dashql_viz_attrs_all      { $$ = ctx.CollectViz(@1, VizType::LINE, {$2}); }
  | NUMBER dashql_viz_attrs_all    { $$ = ctx.CollectViz(@1, VizType::NUMBER, {$2}); }
  | PIE dashql_viz_attrs_all       { $$ = ctx.CollectViz(@1, VizType::PIE, {$2}); }
  | POINT dashql_viz_attrs_all     { $$ = ctx.CollectViz(@1, VizType::POINT, {$2}); }
  | SCATTER dashql_viz_attrs_all   { $$ = ctx.CollectViz(@1, VizType::SCATTER, {$2}); }
  | TABLE dashql_viz_attrs_all     { $$ = ctx.CollectViz(@1, VizType::TABLE, {$2}); }
  | TEXT dashql_viz_attrs_all      { $$ = ctx.CollectViz(@1, VizType::TEXT, {$2}); }
    ;

dashql_viz_attrs_all:
    %empty { $$ = {}; }
