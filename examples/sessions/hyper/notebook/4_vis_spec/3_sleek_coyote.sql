VISUALIZE (
    SELECT embedding, "Title", "Conference", "PaperType", "Year"
    FROM external('/home/local/Desktop/selection-1784529321483.embeddings.fixed.parquet', format => 'parquet')
  ) USING embeddingatlas (
    vector   => embedding,
    category => "Conference",
    label    => "Title",
    project  => (
      method    => umap,
      metric    => cosine,
      neighbors => 15,
      min_dist  => 0.1
    )
  );