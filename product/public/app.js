/* app.js. View rendering + flow state machine (no backend).
 * Flow: onboard -> confirm -> progress -> shortlist -> drafts -> status.
 * State machine fns: showView, submitOnboard, confirmBriefAndRun,
 *   pollProgress, renderShortlist, selectProspect, renderDrafts,
 *   decideDraft, renderStatuses, restart.
 */
(function () {
  "use strict";

  var VIEWS = ["landing", "onboard", "profile", "progress", "shortlist", "drafts", "status", "campaigns", "senders"];
  var state = {
    profile: null,
    prospects: [],
    selectedId: null,
    drafts: [],
    decisions: {},
    runId: null
  };

  var api = null;

  function $(id) { return document.getElementById(id); }

  var CHROMELESS = ["landing", "onboard", "profile", "progress", "shortlist", "drafts"];

  function showView(name) {
    VIEWS.forEach(function (v) {
      var el = $("view-" + v);
      if (el) el.hidden = (v !== name);
    });
    var plain = CHROMELESS.indexOf(name) >= 0;
    var header = document.querySelector(".site-header");
    if (header) header.hidden = plain;
    var footer = $("site-footer");
    if (footer) footer.hidden = plain;
    ["progress-kicker", "shortlist-kicker", "drafts-kicker", "status-kicker",
     "campaigns-kicker", "senders-kicker"].forEach(setDemoKicker);
    var nav = $("step-nav");
    if (nav) {
      var items = nav.querySelectorAll("li");
      items.forEach(function (li) {
        var v = li.getAttribute("data-view");
        li.classList.toggle("active", v === name);
        li.classList.toggle("done", VIEWS.indexOf(v) < VIEWS.indexOf(name));
      });
    }
    try { window.scrollTo(0, 0); } catch (e) { /* noop */ }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var OB_LABELS = {
    offering: "You sell", ideal_customer: "To", service_area: "Where",
    order_size: "Typical order", decision_maker: "Decision maker",
    timeline: "Timing", budget: "Price range", exclusions: "Not for"
  };
  var OB_CORE = ["offering", "ideal_customer", "service_area", "decision_maker", "budget"];

  /* Per-question helper line + example (PDF screen 2). Static copy per known
   * field key; unknown keys fall back to a generic line. */
  var OB_SUB = {
    offering: ["One clear line helps us describe you to buyers.", "For example: packed office lunches, delivered before noon"],
    ideal_customer: ["One quick answer helps us find the right buyers.", "For example: offices with 20 to 200 staff"],
    service_area: ["One quick answer keeps the search where you deliver.", "For example: Ikeja and Yaba"],
    order_size: ["One quick answer helps us size each chance.", "For example: 20 to 200 packs per order"],
    decision_maker: ["One quick answer helps us write to the right person.", "For example: the office admin, sometimes HR"],
    timeline: ["One quick answer helps us time each approach.", "For example: they order weekly, a day ahead"],
    budget: ["One quick answer keeps every quote realistic.", "For example: 1500 to 2500 naira per pack"],
    exclusions: ["One quick answer keeps wrong fits off your list.", "For example: no events under 50 guests"]
  };
  var OB_SUB_FALLBACK = ["One quick answer helps us find buyers that fit.", "Type your answer here"];

  function updateObSub() {
    var pair = (ob.question && OB_SUB[ob.question.key]) || OB_SUB_FALLBACK;
    $("ob-sub").textContent = pair[0];
    $("ob-answer").placeholder = pair[1];
  }

  function updateObSegs(filled) {
    var segs = $("ob-segs");
    if (!segs || !segs.children) return;
    for (var i = 0; i < segs.children.length; i++) {
      segs.children[i].className = i < filled ? "done" : "";
    }
  }

  var ob = null;

  function submitOnboard(event) {
    event.preventDefault();
    var err = $("onboard-error");
    var businessName = $("f-businessName").value.trim();
    var description = $("f-description").value.trim();
    if (!businessName || !description) {
      err.textContent = "Please add your business name and a one-line description.";
      err.hidden = false;
      return false;
    }
    err.hidden = true;
    ob = {
      businessName: businessName, firstText: description,
      fields: {}, followupsUsed: 0, question: null,
      done: false, busy: false, editingKey: null
    };
    $("ob-first").hidden = true;
    $("ob-chat").hidden = false;
    $("ob-yousaid-text").textContent = description;
    renderObChat();
    return obSend(description, {});
  }

  function obSend(text, extra) {
    if (ob.busy) return Promise.resolve(false);
    ob.busy = true;
    obError(null);
    setObButtons(true);
    var payload = { text: text, fields: ob.fields, followups_used: ob.followupsUsed };
    if (extra.skip_key) payload.skip_key = extra.skip_key;
    if (extra.edit_key) { payload.edit_key = extra.edit_key; payload.edit_value = extra.edit_value; }
    return api.onboardTurn(payload).then(function (res) {
      ob.busy = false;
      ob.fields = res.fields || {};
      ob.followupsUsed = res.followups_used || 0;
      ob.question = res.question || null;
      ob.done = !!res.done || !ob.question;
      setObButtons(false);
      renderObChat();
      return true;
    }, function (e) {
      ob.busy = false;
      setObButtons(false);
      obError(friendlyObError(e));
      return false;
    });
  }

  function friendlyObError(e) {
    var detail = e && e.detail ? String(e.detail) : "";
    if (detail === "model_not_configured") return "The assistant is not connected. Come back later.";
    if (detail === "model_error" || (e && e.status === 502)) return "The assistant did not reply. Check your connection and try again.";
    if (detail === "text_too_long") return "That message is too long. Please shorten it and try again.";
    return "Something went wrong. Please try again.";
  }

  function obError(msg) {
    var el = $("ob-error");
    if (!msg) { el.hidden = true; el.textContent = ""; return; }
    el.textContent = msg;
    el.hidden = false;
  }

  function setObButtons(disabled) {
    ["btn-ob-continue", "btn-ob-skip", "btn-ob-finish"].forEach(function (id) {
      var b = $(id);
      if (b) b.disabled = disabled;
    });
    var ans = $("ob-answer");
    if (ans) ans.disabled = disabled;
  }

  function obContinue() {
    if (!ob || ob.busy || ob.done) return false;
    var v = $("ob-answer").value.trim();
    if (!v) { obError("Type your answer, or skip to mark it as a guess."); return false; }
    return obSend(v, {});
  }

  function obSkip() {
    if (!ob || ob.busy || ob.done || !ob.question) return false;
    return obSend("Skipped.", { skip_key: ob.question.key });
  }

  function obChipClick(e) {
    var t = e.target || {};
    var v = t.getAttribute ? t.getAttribute("data-chip") : null;
    if (!v || !ob || ob.busy || ob.done) return;
    if (/not sure/i.test(v)) { obSkip(); return; }
    $("ob-answer").value = v;
    obContinue();
  }

  function renderObChat() {
    var step = $("ob-step");
    if (ob.done) {
      step.textContent = "Step 2 of 3 · done";
      $("ob-question-wrap").hidden = true;
      $("ob-done-wrap").hidden = false;
    } else {
      var left = Math.max(12, 40 - ob.followupsUsed * 12);
      step.textContent = "Step 2 of 3 · about " + left + " seconds left";
      $("ob-question-wrap").hidden = false;
      $("ob-done-wrap").hidden = true;
      $("ob-question").textContent = ob.question ? ob.question.prompt : "Thinking…";
      $("ob-answer").value = "";
      renderObChips();
      updateObSub();
      updateObSegs(2);
    }
    renderObFields();
  }

  function renderObChips() {
    var chips = (ob.question && ob.question.chips) || [];
    $("ob-chips").innerHTML = chips.map(function (c) {
      return '<button type="button" data-chip="' + esc(c) + '">' + esc(c) + "</button>";
    }).join("");
  }

  function renderObFields() {
    var qkey = ob.question ? ob.question.key : null;
    var keys = Object.keys(OB_LABELS).filter(function (k) {
      if (OB_CORE.indexOf(k) >= 0) return true;
      if (ob.fields[k] && (ob.fields[k].value || ob.fields[k].locked)) return true;
      return k === qkey;
    });
    $("ob-fields").innerHTML = keys.map(function (k) { return obFieldRow(k, qkey); }).join("");
  }

  function obFieldRow(k, qkey) {
    var label = OB_LABELS[k];
    var f = ob.fields[k];
    var head = '<div class="ob-row"><dt>' + esc(label) + "</dt>";
    if (ob.editingKey === k) {
      return head + '<dd><input data-obedit="' + esc(k) + '" value="' + esc(f ? f.value : "") +
        '" maxlength="280" /> <button type="button" data-obsave="' + esc(k) + '">Save</button> ' +
        '<button type="button" data-obcancel class="linklike">Cancel</button></dd></div>';
    }
    var editBtn = ' <button type="button" data-obedit-btn="' + esc(k) + '" class="linklike">Edit</button>';
    if (f && f.value) {
      var guess = (f.label === "inferred" || f.label === "unknown") ? ' <span class="guess">a guess</span>' : "";
      return head + "<dd>" + esc(f.value) + guess + editBtn + "</dd></div>";
    }
    if (f && f.locked) {
      return head + '<dd><span class="muted">Marked as a guess</span>' + editBtn + "</dd></div>";
    }
    if (k === qkey) {
      return head + '<dd><span class="ask-now">Asking you now</span></dd></div>';
    }
    return head + '<dd><span class="muted">Optional, you can add it later</span>' + editBtn + "</dd></div>";
  }

  function onObFieldsClick(e) {
    var t = e.target || {};
    var g = function (a) { return t.getAttribute ? t.getAttribute(a) : null; };
    if (!ob) return;
    var editBtn = g("data-obedit-btn");
    if (editBtn) {
      ob.editingKey = editBtn;
      renderObFields();
      var input = $("ob-fields").querySelector('[data-obedit="' + editBtn + '"]');
      if (input && input.focus) input.focus();
      return;
    }
    if (g("data-obcancel") !== null) { ob.editingKey = null; renderObFields(); return; }
    var save = g("data-obsave");
    if (save) {
      var field = $("ob-fields").querySelector('[data-obedit="' + save + '"]');
      var v = field ? field.value.trim() : "";
      ob.editingKey = null;
      // Edits lock locally at once; the next turn carries them to the server.
      if (v) ob.fields[save] = { value: v.slice(0, 280), label: "user-provided", locked: true };
      renderObFields();
    }
  }

  function obEditFirst() {
    if (!ob || ob.busy) return;
    $("ob-chat").hidden = true;
    $("ob-first").hidden = false;
    updateObSegs(1);
    $("f-businessName").value = ob.businessName;
    $("f-description").value = ob.firstText;
    ob = null;
    $("ob-step").textContent = "Step 2 of 3 · about 40 seconds left";
  }

  function obFinish() {
    if (!ob || ob.busy || !ob.done) return false;
    var fv = function (k) { return (ob.fields[k] && ob.fields[k].value) || ""; };
    var desc = fv("offering") || ob.firstText;
    var ideal = fv("ideal_customer");
    // Skip "for X" when the offering already names the buyer ("to offices for offices…").
    if (ideal && desc.toLowerCase().indexOf(ideal.toLowerCase().split(" ")[0]) < 0) desc += " for " + ideal;
    if (fv("timeline")) desc += ". Timing: " + fv("timeline");
    if (fv("budget")) desc += ". Budget per order: " + fv("budget");
    var input = {
      businessName: ob.businessName, site: "", description: desc,
      q1: fv("service_area"), q2: fv("order_size"), q3: fv("decision_maker"),
      q4: fv("exclusions"), q5: fv("ideal_customer")
    };
    setObButtons(true);
    return api.createProfile(input).then(function (res) {
      setObButtons(false);
      state.profile = res.profile;
      renderProfileConfirm(res.profile);
      showView("profile");
    }, function () {
      setObButtons(false);
      obError("Could not save your profile. Please try again.");
      return false;
    });
  }

  function readProfileEdits() {
    var dl = $("profile-fields");
    if (!dl || !state.profile) return;
    var inputs = dl.querySelectorAll("input[data-idx]");
    inputs.forEach(function (input) {
      var i = parseInt(input.getAttribute("data-idx"), 10);
      if (state.profile.fields[i]) state.profile.fields[i].value = input.value;
    });
  }

  function renderProfileConfirm(profile) {
    var dl = $("profile-fields");
    dl.innerHTML = profile.fields.map(function (f, i) {
      var head = "<dt>" + esc(f.key) + "<span class=\"prov " + esc(f.provenance) + "\">" + esc(f.provenance) + "</span></dt>";
      if (f.provenance === "assumed") {
        return head + "<dd><label class=\"guess-edit\">Edit guess <input data-idx=\"" + i + "\" value=\"" + esc(f.value) + "\" /></label></dd>";
      }
      return head + "<dd>" + esc(f.value) + "</dd>";
    }).join("");
  }

  function confirmBriefAndRun() {
    readProfileEdits();
    return api.confirmBrief(state.profile).then(function (res) {
      state.runId = res.runId;
      showView("progress");
      return pollProgress();
    });
  }

  var PROGRESS_IDX = {
    created: 0, awaiting_brief: 0, discovering: 1, investigating: 2,
    assessing: 3, drafting: 4, awaiting_approval: 5, complete: 5,
    stopped: 5, failed: 5
  };
  var progressSeq = 0;

  function pollProgress() {
    $("progress-note").textContent = isDemo()
      ? "Example run. Keep this page open while it works."
      : "Research keeps running on the server. Come back any time.";
    $("progress-error").hidden = true;
    $("btn-restart-progress").hidden = true;
    refreshProgressSnapshot();
    return api.runProgress(state.runId, function () {
      refreshProgressSnapshot();
    }).then(function () {
      return api.getShortlist(state.runId).then(function (res) {
        state.prospects = res.prospects;
        state.selectedId = null;
        state.selectedIds = null;
        state.tab = null;
        renderShortlist();
        showView("shortlist");
      });
    }, function (err) {
      var msg = err && err.message ? err.message : "unknown error";
      $("progress-eyebrow").textContent = "Stopped";
      $("progress-title").textContent = "Research stopped before it finished.";
      var perr = $("progress-error");
      perr.textContent = "Research stopped: " + msg + " You can start over below.";
      perr.hidden = false;
      var again = $("btn-restart-progress");
      if (again) again.hidden = false;
    });
  }

  function refreshProgressSnapshot() {
    var seq = ++progressSeq;
    return api.getProgressSnapshot(state.runId).then(function (snap) {
      if (seq !== progressSeq) return; // a newer poll already landed
      renderProgressSnapshot(snap);
    });
  }

  function renderProgressSnapshot(snap) {
    $("stat-found").textContent = String(snap.found);
    $("stat-opened").textContent = String(snap.opened);
    $("stat-kept").textContent = String(snap.kept);
    var idx = PROGRESS_IDX[snap.status] == null ? 0 : PROGRESS_IDX[snap.status];
    var steps = [
      { doneAt: 1, active: "Understanding your offer and must-haves", done: "Understood your offer and your must-haves" },
      { doneAt: 2, active: "Searching for " + snap.searchLine, done: "Searched for " + snap.searchLine },
      { doneAt: 3, active: "Opening each business's own pages", done: "Opened each business's own pages", frac: [snap.opened, Math.max(snap.found, snap.opened)] },
      { doneAt: 4, active: "Checking fit against your must-haves", done: "Checked fit against your must-haves" },
      { doneAt: 4, active: "Looking for a reason to reach out now", done: "Looked for a reason to reach out now" },
      { doneAt: 5, active: "Finding a published contact route", done: "Found published contact routes" },
      { doneAt: 5, active: "Drafting messages for your approval", done: "Drafted messages for your approval" }
    ];
    var activated = false;
    $("progress-steps").innerHTML = steps.map(function (s) {
      var cls, text;
      if (idx >= s.doneAt) { cls = "done"; text = s.done; } else if (!activated) { cls = "active"; text = s.active; activated = true; } else { cls = ""; text = s.active; }
      if (cls === "active" && s.frac) {
        var pct = s.frac[1] > 0 ? Math.round(100 * s.frac[0] / s.frac[1]) : 0;
        return '<li class="active"><span class="step-top"><span>' + esc(text) +
          '</span><span class="step-count">' + s.frac[0] + " of " + s.frac[1] +
          '</span></span><span class="bar" aria-hidden="true"><span style="width: ' + pct + '%"></span></span></li>';
      }
      return "<li class=\"" + cls + "\">" + esc(text) + "</li>";
    }).join("");
    $("progress-budget").textContent = "Budget so far: " + snap.searches + " searches, " +
      snap.fetches + " page opens (caps 30 / 40)." + (isDemo() ? " Example data." : "");
    var aside = $("progress-setaside");
    aside.innerHTML = (snap.setAside || []).map(function (d) {
      return "<li><strong>" + esc(d.name) + "</strong><span>" + esc(d.reason) + "</span></li>";
    }).join("");
    $("progress-setaside-empty").hidden = (snap.setAside || []).length > 0;
  }

  function previewProgress() {
    if (!state.runId) return false;
    return api.getShortlist(state.runId).then(function (res) {
      state.prospects = res.prospects;
      state.selectedId = null;
      state.selectedIds = null;
      state.tab = null;
      renderShortlist();
      showView("shortlist");
    });
  }

  function tabOf(p) {
    if (p.verdict === "qualified") return "ready";
    if (p.verdict === "no_signal") return "warm";
    return "look";
  }

  function shownProspects() {
    return (state.prospects || []).filter(function (p) { return p.status !== "disqualified"; });
  }

  function firstSentence(s) {
    var t = String(s || "").trim();
    if (!t) return "";
    var head = t.split(/[.?!]\s/)[0].trim() || t;
    return head.slice(0, 140);
  }

  function sourceLabel(url) {
    var u = String(url || "");
    if (!u) return "";
    var low = u.toLowerCase();
    if (low.indexOf("instagram.com") >= 0) return "their Instagram page";
    if (low.indexOf("facebook.com") >= 0 || low.indexOf("fb.com") >= 0) return "their Facebook page";
    if (low.indexOf("career") >= 0 || low.indexOf("hiring") >= 0 || low.indexOf("/jobs") >= 0) return "their careers page";
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u.slice(0, 40); }
  }

  var ROUTE_LABELS = {
    website_form: "Contact form", email: "Email address", phone: "Phone number",
    social_profile: "Social profile", other: "Contact"
  };

  function whyNowFor(p) {
    if ((p.readiness || 0) >= 3 && p.rationale) return firstSentence(p.rationale);
    if (tabOf(p) === "warm") return "No timing signal found. Suggested for a patient intro.";
    return "No timing signal found yet.";
  }

  function fitBadge(p) {
    if (p.verdict === "qualified") return "STRONG FIT";
    if (p.verdict === "no_signal") return "GOOD FIT, NO SIGNAL YET";
    return "NEEDS A LOOK";
  }

  function fitClass(p) {
    if (p.verdict === "qualified") return "tag-green";
    if (p.verdict === "no_signal") return "tag-gold";
    return "tag-line";
  }

  function prospectSource(p) {
    if (p.sourceUrl) return p.sourceUrl;
    var ev = (p.evidence || [])[0];
    return ev ? ev.source || "" : "";
  }

  function isSelected(id) {
    if (!state.selectedIds) return true;
    return state.selectedIds.indexOf(id) >= 0;
  }

  var NUM_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven",
    "Eight", "Nine", "Ten", "Eleven", "Twelve"];

  function numWord(n) {
    return n >= 0 && n < NUM_WORDS.length ? NUM_WORDS[n] : String(n);
  }

  function renderShortlist() {
    var shown = shownProspects();
    if (!state.selectedIds) state.selectedIds = shown.map(function (p) { return p.id; });
    var counts = { ready: 0, warm: 0, look: 0 };
    shown.forEach(function (p) { counts[tabOf(p)] += 1; });
    // Land on the first group with picks; an explicit tab choice always sticks.
    if (!state.tab) {
      state.tab = counts.ready ? "ready" : counts.warm ? "warm" : counts.look ? "look" : "ready";
    }

    $("shortlist-title").textContent = numWord(shown.length) + (shown.length === 1 ? " buyer worth your time." : " buyers worth your time.");
    $("shortlist-sub").textContent = state.tab === "look"
      ? "These need a human look before they join your list."
      : "Each one passed your must-haves. Tick the ones you want, and we write the messages.";
    ["ready", "warm", "look"].forEach(function (t) {
      $("tab-" + t + "-n").textContent = String(counts[t]);
      $("tab-" + t).setAttribute("aria-selected", state.tab === t ? "true" : "false");
    });
    var list = $("prospect-list");
    list.innerHTML = "";
    var inTab = shown.filter(function (p) { return tabOf(p) === state.tab; });
    $("shortlist-empty").hidden = inTab.length > 0;
    inTab.forEach(function (p) {
      var li = document.createElement("li");
      li.className = "pick";
      li.setAttribute("tabindex", "0");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", state.selectedId === p.id ? "true" : "false");
      li.dataset.id = p.id;
      var routes = p.routes || [];
      var first = routes[0];
      var routeLine = first
        ? esc(ROUTE_LABELS[first.channel] || "Contact") + ": " + esc(String(first.value).slice(0, 48)) +
          (routes.length > 1 ? " (+" + (routes.length - 1) + " more)" : "") +
          "<br/><span class=\"muted small\">Published, not yet checked</span>"
        : "<span class=\"muted\">No published route found yet.</span>";
      var open = (p.uncertainties || []).slice(0, 2);
      var src = sourceLabel(prospectSource(p));
      li.innerHTML =
        "<div class=\"pick-top\"><label class=\"pick-tick\"><input type=\"checkbox\" data-sel=\"" + esc(p.id) + "\"" +
        (isSelected(p.id) ? " checked" : "") + " aria-label=\"Select " + esc(p.name) + "\" /></label>" +
        "<h3>" + esc(p.name) + "</h3>" +
        "<span class=\"tag " + fitClass(p) + "\">" + esc(fitBadge(p)) + "</span></div>" +
        "<p class=\"muted pick-sub\">" + esc(p.category) + " · " + esc(p.area) + "</p>" +
        "<div class=\"pick-cols\"><div><h4>Why now</h4><p>" + esc(whyNowFor(p)) + "</p>" +
        (src ? "<p class=\"muted small\">Source: " + esc(src) + "</p>" : "") + "</div>" +
        "<div><h4>How to reach them</h4><p>" + routeLine + "</p></div></div>" +
        (open.length ? "<p class=\"muted small pick-open\">Still unconfirmed: " + esc(open.join(", ")) + "</p>" : "");
      li.addEventListener("click", function (e) {
        var t = e.target || {};
        if (t.getAttribute && t.getAttribute("data-sel")) {
          toggleSelected(t.getAttribute("data-sel"), !!t.checked);
          return;
        }
        selectProspect(p.id);
      });
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") selectProspect(p.id); });
      list.appendChild(li);
    });
    if (!state.selectedId && inTab.length) selectProspect(inTab[0].id);
    renderShortlistBar();
  }

  function toggleSelected(id, on) {
    var ids = state.selectedIds || shownProspects().map(function (p) { return p.id; });
    if (on && ids.indexOf(id) < 0) ids.push(id);
    if (!on) ids = ids.filter(function (x) { return x !== id; });
    state.selectedIds = ids;
    renderShortlistBar();
  }

  function renderShortlistBar() {
    var n = (state.selectedIds || shownProspects().map(function (p) { return p.id; })).length;
    $("shortlist-count").textContent = n === 1
      ? "1 selected · nothing is sent yet"
      : n + " selected · nothing is sent yet";
    $("btn-to-drafts").disabled = n === 0;
  }

  function switchTab(t) {
    state.tab = t;
    state.selectedId = null;
    renderShortlist();
  }

  function selectProspect(id) {
    state.selectedId = id;
    var items = $("prospect-list").querySelectorAll("li");
    items.forEach(function (li) { li.setAttribute("aria-selected", li.dataset.id === id ? "true" : "false"); });
    return api.getEvidence(id).then(function (res) {
      var body = $("evidence-body");
      $("evidence-hint").textContent = api.mode === "live"
        ? "Why " + res.prospect.name + " made your shortlist:"
        : "Why " + res.prospect.name + " made the example shortlist:";
      body.innerHTML = res.evidence.map(function (ev) {
        return "<blockquote>" + esc(ev.quote) + "<cite>Source: " + esc(ev.source) + " (" + esc(ev.type) + (isDemo() ? ", example data" : "") + ")</cite></blockquote>";
      }).join("");
      return renderTimeline(id, body);
    });
  }

  function timelineItem(t) {
    var when = "";
    try { when = new Date(t.at).toLocaleString(); } catch (e) { when = String(t.at || ""); }
    if (t.kind === "contact") {
      return "<li class=\"contact\">" + esc(t.direction === "inbound" ? "Heard back" : "Contacted") +
        " via " + esc(t.channel) + " · " + esc(when) + (t.note ? ". " + esc(t.note) : "") + "</li>";
    }
    return "<li>" + esc(t.event || "update") + " · " + esc(when) + (t.note ? ". " + esc(t.note) : "") + "</li>";
  }

  function renderTimeline(id, body) {
    return api.getTimeline(id).then(function (res) {
      var items = (res.timeline || []).map(timelineItem).join("");
      body.innerHTML += "<h4>History</h4><ul class=\"timeline\">" +
        (items || "<li>No contact yet. Log your first touch below.</li>") + "</ul>" +
        "<div class=\"log-contact\">" +
        "<label>Channel <select data-field=\"contact-channel\">" +
        ["whatsapp", "email", "telegram", "phone", "sms", "in_person", "other"].map(function (c) {
          return "<option value=\"" + c + "\">" + c + "</option>";
        }).join("") + "</select></label>" +
        "<label>Date <input data-field=\"contact-date\" type=\"date\" /></label>" +
        "<label>Note <input data-field=\"contact-note\" placeholder=\"e.g. Sent intro + menu\" /></label>" +
        "<div class=\"row\"><button type=\"button\" data-act=\"log-contact\" data-id=\"" + esc(id) + "\">Log contact</button></div>" +
        "</div>";
    }, function () { /* timeline is best-effort; evidence already rendered */ });
  }

  function onEvidenceClick(e) {
    var t = e.target || {};
    var ds = t.dataset || {};
    if (ds.act !== "log-contact" || !ds.id) return;
    var body = $("evidence-body");
    var channel = body.querySelector('[data-field="contact-channel"]');
    var date = body.querySelector('[data-field="contact-date"]');
    var note = body.querySelector('[data-field="contact-note"]');
    var payload = { channel: channel ? channel.value : "other" };
    if (date && date.value) payload.contacted_at = new Date(date.value + "T12:00:00").toISOString();
    if (note && note.value.trim()) payload.note = note.value.trim();
    api.logContact(ds.id, payload).then(function () { selectProspect(ds.id); });
  }

  var STUDIO_TABS = ["whatsapp", "email", "dm"];
  var STUDIO_TAB_LABEL = { whatsapp: "WhatsApp", email: "Email", dm: "Direct message" };
  var STUDIO_SENDER = {
    whatsapp: "Sends from your own WhatsApp Business number, at a time you choose.",
    email: "Sends from your connected email sender, at a time you choose.",
    dm: "Sends from an account you connect, at a time you choose."
  };

  /** Map a route-style suggestion onto a studio tab (short notes read as DMs). */
  function studioTabFor(channel) {
    if (channel === "phone") return "whatsapp";
    if (channel === "email") return "email";
    if (channel === "social_profile") return "dm";
    return "dm";
  }

  function studioSuggestionLabel(channel) {
    return ROUTE_LABELS[channel] || "Contact";
  }

  function countWords(s) {
    var t = String(s || "").trim();
    return t ? t.split(/\s+/).length : 0;
  }

  function wordGuidance(n) {
    if (n <= 40) return "Short enough to read in one glance.";
    if (n <= 80) return "Room for context, still under 80 words.";
    return "Over 80 words. Shorter usually earns the reply.";
  }

  function rationaleRemainder(rationale) {
    var parts = String(rationale || "").split(/[.?!]\s/);
    if (parts.length < 2) return "";
    return parts.slice(1).join(". ").trim().slice(0, 200);
  }

  function profileOffer() {
    var fields = (state.profile && state.profile.fields) || [];
    var offer = fields.filter(function (f) { return f.key === "Offer"; })[0];
    var v = offer ? String(offer.value || "").trim() : "";
    return v ? v.slice(0, 140) : "The offer on your business profile.";
  }

  function sourceLink(url, label) {
    var u = String(url || "");
    var href = /^https?:\/\//i.test(u) ? u : (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(u) ? "https://" + u : "");
    if (href) {
      return "<a href=\"" + esc(href) + "\" target=\"_blank\" rel=\"noreferrer\">View source: " + esc(label) + "</a>";
    }
    return "View source: " + esc(label);
  }

  function renderDrafts() {
    return api.getDrafts(state.runId).then(function (res) {
      state.drafts = res.drafts.map(function (d) {
        if (state.decisions[d.prospectId]) d.status = state.decisions[d.prospectId].decision;
        return d;
      });
      var sel = state.selectedIds || state.drafts.map(function (d) { return d.prospectId; });
      var drafts = state.drafts.filter(function (d) { return sel.indexOf(d.prospectId) >= 0; });
      var notes = [];
      if (drafts.length < state.drafts.length) notes.push("Showing drafts for your " + sel.length + " selected picks.");
      var missing = sel.filter(function (id) {
        return !state.drafts.some(function (d) { return d.prospectId === id; });
      }).map(function (id) {
        var p = state.prospects.filter(function (x) { return x.id === id; })[0];
        return p ? p.name : id;
      });
      if (missing.length) notes.push("No draft yet for " + missing.join(", ") + ". The research did not write one.");
      $("drafts-note").textContent = notes.join(" ");
      var wrap = $("draft-list");
      wrap.innerHTML = "";
      state.studio = { list: drafts, idx: 0, tab: null, editing: false, evidence: {}, busy: false };
      if (!drafts.length) {
        wrap.innerHTML = "<p class=\"hint\">No drafts for your selected picks yet. The research may still be writing, or nothing qualified.</p>";
        showView("drafts");
        return;
      }
      return Promise.all(drafts.map(function (d) {
        return api.getEvidence(d.prospectId).then(function (r) { return r; }, function () { return null; });
      })).then(function (all) {
        all.forEach(function (r, i) { state.studio.evidence[drafts[i].prospectId] = r; });
        var div = document.createElement("div");
        div.className = "studio";
        div.addEventListener("click", onStudioClick);
        state.studio.el = div;
        wrap.appendChild(div);
        renderStudioInner();
        showView("drafts");
      });
    });
  }

  function studioDraft() {
    return state.studio.list[state.studio.idx];
  }

  function studioProspect(d) {
    return state.prospects.filter(function (x) { return x.id === d.prospectId; })[0] || null;
  }

  function studioNav(step) {
    var n = state.studio.list.length;
    state.studio.idx = Math.min(n - 1, Math.max(0, state.studio.idx + step));
    state.studio.tab = null;
    state.studio.editing = false;
    renderStudioInner();
  }

  function studioStatus(msg) {
    var s = state.studio.el.querySelector("#studio-status");
    if (s) s.textContent = msg;
  }

  function studioKey(d) {
    return api.mode === "live" ? d.id : d.prospectId;
  }

  function studioTone(d, tone) {
    var st = state.studio;
    if (st.busy) return;
    st.busy = true;
    studioStatus("Rewriting…");
    // Unsaved editor text is stored first: the server rewrites stored text.
    var saveFirst = !st.editing ? Promise.resolve() : decideDraft(d.prospectId, "save-edit", st.el).then(function () {
      d.subject = st.el.querySelector('[data-field="subject"]').value;
      d.body = st.el.querySelector('[data-field="body"]').value;
      st.editing = false;
    });
    saveFirst.then(function () {
      return api.rewriteDraft(studioKey(d), tone, { subject: d.subject, body: d.body });
    }).then(function (res) {
      d.subject = res.subject;
      d.body = res.body;
      st.busy = false;
      renderStudioInner();
      decideDraft(d.prospectId, "save-edit", st.el);
      studioStatus("Rewrite ready. Review it before you approve.");
    }, function (e) {
      st.busy = false;
      renderStudioInner();
      studioStatus("Rewrite failed (" + ((e && e.detail) || "please try again") + "). Your text is unchanged.");
    });
  }

  function studioTest(d) {
    var st = state.studio;
    if (st.busy) return;
    if (d.channel !== "email") {
      studioStatus("Test sends are email-only for now.");
      return;
    }
    st.busy = true;
    renderStudioInner();
    studioStatus("Sending a test to yourself…");
    api.testSend(studioKey(d)).then(function (res) {
      st.busy = false;
      renderStudioInner();
      studioStatus("Test sent to " + res.to + ". Nothing went to the prospect.");
    }, function (e) {
      st.busy = false;
      renderStudioInner();
      var msg = (e && e.status === 409)
        ? "Connect an email sender first, then try again."
        : "Test send failed (" + ((e && e.detail) || "please try again") + ").";
      studioStatus(msg);
    });
  }

  function onStudioClick(e) {
    var ds = e.target && e.target.dataset ? e.target.dataset : {};
    var act = ds.act;
    if (!act || !state.studio || !state.studio.el) return;
    var d = studioDraft();
    if (act === "studio-prev") { studioNav(-1); return; }
    if (act === "studio-next") { studioNav(1); return; }
    if (act === "studio-tab" && ds.id) {
      state.studio.tab = ds.id;
      state.studio.editing = false;
      renderStudioInner();
      return;
    }
    if (act === "studio-edit") { state.studio.editing = true; renderStudioInner(); return; }
    if (act === "studio-cancel") { state.studio.editing = false; renderStudioInner(); return; }
    if (act === "studio-save") {
      var el = state.studio.el;
      decideDraft(d.prospectId, "save-edit", el).then(function () {
        d.subject = el.querySelector('[data-field="subject"]').value;
        d.body = el.querySelector('[data-field="body"]').value;
        state.studio.editing = false;
        renderStudioInner();
      });
      return;
    }
    if (act === "studio-sender") { renderSendersView("drafts"); return; }
    if (act === "studio-tone" && ds.id) { studioTone(d, ds.id); return; }
    if (act === "studio-test") { studioTest(d); return; }
    if (act === "approve" || act === "save-edit" || act === "reject" || act === "skip") {
      decideDraft(d.prospectId, act, state.studio.el);
    }
  }

  function renderStudioInner() {
    var st = state.studio;
    var d = studioDraft();
    var p = studioProspect(d);
    var pname = p ? p.name : d.prospectId;
    if (!st.tab) st.tab = studioTabFor(d.channel);
    var primary = studioTabFor(d.channel);
    var dec = decisionOf(d);
    var tabs = STUDIO_TABS.map(function (t) {
      return "<button role=\"tab\" type=\"button\" data-act=\"studio-tab\" data-id=\"" + t + "\" aria-selected=\"" +
        (st.tab === t ? "true" : "false") + "\">" + STUDIO_TAB_LABEL[t] + "</button>";
    }).join("");
    var bodyHtml;
    if (st.tab === primary) {
      var subj = st.tab === "email" && d.subject ? "<p class=\"studio-subject\">" + esc(d.subject) + "</p>" : "";
      var paras = esc(d.body).split("\n").map(function (line) {
        return "<p>" + (line || "&nbsp;") + "</p>";
      }).join("");
      bodyHtml = subj + "<div class=\"studio-text\">" + paras + "</div>" +
        "<button type=\"button\" class=\"linklike\" data-act=\"studio-edit\">Tap to edit</button>";
    } else {
      bodyHtml = "<p class=\"hint\">No " + esc(STUDIO_TAB_LABEL[st.tab].toLowerCase()) + " version for this pick. " +
        "The research wrote one " + esc(studioSuggestionLabel(d.channel).toLowerCase()) + " draft.</p>";
    }
    var n = countWords(d.body);
    var tones = st.tab === primary
      ? [["warmer", "Warmer"], ["more_direct", "More direct"], ["another", "Write another"]].map(function (t) {
        return "<button type=\"button\" data-act=\"studio-tone\" data-id=\"" + t[0] + "\"" +
          (st.busy ? " disabled" : "") + ">" + t[1] + "</button>";
      }).join("")
      : "";
    var editor = "<div class=\"studio-editor\"" + (st.editing ? "" : " hidden") + ">" +
      "<label>Subject <input data-field=\"subject\" value=\"" + esc(d.subject || "") + "\" /></label>" +
      "<label>Message <textarea data-field=\"body\" rows=\"6\">" + esc(d.body) + "</textarea></label>" +
      "<div class=\"row\"><button type=\"button\" data-act=\"studio-save\">Save</button>" +
      "<button type=\"button\" class=\"secondary\" data-act=\"studio-cancel\">Cancel</button></div></div>";
    // Hidden mirror keeps decideDraft + smoke working when the editor is closed.
    var mirror = st.editing ? "" : "<div hidden><input data-field=\"subject\" value=\"" + esc(d.subject || "") +
      "\" /><textarea data-field=\"body\">" + esc(d.body) + "</textarea></div>";
    var ev = (st.evidence[d.prospectId] && st.evidence[d.prospectId].evidence) || [];
    var fact = ev[0];
    var hypothesis = (p && p.hypothesis) || rationaleRemainder(p && p.rationale) ||
      "The research flagged no separate hypothesis.";
    var why = "<div class=\"card why\"><p class=\"kicker kicker-dim\">Why this message</p>" +
      "<div class=\"why-row\"><h4 class=\"why-fact\">A fact we found</h4>" +
      (fact ? "<p>" + esc(fact.quote) + "</p><p class=\"muted small\">" +
        sourceLink(fact.source, sourceLabel(fact.source)) + "</p>"
        : "<p class=\"muted\">No linked evidence for this draft.</p>") + "</div>" +
      "<div class=\"why-row\"><h4 class=\"why-hyp\">Our hypothesis, not confirmed</h4><p>" + esc(hypothesis) + "</p></div>" +
      "<div class=\"why-row\"><h4 class=\"why-dim\">Your offer</h4><p>" + esc(profileOffer()) + "</p></div>" +
      "<div class=\"why-row\"><h4 class=\"why-dim\">A small ask</h4><p>" + esc(d.next_action || "Ask for a quick reply.") + "</p></div>" +
      "<p class=\"muted small note-box\">We never claim a problem we have not confirmed. If the facts change, the message says so too.</p></div>";
    st.el.innerHTML =
      "<p class=\"kicker\">MESSAGE " + (st.idx + 1) + " OF " + st.list.length + "</p>" +
      "<h2 class=\"studio-title\">Your note to " + esc(pname) + ". <span class=\"decision " + esc(dec) + "\">[" + esc(dec) + "]</span></h2>" +
      "<div class=\"row studio-pager\"><button type=\"button\" class=\"secondary\" data-act=\"studio-prev\"" +
      (st.idx === 0 ? " disabled" : "") + ">← Previous</button>" +
      "<button type=\"button\" class=\"secondary\" data-act=\"studio-next\"" +
      (st.idx === st.list.length - 1 ? " disabled" : "") + ">Next →</button></div>" +
      "<div class=\"studio-grid\"><div class=\"studio-main\">" +
      "<div role=\"tablist\" aria-label=\"Message channel\" class=\"tabs\">" + tabs + "</div>" +
      "<div class=\"card studio-card\"><p class=\"kicker kicker-dim\">Draft, tap to edit</p>" + bodyHtml + editor + mirror +
      "<p class=\"word-line\"><svg class=\"tick\" viewBox=\"0 0 12 10\" aria-hidden=\"true\"><path d=\"M1 5.5 4.5 9 11 1\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>" +
      n + " words. " + esc(wordGuidance(n)) + "</p><div class=\"chips tone-row\" id=\"studio-tones\">" + tones + "</div></div>" +
      "<div class=\"card sender-card\"><p>" + esc(STUDIO_SENDER[st.tab]) + " Every message includes a way to opt out.</p>" +
      "<button type=\"button\" class=\"link-gold\" data-act=\"studio-sender\">Change sender</button></div>" +
      "<div class=\"row studio-actions\"><button type=\"button\" data-act=\"approve\">Approve and schedule <span aria-hidden=\"true\">→</span></button>" +
      "<button type=\"button\" class=\"secondary\" data-act=\"studio-test\"" + (st.busy ? " disabled" : "") + ">Send a test to myself</button>" +
      "<button type=\"button\" class=\"linklike\" data-act=\"skip\">Skip this one</button>" +
      "<button type=\"button\" class=\"linklike\" data-act=\"reject\">Reject instead</button></div>" +
      "<p class=\"studio-status\" id=\"studio-status\" aria-live=\"polite\"></p>" +
      "</div>" + why + "</div>";
    if (st.editing) {
      var ta = st.el.querySelector('[data-field="body"]');
      if (ta && ta.focus) ta.focus();
    }
  }

  function decideDraft(prospectId, act, divEl) {
    var subject = divEl.querySelector('[data-field="subject"]').value;
    var body = divEl.querySelector('[data-field="body"]').value;
    var decision = act === "approve" ? "approved" : act === "reject" ? "rejected" : act === "skip" ? "deferred" : "pending";
    if (act === "save-edit") {
      state.decisions[prospectId] = { decision: decision === "pending" ? (state.decisions[prospectId] ? state.decisions[prospectId].decision : "pending") : decision, body: subject + "\n\n" + body };
    }
    var payload = subject + "\n\n" + body;
    var args = [prospectId, decision === "pending" ? "edited" : decision, payload];
    if (api.mode === "live") {
      var d = state.drafts.filter(function (x) { return x.prospectId === prospectId; })[0] || {};
      args = [d.id, decision === "pending" ? "edited" : decision,
        { subject: subject, body: body, edited: subject !== (d.subject || "") || body !== (d.body || "") }];
    }
    return api.decideDraft(args[0], args[1], args[2]).then(function () {
      var prev = state.decisions[prospectId];
      state.decisions[prospectId] = { decision: act === "save-edit" ? (prev ? prev.decision : "pending") : decision, body: payload };
      var badge = divEl.querySelector(".decision");
      badge.textContent = "[" + state.decisions[prospectId].decision + "]";
      badge.className = "decision " + state.decisions[prospectId].decision;
    });
  }

  var STATUS_COLS = [
    { key: "approved", title: "Approved. Follow up yourself" },
    { key: "pending", title: "Pending review" },
    { key: "deferred", title: "Deferred. Revisit later" },
    { key: "rejected", title: "Rejected" },
    { key: "followups", title: "Follow-ups (manual. Handled by you)" }
  ];

  function decisionOf(d) {
    return state.decisions[d.prospectId] ? state.decisions[d.prospectId].decision : d.status;
  }

  function emptyCopy(key) {
    if (!state.drafts.length) {
      return "<li>" + esc("No drafts yet. Nothing qualified for messages.") + "</li>";
    }
    var notes = {
      approved: "No approved drafts yet. Approve one above to see it here.",
      pending: "All drafts reviewed. Nice. Decided drafts are listed in their columns.",
      deferred: "No deferred drafts. Drafts you pause will wait here.",
      rejected: "No rejected drafts. Every draft is still waiting or approved.",
      followups: "No follow-ups yet. Approve a draft first. Follow-ups are manual; nothing is sent without your approval."
    };
    return "<li>" + esc(notes[key] || "Nothing to show here yet.") + "</li>";
  }

  function renderStatuses() {
    var board = $("status-board");
    board.innerHTML = "";
    var seenFollowups = {};
    STATUS_COLS.forEach(function (c) {
      var div = document.createElement("div");
      div.className = "column";
      var names = state.drafts.filter(function (d) {
        var dec = decisionOf(d);
        if (c.key === "followups") {
          if (dec !== "approved") return false;
          if (seenFollowups[d.prospectId]) return false;
          seenFollowups[d.prospectId] = true;
          return true;
        }
        return dec === c.key;
      }).map(function (d) {
        var p = state.prospects.filter(function (x) { return x.id === d.prospectId; })[0];
        var suffix = c.key === "followups" ? ". Follow up manually (e.g. nudge in 3 days)" : "";
        return "<li>" + esc(p ? p.name : d.prospectId) + esc(suffix) + "</li>";
      });
      if (!names.length) names = [emptyCopy(c.key)];
      div.innerHTML = "<h3>" + esc(c.title) + "</h3><ul>" + names.join("") + "</ul>";
      board.appendChild(div);
    });
    renderCampaigns(board);
    showView("status");
  }

  function renderCampaigns(board) {
    return api.getCampaigns().then(function (res) {
      var div = document.createElement("div");
      div.className = "campaigns";
      var list = res.campaigns || [];
      if (!list.length) {
        div.innerHTML = "<h3>Email campaigns</h3><p class=\"hint\">No campaigns yet. Approve drafts, then schedule a campaign.</p>";
      } else {
        div.innerHTML = "<h3>Email campaigns</h3>" + list.map(function (c) {
          var recs = (c.recipients || []).map(function (r) {
            return "<li>" + esc(r.email) + ". " + esc(r.status) + "</li>";
          }).join("");
          var stats = c.stats && Object.keys(c.stats).length
            ? " <span class=\"meta\">(" + Object.keys(c.stats).map(function (k) { return esc(k) + ": " + esc(c.stats[k]); }).join(", ") + ")</span>" : "";
          var when = c.scheduled_at_utc ? " · sends " + esc(c.scheduled_at_utc) : "";
          var cancel = (c.status === "scheduled" || c.status === "sending")
            ? " <button type=\"button\" class=\"secondary\" data-act=\"cancel-campaign\" data-id=\"" + esc(c.id) + "\">Cancel</button>" : "";
          return "<div class=\"campaign\"><h4>" + esc(c.name) + ". " + esc(c.status) + "</h4>" +
            "<p class=\"meta\">" + esc(c.id) + when + stats + "</p><ul>" + recs + "</ul>" + cancel + "</div>";
        }).join("");
      }
      var cta = document.createElement("div");
      cta.className = "row";
      cta.innerHTML = "<button type=\"button\" data-act=\"new-campaign\">New campaign</button>";
      div.appendChild(cta);
      board.appendChild(div);
    }, function () { /* campaigns best-effort */ });
  }

  function onBoardClick(e) {
    var t = e.target || {};
    var ds = t.dataset || {};
    if (ds.act === "new-campaign") { renderCampaignView(); return; }
    if (ds.act !== "cancel-campaign" || !ds.id) return;
    api.cancelCampaign(ds.id).then(function () { renderStatuses(); });
  }

  var sendersReturn = "status";
  var senderChoice = "gmail";
  var senderNotice = "";

  function providerName(p) {
    return { smtp: "SMTP", resend: "Resend", gmail: "Gmail", mock: "Example" }[p] || String(p);
  }

  function senderStatusPill(status) {
    var cls = status === "connected" ? "extracted" : "assumed";
    return "<span class=\"prov " + cls + "\">" + esc(status) + "</span>";
  }

  function renderSendersView(returnTo) {
    sendersReturn = returnTo || "status";
    showView("senders");
    var wrap = $("senders-wrap");
    wrap.innerHTML = "<p class=\"hint\">Loading…</p>";
    wrap.onclick = onSendersClick;
    api.listConnections().then(function (res) {
      renderSendersList(wrap, res.connections || []);
    }, function () {
      wrap.innerHTML = "<p>Could not load senders. Check your connection and try again.</p>" +
        "<div class=\"row\"><button type=\"button\" class=\"secondary\" data-act=\"sender-back\">Back</button></div>";
    });
  }

  function choiceBtn(key, label, sub) {
    return "<button type=\"button\" class=\"" + (senderChoice === key ? "" : "secondary") + "\" data-act=\"sender-choice\" data-id=\"" + key + "\">" +
      esc(label) + "<br/><small>" + esc(sub) + "</small></button>";
  }

  function renderSendersList(wrap, conns) {
    var notice = senderNotice;
    senderNotice = "";
    senderCache = conns;
    var cards = conns.map(function (c) {
      var actions = c.status === "connected"
        ? "<button type=\"button\" class=\"secondary\" data-act=\"sender-test\" data-id=\"" + esc(c.id) + "\">Test again</button> " +
          "<button type=\"button\" class=\"secondary\" data-act=\"sender-disconnect\" data-id=\"" + esc(c.id) + "\">Disconnect</button>"
        : "<button type=\"button\" data-act=\"sender-test\" data-id=\"" + esc(c.id) + "\">Test &amp; connect</button> " +
          "<button type=\"button\" class=\"secondary\" data-act=\"sender-disconnect\" data-id=\"" + esc(c.id) + "\">Remove</button>";
      return "<div class=\"campaign\"><h4>" + esc(c.label || c.sender_email) + " " + senderStatusPill(c.status) + "</h4>" +
        "<p class=\"meta\">" + esc(c.sender_email) + " · " + esc(providerName(c.provider)) + "</p>" +
        "<div class=\"row\">" + actions + "</div></div>";
    }).join("");
    wrap.innerHTML = (notice ? "<p>" + esc(notice) + "</p>" : "") +
      (cards || "<p class=\"hint\">No senders yet. Connect one below.</p>") +
      "<h3>Connect a sender</h3>" +
      "<p class=\"hint\">Where do you send email from?</p>" +
      "<div class=\"choice-row\" role=\"group\" aria-label=\"Email provider\">" +
      choiceBtn("gmail", "Gmail", "A @gmail.com address") +
      choiceBtn("smtp", "Business email", "Zoho, cPanel, Microsoft 365…") +
      choiceBtn("resend", "Resend", "Key from your Resend dashboard") +
      "</div>" +
      "<p class=\"form-error\" id=\"sender-error\" hidden></p>" +
      "<div id=\"sender-form\"></div>" +
      "<div class=\"row\"><button type=\"button\" class=\"secondary\" data-act=\"sender-back\">Back</button></div>";
    renderSenderForm();
  }

  var GMAIL_TWOSV = "https://myaccount.google.com/signinoptions/twosv";
  var GMAIL_APPPW = "https://myaccount.google.com/apppasswords";

  function renderSenderForm() {
    var box = $("sender-form");
    if (!box) return;
    if (senderChoice === "gmail") {
      box.innerHTML =
        "<div class=\"help-box\">" +
        "<strong>Use a Google app password. Never your normal password.</strong>" +
        "<p>Your normal Google password will not work here, and you should never type it into another website. " +
        "An app password is a separate 16-letter code that can only send email. You can delete it any time without changing your Google login.</p>" +
        "<ol>" +
        "<li>Turn on 2-Step Verification first (the option does not appear without it): " +
        "<a href=\"" + GMAIL_TWOSV + "\" target=\"_blank\" rel=\"noopener\">myaccount.google.com/…/twosv</a></li>" +
        "<li>Create the app password here: " +
        "<a href=\"" + GMAIL_APPPW + "\" target=\"_blank\" rel=\"noopener\">myaccount.google.com/apppasswords</a></li>" +
        "<li>Type a name (for example “Prospect Research”) and click Create.</li>" +
        "<li>Google shows the 16 characters once. Copy them straight away. You can ignore the spaces.</li>" +
        "</ol></div>" +
        "<label>Your Gmail address <input data-field=\"snd-email\" type=\"email\" autocomplete=\"email\" placeholder=\"you@gmail.com\" /></label>" +
        "<label>16-letter app password <input data-field=\"snd-password\" type=\"password\" autocomplete=\"new-password\" placeholder=\"xxxx xxxx xxxx xxxx\" /></label>" +
        "<label>Label (optional) <input data-field=\"snd-label\" placeholder=\"Gmail\" /></label>" +
        "<div class=\"row\"><button type=\"button\" data-act=\"sender-submit\">Test &amp; connect</button></div>" +
        "<p class=\"hint\">We store it encrypted and only use it to send campaigns you approve. Testing sends nothing.</p>";
    } else if (senderChoice === "smtp") {
      box.innerHTML =
        "<label>Sender email <input data-field=\"snd-email\" type=\"email\" autocomplete=\"email\" placeholder=\"you@yourbusiness.com\" /></label>" +
        "<label>Mail server (host) <input data-field=\"snd-host\" placeholder=\"e.g. smtp.zoho.com\" /></label>" +
        "<label>Port <input data-field=\"snd-port\" inputmode=\"numeric\" value=\"587\" /></label>" +
        "<label>Username <input data-field=\"snd-user\" autocomplete=\"username\" placeholder=\"Usually the same as the sender email\" /></label>" +
        "<label>Password <input data-field=\"snd-password\" type=\"password\" autocomplete=\"new-password\" /></label>" +
        "<label>Label (optional) <input data-field=\"snd-label\" placeholder=\"Business email\" /></label>" +
        "<details><summary>Where do I find these settings?</summary>" +
        "<p>Your email provider publishes them. Search their help site for “SMTP settings”. Common ones:</p>" +
        "<ul><li><strong>Zoho Mail:</strong> help.zoho.com → “SMTP settings” (usually smtp.zoho.com, port 587).</li>" +
        "<li><strong>cPanel hosting:</strong> your hosting control panel → Email Accounts → Connect Devices (uses your domain's mail server).</li>" +
        "<li><strong>Microsoft 365:</strong> usually outlook.office365.com, port 587. Your IT admin can confirm.</li></ul>" +
        "<p>No luck? Ask the person who set up your email or website. Copy this message to them:</p>" +
        "<div class=\"row\"><button type=\"button\" class=\"secondary\" data-act=\"sender-copydev\">Copy message for my developer</button></div>" +
        "</details>" +
        "<div class=\"row\"><button type=\"button\" data-act=\"sender-submit\">Test &amp; connect</button></div>" +
        "<p class=\"hint\">We store it encrypted and only use it to send campaigns you approve. Testing sends nothing.</p>";
    } else {
      box.innerHTML =
        "<label>Sender email <input data-field=\"snd-email\" type=\"email\" autocomplete=\"email\" placeholder=\"you@yourbusiness.com\" /></label>" +
        "<label>Resend key <input data-field=\"snd-key\" type=\"password\" autocomplete=\"new-password\" placeholder=\"re_…\" /></label>" +
        "<label>Label (optional) <input data-field=\"snd-label\" placeholder=\"Resend\" /></label>" +
        "<div class=\"row\"><button type=\"button\" data-act=\"sender-submit\">Test &amp; connect</button></div>" +
        "<p class=\"hint\">Find it in your Resend dashboard under Keys. We store it encrypted and only use it to send campaigns you approve.</p>";
    }
  }

  function senderErrorText(e, choice) {
    var detail = (e && e.detail) || "";
    if (/password|login|535|Username|auth/i.test(detail)) {
      return choice === "gmail"
        ? "Google rejected that code. It must be a 16-letter app password, not your normal Google password. Follow the steps above to make one."
        : "The mail server rejected that username or password. Check both. Some providers need an app password, not the login password.";
    }
    if (/ECONN|ENOTFOUND|ETIMEDOUT|timed out|reach|EAI_AGAIN/i.test(detail)) {
      return "We could not reach that mail server. Check the host and port, then try again.";
    }
    if (/blocked.*25|port 25/i.test(detail)) {
      return "Port 25 is blocked. Use port 587 (or 465) instead.";
    }
    if (detail) return "Could not connect: " + detail;
    return "Could not connect. Check the details and try again.";
  }

  function setSenderBusy(busy, label) {
    var wrap = $("senders-wrap");
    if (!wrap) return;
    var btns = wrap.querySelectorAll("button");
    btns.forEach(function (b) { b.disabled = busy; });
    var submit = wrap.querySelector('[data-act="sender-submit"]');
    if (submit && busy) submit.textContent = label || "Testing… (can take 20 seconds)";
  }

  function submitSender() {
    var wrap = $("senders-wrap");
    var get = function (sel) { var el = wrap.querySelector(sel); return el ? el.value.trim() : ""; };
    var err = $("sender-error");
    var fail = function (msg) { err.textContent = msg; err.hidden = false; };
    err.hidden = true;
    var email = get('[data-field="snd-email"]');
    if (!email || email.indexOf("@") < 0) { fail("Enter the email address this sender sends from."); return; }
    var payload = null;
    if (senderChoice === "gmail") {
      var pw = get('[data-field="snd-password"]').replace(/\s+/g, "");
      if (pw.length !== 16) { fail("That does not look like a 16-letter app password. Open the steps above and copy the code Google showed you."); return; }
      payload = { provider: "smtp", label: get('[data-field="snd-label"]') || "Gmail", sender_email: email,
        secret: { host: "smtp.gmail.com", port: 587, username: email, password: pw } };
    } else if (senderChoice === "smtp") {
      var host = get('[data-field="snd-host"]');
      var port = parseInt(get('[data-field="snd-port"]') || "587", 10);
      var user = get('[data-field="snd-user"]');
      var pass = get('[data-field="snd-password"]');
      if (!host) { fail("Enter the mail server host. See “Where do I find these settings?” above."); return; }
      if (!user || !pass) { fail("Enter the username and password for that mail server."); return; }
      payload = { provider: "smtp", label: get('[data-field="snd-label"]') || email, sender_email: email,
        secret: { host: host, port: port, username: user, password: pass } };
    } else {
      var key = get('[data-field="snd-key"]');
      if (!key) { fail("Paste your Resend key (it starts with “re_”)."); return; }
      payload = { provider: "resend", label: get('[data-field="snd-label"]') || "Resend", sender_email: email,
        secret: { api_key: key } };
    }
    setSenderBusy(true);
    // Replace a stale pending/error row for the same sender instead of piling up dupes.
    api.listConnections().then(function (res) {
      var stale = (res.connections || []).filter(function (c) {
        return c.provider === payload.provider && c.sender_email === payload.sender_email && c.status !== "connected";
      })[0];
      return stale ? api.disconnectConnection(stale.id) : null;
    }).then(function () {
      return api.createConnection(payload);
    }).then(function (conn) {
      return api.verifyConnection(conn.id);
    }).then(function () {
      senderNotice = "Connected. The test passed and this sender is ready for campaigns.";
      renderSendersView(sendersReturn);
    }, function (e) {
      setSenderBusy(false);
      fail(senderErrorText(e, senderChoice));
    });
  }

  var DEV_MSG = "Hello! To connect our email sender in Prospect Research, please send me our SMTP settings: (1) SMTP host, (2) port, (3) username, and (4) password or app password. Thank you!";

  function copyDevMessage(btn) {
    var done = function () { btn.textContent = "Copied. Paste it anywhere."; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(DEV_MSG).then(done, function () { btn.textContent = "Copy failed. Long-press the text below."; });
    } else {
      var ta = document.createElement("textarea");
      ta.value = DEV_MSG;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { btn.textContent = "Copy failed in this browser."; }
      document.body.removeChild(ta);
    }
  }

  function onSendersClick(e) {
    var t = e.target || {};
    var ds = t.dataset || {};
    if (ds.act === "sender-choice") { senderChoice = ds.id; renderSendersList($("senders-wrap"), senderCache); return; }
    if (ds.act === "sender-back") {
      if (sendersReturn === "campaigns") renderCampaignView();
      else showView(sendersReturn);
      return;
    }
    if (ds.act === "sender-submit") { submitSender(); return; }
    if (ds.act === "sender-copydev") { copyDevMessage(t); return; }
    if (ds.act === "sender-test" && ds.id) {
      setSenderBusy(true, "Testing… (can take 20 seconds)");
      api.verifyConnection(ds.id).then(function () {
        senderNotice = "Test passed. This sender is connected.";
        renderSendersView(sendersReturn);
      }, function (err) {
        setSenderBusy(false);
        var el = $("sender-error");
        el.textContent = senderErrorText(err, "smtp");
        el.hidden = false;
      });
      return;
    }
    if (ds.act === "sender-disconnect" && ds.id) {
      if (!window.confirm("Disconnect this sender? Campaigns using it will not be able to send.")) return;
      api.disconnectConnection(ds.id).then(function () {
        senderNotice = "Sender disconnected.";
        renderSendersView(sendersReturn);
      });
      return;
    }
  }

  var senderCache = [];

  function renderCampaignView() {
    showView("campaigns");
    var wiz = $("campaign-wizard");
    wiz.innerHTML = "<p class=\"hint\">Loading…</p>";
    wiz.onclick = onWizardClick;
    api.listConnections().then(function (creds) {
      var conns = (creds.connections || []).filter(function (c) { return c.status === "connected"; });
      if (!conns.length) {
        wiz.innerHTML = "<p>No verified sender yet. Connect one first, then come back.</p>" +
          "<div class=\"row\"><button type=\"button\" data-act=\"go-senders\">Connect a sender</button></div>";
        return;
      }
      return api.getDrafts(state.runId).then(function (res) {
        var approved = (res.drafts || []).filter(function (d) { return d.decision === "approved"; });
        if (!approved.length) {
          wiz.innerHTML = "<p>No approved drafts yet. Approve drafts first, then build a campaign.</p>";
          return;
        }
        return Promise.all(approved.map(function (d) { return api.getProspectDetail(d.prospectId); })).then(function (details) {
          state.campaignRows = details.map(function (det, i) {
            var routes = det.routes || det.contact_routes || [];
            var email = routes.filter(function (r) { return r.channel === "email"; })[0];
            var draft = (det.draft && (det.draft.subject || det.draft.body)) ? det.draft : (approved[i].draft || {});
            return {
              prospectId: det.prospect ? det.prospect.id : approved[i].prospectId,
              name: det.prospect ? det.prospect.name : approved[i].prospectId,
              email: email ? email.value : "",
              subject: draft.subject || "",
              body: draft.body || ""
            };
          });
          var opts = conns.map(function (c) {
            return "<option value=\"" + esc(c.id) + "\">" + esc(c.label) + " (" + esc(c.sender_email) + ")</option>";
          }).join("");
          wiz.innerHTML = "<label>Campaign name <input data-field=\"cmp-name\" value=\"Outreach. Week 1\" /></label>" +
            "<label>Sender <select data-field=\"cmp-sender\">" + opts + "</select></label>" +
            "<label>Send at <input data-field=\"cmp-when\" type=\"datetime-local\" /></label>" +
            "<h3>Recipients (" + state.campaignRows.length + ")</h3>" +
            state.campaignRows.map(function (r, i) {
              return "<div class=\"campaign\"><h4>" + esc(r.name) + "</h4>" +
                "<label>To <input data-field=\"rcpt-email\" data-idx=\"" + i + "\" value=\"" + esc(r.email) + "\" /></label>" +
                "<label>Subject <input data-field=\"rcpt-subject\" data-idx=\"" + i + "\" value=\"" + esc(r.subject) + "\" /></label>" +
                "<label>Message <textarea data-field=\"rcpt-body\" data-idx=\"" + i + "\" rows=\"4\">" + esc(r.body) + "</textarea></label></div>";
            }).join("") +
            "<div class=\"row\"><button type=\"button\" data-act=\"create-campaign\">Review &amp; schedule</button></div>";
        });
      });
    });
  }

  function submitCampaign() {
    var wiz = $("campaign-wizard");
    var get = function (sel) { var el = wiz.querySelector(sel); return el ? el.value : ""; };
    var name = get('[data-field="cmp-name"]') || "Outreach";
    var connectionId = get('[data-field="cmp-sender"]');
    var when = get('[data-field="cmp-when"]');
    var scheduled = when ? new Date(when).toISOString() : new Date(Date.now() + 60000).toISOString();
    var emails = wiz.querySelectorAll('[data-field="rcpt-email"]');
    var subjects = wiz.querySelectorAll('[data-field="rcpt-subject"]');
    var bodies = wiz.querySelectorAll('[data-field="rcpt-body"]');
    var recipients = state.campaignRows.map(function (r, i) {
      return {
        email: ((emails[i] && emails[i].value) || "").trim(),
        subject: (subjects[i] && subjects[i].value) || "",
        body: (bodies[i] && bodies[i].value) || "",
        prospect_id: r.prospectId
      };
    }).filter(function (r) { return r.email; });
    if (!recipients.length) { wiz.innerHTML = "<p>Enter at least one recipient email.</p>"; return; }
    api.createCampaign({ name: name, connection_id: connectionId, recipients: recipients })
      .then(function (cmp) { return api.approveCampaign(cmp.id, { scheduled_at_utc: scheduled }); })
      .then(function (ok) {
        wiz.innerHTML = "<p>Scheduled. " + recipients.length + " message(s), first send " +
          esc(ok.scheduled_at_utc || scheduled) + ". Watch it land on the status board.</p>";
      }, function (e) {
        wiz.innerHTML = "<p>Could not schedule: " + esc((e && e.message) || e) + "</p>";
      });
  }

  function onWizardClick(e) {
    var t = e.target || {};
    var ds = t.dataset || {};
    if (ds.act === "create-campaign") submitCampaign();
    if (ds.act === "go-senders") renderSendersView("campaigns");
  }

  function restart() {
    state.profile = null; state.prospects = []; state.selectedId = null;
    state.drafts = []; state.decisions = {}; state.runId = null;
    ob = null;
    var first = $("ob-first");
    if (first) first.hidden = false;
    var chat = $("ob-chat");
    if (chat) chat.hidden = true;
    var step = $("ob-step");
    if (step) step.textContent = "Step 2 of 3 · about 40 seconds left";
    showView("onboard");
  }

  /* Demo mode (the /demo path only) marks example data inside the
   * content area. The main journey never shows a mode label. */
  function isDemo() {
    return api && api.mode !== "live";
  }

  function setDemoKicker(id) {
    var el = $(id);
    if (!el) return;
    if (isDemo()) {
      el.textContent = "EXAMPLE DATA";
      el.hidden = false;
    } else {
      el.textContent = "";
      el.hidden = true;
    }
  }

  function init() {
    api = (typeof window.ApiLayer !== "undefined") ? window.ApiLayer.selectApi() : null;
    if (!api) throw new Error("ApiLayer failed to load");
    showView("landing");
    Array.prototype.forEach.call(document.querySelectorAll("[data-start]"), function (btn) {
      btn.addEventListener("click", function () { showView("onboard"); updateObSegs(1); });
    });

    var chips = [];
    try { chips = document.querySelectorAll("[data-preset]") || []; } catch (e) { chips = []; }
    Array.prototype.forEach.call(chips, function (btn) {
      btn.addEventListener("click", function () {
        $("f-businessName").value = btn.getAttribute("data-name") || "";
        $("f-description").value = btn.getAttribute("data-description") || "";
      });
    });
    var stepNav = $("step-nav");
    if (stepNav) {
      stepNav.addEventListener("click", function (e) {
        var li = e.target && e.target.closest ? e.target.closest("li[data-view]") : null;
        if (li && li.getAttribute("data-view") === "senders") renderSendersView("status");
      });
    }
    $("onboard-form").addEventListener("submit", submitOnboard);
    $("ob-answer").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); obContinue(); }
    });
    $("ob-chips").addEventListener("click", obChipClick);
    $("ob-fields").addEventListener("click", onObFieldsClick);
    $("btn-ob-continue").addEventListener("click", obContinue);
    $("btn-ob-skip").addEventListener("click", obSkip);
    $("btn-ob-finish").addEventListener("click", obFinish);
    $("btn-ob-exit").addEventListener("click", function () { showView("landing"); });
    $("btn-ob-edit-first").addEventListener("click", obEditFirst);
    $("evidence-body").addEventListener("click", onEvidenceClick);
    $("status-board").addEventListener("click", onBoardClick);
    $("btn-back-onboard").addEventListener("click", function () { showView("onboard"); });
    $("btn-preview-progress").addEventListener("click", previewProgress);
    $("btn-stop-progress").addEventListener("click", function () { showView("profile"); });
    $("btn-confirm-profile").addEventListener("click", confirmBriefAndRun);
    $("shortlist-tabs").addEventListener("click", function (e) {
      var t = e.target || {};
      var tab = t.getAttribute ? t.getAttribute("data-tab") : null;
      if (!tab) {
        var btn = t.closest ? t.closest("[data-tab]") : null;
        tab = btn && btn.getAttribute ? btn.getAttribute("data-tab") : null;
      }
      if (tab) switchTab(tab);
    });
    $("btn-to-drafts").addEventListener("click", renderDrafts);
    $("btn-to-status").addEventListener("click", renderStatuses);
    $("btn-back-shortlist").addEventListener("click", function () { showView("shortlist"); });
    $("btn-back-drafts").addEventListener("click", function () { showView("drafts"); });
    $("btn-restart").addEventListener("click", restart);
    $("btn-restart-progress").addEventListener("click", restart);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { VIEWS: VIEWS, showView: showView, submitOnboard: submitOnboard, confirmBriefAndRun: confirmBriefAndRun, pollProgress: pollProgress, renderShortlist: renderShortlist, selectProspect: selectProspect, renderDrafts: renderDrafts, decideDraft: decideDraft, renderStatuses: renderStatuses, restart: restart };
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})();
