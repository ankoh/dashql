/**
 * Delete a schema you no longer use.
 *
 * Points that reference it break, and a delete can't be undone. Read the schema first.
 */

call d360.p13n_schema_get (id_or_name => 'product_recommendations_schema');

call d360.p13n_schema_delete (id_or_name => 'product_recommendations_schema');
