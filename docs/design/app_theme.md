# App Theme

Every color of the app comes from one small theme of semantic tokens. Each token is defined once, with its light and
its dark value, and the color scheme of the document picks one. The app switches between a light and a dark color
scheme without reloading, and no component knows which one is shown.

## Layers

```text
packages/dashql-ui/styles/colors.css     palette: neutral_0..9 and neutral_dark_0..3, blue/green/yellow/orange/red/purple/pink/coral _0.._9
        │ only the theme and the flavors pick from it
        ▼
packages/dashql-ui/styles/tokens.css     theme: --color_*, --chrome_*, --shadow_*, --stage_*, --chart_color_*, --code_*,
        │                                       --agent_*, each light-dark(<light>, <dark>)
        │ flavors override theme tokens, never the palette
        ▼
packages/dashql-ui/styles/flavors/<id>.css
                                         :root[data-flavor="<id>"] { --color_...: light-dark(...) }
        │
        ▼
*.module.css, editor themes, charts      use theme tokens only
```

Every color value of the app lives in `packages/dashql-ui/styles`: the palette, the theme and the flavors. The app only
uses tokens. A flavor's identity (name, logos, settings) stays in the app (`src/config/flavors.ts`), which sets
`data-flavor` on the root and imports the stylesheets of the flavors.

A flavor overrides theme tokens on `:root[data-flavor="<id>"]`, which wins over `:root` whatever the order of the
stylesheets. It writes its values with `light-dark()` too, so one file covers both schemes. Tokens derive from other
tokens and the greys of the palette from `--neutral_hue`, so a few overrides reach far: a flavor that sets the hue tints
every grey, and one that sets `--color_bg` moves the stage with it.

The palette and the theme are shared with the website (dashql.org). It loads no flavor and sets no color scheme on its
root, so the tokens resolve to the default light theme there.

## Tokens

The theme is closed: a stylesheet takes the closest token, and a color that no token fits is added to `tokens.css`
deliberately, with a role that other stylesheets can share. The groups:

| Group | Tokens | Role |
|---|---|---|
| Surfaces | `--color_bg`, `--color_bg_card`, `--color_bg_subtle`, `--color_bg_hover`, `--color_bg_selected`, `--color_bg_inverse` | The page, cards (also editors, tables, dialogs), headers and sunken areas, hover and selection overlays, tooltips and dark badges |
| Page | `--page_background`, `--color_bg_pane`, `--color_bg_pane_subtle` | The one background of a page, and the panes on it, like the sidebar and the bars above the stage |
| Text | `--color_fg`, `--color_fg_muted`, `--color_fg_subtle`, `--color_fg_on_emphasis`, `--color_fg_inverse` | Default, secondary, placeholder and disabled, text on emphasis backgrounds, text on the inverse surface |
| Borders | `--color_border`, `--color_border_muted` | Cards and controls, dividers inside them |
| Accent | `--color_accent_fg`, `--color_accent_emphasis`, `--color_accent_muted`, `--color_focus` | Links and highlights, solid accent backgrounds, highlighted rows, focus rings |
| Status | `--color_{success,danger,attention,neutral,done}_{fg,emphasis,muted}` | Status text and icons, solid status backgrounds with white text, muted status backgrounds |
| Primary button | `--color_primary_emphasis`, `_hover`, `_active`, `_disabled` | The primary action |
| Elevation | `--shadow_small`, `--shadow_medium`, `--shadow_large`, `--shadow_extra_large` | Box shadows with their offsets |
| Chrome | `--chrome_bg`, `--chrome_bg_80`, `--chrome_bg_100`, `--chrome_bg_active`, `--background` | The always dark top bar, rail and backdrop |
| Stage | `--stage_background` and its parts | The backdrop of pages with a lot of empty space |
| Shell | `--shell_bg`, `--shell_header_bg`, `--shell_divider`, `--shell_edge`, `--shell_hover`, `--shell_focus`, `--shell_fg`, `--shell_fg_muted`, `--shell_fg_subtle` | The terminal on the dark backdrop, the same in both schemes |
| Charts | `--chart_color_1..8` | Categorical series, the first one is a single series |
| Code | `--code_*` | The editors and code views, the Xcode palettes of `@ankoh/dashql-ui/xcode` |
| Agent | `--agent_gradient_1..3`, `--agent_accent`, `--agent_accent_text`, `--agent_fg` | The agent, its face and question |

