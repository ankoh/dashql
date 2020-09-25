//---------------------------------------------------------------------------
// DashQL
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_PARSER_TQL_TQL_PARSE_CONTEXT_H_
#define INCLUDE_TIGON_PARSER_TQL_TQL_PARSE_CONTEXT_H_

#include <map>
#include <memory>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>
#include "dashql/parser/tql/tql_syntax.h"

namespace dashql {
    namespace tql {
        // Schema parse context
        class ParseContext {
            friend class Parser;

          protected:
            /// Trace the scanning
            bool trace_scanning;

            /// Trace the parsing
            bool trace_parsing;

            /// The statements
            std::vector<Statement> statements;

            /// The errors
            std::vector<Error> errors;

            /// Begin a scan
            void beginScan(std::string_view in);

            /// End a scan
            void endScan();

          public:
            /// Constructor
            explicit ParseContext(bool trace_scanning = false, bool trace_parsing = false);

            /// Destructor
            virtual ~ParseContext();

            /// Parse an istream
            Module Parse(std::string_view in);

            /// Throw an error
            void RaiseError(Location location, const std::string& message);

            /// Define a statement
            void DefineStatement(Statement statement, Location location);
        };

    } // namespace tql
} // namespace dashql

#endif // INCLUDE_TIGON_PARSER_TQL_TQL_PARSE_CONTEXT_H_
