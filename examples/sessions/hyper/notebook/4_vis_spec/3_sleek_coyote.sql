VISUALIZE (
    SELECT embedding, "Title", "Conference", "PaperType", "Year"
    FROM external('/mnt/home/Desktop/selection-1784529321483.embeddings.fixed.parquet', format => 'parquet')
  ) USING umap (
    vector    => embedding,
    category  => "Conference",
    label     => "Title",
    metric    => cosine,
    neighbors => 15,
    min_dist  => 0.1
  );