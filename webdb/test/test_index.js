var context = require.context('.', true, /\.test\.ts$/);
context.keys().forEach(context);
