/**
 * Create a personalization point: prioritized decisions whose attribute values pick the content shown at that point.
 *
 * The data space, the profile data graph and the schema must exist. Each decision's `criteria` is a JSON string, and `attribute_values` set the attributes of the schema. The decision order is documented two ways (first match wins, or the highest priority value), so check it on an org. Read `status` of the point afterwards: it is `Active` when the point is ready, or `Error`.
 */

call cdp.p13n_point_create (
    name => 'home_page_experience',
    label => 'Home Page Experience Point',
    dataspace_name => 'default',
    profile_data_graph_name => 'individual_profile',
    source => 'PersonalizationApp',
    is_authentication_required => true,
    schema_name => 'product_recommendations_schema',
    max_items_count => 10,
    decisions => [
        (
            name = 'premium_decision',
            label = 'Premium User Decision',
            criteria = $${"type":"Criteria","operator":"AND","filters":[{"type":"Filter","operator":"EQUALS","subject":{"fieldApiName":"Segment__c","objectApiName":"Individual__dll"},"values":["Premium"]}]}$$,
            attribute_values = [(attribute_name = 'recommendation_type', value = 'premium_products')],
            personalizer_name = 'premium_recommender',
            state = 'Live'
        ),
        (
            name = 'default_decision',
            label = 'Default Decision',
            criteria = $${"type":"Criteria","operator":"AND","filters":[]}$$,
            attribute_values = [(attribute_name = 'recommendation_type', value = 'popular_items')],
            personalizer_name = 'default_recommender',
            state = 'Live'
        )
    ]
);

call cdp.p13n_point_get (id_or_name => 'home_page_experience');
