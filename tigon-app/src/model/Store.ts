import * as Model from './';

export let createStore: () => Model.ReduxStore;
if (process.env.NODE_ENV === 'production') {
    createStore = require('./Store.prod').default;
} else {
    createStore = require('./Store.dev').default;
}

export default createStore;

