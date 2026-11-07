/**
 * Define the structure of personalized content: the attributes a decision can set, the content object (DMO) to draw from and the objects related to it.
 *
 * Points refer to the schema by `schema_name`, transformers by `schema_reference`. `personalization_type` is one of `ExperienceVariation`, `FlowPath`, `ManualContent` and `Recommendations`. The data space and the content object must exist. `Product__dll` is how the sources write the content object, although DMOs normally end in `__dlm`.
 */

call cdp.p13n_schema_create (
    name => 'product_recommendations_schema',
    label => 'Product Recommendations Schema',
    dataspace_name => 'default',
    personalization_type => 'Recommendations',
    attributes => [
        (name = 'recommendation_type', label = 'Recommendation Type', default_value = 'similar_items'),
        (name = 'priority_score', label = 'Priority Score')
    ],
    content_object => (
        name = 'Product__dll',
        field_names = ['name', 'description', 'price', 'image_url', 'category']
    ),
    related_content_objects => [(
        content_object_name = 'ProductReviews__dll',
        field_names = ['rating', 'review_count']
    )]
);
