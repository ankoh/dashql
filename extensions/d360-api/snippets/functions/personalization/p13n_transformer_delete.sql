/**
 * Delete a transformer after you checked that no experience config renders through it.
 *
 * Experience configs that reference it break, and a delete can't be undone. The list finds the references, once per connector.
 */

call cdp.p13n_transformer_get (id_or_name => 'promo_banner_transformer');

call cdp.p13n_experience_config_list (
    id_or_app_source_id_or_name => 'my_website_connector',
    transformer_name_or_id => 'promo_banner_transformer'
);

call cdp.p13n_transformer_delete (id_or_name => 'promo_banner_transformer');
