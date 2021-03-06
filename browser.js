"use strict";

// Inject Annotator CSS
var insertCss = require('insert-css');
var css = require('./css/annotator.css');
insertCss(css);

var app = require('./src/app');
var ui = require('./src/ui');
var storage = require('./src/storage');
var util = require('./src/util');
var defaultUI = require('./src/plugin/defaultui');

// Core annotator components
exports.App = app.App;
exports.supported = app.supported;

// Access to libraries (for browser installations)
exports.storage = storage;
exports.ui = ui;
exports.util = util;

// Plugin namespace (for core-provided plugins)
exports.plugin = {};
exports.plugin.defaultUI = defaultUI.defaultUI;

// Store a reference to the current annotator object, if one exists.
var g = util.getGlobal();
var _annotator = g.annotator;

// Restores the Annotator property on the global object to it's
// previous value and returns the Annotator.
exports.noConflict = function noConflict() {
    g.annotator = _annotator;
    return this;
};
