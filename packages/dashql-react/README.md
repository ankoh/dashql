# @akohn/dashql-react

DashQL in React: the hooks of the runtime of [`@akohn/dashql`](../dashql/README.md), the models that components show,
the components, and the design tokens, fonts and icons of DashQL. The DashQL app is built from it, and so can be other
hosts of the runtime.

```sh
npm install @akohn/dashql @akohn/dashql-react react react-dom apache-arrow
```

`@akohn/dashql` is a peer of exactly the version of this package: the views of the runtime change with DashQL, so both
come from the same build. The Vega libraries are optional peers, for the charts.

## Using it

The modules keep the paths of the sources, every one is a subpath of its own:

```tsx
import '@akohn/dashql-react/style.css';
import '@akohn/dashql-react/styles/tokens.css';
import '@akohn/dashql-react/fonts/fonts.css';

import { Button } from '@akohn/dashql-react/components/button';
import { SymbolIcon } from '@akohn/dashql-react/components/symbol_icon';
import { RuntimeContextProvider, useScript } from '@akohn/dashql-react/hooks';
import { useScriptModel } from '@akohn/dashql-react/models/script_model';
```

- **`style.css`**: the stylesheets of all components, imported once. Their classes are `dashql_<class>_<hash>`.
- **`styles/tokens.css`, `styles/colors.css`, `styles/flavors/*.css`**: the design tokens that the components read as
  CSS variables, and the flavors that override them.
- **`fonts/fonts.css`**: Instrument Sans and JetBrains Mono with their font files (SIL Open Font License).
- **`symbols.svg`**: the icons and logos, one `<symbol>` each. `SymbolIcon` refers to them by the URL of the atlas
  next to the modules (`new URL('./symbols.svg', import.meta.url)`), which the bundler of the host emits as an asset.
  The atlas is served by the host: browsers resolve the `<use>` of a symbol only from the origin of the page.

How the layers fit, the runtime, the models and the components, is described in
[dashql_runtime.md](../../docs/design/dashql_runtime.md) and
[writing_components.md](../../docs/agents/writing_components.md).

## The package

`//packages/dashql-react:npm_tarball` builds `dashql-react.tgz` with `npm/build.mjs`: Vite compiles the modules of
`src/` without the tests and their helpers (`src/testing`), every module keeps its path, the CSS modules become their
class names and one stylesheet, tsc writes the declarations next to the modules. The version is the npm version of the
build, the same as that of `@akohn/dashql`. `:tarball_consumer_test` installs the archive like a host and renders,
type checks and bundles a page with it.
