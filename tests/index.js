'use strict';

// Entry point so that `node --test tests/` (a bare directory argument) works.
//
// Node's test runner CLI resolves an explicit directory argument through
// normal CommonJS module resolution (looking for this index.js), rather than
// recursively scanning the directory for *.test.js files the way the
// zero-argument default-discovery mode does. Requiring each test file here
// makes `node --test tests/` register and run every suite.
//
// `node --test` still works too (default discovery finds tests/*.test.js
// directly), as does `node --test tests/util.test.js`.

require('./util.test.js');
require('./measure.test.js');
require('./sensitivity.test.js');
