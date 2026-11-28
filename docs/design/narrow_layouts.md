# Narrow layouts

DashQL runs on every width with one UI: a narrow window gets the same views, components and actions as a wide one,
only arranged and sized differently. Nothing is phone-only. A part that a phone needs, e.g. the detail of a row or a
card in full screen, is a part of every width. A phone also has every action of the desktop, including arranging the
dashboard and editing scripts.

## Width classes

| Class | Width | What changes |
|---|---|---|
| compact | below 840px | the phone layout: dark chrome without rail, one pane at a time, the views in a tab bar, the workbench in a drawer |
| expanded | from 840px | the desktop layout: the rail, the stripe, the workbench next to the workbook |

There is no layout between them: a window that has no room for the workbench next to the workbook gets the phone layout
right away, a tablet too. `EXPANDED_WIDTH` of `@akohn/dashql-react/dom/media_query` holds the number,
`COMPACT_WIDTH_QUERY` and `EXPANDED_WIDTH_QUERY` the queries for `useMediaQuery`. The stylesheets write the same number,
`max-width: 839px` for compact. A view decides its own layout by the width of its container where it can (a container
query, `NARROW_CONTAINER_WIDTH` of 600px for a container as narrow as a phone), so a pane as narrow as a phone, e.g. the
side panel of Slack, gets the narrow layout as well.

Touch is a separate question from width. `(pointer: coarse)` makes the targets larger and `(hover: none)` shows the
controls that a mouse would reveal on hover. Neither changes what the view shows.

## The shell

There is no gate for narrow windows. Before, a window below 800px showed a page that asked to enable an experimental
layout. The setting it wrote, `narrowScreenLayout`, stays in the schema of the app manifest so that older manifests stay
valid, and the app no longer reads it.

- **The top of a compact window** is dark chrome in place of the stripe and the rail (`data-workbook-chrome` of
  `workbook/views/workbook_views_page.tsx`, the stripe and the rail don't show next to it, `navbar.module.css`): the
  drawer and the pages of the rail (Workspace, Shell) at its start, the overlays of the stripe (the client, the
  version, the color scheme) at its end. They render there on a compact window only, the rail and the stripe have them
  on wider windows. Below it the bar of the workbook is the top of the card with the rounded corners of the card below
  the stripe of a wide window, one row of 44px like there: Execute All with the text of its run, the connections and
  the actions. The views switch in the tab bar at the bottom, the bookmark of the default view and the arrows stay on
  wider windows. Without their labels the buttons are as narrow as their icons.
- **The bottom of a compact window** is the tab bar of the views (`WorkbookTabBar`), the light bottom of the card:
  Feed and Console, Wobble in the middle, Board and Flow, the active view in the color of the text. The face of Wobble
  tells the run of the workbook by a dot (running, succeeded, failed), a tap opens the composer over the view and
  closes it again; the composer shrunk into its bar doesn't show. Wider windows switch the views in the bar at the top
  and show the bar of Wobble at the bottom of the views.
- **The shell** keeps the dark chrome above it on a compact window (`workbook_page.module.css`), with the pages of the
  rail to leave it; the bar of the workbook and the tab bar don't show. A page without that bar keeps the stripe with
  the pages of the rail in its middle.
- **The workbench** opens in a drawer below the expanded width (`WorkbookNavigationDrawer`), the same component as the
  sidebar. Its white header has the brand like the stripe, in the color of the text.

## The console

`ConsoleLayout` (`workbook/console/console_layout.tsx`) shows one pane at a time on a compact window: the editor with
the header of its script, the results, or the sidebar with the inputs and the attachments. A segmented control at the
bottom of the console, in reach of the thumb, picks the pane (SQL, Results, Inputs). The panes stay mounted while
hidden, the editor keeps its state. A new run of the active script, a new id of its latest query (`runKey`), shows the
results; a switch of the tab keeps the pane. An expanded window keeps the split of the editor over the results with the
sidebar next to them.

A touch screen (`pointer: coarse`) shows the keys of SQL below the editor (`SqlKeyBar` of
`workbook/editor/sql_key_bar.tsx`): Run, Tab (what the keymap of the editor does with it, else the completion), the
symbols that the letter keyboard hides on another page, and the arrows that move the cursor. A key keeps the focus in
the editor, so the keyboard stays open. The viewport of the app resizes its content for the keyboard
(`interactive-widget=resizes-content`, Chromium and Firefox), the keys sit right above it.

## The feed

The cards of the feed hide the optional controls of their header when they get narrow, by a container query on the
card like the console and the dataflow: below 760px the statistics and Delete (also in the menu of the script), below
400px the chart builder and the snippets. A compact window narrows the gutter of the page to 8px
(`--page_gutter` of the workbook page) and starts the composer shrunk into the bar of Wobble in the feed as well, a tap
expands it; open, it would cover the cards.

A compact window folds the SQL of a script of more than four lines to its first lines, faded towards a button that says
how many lines there are (`data-sql-fold` of the editor of `script_card.tsx`); the result of the script shows right
below. The button or a focus in the editor unfolds it, the button folds it again. Wider windows ignore the fold.

## The dashboard

A compact window reflows the board (`dashboard.module.css`) in its reading order, row then column: two columns, a KPI
card (at most three columns of the grid wide, `data-compact-span` of the card) takes one of them and sits next to the
next KPI card, the other cards take both. The cards keep their heights. An expanded window keeps the 12-column grid of
the desktop, with dragging and resizing. Without hover the header of a KPI card takes a row of its own above the value,
an overlay would hide the value. A card narrower than 360px hides the segments of its renderers, its menu has them as
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

On a touch screen (`pointer: coarse`) the rows of the grid are 36px high instead of 26px (`useDataTableRowHeight`,
`TOUCH_ROW_HEIGHT`), tall enough to hit a row with a finger; the heights of fitted tables and of the previews of cards
count with it.

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

## Full screen

The full result table of a feed entry or a dashboard card opens in a card over the page, enlarged to the window below
the top bar (`ResultTableOverlay`). On a compact window it fills the window below the dark chrome
(`--nav_bar_top_height` is the height of the chrome there) with the rounded top corners of the card of the page. The
chart of a feed entry opens the same way, an expand button in the header of its visualization (`ChartFocusOverlay`):
the same spec in the size of the card, a KPI and Markdown alike.

## Charts

Charts stay the authored Vega-Lite spec, `VegaLiteView` fits them to their card. Only the config of DashQL may follow
the width of a card, never the spec.
