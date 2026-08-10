#include "dashql/shell/arrow_renderer.h"

#include <algorithm>
#include <limits>
#include <memory>
#include <string_view>
#include <utility>
#include <vector>

#include "arrow/array/array_base.h"
#include "arrow/buffer.h"
#include "arrow/ipc/reader.h"
#include "arrow/io/memory.h"
#include "arrow/record_batch.h"
#include "arrow/scalar.h"
#include "arrow/type.h"
#include "utf8proc/utf8proc_wrapper.hpp"

namespace dashql::shell {
namespace {

enum class Alignment { kLeft, kRight };

struct Cell {
    std::string text;
    Alignment alignment = Alignment::kLeft;
};

struct Table {
    std::vector<std::string> headers;
    std::vector<Alignment> alignments;
    std::vector<std::vector<Cell>> rows;
};

size_t DisplayWidth(std::string_view text) {
    if (!utf8::Utf8Proc::IsValid(text)) {
        return text.size();
    }
    size_t width = 0;
    for (size_t offset = 0; offset < text.size();) {
        width += utf8::Utf8Proc::RenderWidth(text, offset);
        const auto next = utf8::Utf8Proc::NextGraphemeCluster(text, offset);
        if (next <= offset) {
            ++offset;
        } else {
            offset = next;
        }
    }
    return width;
}

std::string EscapeCellText(std::string_view text) {
    std::string output;
    output.reserve(text.size());
    constexpr char HEX[] = "0123456789abcdef";
    for (size_t i = 0; i < text.size(); ++i) {
        const auto value = static_cast<uint8_t>(text[i]);
        if (value == '\n') {
            output.push_back('\n');
        } else if (value == '\r') {
            if (i + 1 >= text.size() || text[i + 1] != '\n') {
                output.push_back('\n');
            }
        } else if (value == '\t') {
            output.append("    ");
        } else if (value < 0x20 || value == 0x7f) {
            output.append("\\x");
            output.push_back(HEX[value >> 4]);
            output.push_back(HEX[value & 0x0f]);
        } else {
            output.push_back(text[i]);
        }
    }
    return output;
}

bool IsRightAligned(arrow::Type::type type) {
    switch (type) {
        case arrow::Type::BOOL:
        case arrow::Type::INT8:
        case arrow::Type::INT16:
        case arrow::Type::INT32:
        case arrow::Type::INT64:
        case arrow::Type::UINT8:
        case arrow::Type::UINT16:
        case arrow::Type::UINT32:
        case arrow::Type::UINT64:
        case arrow::Type::HALF_FLOAT:
        case arrow::Type::FLOAT:
        case arrow::Type::DOUBLE:
        case arrow::Type::DECIMAL32:
        case arrow::Type::DECIMAL64:
        case arrow::Type::DECIMAL128:
        case arrow::Type::DECIMAL256:
            return true;
        default:
            return false;
    }
}

arrow::Result<std::string> FormatValue(const arrow::Array& array, int64_t row) {
    if (array.IsNull(row)) {
        return std::string{};
    }
    ARROW_ASSIGN_OR_RAISE(auto scalar, array.GetScalar(row));
    return EscapeCellText(scalar->ToString());
}

arrow::Result<Table> ReadIPC(std::span<const uint8_t> data) {
    if (data.empty()) {
        return arrow::Status::Invalid("Arrow IPC buffer is empty");
    }
    auto buffer = std::make_shared<arrow::Buffer>(data.data(), static_cast<int64_t>(data.size()));
    auto input = std::make_shared<arrow::io::BufferReader>(std::move(buffer));
    ARROW_ASSIGN_OR_RAISE(auto reader, arrow::ipc::RecordBatchFileReader::Open(input));

    Table table;
    const auto& schema = reader->schema();
    table.headers.reserve(schema->num_fields());
    table.alignments.reserve(schema->num_fields());
    for (const auto& field : schema->fields()) {
        table.headers.push_back(EscapeCellText(field->name()));
        table.alignments.push_back(IsRightAligned(field->type()->id()) ? Alignment::kRight : Alignment::kLeft);
    }

    for (int batch_index = 0; batch_index < reader->num_record_batches(); ++batch_index) {
        ARROW_ASSIGN_OR_RAISE(auto batch, reader->ReadRecordBatch(batch_index));
        for (int64_t row = 0; row < batch->num_rows(); ++row) {
            std::vector<Cell> cells;
            cells.reserve(batch->num_columns());
            for (int column = 0; column < batch->num_columns(); ++column) {
                ARROW_ASSIGN_OR_RAISE(auto text, FormatValue(*batch->column(column), row));
                cells.push_back(Cell{std::move(text), table.alignments[column]});
            }
            table.rows.push_back(std::move(cells));
        }
    }
    return table;
}

std::vector<std::string> WrapText(std::string_view text, size_t width) {
    width = std::max<size_t>(width, 1);
    std::vector<std::string> lines;
    size_t line_begin = 0;
    size_t line_width = 0;
    size_t offset = 0;
    while (offset < text.size()) {
        if (text[offset] == '\n') {
            lines.emplace_back(text.substr(line_begin, offset - line_begin));
            ++offset;
            line_begin = offset;
            line_width = 0;
            continue;
        }

        size_t next = offset + 1;
        size_t grapheme_width = 1;
        if (utf8::Utf8Proc::IsValid(text)) {
            next = utf8::Utf8Proc::NextGraphemeCluster(text, offset);
            if (next <= offset) {
                next = offset + 1;
            }
            grapheme_width = DisplayWidth(text.substr(offset, next - offset));
        }
        if (line_width != 0 && line_width + grapheme_width > width) {
            lines.emplace_back(text.substr(line_begin, offset - line_begin));
            line_begin = offset;
            line_width = 0;
        }
        line_width += grapheme_width;
        offset = next;
    }
    lines.emplace_back(text.substr(line_begin));
    return lines;
}

std::vector<size_t> ResolveColumnWidths(const Table& table, size_t terminal_columns) {
    const size_t column_count = table.headers.size();
    std::vector<size_t> widths(column_count, 1);
    for (size_t column = 0; column < column_count; ++column) {
        widths[column] = std::max<size_t>(1, DisplayWidth(table.headers[column]));
    }
    for (const auto& row : table.rows) {
        for (size_t column = 0; column < std::min(row.size(), column_count); ++column) {
            for (const auto& line : WrapText(row[column].text, std::numeric_limits<size_t>::max())) {
                widths[column] = std::max(widths[column], DisplayWidth(line));
            }
        }
    }

    if (column_count == 0) {
        return widths;
    }
    const size_t frame_width = 3 * column_count + 1;
    const size_t available = terminal_columns > frame_width ? terminal_columns - frame_width : column_count;
    size_t total = 0;
    for (const auto width : widths) {
        total += width;
    }
    while (total > available) {
        auto widest = std::max_element(widths.begin(), widths.end());
        if (widest == widths.end() || *widest <= 1) {
            break;
        }
        --(*widest);
        --total;
    }
    return widths;
}

void AppendRule(std::string& output,
                std::string_view left,
                std::string_view middle,
                std::string_view right,
                std::string_view fill,
                const std::vector<size_t>& widths) {
    output.append(left);
    for (size_t column = 0; column < widths.size(); ++column) {
        if (column != 0) {
            output.append(middle);
        }
        for (size_t i = 0; i < widths[column] + 2; ++i) {
            output.append(fill);
        }
    }
    output.append(right);
    output.push_back('\n');
}

void AppendCell(std::string& output, std::string_view text, size_t width, Alignment alignment) {
    const size_t rendered = DisplayWidth(text);
    const size_t padding = rendered < width ? width - rendered : 0;
    if (alignment == Alignment::kRight) {
        output.append(padding, ' ');
    }
    output.append(text);
    if (alignment == Alignment::kLeft) {
        output.append(padding, ' ');
    }
}

void AppendRow(std::string& output,
               const std::vector<Cell>& cells,
               const std::vector<size_t>& widths,
               std::string_view separator) {
    std::vector<std::vector<std::string>> wrapped;
    wrapped.reserve(widths.size());
    size_t row_height = 1;
    for (size_t column = 0; column < widths.size(); ++column) {
        const std::string_view text = column < cells.size() ? std::string_view{cells[column].text} : std::string_view{};
        wrapped.push_back(WrapText(text, widths[column]));
        row_height = std::max(row_height, wrapped.back().size());
    }

    for (size_t line = 0; line < row_height; ++line) {
        output.append("│ ");
        for (size_t column = 0; column < widths.size(); ++column) {
            if (column != 0) {
                output.push_back(' ');
                output.append(separator);
                output.push_back(' ');
            }
            const std::string_view text = line < wrapped[column].size() ? std::string_view{wrapped[column][line]}
                                                                        : std::string_view{};
            const auto alignment = column < cells.size() ? cells[column].alignment : Alignment::kLeft;
            AppendCell(output, text, widths[column], alignment);
        }
        output.append(" │\n");
    }
}

std::string RenderTable(const Table& table, size_t terminal_columns) {
    if (table.headers.empty()) {
        return {};
    }
    const auto widths = ResolveColumnWidths(table, terminal_columns);
    std::string output;
    AppendRule(output, "╭", "┬", "╮", "─", widths);

    std::vector<Cell> headers;
    headers.reserve(table.headers.size());
    for (const auto& header : table.headers) {
        headers.push_back(Cell{header, Alignment::kLeft});
    }
    AppendRow(output, headers, widths, "│");
    AppendRule(output, "╞", "╪", "╡", "═", widths);
    for (const auto& row : table.rows) {
        AppendRow(output, row, widths, "┆");
    }
    AppendRule(output, "╰", "┴", "╯", "─", widths);
    if (!output.empty()) {
        output.pop_back();
    }
    return output;
}

}  // namespace

ArrowRenderer::ArrowRenderer(uint32_t terminal_columns) : terminal_columns_{std::max<uint32_t>(terminal_columns, 1)} {}

void ArrowRenderer::Resize(uint32_t terminal_columns) {
    terminal_columns_ = std::max<uint32_t>(terminal_columns, 1);
}

arrow::Result<std::string> ArrowRenderer::RenderIPC(std::span<const uint8_t> data) const {
    ARROW_ASSIGN_OR_RAISE(auto table, ReadIPC(data));
    return RenderTable(table, terminal_columns_);
}

}  // namespace dashql::shell
