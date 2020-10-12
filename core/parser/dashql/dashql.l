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
$   "$"

(?i)as          "AS"
(?i)date        "DATE"
(?i)datetime    "DATETIME"
(?i)declare     "DECLARE"
(?i)extract     "EXTRACT"
(?i)file        "FILE"
(?i)float       "FLOAT"
(?i)from        "FROM"
(?i)get         "GET"
(?i)http        "HTTP"
(?i)integer     "INTEGER"
(?i)load        "LOAD"
(?i)method      "METHOD"
(?i)parameter   "PARAMETER"
(?i)post        "POST"
(?i)put         "PUT"
(?i)query       "QUERY"
(?i)text        "TEXT"
(?i)time        "TIME"
(?i)type        "TYPE"
(?i)url         "URL"
(?i)visualize   "VISUALIZE"

'(\\.|[^\\'])*'     "SINGLY_QUOTED_STRING"
"(\\.|[^\\"])*"     "DOUBLY_QUOTED_STRING"
(?i)[a-z][a-z0-9_]* "IDENTIFIER"
