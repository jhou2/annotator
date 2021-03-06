"use strict";

var ui = require('../ui');
var util = require('../util');

var g = util.getGlobal(),
    _t = util.gettext;

// trim strips whitespace from either end of a string.
//
// This usually exists in native code, but not in IE8.
function trim(s) {
    if (typeof String.prototype.trim === 'function') {
        return String.prototype.trim.call(s);
    } else {
        return s.replace(/^[\s\xA0]+|[\s\xA0]+$/g, '');
    }
}


// annotationFactory returns a function that can be used to construct an
// annotation from a list of selected ranges.
function annotationFactory(contextEl, ignoreSelector) {
    return function (ranges) {
        var text = [],
            serializedRanges = [];

        for (var i = 0, len = ranges.length; i < len; i++) {
            var r = ranges[i];
            text.push(trim(r.text()));
            serializedRanges.push(r.serialize(contextEl, ignoreSelector));
        }

        return {
            quote: text.join(' / '),
            ranges: serializedRanges
        };
    };
}


// maxZIndex returns the maximum z-index of all elements in the provided set.
function maxZIndex(elements) {
    var max = -1;
    for (var i = 0, len = elements.length; i < len; i++) {
        var $el = util.$(elements[i]);
        if ($el.css('position') !== 'static') {
            // Use parseFloat since we may get scientific notation for large
            // values.
            var zIndex = parseFloat($el.css('z-index'));
            if (zIndex > max) {
                max = zIndex;
            }
        }
    }
    return max;
}


// Helper function to inject CSS into the page that ensures Annotator elements
// are displayed with the highest z-index.
function injectDynamicStyle() {
    util.$('#annotator-dynamic-style').remove();

    var sel = '*' +
              ':not(annotator-adder)' +
              ':not(annotator-outer)' +
              ':not(annotator-notice)' +
              ':not(annotator-filter)';

    // use the maximum z-index in the page
    var max = maxZIndex(util.$(g.document.body).find(sel).get());

    // but don't go smaller than 1010, because this isn't bulletproof --
    // dynamic elements in the page (notifications, dialogs, etc.) may well
    // have high z-indices that we can't catch using the above method.
    max = Math.max(max, 1000);

    var rules = [
        ".annotator-adder, .annotator-outer, .annotator-notice {",
        "  z-index: " + (max + 20) + ";",
        "}",
        ".annotator-filter {",
        "  z-index: " + (max + 10) + ";",
        "}"
    ].join("\n");

    util.$('<style>' + rules + '</style>')
        .attr('id', 'annotator-dynamic-style')
        .attr('type', 'text/css')
        .appendTo('head');
}


// Helper function to remove dynamic stylesheets
function removeDynamicStyle() {
    util.$('#annotator-dynamic-style').remove();
}


// Helper function to add permissions checkboxes to the editor
function addPermissionsCheckboxes(editor, registry) {
    function createLoadCallback(action) {
        return function loadCallback(field, annotation) {
            field = util.$(field).show();

            var u = registry.ident.who();
            var input = field.find('input');

            // Do not show field if no user is set
            if (typeof u === 'undefined' || u === null) {
                field.hide();
            }

            // Do not show field if current user is not admin.
            if (!(registry.authz.permits('admin', annotation, u))) {
                field.hide();
            }

            // See if we can authorise without a user.
            if (registry.authz.permits(action, annotation, null)) {
                input.attr('checked', 'checked');
            } else {
                input.removeAttr('checked');
            }
        };
    }

    function createSubmitCallback(action) {
        return function submitCallback(field, annotation) {
            var u = registry.ident.who();

            // Don't do anything if no user is set
            if (typeof u === 'undefined' || u === null) {
                return;
            }

            if (!annotation.permissions) {
                annotation.permissions = {};
            }
            if (util.$(field).find('input').is(':checked')) {
                delete annotation.permissions[action];
            } else {
                // While the permissions model allows for more complex entries
                // than this, our UI presents a checkbox, so we can only
                // interpret "prevent others from viewing" as meaning "allow
                // only me to view". This may want changing in the future.
                annotation.permissions[action] = [
                    registry.authz.authorizedUserId(u)
                ];
            }
        };
    }

    editor.addField({
        type: 'checkbox',
        label: _t('Allow anyone to <strong>view</strong> this annotation'),
        load: createLoadCallback('read'),
        submit: createSubmitCallback('read')
    });

    editor.addField({
        type: 'checkbox',
        label: _t('Allow anyone to <strong>edit</strong> this annotation'),
        load: createLoadCallback('update'),
        submit: createSubmitCallback('update')
    });
}


