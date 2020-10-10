%%

[\t ]+  ;
\n      ;

,   ","
;   ";"
'   "'"
"   '"'
\.  "."
\(  "("
\)  ")"
\[  '['
\]  ']'
\*  "*"
\+  "+"
=   "="

(?i)as          "AS"
(?i)date        "DATE"
(?i)datetime    "DATETIME"
(?i)declare     "DECLARE"
(?i)extract     "EXTRACT"
(?i)file        "FILE"
(?i)float       "FLOAT"
(?i)integer     "INTEGER"
(?i)load        "LOAD"
(?i)parameter   "PARAMETER"
(?i)query       "QUERY"
(?i)text        "TEXT"
(?i)time        "TIME"
(?i)type        "TYPE"
(?i)visualize   "VISUALIZE"

'(\\.|[^\\'])*'     "SINGLY_QUOTED_STRING"
"(\\.|[^\\"])*"     "DOUBLY_QUOTED_STRING"
(?i)[a-z][a-z0-9_]* "IDENTIFIER"
