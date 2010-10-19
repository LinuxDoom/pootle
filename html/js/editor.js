(function($) {
  window.PTL = window.PTL || {};

  PTL.editor = {

  /*
   * Initializes the editor
   */
  init: function(options) {

    /* Default settings */
    this.settings = {
      secure: false,
      mt: []
    };
    /* Merge given options with default settings */
    if (options) {
      $.extend(this.settings, options);
    }

    /* Initialize variables */
    this.units = {};
    this.store = $("div#store").text();
    this.active_uid = $("#active_uid").text();
    this.current_page = 1;
    this.current_current_num_pages = $("#num_pages").text();
    this.pages_got = {};
    this.filter = "all";
    this.keepstate = false;

    /* Ugly hack to avoid JS templates from being interpreted by Django. */
    $("script[type=text/x-jquery-template]").each(function() {
      var stext = $(this).text();
      stext = stext.replace(/\[\[/g, "{{").replace(/\]\]/g, "}}");
      $(this).text(stext);
    });

    /* Compile templates */
    this.tmpl = {pager: $("#pager").template(),
                 vunit: $("#view_unit").template()}

    /* Set initial focus on page load */
    this.focused = $(".translate-original-focus textarea").get(0);

    /* Update focus when appropriate */
    $(".focusthis").live("focus", function(e) {
      PTL.editor.focused = e.target;
    });

    /* Write TM results into the currently focused element */
    // TODO: refactor write TM and writespecial within a single function
    $(".writetm").live("click", function() {
      var tmtext = $(".tm-translation", this).text();
      var element = $(PTL.editor.focused);
      var start = element.caret().start + tmtext.length;
      element.val(element.caret().replace(tmtext));
      element.caret(start, start);
    });

    /* Write special chars, tags and escapes into the currently focused element */
    $(".writespecial, .translate-full .translation-highlight-escape, .translate-full .translation-highlight-html").live("click", function() {
      var specialtext = $(this).text();
      var element = $(PTL.editor.focused);
      var start = element.caret().start + specialtext.length;
      element.val(element.caret().replace(specialtext));
      element.caret(start, start);
    });

    /* Copy original translation */
    $("a.copyoriginal").live("click", function() {
      var sources = $(".translation-text", $(this).parent().parent().parent());
      var clean_sources = [];
      $.each(sources, function(i) {
        clean_sources[i] = $(this).text()
                                  .replace("\n", "\\n\n", "g")
                                  .replace("\t", "\\t", "g");
      });

      var targets = $("[id^=id_target_f_]");
      if (targets.length) {
        var max = clean_sources.length - 1;
        for (var i=0; i<targets.length; i++) {
          var newval = clean_sources[i] || clean_sources[max];
          $(targets.get(i)).val(newval);
        }
        $(targets).get(0).focus();
        PTL.editor.goFuzzy();
      }
    });

    /* Fuzzy / unfuzzy */
    $("textarea.translation").live("keyup blur", function() {
      if (!PTL.editor.keepstate && $(this).attr("defaultValue") != $(this).val()) {
        PTL.editor.ungoFuzzy();
      }
    });

    $("input.fuzzycheck").live("click", function() {
      if (PTL.editor.isFuzzy()) {
        PTL.editor.doFuzzyArea();
      } else {
        PTL.editor.undoFuzzyArea();
      }
    });

    /* Collapsing */
    $(".collapse").live("click", function(event) {
      event.preventDefault();
      $(this).siblings(".collapsethis").slideToggle("fast");
      if ($("textarea", $(this).next("div.collapsethis")).length) {
        $("textarea", $(this).next("div.collapsethis")).focus();
      }
    });

    /* Bind event handlers */
    $("table.translate-table").live("editor_ready", PTL.editor.ready);
    $("a[id^=editlink]").live("click", PTL.editor.goto_unit);
    $("input.submit, input.suggest").live("click", PTL.editor.process_submit);
    $("input.previous, input.next").live("click", PTL.editor.goto_prevnext);
    $("#translate-suggestion-container .rejectsugg").live("click", PTL.editor.reject_suggestion);
    $("#translate-suggestion-container .acceptsugg").live("click", PTL.editor.accept_suggestion);
    $("#translate-checks-block .rejectcheck").live("click", PTL.editor.reject_check);
    $("select#filter-status").live("change", PTL.editor.filter_status);

    /* Bind hotkeys */
    shortcut.add('ctrl+return', function() {
      $("input.submit").trigger("click");
    });
    shortcut.add('ctrl+shift+return', function() {
      $("input.suggest").trigger("click");
    });
    shortcut.add('ctrl+up', function() {
      $("input.previous").trigger("click");
    });
    shortcut.add('ctrl+down', function() {
      $("input.next").trigger("click");
    });

    /* XHR activity indicator */
    $(document).ajaxStart(function() {
      $("#xhr-error").hide();
      $("#xhr-activity").show();
    });
    $(document).ajaxStop(function() {
      $("#xhr-activity").hide();
    });

    /* Load MT backends */
    $.each(this.settings.mt, function() {
      var backend = this.name;
      $.ajax({
        url: m('js/mt/' + backend + '.js'),
        async: false,
        dataType: 'script',
        success: function() {
          $("table.translate-table").live("mt_ready", PTL.editor.mt[backend].ready);
          PTL.editor.mt[backend].init();
        }
      });
    });

    /* History support */
    $.history.init(function(hash) {
      var parts = hash.split("/");
      switch (parts[0]) {
        case "unit":
          var uid = parseInt(parts[1]);
          // Take care when we want to access a unit directly from a permalink
          if (PTL.editor.active_uid != uid
              && PTL.editor.units[uid] == undefined) {
            PTL.editor.active_uid = uid;
            PTL.editor.get_meta(true);
          }
          PTL.editor.display_edit_unit(uid);
        break;
        case "filter":
          PTL.editor.filter = parts[1];
          PTL.editor.pages_got = {};
          PTL.editor.units = {};
          PTL.editor.get_meta(false);
          PTL.editor.display_edit_unit(PTL.editor.active_uid);
        break;
      }
    }, {'unescape': true});

    /* Retrieve metadata used for this query */
    this.get_meta(true);
  },

  /*
   * Stuff to be done when the editor is ready
   */
  ready: function() {
    PTL.editor.make_zebra("table.translate-table tr[id]");
    var maxheight = $(window).height() * 0.3;
    $('textarea.expanding').TextAreaExpander('10', maxheight);
    $(".focusthis").get(0).focus();
    $("table.translate-table").trigger("mt_ready");
  },

  /*
   * Makes zebra stripes
   * XXX: move this over pootle.util ?
   */
  make_zebra: function(selector) {
    /* Customisation for zebra tags */
    var cls = "even";
    var even = true;
    $(selector).each(function() {
      $(this).addClass(cls)
      cls = even ? "odd" : "even";
      $(this).removeClass(cls)
      even = !even;
    });
  },

  /*
   * Fuzzying / unfuzzying functions
   */
  doFuzzyArea: function() {
    $("tr.translate-translation-row").addClass("translate-translation-fuzzy");
  },

  undoFuzzyArea: function() {
    $("tr.translate-translation-row").removeClass("translate-translation-fuzzy");
  },

  doFuzzyBox: function() {
    var checkbox = $("input.fuzzycheck");
    if (!this.isFuzzy()) {
      checkbox.attr("checked", "checked");
    }
  },

  undoFuzzyBox: function() {
    var checkbox = $("input.fuzzycheck");
    if (this.isFuzzy()) {
      checkbox.removeAttr("checked");
    }
  },

  goFuzzy: function() {
    if (!this.isFuzzy()) {
      this.keepstate = true;
      this.doFuzzyArea();
      this.doFuzzyBox();
    }
  },

  ungoFuzzy: function() {
    if (this.isFuzzy()) {
      this.keepstate = true;
      this.undoFuzzyArea();
      this.undoFuzzyBox();
    }
  },

  isFuzzy: function() {
    var checkbox = $("input.fuzzycheck");
    var checked = checkbox.attr("checked");
    if (checked == undefined || checked == false) {
      return false;
    } else {
      return true;
    }
  },

  /*
   * Displays error messages returned in XHR requests
   */
  error: function(msg) {
    if (msg) {
      $("#xhr-activity").hide();
      $("#xhr-error span").text(msg).parent().show();
    }
  },


  /*
   * Unit navigation, display, submission
   */

  /* Retrieves the metadata used for this query */
  get_meta: function(with_uid) {
    var append = with_uid ? this.active_uid : "";
    var meta_url = l(this.store + "/meta/" + append);
    $.ajax({
      url: meta_url,
      async: false,
      data: {filter: PTL.editor.filter},
      dataType: 'json',
      success: function(data) {
        PTL.editor.meta = data.meta;
        // TODO: If there's no pager information, that means ther are no
        // units in this query so we should display a message accordingly.
        if (data.pager) {
            PTL.editor.update_pager(data.pager);
            PTL.editor.current_page = data.pager.number;
            PTL.editor.current_num_pages = data.pager.num_pages;
            PTL.editor.fetch_pages(false);
            if (data.uid) {
              PTL.editor.active_uid = data.uid;
            }
        }
      },
    });
  },

  /* Gets the view units that refer to current_page */
  get_view_units: function(async, page, limit) {
    var async = async == undefined ? false : async;
    var page = page == undefined ? this.current_page : page;
    var limit = limit == undefined ? 0 : limit;
    var url_str = this.store + '/view';
    url_str = limit ? url_str + '/limit/' + limit : url_str;
    var view_for_url = l(url_str);
    $.ajax({
      url: view_for_url,
      data: {page: page, filter: PTL.editor.filter},
      dataType: 'json',
      async: async,
      success: function(data) {
        if (data.success) {
          PTL.editor.pages_got[page] = [];
          $.each(data.units, function() {
            PTL.editor.units[this.id] = this;
            PTL.editor.pages_got[page].push(this.id);
          });
        } else {
          PTL.editor.error(data.msg);
        }
      }
    });
  },

  /* Builds view rows for units represented by 'uids' */
  build_rows: function(uids) {
    var rows = "";
    for (var i=0; i<uids.length; i++) {
      var _this = uids[i].id || uids[i];
      var unit = this.units[_this];
      rows += '<tr id="row' + _this + '">';
      rows += this.tmpl.vunit($, {data: {meta: this.meta,
                                         unit: unit}}).join("");
      rows += '</tr>';
    }
    return rows;
  },

  /* Gets uids that should be displayed before/after 'uid' */
  get_uids_before_after: function(uid) {
    var uids = {before: [], after: []};
    var limit = (this.pager.per_page - 1) / 2;
    var current = this.units[uid];
    var prevnext = {prev: "before", next: "after"};
    for (var m in prevnext) {
      var tu = current;
      for (var i=0; i<limit; i++) {
        if (tu[m] != undefined) {
          var tu = this.units[tu[m]];
          uids[prevnext[m]].push(tu.id);
        }
      }
    }
    var prevnextl = {prev: "after", next: "before"};
    for (var m in prevnext) {
      if (uids[prevnextl[m]].length < limit) {
        // Add (limit - length) units to uids[prevnext[m]]
        var how_much = limit - uids[prevnextl[m]].length;
        var tu = this.units[uids[prevnext[m]][uids[prevnext[m]].length-1]];
        for (var i=0; i<how_much; i++) {
          if (tu[m] != undefined) {
            var tu = this.units[tu[m]];
            uids[prevnext[m]].push(tu.id);
          }
        }
      }
    }
    uids.before.reverse();
    return uids;
  },

  /* Sets the edit view for unit 'uid' */
  display_edit_unit: function(uid) {
    // TODO: Try to add stripe classes on the fly, not at a separate
    // time after rendering
    this.fetch_pages(true);
    var uids = this.get_uids_before_after(uid);
    var newtbody = this.build_rows(uids.before) +
                   this.get_edit_unit(uid) +
                   this.build_rows(uids.after);
    this.redraw(newtbody);
  },

  /* Redraws the translate table rows */
  redraw: function(newtbody) {
    var ttable = $("table.translate-table");
    var where = $("tbody", ttable);
    var oldrows = $("tr", where);
    oldrows.remove();
    where.append(newtbody);
    $(ttable).trigger("editor_ready");
  },

  /* Fetches more view unit pages in case they're needed */
  fetch_pages: function(async) {
    var current = this.current_page;
    var candidates = [current, current + 1, current - 1];
    var pages = [];

    for (var i=0; i<candidates.length; i++) {
      if (candidates[i] <= this.pager.num_pages &&
          candidates[i] > 0 &&
          !(candidates[i] in this.pages_got)) {
        pages.push(candidates[i]);
      }
    }
    for (var i=0; i<pages.length; i++) {
      this.get_view_units(async, pages[i]);
    }
  },

  /* Updates the pager */
  update_pager: function(pager) {
    this.pager = pager;
    // If page number or num_pages has changed, redraw pager
    if (this.current_page != pager.number
        || this.current_num_pages != pager.num_pages) {
      this.current_page = pager.number;
      this.current_num_pages = pager.num_pages;
      var newpager = this.tmpl.pager($, {data: {pager: pager}}).join("");
      $("div.translation-nav").children().replaceWith(newpager);
    }
  },

  /* Loads the edit unit 'uid' */
  get_edit_unit: function(uid) {
    var edit_url = l(this.store + '/edit/' + uid);
    var editor = '<tr id="row' + uid + '" class="translate-translation-row">';
    var widget = '';
    $.ajax({
      url: edit_url,
      async: false,
      data: {page: PTL.editor.current_page, filter: PTL.editor.filter},
      dataType: 'json',
      success: function(data) {
        widget = data['editor'];
        if (data.pager) {
          PTL.editor.update_pager(data.pager);
        }
      },
    });
    editor += widget + '</tr>';
    this.active_uid = uid;
    return editor;
  },

  /* Pushes submissions or suggestions and moves to the next unit */
  process_submit: function(e, type_class) {
    e.preventDefault();
    if (type_class == undefined) {
      type_class = $(e.target).attr("class");
      form_id = "translate";
    } else {
      form_id = "captcha";
    }
    var uid = PTL.editor.active_uid;
    var type_map = {submit: "submission", suggest: "suggestion"};
    var type = type_map[type_class];
    var submit_url = l(PTL.editor.store + '/process/' + uid + '/' + type);
    // Serialize data to be sent
    var post_data = $("form#" + form_id).serialize();
    post_data += "&page=" + PTL.editor.current_page + "&filter=" + PTL.editor.filter;
    $.ajax({
      url: submit_url,
      type: 'POST',
      data: post_data,
      dataType: 'json',
      async: false,
      success: function(data) {
        if (data.captcha) {
          $.fancybox(data.captcha);
          $("input#id_captcha_answer").focus();
        } else {
          if (data.success) {
            if (type == 'submission') {
              $("textarea[id^=id_target_f_]").each(function(i) {
                PTL.editor.units[uid].target[i].text = $(this).val();
              });
            }
            var new_uid = parseInt(data.new_uid);
            if (new_uid) {
              var newhash = "unit/" + new_uid;
              $.history.load(newhash);
            }
          } else {
            PTL.editor.error(data.msg);
          }
        }
      }
    });
    return false;
  },

  /* Loads the editor with the next unit */
  goto_prevnext: function(e) {
    e.preventDefault();
    var current = PTL.editor.units[PTL.editor.active_uid];
    var prevnext_map = {previous: current.prev, next: current.next};
    var new_uid = prevnext_map[$(e.target).attr("class")];
    if (new_uid != null) {
        var newhash = "unit/" + parseInt(new_uid);
        $.history.load(newhash);
    }
  },

  /* Loads the editor with a specific unit */
  goto_unit: function(e) {
    e.preventDefault();
    var m = $(this).attr("id").match(/editlink([0-9]+)/);
    if (m) {
      var uid = m[1];
      var newhash = "unit/" + parseInt(uid);
      $.history.load(newhash);
    }
  },


  /*
   * Units filtering
   */
  filter_status: function() {
    var newhash = "filter/" + $("option:selected", this).val();
    $.history.load(newhash);
  },


  /*
   * Suggestions handling
   */

  /* Rejects a suggestion */
  reject_suggestion: function() {
    var element = $(this).parent().parent();
    var uid = $('.translate-container input#id_id').val();
    var suggid = $(this).siblings("input.suggid").val();
    var url = l('/suggestion/reject/') + uid + '/' + suggid;
    $.post(url, {'reject': 1},
           function(rdata) {
             element.fadeOut(200, function() {
               $(this).remove();
               if (!$("div#translate-suggestion-container div.translate-suggestion").length) {
                 $("input.next").trigger("click");
               }
             });
           }, "json");
    return false;
  },

  /* Accepts a suggestion */
  accept_suggestion: function() {
    var element = $(this).parent().parent();
    var uid = $('.translate-container input#id_id').val();
    var suggid = $(this).siblings("input.suggid").val();
    var url = l('/suggestion/accept/') + uid + '/' + suggid;
    $.post(url, {'accept': 1},
           function(rdata) {
             $.each(rdata.newtargets, function(i, target) {
               $("textarea#id_target_f_" + i).val(target).focus();
             });
             $.each(rdata.newdiffs, function(suggid, sugg) {
               $.each(sugg, function(i, target) {
                 $("#suggdiff-" + suggid + "-" + i).html(target);
               });
             });
             $("textarea[id^=id_target_f_]").each(function(i) {
               PTL.editor.units[uid].target[i].text = $(this).val();
             });
             element.fadeOut(200, function() {
               $(this).remove();
               if (!$("div#translate-suggestion-container div.translate-suggestion").length) {
                 $("input.next").trigger("click");
               }
             });
           }, "json");
    return false;
  },

  /* Rejects a quality check marking it as false positive */
  reject_check: function() {
    var element = $(this).parent();
    var checkid = $(this).siblings("input.checkid").val();
    var uid = $('.translate-container input#id_id').val();
    var url = l('/qualitycheck/reject/') + uid + '/' + checkid;
    $.post(url, {'reject': 1},
           function(rdata) {
             element.fadeOut(200, function() {
               $(this).remove();
             });
           }, "json");
    return false;
  },


  /*
   * Machine Translation
   */
  isSupportedSource: function(pairs, source) {
    for (var i in pairs) {
      if (source == pairs[i].source) {
        return true;
      }
    }
    return false;
  },

  isSupportedTarget: function(pairs, target) {
    for (var i in pairs) {
      if (target == pairs[i].target) {
        return true;
      }
    }
    return false;
  },

  isSupportedPair: function(pairs, source, target) {
    for (var i in pairs) {
      if (source == pairs[i].source &&
          target == pairs[i].target) {
        return true;
      }
    }
    return false;
  },

  addMTButton: function(element, aclass, imgfn, tooltip) {
      var a = document.createElement("a");
      a.setAttribute("class", "translate-mt " + aclass);
      var img = document.createElement("img");
      img.setAttribute("src", imgfn);
      img.setAttribute("title", tooltip);
      a.appendChild(img);
      element.prepend(a);
  },

  normalize_code: function(locale) {
      var clean = locale.replace('_', '-')
      var atIndex = locale.indexOf("@");
      if (atIndex != -1) {
        clean = clean.slice(0, atIndex);
      }
      return clean;
  },

  collectArguments: function(substring) {
    if (substring == '%%') {
      return '%%';
    }
    argument_subs[pos] = substring;
    substitute_string = "__" + pos + "__";
    pos = pos + 1;
    return substitute_string;
  },

  };

})(jQuery);