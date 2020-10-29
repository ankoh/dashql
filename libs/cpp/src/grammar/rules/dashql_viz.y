viz_statement:
    viz_statement_prefix identifier FROM identifier USING viz_attributes  {
        $$ = ctx.CreateObject(@$.encode(), syntax::ObjectType::VIZ_STATEMENT, move($6));
    }
    ;

viz_statement_prefix:
    VIZ
  | VIS
  | VISUALISE
  | VISUALIZE
  | SHOW
    ;

viz_attributes:
    AREA viz_attrs_all      { $$ = ctx.CollectViz(@1.encode(), VizType::AREA, {$2}); }
  | BAR viz_attrs_all       { $$ = ctx.CollectViz(@1.encode(), VizType::BAR, {$2}); }
  | BOX viz_attrs_all       { $$ = ctx.CollectViz(@1.encode(), VizType::BOX, {$2}); }
  | BUBBLE viz_attrs_all    { $$ = ctx.CollectViz(@1.encode(), VizType::BUBBLE, {$2}); }
  | GRID viz_attrs_all      { $$ = ctx.CollectViz(@1.encode(), VizType::GRID, {$2}); }
  | HISTOGRAM viz_attrs_all { $$ = ctx.CollectViz(@1.encode(), VizType::HISTOGRAM, {$2}); }
  | LINE viz_attrs_all      { $$ = ctx.CollectViz(@1.encode(), VizType::LINE, {$2}); }
  | NUMBER viz_attrs_all    { $$ = ctx.CollectViz(@1.encode(), VizType::NUMBER, {$2}); }
  | PIE viz_attrs_all       { $$ = ctx.CollectViz(@1.encode(), VizType::PIE, {$2}); }
  | POINT viz_attrs_all     { $$ = ctx.CollectViz(@1.encode(), VizType::POINT, {$2}); }
  | SCATTER viz_attrs_all   { $$ = ctx.CollectViz(@1.encode(), VizType::SCATTER, {$2}); }
  | TABLE viz_attrs_all     { $$ = ctx.CollectViz(@1.encode(), VizType::TABLE, {$2}); }
  | TEXT viz_attrs_all      { $$ = ctx.CollectViz(@1.encode(), VizType::TEXT, {$2}); }
    ;

viz_attrs_all:
    %empty { $$ = {}; }
