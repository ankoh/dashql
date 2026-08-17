select
	"Year", "Title", "Conference", "Link", "PaperType", "Award",
	"CitationCount_CrossRef", "PubsCited_CrossRef", "embedding"
from external('/mnt/home/Desktop/selection-1784529321483.embeddings.fixed.parquet', format=>'parquet')
