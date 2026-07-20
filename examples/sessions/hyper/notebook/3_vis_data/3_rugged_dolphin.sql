select 
	"Year", "Title", "Conference", "Link", "PaperType", "Award",
	"CitationCount_CrossRef", "PubsCited_CrossRef"
from external('/home/local/Desktop/selection-1784529321483.embeddings.parquet', format=>'parquet')