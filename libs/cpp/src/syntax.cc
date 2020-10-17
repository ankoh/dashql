// Copyright (c) 2020 The DashQL Authors

#include "dashql/parser/syntax.h"

namespace dashql {
namespace parser {

const char* VizStatement::getTypeName() {
    switch (viz_type.type) {
        case VizStatement::VizType::Type::Area:
            return "Area";
        case VizStatement::VizType::Type::Bar:
            return "Bar";
        case VizStatement::VizType::Type::Box:
            return "Box";
        case VizStatement::VizType::Type::Bubble:
            return "Bubble";
        case VizStatement::VizType::Type::Grid:
            return "Grid";
        case VizStatement::VizType::Type::Histogram:
            return "Histogram";
        case VizStatement::VizType::Type::Line:
            return "Line";
        case VizStatement::VizType::Type::Number:
            return "Number";
        case VizStatement::VizType::Type::Pie:
            return "Pie";
        case VizStatement::VizType::Type::Point:
            return "Point";
        case VizStatement::VizType::Type::Scatter:
            return "Scatter";
        case VizStatement::VizType::Type::Table:
            return "Table";
        case VizStatement::VizType::Type::Text:
            return "Text";
    }
}

} // namespace parser
} // namespace dashql
