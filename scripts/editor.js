"use strict";

var $, ace, audio, compiler, feedback, intervals, path, timers, windows;

$ = require("jquery");

ace = require("brace");
path = require("path");

require("brace/ext/searchbox");
require("setimmediate");

compiler = require("./compiler");
feedback = require("./feedback");

require("./ace/mode-grace");

windows = [];
timers = [];
intervals = [];
audio = [];

exports.setup = function (files, view, fdbk, hideReveal) {
  var download, drop, editor, fileName, opening, rename, session;
  var download, drop, search, editor, fileName, opening, rename, session;

  function stop() {
    windows.forEach(function (win) {
      win.close();
    });

    timers.forEach(function (tim) {
      clearTimeout(tim);
    });

    intervals.forEach(function (ter) {
      clearInterval(ter);
    });

    audio.forEach(function (aud) {
      aud.pause();
    });

    feedback.compilation.stop();
  }

  function checkStop() {
    if (windows.length === 0 &&
        timers.length === 0 && intervals.length === 0 && audio.length === 0) {
      stop();
      return true;
    }

    return false;
  }

  global.checkStop = checkStop;

  global.graceRegisterWindow = function (win) {
    windows.push(win);
    win.addEventListener("unload", function () {
      windows.pop(win);
      checkStop();
    });
  };

  global.graceRegisterTimeout = function (timer) {
    timers.push(timer);
  };

  global.graceRegisterInterval = function (interval) {
    timers.push(interval);
  };

  global.graceRegisterAudio = function (element) {
    audio.push(element);
  };

  download = view.find(".download");
  fileName = view.find(".file-name");
  search = view.find(".search");
  drop = view.find(".delete");

  rename = view.find(".file-name-input");
  
  function runProgram() {
    var escaped, modname;

    feedback.running();

    modname = path.basename(fileName.text(), ".grace");
    escaped = "gracecode_" + modname.replace("/", "$");

    global.gracecode_main = global[escaped];
    global.theModule = global[escaped];

    minigrace.lastSourceCode = editor.getValue();
    minigrace.lastModname = modname;
    minigrace.lastMode = "js";
    minigrace.lastDebugMode = true;

    minigrace.stdout_write = function (value) {
      feedback.output.write(value);
      openOutputViewIfHidden();
    };

    minigrace.stderr_write = function (value) {
      feedback.output.error(value);
      openOutputViewIfHidden();
      stop();
    };

    try {
      minigrace.run();
    } catch (error) {
      feedback.output.error(error.toString());
      openOutputViewIfHidden();
      stop();
    }

    if (!checkStop()) {
      return stop;
    }
  }

  function setDownload(name, text) {
    download.attr("href", URL.createObjectURL(new Blob([ text ], {
      "type": "text/x-grace"
    }))).attr("download", name);
  }

  editor = ace.edit(view.find(".editor")[0]);

  editor.setFontSize(14);
  editor.$blockScrolling = Infinity;

  session = editor.getSession();
  session.setUseSoftTabs(true);
  session.setTabSize(2);
  session.setMode("ace/mode/grace");

  session.on("change", function () {
    var name, value;

    if (opening) {
      return;
    }

    name = fileName.text();
    value = session.getValue();

    if (files.isChanged(name, value)) {
      compiler.forget(name);
      stop();
      feedback.compilation.waiting();
    }

    setDownload(name, value);
    files.save(value);

    session.clearAnnotations();
  });

  editor.focus();

  feedback = feedback.setup(fdbk, function () {
    var modname, name;

    name = fileName.text();
    modname = path.basename(name, ".grace");

    compiler.compile(modname, session.getValue(), function (reason) {
      if (reason !== null) {
        feedback.error(reason);
        openOutputViewIfHidden();

        if (reason.module === name && reason.line) {
          session.setAnnotations([ {
            "row": reason.line - 1,
            "column": reason.column && reason.column - 1,
            "type": "error",
            "text": reason.message
          } ]);
        }
      } else {
        feedback.compilation.ready();
        runProgram();
      }
    });
  }, function () {
      runProgram();
  });

  function openOutputViewIfHidden() {
    if (view.find("#output-view").hasClass("hide")) {
      toggleOutputView();
    }
  }

  function toggleOutputView() {
    var fileView = view.find(".open-file");
    var outputView = view.find("#output-view");
    var hideRevealIcon = view.find("#output-hide-reveal-icon");

    if (outputView.hasClass("hide")) {
      fileView.animate({
        height: (view.height() - fdbk.height()) + "px",
      }, 400);

      outputView.animate({
        flexGrow: "1",
        padding: "8px",
        borderBottomWidth: "1pt",
      }, 400, function() {
        outputView.removeClass("hide");
        hideRevealIcon.html("<b>&#x276C;</b>");
      });
    } else {
      fileView.animate({
        height: (view.height() - view.find(".compilation").height()) + "px",
      }, 400);

      outputView.animate({
        flexGrow: "0",
        padding: "0px",
        borderBottomWidth: "0px",
      }, 400, function() {
        outputView.addClass("hide");
        hideRevealIcon.html("<b>&#x276D;</b>");
      });
    }
  }

  hideReveal.mouseup(function () {
    toggleOutputView();
  });

  files.onOpen(function (name, content) {
    var slashIndex = name.lastIndexOf("/");

    if (slashIndex !== -1) {
      name = name.substring(slashIndex + 1);
    }

    fileName.text(name);
    setDownload(name, content);

    opening = true;
    session.setValue(content);
    opening = false;

    if (compiler.isCompiled(name)) {
      feedback.compilation.ready();
    } else if (compiler.isCompiling(name)) {
      feedback.compilation.building();
    } else {
      feedback.compilation.waiting();
    }

    view.removeClass("hidden");
    editor.focus();
  });

  drop.click(function () {
    if (confirm("Are you sure you want to delete this file?")) {
      files.remove();
      view.addClass("hidden");
      feedback.output.clear();
    }
  });

  function resize() {
    rename.attr("size", rename.val().length + 1);
  }

  fileName.click(function () {
    fileName.hide();
    rename.val(fileName.text()).css("display", "inline-block").focus();
    resize();
  });

  rename.change(function () {
    var name = rename.css("display", "none").val();
    fileName.show();
    files.rename(name);
  }).keypress(function (event) {
    if (event.which === 13) {
      rename.blur();
    } else {
      resize();
    }
  }).keydown(resize).keyup(resize);

  // Ace seems to have trouble with adjusting to flexible CSS. Force a resize
  // once the size settles.
  setImmediate(function () {
    editor.resize(true);
  });

  function toggleSettingView() {
    var settingView = $("#settings-view");
    var screenOverlay = $("#screen-overlay")

    if (settingView.hasClass("hidden")) {
      settingView.removeClass("hidden");
      screenOverlay.removeClass("hidden");
    } else {
      settingView.addClass("hidden");
      screenOverlay.addClass("hidden");
    }
  }

  $("#open-settings, #close-settings").mouseup(function () {
    toggleSettingView();
  });
  
  function toggleRefactorView() {
    var refactorView = $("#refactor-view");
    var screenOverlay = $("#screen-overlay")

    if (refactorView.hasClass("hidden")) {
      refactorView.removeClass("hidden");
      screenOverlay.removeClass("hidden");
    } else {
      refactorView.addClass("hidden");
      screenOverlay.addClass("hidden");
    }
  }
  
  $("#rename-vars, #start-refactor, #cancel-refactor").mouseup(function () {
    toggleRefactorView();
  });

  $("#screen-overlay").mouseup(function () {
    if (!$("#settings-view").hasClass("hidden")) {
      toggleSettingView();
    }
  });

  search.mouseup(function () {
    if (search.find(".label").html() == "Search") {
      editor.execCommand("find");
      search.find(".label").html("Replace");
    } else {
      editor.execCommand("replace");
      search.find(".label").html("Search");
    }
  });

  return editor;
};
