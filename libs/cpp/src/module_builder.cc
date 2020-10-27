// Copyright (c) 2020 The DashQL Authors

#include <string_view>
#include <optional>
#include <iostream>

#include "dashql/parser/common/variant.h"
#include "dashql/parser/module_builder.h"

using namespace std;
namespace fb = flatbuffers;

namespace dashql {
namespace parser {

/// Write as flatbuffer
fb::Offset<proto::syntax::ModuleSections> SectionsBuilder::write(fb::FlatBufferBuilder& builder) {
    optional<fb::Offset<fb::Vector<double>>> numbers;
    optional<fb::Offset<fb::Vector<const proto::syntax::Span*>>> number_arrays;
    optional<fb::Offset<fb::Vector<const proto::syntax::Attribute*>>> attributes;
    optional<fb::Offset<fb::Vector<const proto::syntax::Object*>>> objects;
    optional<fb::Offset<fb::Vector<const proto::syntax::Span*>>> object_arrays;

    if (!_numbers.empty())
        numbers = builder.CreateVector(_numbers);
    if (!_number_arrays.empty())
        number_arrays = builder.CreateVectorOfStructs(_number_arrays);
    if (!_attributes.empty())
        attributes = builder.CreateVectorOfStructs(_attributes);
    if (!_objects.empty())
        objects = builder.CreateVectorOfStructs(_objects);
    if (!_object_arrays.empty())
        object_arrays = builder.CreateVectorOfStructs(_object_arrays);

    proto::syntax::ModuleSectionsBuilder sectionsBuilder{builder};
    if (numbers)
        sectionsBuilder.add_numbers(*numbers);
    if (number_arrays)
        sectionsBuilder.add_number_arrays(*number_arrays);
    if (attributes)
        sectionsBuilder.add_attributes(*attributes);
    if (objects)
        sectionsBuilder.add_objects(*objects);
    if (object_arrays)
        sectionsBuilder.add_object_arrays(*object_arrays);
    return sectionsBuilder.Finish();
}

/// Write the module
fb::Offset<proto::syntax::Module> ModuleBuilder::write(fb::FlatBufferBuilder& builder) {
    auto sec_ofs = _sections.write(builder);
    auto stmt_vec = builder.CreateVector(_statements);
    auto error_vec = builder.CreateVector(_errors);
    proto::syntax::ModuleBuilder moduleBuilder{builder};
    moduleBuilder.add_sections(sec_ofs);
    moduleBuilder.add_statements(stmt_vec);
    moduleBuilder.add_errors(error_vec);
    return moduleBuilder.Finish();
}

}  // namespace parser
}  // namespace dashql
