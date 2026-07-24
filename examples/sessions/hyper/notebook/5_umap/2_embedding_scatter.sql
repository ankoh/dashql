VISUALIZE dashql.notebook."umap/vis_publications" USING umap (
    vector    => embedding,
    category  => "Conference",
    label     => "Title",
    metric    => cosine,
    neighbors => 15,
    min_dist  => 0.1
  );