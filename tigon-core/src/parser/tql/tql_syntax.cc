//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/parser/tql/tql_syntax.h"

namespace tigon {
namespace tql {

template <>
struct FlatBufferWriter<DisplayStatement> {
    /// Encode a statement as flatbuffer
    static flatbuffers::Offset<void> write(DisplayStatement& target, flatbuffers::FlatBufferBuilder& builder);
};

// Encode a statement as flatbuffer
flatbuffers::Offset<void> FlatBufferWriter<DisplayStatement>::write(DisplayStatement& target, flatbuffers::FlatBufferBuilder& builder) {
    auto name = builder.CreateString(target.target);

    flatbuffers::Offset<proto::TQLDisplayLength> layoutWidth = 0;
    flatbuffers::Offset<proto::TQLDisplayLength> layoutHeight = 0;
    flatbuffers::Offset<proto::TQLDisplayAxis> axisX = 0;
    flatbuffers::Offset<proto::TQLDisplayAxis> axisY = 0;

    if (!!target.layout.width) {
        layoutWidth = proto::CreateTQLDisplayLength(builder);
    }
    if (!!target.layout.height) {
        layoutHeight = proto::CreateTQLDisplayLength(builder);
    }
    if (!!target.axes.x) {
        axisX = proto::CreateTQLDisplayAxis(builder);
    }
    if (!!target.axes.y) {
        axisY = proto::CreateTQLDisplayAxis(builder);
    }

    auto layout = proto::CreateTQLDisplayLayout(builder, layoutWidth, layoutHeight);
    auto axes = proto::CreateTQLDisplayAxes(builder, axisX, axisY);

    proto::TQLDisplayColor color;

    auto statement = proto::CreateTQLDisplayStatement(
        builder,
        name,
        static_cast<proto::TQLDisplayType>(target.type),
        target.type_flags,
        layout,
        &color,
        axes
    );

    return statement.Union();
}

}
}
