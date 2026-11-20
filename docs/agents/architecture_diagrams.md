# Architecture diagrams

The architecture diagrams of dashql.org are hand-laid SVGs on the page `/architecture`
(`packages/dashql-org/src/pages/architecture.astro`). They share one visual style: dark cards nested in dark cards, like
the app in its dark theme, with quiet edges between them. This doc is how to draw a new diagram in that style, whatever it
shows: packages, a data flow, the hosts, a sequence of steps. A reader looks at a diagram on the page, zooms in, and
downloads it as SVG or PNG for slides and documents or to edit it in an SVG editor.

## The style

### Cards

Everything is a card: a rounded rect with a 1px border and lines of text in its top left corner. There are three
levels, each a step lighter or darker than the one around it:

| Level | What | Class | Fill | Radius |
|---|---|---|---|---|
| Region | A top-level group, spans the width of the diagram | `region` | `--diagram_region_bg` | 14 |
| Group | A card inside a region that holds boxes of its own | `wasm` or a new kind | `--diagram_group_bg` | 14 |
| Box | A leaf, the thing the diagram is about | `box` | `--diagram_box_bg` | 10 |

- All regions have the same fill. Don't vary the greys to set regions apart, the title of a region does that.
- The group is sunken (the color of the page), the boxes are raised (the cards of the app). Don't go deeper than three
  levels; if a box needs children, split the diagram.
- A thing that is not ours (a library from npm, a service) is an `external` box: the fill of a region with a dashed
  border.
- A box can have a `badge` (a pill in its top right corner, e.g. `npm`) and an `aside` (right-aligned text on the line of
  its title, e.g. a file name).
- A card stands for a thing, not for a remark. Notes go into the `<desc>` or a caption.

### Text

Instrument Sans at 18px, left-aligned, at most five lines per card:

1. The name, `heading`: semibold in `--diagram_fg`.
2. What it is, `accent`: semibold in the blue grey `--diagram_accent_fg`.
3. Details, `muted`: regular in `--diagram_fg_muted`, short phrases like "Editor, workbooks and embed".

Write it like a person would: no lists joined by " · ", no separators or emoji in titles, no trailing periods. A region
has a title and at most two muted lines on its left; its boxes start to the right of them or below them.

### Color

Color is rare and means one thing:

- The greys of the dark theme of the app (`neutral_dark_0` to `neutral_dark_2`, `neutral_1` to `neutral_7`) for all
  cards, text, borders and edges.
- The blue grey of `--diagram_accent_fg`, only for the second line of a card.
- One hue for one kind of thing, explained in the legend. The package diagram uses the purple of the app
  (`--diagram_wasm`, `--diagram_wasm_fg`) for WebAssembly modules: a purple border on the card and purple for its
  second line or aside. A new meaning takes another hue of the palette of `@akohn/dashql-react` (`styles/colors.css`),
  in steps 3 and 4 so it reads on the dark greys. Never green, never two hues for one meaning.
- No emphasis that the legend doesn't explain: no box gets a heavier border, a brighter fill or a color because it
  matters more.

Every color is a `--diagram_*` token of `packages/dashql-org/src/layouts/theme.module.css`, used through the classes of
`architecture_diagram.module.css`, never in the markup. The tokens are solid colors: no `color-mix`, no transparency,
since the downloads freeze them into attributes (see below).

### Edges

The edges stay in the background: 1.25px lines in `--diagram_edge` with a small filled arrow at the target. A dashed
line (`runtime`) is a second kind of edge, e.g. a dependency at run time instead of one of the build; more than two
kinds is too many.

- Each edge is one `<path>` from the border of its source to the border of its target, arrow at the end. Two edges from
  one source may share a trunk and split.
- The paths are orthogonal (`H` and `V` only) and run in the gaps between the cards, never across text or through a box.
  They may cross the border of a region they leave or enter.
- The edges are one layer above the cards, or a filled region would hide them.
- Leave room for lanes instead of dropping an edge. Where two edges have to cross, they cross once, at a right angle.

### Legend

The legend sits in the top right corner of the diagram, above the first region: a short sample of every kind of edge
and a swatch of every color with a meaning, each with a muted label. The diagram has no title of its own, the header bar
of the figure has it.

### Layout

