//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_PARSER_TQL_TQL_SYNTAX_H_
#define INCLUDE_TIGON_PARSER_TQL_TQL_SYNTAX_H_

#include <map>
#include <memory>
#include <optional>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>

namespace tigon {
    namespace tql {
        /// A location within the program text
        struct Location {
            /// A position
            struct Position {
                /// The line
                uint32_t line;

                /// The column
                uint32_t column;
            };

            /// The starting position
            Position begin;

            /// The finishing position
            Position end;
        };

        struct String {
            /// The location
            Location location;

            /// The string
            std::string_view string;
        };

        /// A data type
        struct DataType {
            enum class Type { Integer, Float, Text, Date, DateTime, Time };

            /// The location
            Location location;

            /// The type
            Type type;
        };

        /// A parameter declaration
        struct ParameterDeclaration {
            /// The location
            Location location;

            /// The parameter name
            String name;

            /// The data type
            DataType data_type;
        };

        /// A raw sql statement
        struct QueryStatement {
            /// The location
            Location location;

            /// The query name (if any)
            std::optional<String> name;

            /// The query text
            String query_text;
        };

        /// A load statement
        struct LoadStatement {
            /// A HTTP loader
            struct HTTPLoader {
                /// A HTTP method
                struct Method {
                    /// A HTTP verb
                    enum class Verb { Get, Put, Post };

                    /// The location
                    Location location;

                    /// The HTTP verb
                    Verb verb;
                };

                /// An URL
                struct URL {
                    /// The location
                    Location location;

                    /// The url
                    std::string_view url;
                };

                using Attribute = std::variant<Method, URL>;

                /// Attributes
                struct Attributes {
                    /// The location
                    Location location;

                    /// The attributes
                    std::vector<Attribute> attributes;
                };

                /// The location
                Location location;

                /// The attributes
                Attributes attributes;
            };

            /// A file loader
            struct FileLoader {
                /// The location
                Location location;
            };

            using LoadMethod = std::variant<HTTPLoader, FileLoader>;

            /// The location
            Location location;

            /// The name
            String name;

            /// The method
            LoadMethod method;
        };

        /// An extract statement
        struct ExtractStatement {
            /// An extractor that uses JSONPath
            struct JSONPathExtract {
                /// The location
                Location location;
            };

            /// An extractor that uses CSV
            struct CSVExtract {
                /// The location
                Location location;
            };

            using ExtractMethod = std::variant<JSONPathExtract, CSVExtract>;

            /// The location
            Location location;

            /// The name
            String name;

            /// The data name
            String data_name;

            /// The method
            ExtractMethod method;
        };

        /// A viz statement
        struct VizStatement {
            /// A viz type
            struct VizType {
                /// A type
                enum class Type { Area = 0, Bar = 1, Box = 2, Bubble = 3, Grid = 4, Histogram = 5, Line = 6, Number = 7, Pie = 8, Point = 9, Scatter = 10, Table = 11, Text = 12 };

                /// The location
                Location location;

                /// The type
                Type type;
            };

            /// Get the type name
            const char* getTypeName();

            /// The location
            Location location;

            /// The name
            String name;

            /// The query name
            String query_name;

            /// The viz type
            VizType viz_type;
        };

        /// A statement
        using Statement = std::variant<ParameterDeclaration, ExtractStatement, LoadStatement, QueryStatement, VizStatement>;

        /// An error
        struct Error {
            /// The location
            Location location;

            /// The message
            const std::string& message;
        };

        /// A module
        struct Module {
            /// The statements
            std::vector<Statement> statements;

            /// The errors
            std::vector<Error> errors;
        };
    } // namespace tql
} // namespace tigon

#endif // INCLUDE_TIGON_PARSER_TQL_TQL_SYNTAX_H_
