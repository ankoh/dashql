#include "dashql/visualize/vegalite.h"

#include <string>
#include <unordered_map>
#include <vector>

#include "rapidjson/document.h"

namespace dashql::visualize {

namespace {

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

void AppendChannel(std::string& out, const std::string& channel_name, const rapidjson::Value& channel_obj,
                   const std::string& indent) {
    out += channel_name;
    out += " => (";

    std::vector<std::string> parts;

    if (channel_obj.HasMember("field") && channel_obj["field"].IsString()) {
        parts.push_back(std::string("field => ") + channel_obj["field"].GetString());
    }
    if (channel_obj.HasMember("type") && channel_obj["type"].IsString()) {
        parts.push_back(std::string("type => ") + channel_obj["type"].GetString());
    }
    if (channel_obj.HasMember("aggregate") && channel_obj["aggregate"].IsString()) {
        parts.push_back(std::string("aggregate => ") + channel_obj["aggregate"].GetString());
    }
    if (channel_obj.HasMember("bin")) {
        auto& bin_val = channel_obj["bin"];
        if (bin_val.IsBool()) {
            parts.push_back(std::string("bin => ") + (bin_val.GetBool() ? "true" : "false"));
        } else if (bin_val.IsObject()) {
            std::string bin_str = "bin => (";
            bool first = true;
            for (auto it = bin_val.MemberBegin(); it != bin_val.MemberEnd(); ++it) {
                if (!first) bin_str += ", ";
                first = false;
                bin_str += it->name.GetString();
                bin_str += " => ";
                if (it->value.IsBool()) {
                    bin_str += it->value.GetBool() ? "true" : "false";
                } else if (it->value.IsInt()) {
                    bin_str += std::to_string(it->value.GetInt());
                } else if (it->value.IsDouble()) {
                    auto v = it->value.GetDouble();
                    if (v == static_cast<int64_t>(v)) {
                        bin_str += std::to_string(static_cast<int64_t>(v));
                    } else {
                        bin_str += std::to_string(v);
                    }
                }
            }
            bin_str += ")";
            parts.push_back(std::move(bin_str));
        }
    }
    if (channel_obj.HasMember("timeUnit") && channel_obj["timeUnit"].IsString()) {
        parts.push_back(std::string("time_unit => ") + channel_obj["timeUnit"].GetString());
    }

    auto write_sub_object = [&](const char* json_key, const char* dashql_key) {
        if (!channel_obj.HasMember(json_key) || !channel_obj[json_key].IsObject()) return;
        auto& obj = channel_obj[json_key];
        std::string sub = std::string(dashql_key) + " => (";
        bool first = true;
        for (auto it = obj.MemberBegin(); it != obj.MemberEnd(); ++it) {
            if (!first) sub += ", ";
            first = false;

            std::string key_name = it->name.GetString();
            // Convert camelCase JSON keys to snake_case DashQL keys
            std::string lower_key;
            for (char c : key_name) {
                if (std::isupper(c)) {
                    if (!lower_key.empty()) lower_key += '_';
                    lower_key += std::tolower(c);
                } else {
                    lower_key += c;
                }
            }

            sub += lower_key;
            sub += " => ";
            if (it->value.IsBool()) {
                sub += it->value.GetBool() ? "true" : "false";
            } else if (it->value.IsInt()) {
                sub += std::to_string(it->value.GetInt());
            } else if (it->value.IsDouble()) {
                auto v = it->value.GetDouble();
                if (v == static_cast<int64_t>(v)) {
                    sub += std::to_string(static_cast<int64_t>(v));
                } else {
                    sub += std::to_string(v);
                }
            } else if (it->value.IsString()) {
                sub += it->value.GetString();
            } else if (it->value.IsArray()) {
                sub += "[";
                for (rapidjson::SizeType ai = 0; ai < it->value.Size(); ++ai) {
                    if (ai > 0) sub += ", ";
                    auto& elem = it->value[ai];
                    if (elem.IsInt()) {
                        sub += std::to_string(elem.GetInt());
                    } else if (elem.IsDouble()) {
                        auto v = elem.GetDouble();
                        if (v == static_cast<int64_t>(v)) {
                            sub += std::to_string(static_cast<int64_t>(v));
                        } else {
                            sub += std::to_string(v);
                        }
                    } else if (elem.IsString()) {
                        sub += "'";
                        sub += elem.GetString();
                        sub += "'";
                    } else if (elem.IsBool()) {
                        sub += elem.GetBool() ? "true" : "false";
                    }
                }
                sub += "]";
            }
        }
        sub += ")";
        parts.push_back(std::move(sub));
    };

    write_sub_object("scale", "scale");
    write_sub_object("axis", "axis");
    write_sub_object("legend", "legend");

    for (size_t i = 0; i < parts.size(); ++i) {
        if (i > 0) out += ", ";
        out += parts[i];
    }
    out += ")";
}

}  // namespace

std::string ParseVegaLiteToVisualize(const std::string& vegalite_json) {
    rapidjson::Document doc;
    doc.Parse(vegalite_json.c_str());
    if (doc.HasParseError() || !doc.IsObject()) {
        return "";
    }

    std::string source;
    bool source_is_sql = false;
    if (doc.HasMember("data") && doc["data"].IsObject()) {
        auto& data = doc["data"];
        if (data.HasMember("$sql") && data["$sql"].IsString()) {
            source = data["$sql"].GetString();
            source_is_sql = true;
        } else if (data.HasMember("name") && data["name"].IsString()) {
            source = data["name"].GetString();
        }
    }

    std::string mark;
    if (doc.HasMember("mark") && doc["mark"].IsString()) {
        mark = doc["mark"].GetString();
    }

    auto is_simple_ident = [](const std::string& s) {
        if (s.empty()) return false;
        if (!std::isalpha(static_cast<unsigned char>(s[0])) && s[0] != '_') return false;
        for (char c : s) {
            if (!std::isalnum(static_cast<unsigned char>(c)) && c != '_') return false;
        }
        return true;
    };

    std::string result = "VISUALIZE ";
    if (!source.empty()) {
        if (source_is_sql) {
            result += '(';
            result += source;
            result += ')';
        } else if (is_simple_ident(source)) {
            result += source;
        } else {
            result += '"';
            result += source;
            result += '"';
        }
        result += " ";
    }
    result += "AS (\n";
    result += "  mark => ";
    result += mark;

    if (doc.HasMember("title") && doc["title"].IsString()) {
        result += ",\n  title => ";
        result += doc["title"].GetString();
    }
    if (doc.HasMember("width") && doc["width"].IsInt()) {
        result += ",\n  width => ";
        result += std::to_string(doc["width"].GetInt());
    }
    if (doc.HasMember("height") && doc["height"].IsInt()) {
        result += ",\n  height => ";
        result += std::to_string(doc["height"].GetInt());
    }

    if (doc.HasMember("encoding") && doc["encoding"].IsObject()) {
        result += ",\n  encoding => (\n";
        auto& encoding = doc["encoding"];
        bool first_channel = true;
        for (auto it = encoding.MemberBegin(); it != encoding.MemberEnd(); ++it) {
            if (!it->value.IsObject()) continue;
            std::string_view json_key(it->name.GetString(), it->name.GetStringLength());
            auto channel_it = VEGALITE_TO_CHANNEL_KEY.find(json_key);
            if (channel_it == VEGALITE_TO_CHANNEL_KEY.end()) continue;

            if (!first_channel) result += ",\n";
            first_channel = false;
            result += "    ";
            AppendChannel(result, std::string(channel_it->second), it->value, "    ");
        }
        result += "\n  )";
    }

    result += "\n);";
    return result;
}

}  // namespace dashql::visualize