// DefaultUI is a function that can be used to construct a plugin that will
// provide Annotator's default user interface.
//
// element - The DOM element which you want to be able to annotate.
//
// Examples
//
//    ann = new annotator.core.Annotator()
//    ann.addPlugin(DefaultUI(document.body, {}))
//
// Returns an Annotator plugin.
function defaultUI(options) {
    var element = options.element;
    // FIXME: restore readOnly mode
    //
    // options: # Configuration options
    //   # Start Annotator in read-only mode. No controls will be shown.
    //   readOnly: false
    // Local helpers
    var makeAnnotation = annotationFactory(element, '.annotator-hl');

    var adder;
    var editor;
    var highlighter;
    var tags;
    var textSelector;
    var viewer;

    // Shared user interface state
    var interactionPoint = null;

    function configure(registry) {
        adder = new ui.Adder({
            onCreate: function (ann) {
                registry.annotations.create(ann);
            }
        });
        adder.attach();

        tags = ui.tags({});
        editor = new ui.Editor({extensions: [tags.createEditorField]});
        editor.attach();

        addPermissionsCheckboxes(editor, registry);

        highlighter = new ui.Highlighter(element);

        textSelector = new ui.TextSelector(element, {
            onSelection: function (ranges, event) {
                if (ranges.length > 0) {
                    var annotation = makeAnnotation(ranges);
                    interactionPoint = util.mousePosition(event);
                    adder.load(annotation, interactionPoint);
                } else {
                    adder.hide();
                }
            }
        });

        var viewerOpts = {
            onEdit: function (ann) {
                registry.annotations.update(ann);
            },
            onDelete: function (ann) {
                registry.annotations['delete'](ann);
            },
            permitEdit: function (ann) {
                return registry.authz.permits(
                    'update',
                    ann,
                    registry.ident.who()
                );
            },
            permitDelete: function (ann) {
                return registry.authz.permits(
                    'delete',
                    ann,
                    registry.ident.who()
                );
            },
            autoViewHighlights: element,
            extensions: [tags.createViewerField]
        };

        if (g.Showdown && typeof g.Showdown.converter === 'function') {
            viewerOpts.renderText = ui.markdown().convert;
        }

        viewer = new ui.Viewer(viewerOpts);
        viewer.attach();

        injectDynamicStyle();
    }

    return {
        configure: configure,

        destroy: function () {
            adder.destroy();
            editor.destroy();
            highlighter.destroy();
            textSelector.destroy();
            viewer.destroy();
            removeDynamicStyle();
        },

        onAnnotationsLoaded: function (anns) { highlighter.drawAll(anns); },
        onAnnotationCreated: function (ann) { highlighter.draw(ann); },
        onAnnotationDeleted: function (ann) { highlighter.undraw(ann); },
        onAnnotationUpdated: function (ann) { highlighter.redraw(ann); },

        onBeforeAnnotationCreated: function (annotation) {
            // Editor#load returns a promise that is resolved if editing
            // completes, and rejected if editing is cancelled. We return it
            // here to "stall" the annotation process until the editing is
            // done.
            return editor.load(annotation, interactionPoint);
        },

        onBeforeAnnotationUpdated: function (annotation) {
            return editor.load(annotation, interactionPoint);
        }
    };
}


exports.defaultUI = defaultUI;
