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

- **The top of a compact window** is one dark bar, the bar of the workbook (`workbook/views/workbook_views_page.tsx`,
  `data-workbook-bar`): the stripe and the rail don't show next to it (`navbar.module.css`). It is one row of 44px:
  the drawer, Execute All with the indicator of its run, the connections, the actions and the view switch. The text of
  the run shows in the bar of Wobble, Export .dashql stays in the menu of the actions. The bookmark of the default view,
  the arrows of the view switch and the separators stay on wider windows. A page without that bar, e.g. the shell,
  keeps the stripe with the pages of the rail in its middle.
- **The drawer** of the workbench has the pages of the rail and the overlays of the stripe (the client, the version,
  the color scheme) in its dark header on a compact window; a page of the rail closes it.
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

## The dashboard

A compact window reflows the board (`dashboard.module.css`) in its reading order, row then column: two columns, a KPI
card (at most three columns of the grid wide, `data-compact-span` of the card) takes one of them and sits next to the
next KPI card, the other cards take both. The cards keep their heights. A medium window keeps the 12-column grid of the
desktop, with dragging and resizing. Without hover the header of a KPI card takes a row of its own above the value, an
overlay would hide the value. A card narrower than 360px hides the segments of its renderers, its menu has them as
well (Show as).

A compact window can't drag the cards of the reflowed board, Arrange above the cards shows the map of the board
instead (`DashboardArrange` of `dashboard_arrange.tsx`): the 12-column grid of every section scaled to the width of the
window, every card a block at its placement. A tap picks a card, the panel at the bottom changes its width and height
by one and moves it by one row or column, within the 12 columns. A change goes through the same placement of the
cards as a drag and a resize (`moveDashboardItem`, `resizeDashboardItem`) and writes the `@board` tags.

## Sheets

`Sheet` (`@akohn/dashql-react/components/sheet`) shows what belongs to one picked thing over the page: from the bottom
on a compact window, at most 85% of its height, at the right edge on a wider one. Escape, the backdrop and the close
button close it, its header has a title and optional controls.

## The result viewer

A click or tap on the number of a row opens the detail of the row in a sheet (`DataTableRowDetail` of the data table):
the fields in the order of the columns with their types, the arrows step through the rows. A row that the window of
the table doesn't hold is read on its own, like the detail of a cell. It is what a phone can't show side by side in the
grid, and the same on every width.

## The dataflow

The canvas changes its level of detail, not its UI. Below a scale of 0.6 every box draws as a tile: its name, a status
dot (running, succeeded, failed, stale) and a line about its result (`4,000 rows`, `bar · 4 rows`, `KPI 23.42K`). The
text stays 12px on the screen, and a tile renders no rows or renderers. A canvas narrower than 600px (its own width,
not the window's) shows the dense layout of `dashql-dataflow`: tiles of one size from top to bottom, rows of at most as
many tiles as fit the width, fitted at a scale of at least 0.75. The dense layout ignores the `@flow` positions and
never writes them. A tap or click on a box focuses its lineage on every width: what it reads and what reads it, through
other boxes too, in the accent color, with the rest faded. On a compact canvas the tap also opens a sheet with the
status, the boxes it reads and that read it (a tap moves there), and Edit, Run and Result. The editor dialog of a
script fills a compact window, as does any expanded overlay. `dataflow.md` describes the layout and the canvas.

## The views

The other views follow, one at a time. Each keeps its components and changes its arrangement:

- **Console**: a key bar above the keyboard.
- **Result viewer**: a pinned column, taller rows on touch, a menu of the column.
- **Feed**: a folded SQL, a card in full screen.
- **Dashboard**: the inputs as chips with a sheet.

Charts stay the authored Vega-Lite spec, `VegaLiteView` fits them to their card. Only the config of DashQL may follow
the width of a card, never the spec.
