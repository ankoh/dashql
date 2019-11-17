//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/parser/tql/tql_syntax.h"

namespace tigon {
namespace tql {

template <>
struct FlatBufferWriter<VizStatement> {
    /// Encode a statement as flatbuffer
    static flatbuffers::Offset<void> write(VizStatement& target, flatbuffers::FlatBufferBuilder& builder);
};

// Encode a statement as flatbuffer
flatbuffers::Offset<void> FlatBufferWriter<VizStatement>::write(VizStatement& target, flatbuffers::FlatBufferBuilder& builder) {
    auto name = builder.CreateString(target.target);

    flatbuffers::Offset<proto::TQLVizLength> layoutWidth = 0;
    flatbuffers::Offset<proto::TQLVizLength> layoutHeight = 0;
    flatbuffers::Offset<proto::TQLVizAxis> axisX = 0;
    flatbuffers::Offset<proto::TQLVizAxis> axisY = 0;

    if (!!target.layout.width) {
        layoutWidth = proto::CreateTQLVizLength(builder);
    }
    if (!!target.layout.height) {
        layoutHeight = proto::CreateTQLVizLength(builder);
    }
    if (!!target.axes.x) {
        axisX = proto::CreateTQLVizAxis(builder);
    }
    if (!!target.axes.y) {
        axisY = proto::CreateTQLVizAxis(builder);
    }

    auto layout = proto::CreateTQLVizLayout(builder, layoutWidth, layoutHeight);
    auto axes = proto::CreateTQLVizAxes(builder, axisX, axisY);

    proto::TQLVizColor color;

    proto::TQLVizStatementBuilder vb{builder};
    vb.add_viz_name(name);
    vb.add_viz_type(static_cast<proto::TQLVizType>(target.type));
    vb.add_viz_type_flags(target.type_flags);
    vb.add_layout(layout);
    vb.add_color(&color);
    vb.add_axes(axes);
    auto vs = vb.Finish();

    return vs.Union();
}

}
}
