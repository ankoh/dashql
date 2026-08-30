-- Create a view over a materialized table
create or replace view view_over_nation_materialized as select * from nation_materialized;

-- `expand_views false` will report `view_over_nation_materialized` as referenced table
explain (format referenced_tables, expand_views false)
select * from view_over_nation_materialized