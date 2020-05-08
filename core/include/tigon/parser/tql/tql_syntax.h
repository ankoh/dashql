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

        /// A type
        enum class Type { Integer, Float, Text, Date, DateTime, Time };

        /// A raw sql statement
        struct QueryStatement {
            /// The id (if any)
            std::string_view query_id;
            /// The sql text
            std::string_view text;

            /// Constructor
            QueryStatement(std::string_view query_id, std::string_view text): query_id(query_id), text(text) {}
        };

        /// A parameter declaration
        struct ParameterDeclaration {
            /// The parameter name
            std::string_view parameter_id;
            /// The type
            Type type;
        };

        /// A load statement
        struct LoadStatement {
            /// A http loader
            struct HTTPLoader {
                /// A http method
                enum class Method { Get, Put, Post };

                /// A URL
                std::string_view url;
                /// A method
                Method method;
            };

            /// A file loader
            struct FileLoader {};

            using LoadMethod = std::variant<std::unique_ptr<HTTPLoader>, std::unique_ptr<FileLoader>>;

            /// The name
            std::string_view data_id;
            /// The method
            LoadMethod method;
        };

        /// An extract statement
        struct ExtractStatement {
            /// An extractor that uses Jsonpath
            struct JSONPathExtract {
                /// The column definition
                struct ColumnDefinition {
                    /// The name
                    std::string_view name;
                    /// The json path
                    std::string_view json_path;
                    /// The type
                    Type type;
                };

                /// The columns
                std::vector<ColumnDefinition> columns;
            };

            /// An extractor that uses CSV
            struct CSVExtract {
                /// The column definition
                struct ColumnDefinition {
                    /// The name
                    std::string_view name;
                    /// The index within the csv
                    unsigned index;
                    /// The type
                    Type type;
                };

                /// The columns
                std::vector<ColumnDefinition> columns;
            };

            using ExtractMethod = std::variant<JSONPathExtract, CSVExtract>;

            /// The extract id
            std::string_view extract_id;
            /// The data id
            std::string_view data_id;
            /// The method
            ExtractMethod method;
        };

        struct VizStatement {
            /// A type
            enum class Type { Area = 0, Bar = 1, Box = 2, Bubble = 3, Grid = 4, Histogram = 5, Line = 6, Number = 7, Pie = 8, Point = 9, Scatter = 10, Table = 11, Text = 12 };

            /// Get the type name
            const char* getTypeName();

            /// Type flags
            enum class TypeFlag : uint64_t {
                None = 0,
                Horizontal = 1,
                Vertical = 1 << 1,
                Stacked = 1 << 2,
            };

            /// A rgb color
            struct RGBColor {
                /// The red color
                uint8_t red;
                /// The green color
                uint8_t green;
                /// The blue color
                uint8_t blue;

                /// Constructor
                RGBColor(): red(), green(), blue() {}
                /// Constructor
                RGBColor(uint8_t r, uint8_t g, uint8_t b): red(r), green(g), blue(b) {}
                /// Constructor
                RGBColor(uint32_t rgb): red(static_cast<uint8_t>(rgb & 0xFF)), green(static_cast<uint8_t>((rgb >> 8) & 0xFF)), blue(static_cast<uint8_t>((rgb >> 16) & 0xFF)) {}
            };

            /// A plot color
            struct Color {
                /// The column
                std::string_view column;
                /// The palette
                std::vector<RGBColor> palette;
            };

            /// A layout class
            enum class SizeClass {
                Wildcard,
                Small,
                Medium,
                Large,
                ExtraLarge,
            };

            /// A grid area
            struct GridArea {
                /// The values
                std::array<uint32_t, 4> values;
                /// The length
                uint32_t length;

                /// Constructor
                GridArea(): values({0, 0, 0, 0}), length(0) {}
                /// Constructor
                GridArea(uint32_t colBegin): values({colBegin, 0, 0, 0}), length(1) {}

                /// Push a new value
                void push(uint32_t value) {
                    if (length == 4) {
                        // XXX just ignore?
                        return;
                    }
                    values[length++] = value;
                }
            };

            /// A layout length
            struct ResponsiveGridArea {
                /// Wildcard
                std::optional<GridArea> wildcard;
                /// Small displays
                std::optional<GridArea> sm;
                /// Medium displays
                std::optional<GridArea> md;
                /// Large displays
                std::optional<GridArea> lg;
                /// Extra large displays
                std::optional<GridArea> xl;

                /// Constructor
                ResponsiveGridArea(): wildcard(), sm(), md(), lg(), xl() {}

                /// Set a value
                void set(SizeClass size, GridArea area) {
                    switch (size) {
                        case SizeClass::Wildcard:
                            wildcard = area;
                            break;
                        case SizeClass::Small:
                            sm = area;
                            break;
                        case SizeClass::Medium:
                            md = area;
                            break;
                        case SizeClass::Large:
                            lg = area;
                            break;
                        case SizeClass::ExtraLarge:
                            xl = area;
                            break;
                    }
                }
            };

            /// The scale of an axis
            enum class AxisScale : uint8_t {
                Linear = 0,
                Logarithmic = 1,
            };

            /// An axis
            struct Axis {
                /// The column
                std::string_view column;
                /// The scale
                AxisScale scale;
            };

            /// The axes
            struct Axes {
                /// X-axis
                std::unique_ptr<Axis> x;
                /// Y-axis
                std::unique_ptr<Axis> y;
            };

            /// The viz id
            std::string_view viz_id;
            /// The query id
            std::string_view query_id;
            /// The type
            Type type;
            /// The type flags
            uint64_t type_flags;
            /// The title
            std::string_view title;
            /// The area
            std::unique_ptr<ResponsiveGridArea> area;
            /// The color
            Color color;
            /// The axes
            Axes axes;
        };

        /// A statement
        using Statement =
            std::variant<std::unique_ptr<ExtractStatement>, std::unique_ptr<LoadStatement>, std::unique_ptr<ParameterDeclaration>, std::unique_ptr<QueryStatement>, std::unique_ptr<VizStatement>>;

        /// A module
        struct Module {
            /// The statements
            std::vector<Statement> statements;
        };

    } // namespace tql
} // namespace tigon

#endif // INCLUDE_TIGON_PARSER_TQL_TQL_SYNTAX_H_