- The view box is 1440 wide; the height is what the cards need.
- The text of a card starts 20 from its left border, the first baseline 34 below its top, the next ones 28 apart
  (`CARD_PADDING`, `CARD_FIRST_LINE`, `CARD_LINE_HEIGHT` of `architecture_diagram.ts`). A box is 34 + 28 per line after
  the first + 22 high: 112 for three lines, 140 for four, 168 for five. Boxes of a row have the same height.
- The cards sit on a grid of columns: 24 from the border of the diagram to a region, 20 inside a region, 24 to 40
  between boxes. Between two regions leave 24, or 40 and more where edges run between them.
- All coordinates are those of the diagram, also for children, so the paths of the edges can use them directly.
- Plan the lanes before placing the cards: an edge that passes a column needs a gap of 40 or more. Narrow a column or
  move a box rather than squeezing an edge between two boxes.
- Nothing measures the text. Keep each line inside its card and clear of the arrows, and look at it.

## The SVG

The nesting of the cards is the structure of the SVG, so that Figma, Illustrator or Inkscape show the same layers as the
diagram and a region moves with everything in it:

- One `<g>` per card holds its rect, its text and the `<g>`s of its children: the tree of `children` in the model. No
  flat lists of all rects or all texts, no grouping by kind.
- The ids name the layers: `<diagram>-<card>`, `<diagram>-<from>-to-<to>` for an edge, and `<diagram>-background`,
  `<diagram>-legend`, `<diagram>-cards` and `<diagram>-dependencies` (the edges) for the top-level groups.
- The `<svg>` has `role="img"`, an `aria-label` with the gist, a `<title>`, and a `<desc>` that says in prose what every
  card is and how they connect, linked by `aria-describedby`.

## Downloads

`ArchitectureFigure` and the zoom viewer have Download SVG and Download PNG. The downloaded SVG stands on its own:
`svg_download.ts` writes the computed styles as presentation attributes, drops the classes and embeds the fonts into the
`<defs>`; the PNG is the SVG rendered at 2x. So no styling the export can't freeze: no filters, shadows, `color-mix` or
transparency in a token, no CSS on `:hover`, no `foreignObject`. The files are `dashql_<name>.svg` and
`dashql_<name>.png`.

## The parts

| File (`packages/dashql-org/src/components/`) | What |
|---|---|
| `architecture_diagram.ts` | The model: a tree of `DiagramCard`s, a list of `DiagramEdge`s, the metrics of the text |
| `architecture_diagram.module.css` | The classes of the SVG: the kinds of cards, the tones of text, the edges |
| `architecture_card.astro` | Renders a card as a `<g>` with its rect, its text and the `<g>`s of its children |
| `architecture_figure.astro` | A diagram in a dark card of the site with Zoom in, Download SVG and Download PNG |
| `architecture_viewer.astro` | The zoom dialog, one per page, 25% to 400% and Fit, with the downloads |
| `svg_download.ts` | The downloads: freezes the styles into attributes, embeds the fonts, renders the PNG |
| `package_diagram.astro` | The packages of the repository, the example to start from |

## A new diagram

1. Copy `package_diagram.astro` to `<name>_diagram.astro` and replace its cards, edges, legend, `<title>` and `<desc>`.
   Use the existing kinds and tones; add a kind of card or a tone to `architecture_diagram.ts`, a class to
   `architecture_diagram.module.css` and a token to `theme.module.css` only for a new meaning, and put it in the legend.
2. Take the facts from the code, not from memory, the docs or the names of things. Every dependency the diagram claims
   is one the code has; where edges would bury the cards and one is left out, the `<desc>` says which.
3. Wrap it in an `ArchitectureFigure` on the page with a title and `filename="dashql_<name>.svg"`, and add it to the
   navigation at the top of the page. A `caption` below the card is optional.
4. When the code changes what a diagram shows, update the diagram in the same commit.

## Checking a diagram

`bazel build //packages/dashql-org:pages`, `bazel test //packages/dashql-org:check //packages/dashql-org:eslint_test`,
then look at it: `bazel run //packages/dashql-org:dev` serves the site on port 9003. Open the zoom with Fit and check
that no edge crosses text or a box, that no line of text leaves its card or touches an arrow and that every color is in
the legend, then download both files and open them.
