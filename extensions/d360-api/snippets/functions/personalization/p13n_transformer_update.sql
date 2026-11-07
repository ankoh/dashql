/**
 * Rename a transformer, switch it on and change its description.
 *
 * The verb is `PUT`, but the sources call it a partial update where every field is optional. Changing `transformer_type` may require changing `transformer_type_details` to match.
 */

call cdp.p13n_transformer_update (
    id_or_name => 'promo_banner_transformer',
    label => 'Updated Banner Transformer',
    description => 'Banner with a title and a call to action button',
    is_enabled => true
);

call cdp.p13n_transformer_get (id_or_name => 'promo_banner_transformer');
