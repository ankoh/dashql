"use strict";
exports.handler = async (e) => {
  const r = e.Records[0].cf.request;
  if (!r.uri.startsWith('/static/')) {
    r.uri = '/';
  }
  return r;
};
