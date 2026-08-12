#include "dashql/visualize/vegalite.h"

#include <cctype>
#include <cmath>
#include <cstdio>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "rapidjson/document.h"

namespace dashql::visualize {

namespace {

/// Encoding channels we can emit (Vega-Lite name -> DSL channel keyword).
/// Mirrors `CHANNEL_KEY_TO_VEGALITE` in `vegalite_generator.cc` (inverted).
static const std::unordered_map<std::string_view, std::string_view> VEGALITE_TO_CHANNEL_KEY = {
    {"x", "x"},
    {"y", "y"},
    {"x2", "x2"},
    {"y2", "y2"},
    {"color", "color"},
    {"fill", "fill"},
    {"stroke", "stroke"},
    {"fillOpacity", "fill_opacity"},
    {"strokeOpacity", "stroke_opacity"},
    {"strokeWidth", "stroke_width"},
    {"strokeDash", "stroke_dash"},
    {"opacity", "opacity"},
    {"size", "size"},
    {"shape", "shape"},
    {"angle", "angle"},
    {"theta", "theta"},
    {"theta2", "theta2"},
    {"radius", "radius"},
    {"radius2", "radius2"},
    {"detail", "detail"},
    {"order", "order"},
    {"tooltip", "tooltip"},
    {"text", "text"},
    {"row", "row"},
    {"column", "column"},
    {"facet", "facet"},
    {"href", "href"},
    {"url", "url"},
    {"key", "key"},
    {"latitude", "latitude"},
    {"longitude", "longitude"},
    {"latitude2", "latitude2"},
    {"longitude2", "longitude2"},
    {"xOffset", "x_offset"},
    {"yOffset", "y_offset"},
};

/// A simple SQL identifier: starts with a letter/underscore, followed by alnum/underscore.
bool IsSimpleIdent(std::string_view s) {
    if (s.empty()) return false;
    if (!std::isalpha(static_cast<unsigned char>(s[0])) && s[0] != '_') return false;
    for (char c : s) {
        if (!std::isalnum(static_cast<unsigned char>(c)) && c != '_') return false;
    }
    return true;
}

/// Convert a camelCase JSON key to a snake_case DSL key (e.g. `labelAngle` -> `label_angle`).
std::string ToSnakeCase(std::string_view key_name) {
    std::string out;
    for (char c : key_name) {
        if (std::isupper(static_cast<unsigned char>(c))) {
            if (!out.empty()) out += '_';
            out += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        } else {
            out += c;
        }
    }
    return out;
}

/// Emit an identifier value: bare when it is a simple identifier, double-quoted otherwise.
/// Used for column-ish references (`field`, `aggregate`, `time_unit`) and source name segments.
std::string EmitIdentifier(std::string_view s) {
    if (IsSimpleIdent(s)) return std::string(s);
    std::string out = "\"";
    for (char c : s) {
        if (c == '"') out += "\"\"";
        else out += c;
    }
    out += "\"";
    return out;
}

/// Emit a single-quoted SQL string literal, escaping embedded quotes.
std::string EmitStringLiteral(std::string_view s) {
    std::string out = "'";
    for (char c : s) {
        if (c == '\'') out += "''";
        else out += c;
    }
    out += "'";
    return out;
}

/// Format a JSON number as a bare DSL numeric literal (integral values without a fractional part).
std::string EmitNumber(const rapidjson::Value& v) {
    if (v.IsInt()) return std::to_string(v.GetInt());
    if (v.IsUint()) return std::to_string(v.GetUint());
    if (v.IsInt64()) return std::to_string(v.GetInt64());
    if (v.IsUint64()) return std::to_string(v.GetUint64());
    double d = v.GetDouble();
    if (std::isfinite(d) && d == static_cast<double>(static_cast<int64_t>(d)) && std::abs(d) < 1e15) {
        return std::to_string(static_cast<int64_t>(d));
    }
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%g", d);
    return std::string(buf);
}

/// Emit a scalar JSON value (string/number/bool) as a DSL value.
/// `as_ident` selects string handling: identifiers (bare-or-quoted) vs. string literals (quoted).
/// Returns nullopt for unrepresentable values (null/object).
std::optional<std::string> EmitScalar(const rapidjson::Value& v, bool as_ident) {
    if (v.IsString()) {
        return as_ident ? EmitIdentifier(v.GetString()) : EmitStringLiteral(v.GetString());
    }
    if (v.IsBool()) return v.GetBool() ? std::string("true") : std::string("false");
    if (v.IsNumber()) return EmitNumber(v);
    return std::nullopt;
}

/// Emit a value that may be a scalar or an array of scalars (`[a, b, …]`).
/// String array elements are always quoted as string literals.
std::optional<std::string> EmitValue(const rapidjson::Value& v, bool as_ident) {
    if (v.IsArray()) {
        std::string out = "[";
        bool first = true;
        for (rapidjson::SizeType i = 0; i < v.Size(); ++i) {
            auto elem = EmitScalar(v[i], false);
            if (!elem) continue;
            if (!first) out += ", ";
            first = false;
            out += *elem;
        }
        out += "]";
        return out;
    }
    return EmitScalar(v, as_ident);
}

/// Emit a `( k => v, … )` sub-object, mapping camelCase JSON keys to snake_case DSL keys.
/// `type` is treated as an enum keyword (bare, lower-cased) when `type_is_enum` is set (scales).
/// Unknown / unrepresentable members are dropped. Returns nullopt if nothing was emitted.
std::optional<std::string> EmitSubObject(const rapidjson::Value& obj, bool type_is_enum) {
    std::vector<std::string> parts;
    for (auto it = obj.MemberBegin(); it != obj.MemberEnd(); ++it) {
        std::string key = it->name.GetString();
        if (type_is_enum && key == "type") {
            if (it->value.IsString()) {
                std::string ty = it->value.GetString();
                for (auto& c : ty) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
                parts.push_back("type => " + ty);
            }
            continue;
        }
        auto emitted = EmitValue(it->value, /*as_ident=*/false);
        if (!emitted) continue;
        parts.push_back(ToSnakeCase(key) + " => " + *emitted);
    }
    if (parts.empty()) return std::nullopt;
    std::string out = "(";
    for (size_t i = 0; i < parts.size(); ++i) {
        if (i > 0) out += ", ";
        out += parts[i];
    }
    out += ")";
    return out;
}

/// Emit a mark definition `( type => …, point => (…), filled => …, … )` from a Vega-Lite
/// mark object. `type` is a bare enum keyword; `point` / `line` recurse (a boolean toggle
/// stays a boolean, a nested object becomes a parenthesised sub-mark).
std::string EmitMark(const rapidjson::Value& obj) {
    std::vector<std::string> parts;
    for (auto it = obj.MemberBegin(); it != obj.MemberEnd(); ++it) {
        std::string key = it->name.GetString();
        if (key == "type") {
            if (it->value.IsString()) {
                std::string ty = it->value.GetString();
                for (auto& c : ty) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
                parts.push_back("type => " + ty);
            }
            continue;
        }
        if (key == "point" || key == "line") {
            if (it->value.IsObject()) {
                parts.push_back(key + " => " + EmitMark(it->value));
            } else if (it->value.IsBool()) {
                parts.push_back(key + " => " + (it->value.GetBool() ? std::string("true") : std::string("false")));
            }
            continue;
        }
        auto emitted = EmitValue(it->value, /*as_ident=*/false);
        if (!emitted) continue;
        parts.push_back(ToSnakeCase(key) + " => " + *emitted);
    }
    if (parts.empty()) return "()";
    std::string out = "(";
    for (size_t i = 0; i < parts.size(); ++i) {
        if (i > 0) out += ", ";
        out += parts[i];
    }
    out += ")";
    return out;
}

/// Emit a `bin => …` value. Vega-Lite allows `true`/`false` or an object of bin parameters.
std::optional<std::string> EmitBin(const rapidjson::Value& bin) {
    if (bin.IsBool()) return bin.GetBool() ? std::string("true") : std::string("false");
    if (bin.IsObject()) {
        std::vector<std::string> parts;
        for (auto it = bin.MemberBegin(); it != bin.MemberEnd(); ++it) {
            auto emitted = EmitScalar(it->value, /*as_ident=*/false);
            if (!emitted) continue;
            // Bin parameters (maxbins, step, …) are already lower-case single words.
            parts.push_back(std::string(it->name.GetString()) + " => " + *emitted);
        }
        if (parts.empty()) return std::string("true");
        std::string out = "(";
        for (size_t i = 0; i < parts.size(); ++i) {
            if (i > 0) out += ", ";
            out += parts[i];
        }
        out += ")";
        return out;
    }
    return std::nullopt;
}

/// The field-definition keys whose values are column-ish identifiers (emitted bare-or-quoted
/// rather than as string literals). Everything else is treated as a string literal / scalar.
bool IsIdentifierFieldKey(std::string_view dsl_key) {
    return dsl_key == "field" || dsl_key == "aggregate" || dsl_key == "time_unit";
}

/// Append one encoding channel `<channel> => (field => …, type => …, …)` to `out`.
void AppendChannel(std::string& out, std::string_view channel_name, const rapidjson::Value& channel_obj) {
    out += channel_name;
    out += " => (";

    std::vector<std::string> parts;

    if (channel_obj.HasMember("field") && channel_obj["field"].IsString()) {
        parts.push_back("field => " + EmitIdentifier(channel_obj["field"].GetString()));
    }
    if (channel_obj.HasMember("type") && channel_obj["type"].IsString()) {
        std::string ty = channel_obj["type"].GetString();
        for (auto& c : ty) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        parts.push_back("type => " + ty);
    }
    if (channel_obj.HasMember("aggregate") && channel_obj["aggregate"].IsString()) {
        parts.push_back("aggregate => " + EmitIdentifier(channel_obj["aggregate"].GetString()));
    }
    if (channel_obj.HasMember("bin")) {
        auto bin = EmitBin(channel_obj["bin"]);
        if (bin) parts.push_back("bin => " + *bin);
    }
    if (channel_obj.HasMember("timeUnit") && channel_obj["timeUnit"].IsString()) {
        parts.push_back("time_unit => " + EmitIdentifier(channel_obj["timeUnit"].GetString()));
    }
    if (channel_obj.HasMember("scale") && channel_obj["scale"].IsObject()) {
        auto scale = EmitSubObject(channel_obj["scale"], /*type_is_enum=*/true);
        if (scale) parts.push_back("scale => " + *scale);
    }
    if (channel_obj.HasMember("axis") && channel_obj["axis"].IsObject()) {
        auto axis = EmitSubObject(channel_obj["axis"], /*type_is_enum=*/false);
        if (axis) parts.push_back("axis => " + *axis);
    }
    if (channel_obj.HasMember("legend") && channel_obj["legend"].IsObject()) {
        auto legend = EmitSubObject(channel_obj["legend"], /*type_is_enum=*/false);
        if (legend) parts.push_back("legend => " + *legend);
    }
    // Remaining simple field-def keys (sort, stack, title, format, …).
    for (auto it = channel_obj.MemberBegin(); it != channel_obj.MemberEnd(); ++it) {
        std::string_view key(it->name.GetString(), it->name.GetStringLength());
        if (key == "field" || key == "type" || key == "aggregate" || key == "bin" || key == "timeUnit" ||
            key == "scale" || key == "axis" || key == "legend") {
            continue;
        }
        std::string dsl_key = ToSnakeCase(key);
        auto emitted = EmitValue(it->value, IsIdentifierFieldKey(dsl_key));
        if (!emitted) continue;
        parts.push_back(dsl_key + " => " + *emitted);
    }

    for (size_t i = 0; i < parts.size(); ++i) {
        if (i > 0) out += ", ";
        out += parts[i];
    }
    out += ")";
}

std::optional<std::string> EmitResolveMap(const rapidjson::Value& obj) {
    if (!obj.IsObject()) return std::nullopt;
    std::vector<std::string> parts;
    for (auto it = obj.MemberBegin(); it != obj.MemberEnd(); ++it) {
        std::string_view json_key(it->name.GetString(), it->name.GetStringLength());
        auto channel = VEGALITE_TO_CHANNEL_KEY.find(json_key);
        if (channel == VEGALITE_TO_CHANNEL_KEY.end()) continue;
        auto value = EmitScalar(it->value, /*as_ident=*/true);
        if (!value) continue;
        parts.push_back(std::string(channel->second) + " => " + *value);
    }
    if (parts.empty()) return std::nullopt;
    std::string out = "(";
    for (size_t i = 0; i < parts.size(); ++i) {
        if (i > 0) out += ", ";
        out += parts[i];
    }
    out += ")";
    return out;
}

void AppendVegaLiteSpecLines(const rapidjson::Value& spec, std::vector<std::string>& lines, std::string_view indent) {
    if (!spec.IsObject()) return;
    std::string prefix(indent);

    if (spec.HasMember("mark")) {
        const auto& mark_val = spec["mark"];
        if (mark_val.IsString()) {
            std::string mark = mark_val.GetString();
            for (auto& c : mark) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            lines.push_back(prefix + "mark => " + mark);
        } else if (mark_val.IsObject()) {
            if (mark_val.MemberCount() == 1 && mark_val.HasMember("type") && mark_val["type"].IsString()) {
                std::string mark = mark_val["type"].GetString();
                for (auto& c : mark) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
                lines.push_back(prefix + "mark => " + mark);
            } else if (mark_val.MemberCount() > 0) {
                lines.push_back(prefix + "mark => " + EmitMark(mark_val));
            }
        }
    }

    if (spec.HasMember("title") && spec["title"].IsString()) {
        lines.push_back(prefix + "title => " + EmitStringLiteral(spec["title"].GetString()));
    }
    if (spec.HasMember("width") && spec["width"].IsNumber()) {
        lines.push_back(prefix + "width => " + EmitNumber(spec["width"]));
    }
    if (spec.HasMember("height") && spec["height"].IsNumber()) {
        lines.push_back(prefix + "height => " + EmitNumber(spec["height"]));
    }

    if (spec.HasMember("encoding") && spec["encoding"].IsObject()) {
        const auto& encoding = spec["encoding"];
        std::vector<std::string> channels;
        for (auto it = encoding.MemberBegin(); it != encoding.MemberEnd(); ++it) {
            if (!it->value.IsObject()) continue;
            std::string_view json_key(it->name.GetString(), it->name.GetStringLength());
            auto channel_it = VEGALITE_TO_CHANNEL_KEY.find(json_key);
            if (channel_it == VEGALITE_TO_CHANNEL_KEY.end()) continue;
            std::string channel = prefix + "  ";
            AppendChannel(channel, channel_it->second, it->value);
            channels.push_back(std::move(channel));
        }
        if (!channels.empty()) {
            std::string encoding_block = prefix + "encoding => (\n";
            for (size_t i = 0; i < channels.size(); ++i) {
                if (i > 0) encoding_block += ",\n";
                encoding_block += channels[i];
            }
            encoding_block += "\n" + prefix + ")";
            lines.push_back(std::move(encoding_block));
        }
    }

    if (spec.HasMember("layer") && spec["layer"].IsArray()) {
        std::vector<std::string> layers;
        for (const auto& layer : spec["layer"].GetArray()) {
            if (!layer.IsObject()) continue;
            std::vector<std::string> layer_lines;
            AppendVegaLiteSpecLines(layer, layer_lines, std::string(indent) + "    ");
            if (layer_lines.empty()) continue;
            std::string block = prefix + "  (\n";
            for (size_t i = 0; i < layer_lines.size(); ++i) {
                if (i > 0) block += ",\n";
                block += layer_lines[i];
            }
            block += "\n" + prefix + "  )";
            layers.push_back(std::move(block));
        }
        if (!layers.empty()) {
            std::string block = prefix + "layer => [\n";
            for (size_t i = 0; i < layers.size(); ++i) {
                if (i > 0) block += ",\n";
                block += layers[i];
            }
            block += "\n" + prefix + "]";
            lines.push_back(std::move(block));
        }
    }

    if (spec.HasMember("resolve") && spec["resolve"].IsObject()) {
        const auto& resolve = spec["resolve"];
        std::vector<std::string> parts;
        for (const char* key : {"scale", "axis", "legend"}) {
            if (!resolve.HasMember(key)) continue;
            auto value = EmitResolveMap(resolve[key]);
            if (value) parts.push_back(std::string(key) + " => " + *value);
        }
        if (!parts.empty()) {
            std::string block = prefix + "resolve => (";
            for (size_t i = 0; i < parts.size(); ++i) {
                if (i > 0) block += ", ";
                block += parts[i];
            }
            block += ")";
            lines.push_back(std::move(block));
        }
    }
}

/// Emit the query input before the VISUALIZE pipe from the spec's `data` member.
///
/// Recognised conventions (the analyzer-driven generator emits `name` / `$sql`; the agent loop
/// injects `$ref` / `$raw` for qualified- and verbatim-source edits):
///   - `{ "$sql": "SELECT …" }`           -> query text
///   - `{ "$raw": "<text>" }`             -> verbatim query text
std::optional<std::string> EmitSource(const rapidjson::Value& data) {
    if (!data.IsObject()) return std::nullopt;
    if (data.HasMember("$sql") && data["$sql"].IsString()) {
        std::string sql = data["$sql"].GetString();
        return sql.empty() ? std::nullopt : std::optional<std::string>(std::move(sql));
    }
    if (data.HasMember("$raw") && data["$raw"].IsString()) {
        std::string raw = data["$raw"].GetString();
        return raw.empty() ? std::nullopt : std::optional<std::string>(raw);
    }
    return std::nullopt;
}

}  // namespace

std::string ParseVegaLiteToVisualize(const std::string& vegalite_json) {
    rapidjson::Document doc;
    doc.Parse(vegalite_json.c_str());
    if (doc.HasParseError() || !doc.IsObject()) {
        return "";
    }

    std::vector<std::string> lines;
    AppendVegaLiteSpecLines(doc, lines, "  ");

    if (!doc.HasMember("data")) return "";
    auto source = EmitSource(doc["data"]);
    if (!source) return "";

    std::string result = *source;
    result += "\n|> VISUALIZE USING vegalite (\n";
    for (size_t i = 0; i < lines.size(); ++i) {
        if (i > 0) result += ",\n";
        result += lines[i];
    }
    result += "\n);";
    return result;
}

}  // namespace dashql::visualize
