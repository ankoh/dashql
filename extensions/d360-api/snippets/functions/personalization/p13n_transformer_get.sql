/**
 * Read one transformer with its substitution definitions, type details and data connectors.
 *
 * `id_or_name` takes the id or the unique name of the transformer.
 */

call d360.p13n_transformer_list (channel_type => 'WebApp', transformer_type => 'Handlebars');

call d360.p13n_transformer_get (id_or_name => 'promo_banner_transformer');
