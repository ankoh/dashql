//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/parser/tql/tql_syntax.h"

namespace tigon {
    namespace tql {

        const char* VizStatement::getTypeName() {
            switch (type) {
                case Type::Area:
                    return "Area";
                case Type::Bar:
                    return "Bar";
                case Type::Box:
                    return "Box";
                case Type::Bubble:
                    return "Bubble";
                case Type::Grid:
                    return "Grid";
                case Type::Histogram:
                    return "Histogram";
                case Type::Line:
                    return "Line";
                case Type::Number:
                    return "Number";
                case Type::Pie:
                    return "Pie";
                case Type::Point:
                    return "Point";
                case Type::Scatter:
                    return "Scatter";
                case Type::Table:
                    return "Table";
                case Type::Text:
                    return "Text";
            }
        }

    } // namespace tql
} // namespace tigon