Translucent derivations of a token are fine where no token fits, e.g. `color-mix(in srgb, var(--color_success_fg) 18%,
transparent)` for the inserted statements of a diff.

## Rules for stylesheets

- No color literals: no hex, `rgb()`, `hsl()` and no named colors. `transparent` and `currentColor` are fine.
- No colors of the palette (`--base_color_*`), no greys of their own (`hsl(var(--neutral_hue), …)`), and no
  `light-dark()`: the theme decides what a role looks like in each scheme.
- No color custom properties of their own. A custom property that switches per variant may alias theme tokens.
- The test `src/styles/theme.test.ts` checks every stylesheet of the app. It also checks that the `--code_*` tokens
  match the Xcode palettes that the website uses.

## Color scheme

`light-dark()` resolves against the `color-scheme` of the element that uses a token, and custom properties carry it
unresolved to that element. `src/styles/globals.css` sets the scheme of the root:

```css
:root { color-scheme: light dark; }
:root[data-color-scheme="light"] { color-scheme: light; }
:root[data-color-scheme="dark"] { color-scheme: dark; }
```

Without `data-color-scheme`, the app follows the OS. The setting `colorScheme` of the app settings pins it
(`src/config/color_scheme.tsx`, applied by `AppSettingsSync`). The toggle in the top bar switches to the other scheme
and pins it, the app settings offer to follow the OS again. The settings load asynchronously, until then the app
follows the OS.

The dev server and the build keep `light-dark()` native: the CSS target of `vite.config.tpl.ts` names browsers that
support it. An older target would make the CSS minifier rewrite it into a fallback that needs a `color-scheme`
declaration on every element that uses a token.

## Dark chrome

The top bar, the nav rail and the backdrop of the setup pages are dark in both schemes. They set
`color-scheme: dark` on themselves and use the same tokens as everything else, which resolve to their dark values
inside. Their own backgrounds are the `--chrome_*` tokens. The same holds for other surfaces that are dark on
purpose, like the terminal of the shell.

## Dark page

The light page is cut out of the chrome: its panes are white and grey and cover the page. The dark page is not a cut,
so it follows the gradient of the chrome instead, like the card of the shell. The session page paints
`--page_background` once, a translucent shade (`--shell_bg`) over the backdrop of the chrome behind it. Its panes, the
sidebar and the bars above the stage, shade it a little more like the header of the shell (`--color_bg_pane`), the
stage is only its dot grid. So the gradient runs through the whole page without breaks between its components.
Cards, tables, editors, dialogs and menus are opaque and sit slightly lighter than the page.

## Colors outside of CSS

- SVG presentation attributes do not resolve `var()`. Components set theme colors as style properties instead, e.g.
  `style={{ fill: 'var(--color_border)' }}`.
- The editors use one CodeMirror theme whose colors are `var(--code_*)` and theme tokens
  (`src/session/editor/themes/xcode.ts`). They switch with the scheme without being reconfigured.
- Vega draws on a canvas, which cannot resolve tokens. `resolveChartColors()` resolves them with a probe element, and
  the charts embed again when `useColorScheme()` or the flavor changes. Chart images resolve the light scheme on a white
  background in both schemes.
- Colors that encode data, like the badges of the query profile, stay data colors.
- The icons of connectors are their colored logos in the light scheme and their monochrome logos in the dark one,
  which take the color of the text (`useConnectorIcon` in `src/connections/connector_icon.ts`).
