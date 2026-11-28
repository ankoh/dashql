# Narrow layouts

DashQL runs on every width with one UI: a narrow window gets the same views, components and actions as a wide one,
only arranged and sized differently. Nothing is phone-only. A part that a phone needs, e.g. the detail of a row or a
card in full screen, is a part of every width. A phone also has every action of the desktop, including arranging the
dashboard and editing scripts.

## Width classes

| Class | Width | What changes |
|---|---|---|
| compact | below 600px | one pane at a time, the rail in the stripe, the bar of the workbook in one row |
| medium | 600px to 839px | the rail returns, the workbench stays in a drawer, splits are allowed |
| expanded | from 840px | the workbench next to the workbook |

`MEDIUM_WIDTH` and `EXPANDED_WIDTH` of `@akohn/dashql-react/dom/media_query` hold the numbers, `COMPACT_WIDTH_QUERY`
and `EXPANDED_WIDTH_QUERY` the queries for `useMediaQuery`. The stylesheets write the same numbers: `max-width: 599px`
for compact, `max-width: 839px` below expanded. A view decides its own layout by the width of its container where it
can (a container query), so a pane as narrow as a phone, e.g. the side panel of Slack, gets the compact layout as well.

Touch is a separate question from width. `(pointer: coarse)` makes the targets larger and `(hover: none)` shows the
controls that a mouse would reveal on hover. Neither changes what the view shows.

## The shell

There is no gate for narrow windows. Before, a window below 800px showed a page that asked to enable an experimental
layout. The setting it wrote, `narrowScreenLayout`, stays in the schema of the app manifest so that older manifests stay
valid, and the app no longer reads it.

- **The rail** (`app/nav_rail.tsx`) gets no column on a compact window: its pages sit in the middle of the dark stripe
  at the top, as a row. The toggle of the wide rail and the pages that are not there yet stay out
  (`nav_rail.module.css`, `navbar.module.css`).
- **The bar of the workbook** (`workbook/views/workbook_views_page.tsx`) is one row of 44px on a compact window: the
  drawer, Execute All with the indicator of its run, the connections, the actions and the view switch. The text of
  the run shows in the bar of Wobble. The bookmark of the default view, the arrows of the view switch and the separators
  stay on wider windows.
- **The workbench** opens in a drawer below the expanded width (`WorkbookNavigationDrawer`), the same component as the
  sidebar.
- **The bottom** of the window holds one bar, the bar of Wobble. The view switch stays in the bar at the top on every
  width, there is no tab bar at the bottom.

## The console

`ConsoleLayout` (`workbook/console/console_layout.tsx`) shows one pane at a time on a compact window: the editor with
the header of its script, the results, or the sidebar with the inputs and the attachments. A segmented control below
the tabs picks the pane (SQL, Results, Inputs). The panes stay mounted while hidden, the editor keeps its state. A new
run of the active script, a new id of its latest query (`runKey`), shows the results; a switch of the tab keeps the
pane. Wider windows keep the split of the editor over the results, with the sidebar below them up to the expanded width
and next to them from there.

## The feed

The cards of the feed hide the optional controls of their header when they get narrow, by a container query on the
card like the console and the dataflow: below 760px the statistics and Delete (also in the menu of the script), below
400px the chart builder and the snippets. A compact window narrows the gutter of the page to 8px
(`--page_gutter` of the workbook page) and starts the composer shrunk into the bar of Wobble in the feed as well, a tap
expands it; open, it would cover the cards.

## The views

The other views follow, one at a time. Each keeps its components and changes its arrangement:

- **Console**: a key bar above the keyboard.
- **Result viewer**: the grid stays a grid, with a pinned column, taller rows on touch, a sheet with the detail of a
  row and a menu of the column.
- **Feed**: a folded SQL, a card in full screen.
- **Dashboard**: one column in the reading order of the grid, the inputs as chips with a sheet, arranging on the real
  12-column grid scaled to the window.
- **Dataflow**: a dense flow, compact tiles from top to bottom in the layout of `dashql-dataflow`, the result inside
  the boxes when zoomed in, the lineage of a tapped tile.

Charts stay the authored Vega-Lite spec, `VegaLiteView` fits them to their card. Only the config of DashQL may follow
the width of a card, never the spec.
