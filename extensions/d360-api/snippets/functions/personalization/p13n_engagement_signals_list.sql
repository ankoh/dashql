/**
 * Read the engagement signals of a profile data graph, such as click, view, purchase or add-to-cart, before you configure a recommender.
 *
 * Both options take names here, not ids: the data space `default` and the data graph `user_profile_graph`. The public sources don't document the response, so it comes back as one row in `_raw`.
 */

call cdp.p13n_engagement_signals_list (dataspace_id => 'default', data_graph_id => 'user_profile_graph');
