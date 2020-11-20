// Copyright (c) 2020 The DashQL Authors

#include <sstream>

#include "flatbuffers/minireflect.h"

namespace fb = flatbuffers;

namespace {

/// An iteration visitor to emit json strings
struct ToJSONVisitor : public fb::IterationVisitor {
    /// The output stream
    std::stringstream &out;
    /// The delimiter
    const char *delimiter;
    /// The indentation
    const char *indent;
    /// The indentation level
    size_t indent_level;
    /// Should vectors be delimited?
    bool vector_delimited;

    /// Constructor
    ToJSONVisitor(std::stringstream &out, const char *delimiter, const char *indent, bool vector_delimited = true)
        : out(out), delimiter(delimiter), indent(indent), indent_level(0), vector_delimited(vector_delimited) {}

    void append_indent() {
        for (size_t i = 0; i < indent_level; i++) {
            out << indent;
        }
    }

    void StartSequence() {
        out << "{" << delimiter;
        ++indent_level;
    }

    void EndSequence() {
        out << delimiter;
        --indent_level;
        append_indent();
        out << "}";
    }

    void Field(size_t /*field_idx*/, size_t set_idx, fb::ElementaryType /*type*/, bool /*is_vector*/,
               const fb::TypeTable * /*type_table*/, const char *name, const uint8_t *val) {
        if (!val) return;
        if (set_idx > 0) {
            out << "," << delimiter;
        }
        append_indent();
        if (name) {
            out << "\"" << name << "\": ";
        }
    }

    template <typename T>
    void Named(T x, const char *name) {
        if (name) {
            out << "\"" << name << "\"";
        } else {
            out << fb::NumToString(x);
        }
    }

    void UType(uint8_t x, const char *name) { Named(x, name); }
    void Bool(bool x) { out << (x ? "true" : "false"); }
    void Char(int8_t x, const char *name) { Named(x, name); }
    void UChar(uint8_t x, const char *name) { Named(x, name); }
    void Short(int16_t x, const char *name) { Named(x, name); }
    void UShort(uint16_t x, const char *name) { Named(x, name); }
    void Int(int32_t x, const char *name) { Named(x, name); }
    void UInt(uint32_t x, const char *name) { Named(x, name); }
    void Long(int64_t x) { out << fb::NumToString(x); }
    void ULong(uint64_t x) { out << fb::NumToString(x); }
    void Float(float x) { out << fb::NumToString(x); }
    void Double(double x) { out << fb::NumToString(x); }
    void String(const struct fb::String *str) {
        std::string buffer;
        fb::EscapeString(str->c_str(), str->size(), &buffer, true, false);
        out << buffer;
    }
    void Unknown(const uint8_t *) { out << "(?)"; }

    void StartVector() {
        out << "[";
        if (vector_delimited) {
            out << delimiter;
            indent_level++;
            append_indent();
        } else {
            out << " ";
        }
    }

    void EndVector() {
        if (vector_delimited) {
            out << delimiter;
            indent_level--;
            append_indent();
        } else {
            out << " ";
        }
        out << "]";
    }

    void Element(size_t i, fb::ElementaryType /*type*/, const fb::TypeTable * /*type_table*/, const uint8_t * /*val*/) {
        if (i) {
            out << ",";
            if (vector_delimited) {
                out << delimiter;
                append_indent();
            } else {
                out << " ";
            }
        }
    }
};
}  // namespace

namespace duckdb {
namespace web {

/// Write the tql program
std::string writeJSON(void *buffer, const flatbuffers::TypeTable &type_table) {
    std::stringstream out;
    ToJSONVisitor visitor(out, "\n", "    ", true);
    fb::IterateFlatBuffer(static_cast<uint8_t *>(buffer), &type_table, &visitor);
    return out.str();
}

}  // namespace web
}  // namespace duckdb

