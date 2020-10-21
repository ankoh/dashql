import * as Model from './';

export let createStore: () => Model.ReduxStore;
if (process.env.NODE_ENV === 'production') {
    createStore = require('./store_prod').default;
} else {
    createStore = require('./store_dev').default;
}

export default createStore;

