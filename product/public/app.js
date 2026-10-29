/* app.js — view rendering + flow state machine (no backend).
 * Flow: onboard -> confirm -> progress -> shortlist -> drafts -> status.
 * State machine fns: showView, submitOnboard, confirmBriefAndRun,
 *   pollProgress, renderShortlist, selectProspect, renderDrafts,
 *   decideDraft, renderStatuses, restart.
 */
(function () {
  "use strict";

  var VIEWS = ["onboard", "profile", "progress", "shortlist", "drafts", "status", "senders"];
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

  function showView(name) {
    VIEWS.forEach(function (v) {
      var el = $("view-" + v);
      if (el) el.hidden = (v !== name);
    });
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

  function submitOnboard(event) {
    event.preventDefault();
    var err = $("onboard-error");
    var businessName = $("f-businessName").value.trim();
    var site = $("f-site").value.trim();
    var description = $("f-description").value.trim();
    if (!businessName || !description) {
      err.textContent = "Please add your business name and a one-line description.";
      err.hidden = false;
      return false;
    }
    err.hidden = true;
    var input = {
      businessName: businessName, site: site, description: description,
      q1: $("f-q1").value.trim(), q2: $("f-q2").value.trim(),
      q3: $("f-q3").value.trim(), q4: $("f-q4").value.trim(),
      q5: $("f-q5").value.trim()
    };
    return api.createProfile(input).then(function (res) {
      state.profile = res.profile;
      renderProfileConfirm(res.profile);
      showView("profile");
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

  function pollProgress() {
    var stepsEl = $("progress-steps");
    var label = $("progress-label");
    var fill = $("progress-fill");
    var budget = $("progress-budget");
    return api.runProgress(state.runId, function (tick) {
      fill.style.width = Math.round((tick.done / tick.total) * 100) + "%";
      label.textContent = "Step " + tick.done + " of " + tick.total + ": " + tick.steps[tick.done - 1] + "…";
      if (api.mode === "live") {
        budget.textContent = "Live research against public sources (caps 30 searches / 40 fetches).";
      } else {
        budget.textContent = "Budget so far: " + tick.searches + " searches, " + tick.fetches + " page fetches (caps 30 / 40). Sample data.";
      }
      stepsEl.innerHTML = tick.steps.map(function (s, idx) {
        var cls = idx < tick.done ? "done" : (idx === tick.done ? "active" : "");
        return "<li class=\"" + cls + "\">" + esc(s) + "</li>";
      }).join("");
    }).then(function () {
      return api.getShortlist(state.runId).then(function (res) {
        state.prospects = res.prospects;
        renderShortlist();
        showView("shortlist");
      });
    }, function (err) {
      label.textContent = "Research stopped: " + (err && err.message ? err.message : "unknown error") + " You can start over below.";
      budget.textContent = "";
      var again = $("btn-restart-progress");
      if (again) again.hidden = false;
    });
  }

  function renderShortlist() {
    var list = $("prospect-list");
    list.innerHTML = "";
    state.prospects.forEach(function (p) {
      var li = document.createElement("li");
      li.setAttribute("tabindex", "0");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", state.selectedId === p.id ? "true" : "false");
      li.dataset.id = p.id;
      li.innerHTML = "<strong>" + esc(p.name) + "</strong> <span class=\"score\">" + esc(p.score) + "/100</span><br/>" +
        "<span>" + esc(p.area) + " · " + esc(p.category) + "</span><br/>" +
        "<span>" + esc(p.summary) + "</span>";
      li.addEventListener("click", function () { selectProspect(p.id); });
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") selectProspect(p.id); });
      list.appendChild(li);
    });
    if (!state.selectedId && state.prospects.length) selectProspect(state.prospects[0].id);
  }

  function selectProspect(id) {
    state.selectedId = id;
    var items = $("prospect-list").querySelectorAll("li");
    items.forEach(function (li) { li.setAttribute("aria-selected", li.dataset.id === id ? "true" : "false"); });
    return api.getEvidence(id).then(function (res) {
      var body = $("evidence-body");
      $("evidence-hint").textContent = api.mode === "live"
        ? "Why " + res.prospect.name + " made your shortlist:"
        : "Why " + res.prospect.name + " made the demo shortlist:";
      body.innerHTML = res.evidence.map(function (ev) {
        return "<blockquote>" + esc(ev.quote) + "<cite>Source: " + esc(ev.source) + " (" + esc(ev.type) + (api.mode === "live" ? "" : ", demo data") + ")</cite></blockquote>";
      }).join("");
      return renderTimeline(id, body);
    });
  }

  function timelineItem(t) {
    var when = "";
    try { when = new Date(t.at).toLocaleString(); } catch (e) { when = String(t.at || ""); }
    if (t.kind === "contact") {
      return "<li class=\"contact\">" + esc(t.direction === "inbound" ? "Heard back" : "Contacted") +
        " via " + esc(t.channel) + " · " + esc(when) + (t.note ? " — " + esc(t.note) : "") + "</li>";
    }
    return "<li>" + esc(t.event || "update") + " · " + esc(when) + (t.note ? " — " + esc(t.note) : "") + "</li>";
  }

  function renderTimeline(id, body) {
    return api.getTimeline(id).then(function (res) {
      var items = (res.timeline || []).map(timelineItem).join("");
      body.innerHTML += "<h4>History</h4><ul class=\"timeline\">" +
        (items || "<li>No contact yet — log your first touch below.</li>") + "</ul>" +
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

  function renderDrafts() {
    return api.getDrafts(state.runId).then(function (res) {
      state.drafts = res.drafts.map(function (d) {
        if (state.decisions[d.prospectId]) d.status = state.decisions[d.prospectId].decision;
        return d;
      });
      var wrap = $("draft-list");
      wrap.innerHTML = "";
      state.drafts.forEach(function (d) {
        var p = state.prospects.filter(function (x) { return x.id === d.prospectId; })[0];
        var div = document.createElement("div");
        div.className = "draft";
        div.dataset.id = d.prospectId;
        div.innerHTML = "<h3>To: " + esc(p ? p.name : d.prospectId) + " <span class=\"decision " + esc(d.status) + "\">[" + esc(d.status) + "]</span></h3>" +
          "<label>Subject <input data-field=\"subject\" value=\"" + esc(d.subject) + "\" /></label>" +
          "<label>Message <textarea data-field=\"body\">" + esc(d.body) + "</textarea></label>" +
          "<div class=\"row\">" +
          "<button data-act=\"approve\" type=\"button\">Approve</button>" +
          "<button data-act=\"save-edit\" type=\"button\" class=\"secondary\">Save edit</button>" +
          "<button data-act=\"reject\" type=\"button\" class=\"danger\">Reject</button>" +
          "</div>";
        div.addEventListener("click", function (e) {
          var act = e.target && e.target.dataset ? e.target.dataset.act : null;
          if (act) decideDraft(d.prospectId, act, div);
        });
        wrap.appendChild(div);
      });
      showView("drafts");
    });
  }

  function decideDraft(prospectId, act, divEl) {
    var subject = divEl.querySelector('[data-field="subject"]').value;
    var body = divEl.querySelector('[data-field="body"]').value;
    var decision = act === "approve" ? "approved" : (act === "reject" ? "rejected" : "pending");
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
    { key: "approved", title: "Approved — follow up yourself" },
    { key: "pending", title: "Pending review" },
    { key: "deferred", title: "Deferred — revisit later" },
    { key: "rejected", title: "Rejected" },
    { key: "followups", title: "Follow-ups (manual — handled by you)" }
  ];

  function decisionOf(d) {
    return state.decisions[d.prospectId] ? state.decisions[d.prospectId].decision : d.status;
  }

  function emptyCopy(key) {
    var notes = {
      approved: "No approved drafts yet — approve one above to see it here.",
      pending: "All drafts reviewed — nice. Decided drafts are listed in their columns.",
      deferred: "No deferred drafts — drafts you pause will wait here.",
      rejected: "No rejected drafts — every draft is still live or approved.",
      followups: "No follow-ups yet — approve a draft first. Follow-ups are manual; nothing goes out from this demo."
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
        var suffix = c.key === "followups" ? " — follow up manually (e.g. nudge in 3 days)" : "";
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
        div.innerHTML = "<h3>Email campaigns</h3><p class=\"hint\">No campaigns yet — approve drafts, then schedule a campaign.</p>";
      } else {
        div.innerHTML = "<h3>Email campaigns</h3>" + list.map(function (c) {
          var recs = (c.recipients || []).map(function (r) {
            return "<li>" + esc(r.email) + " — " + esc(r.status) + "</li>";
          }).join("");
          var stats = c.stats && Object.keys(c.stats).length
            ? " <span class=\"meta\">(" + Object.keys(c.stats).map(function (k) { return esc(k) + ": " + esc(c.stats[k]); }).join(", ") + ")</span>" : "";
          var when = c.scheduled_at_utc ? " · sends " + esc(c.scheduled_at_utc) : "";
          var cancel = (c.status === "scheduled" || c.status === "sending")
            ? " <button type=\"button\" class=\"secondary\" data-act=\"cancel-campaign\" data-id=\"" + esc(c.id) + "\">Cancel</button>" : "";
          return "<div class=\"campaign\"><h4>" + esc(c.name) + " — " + esc(c.status) + "</h4>" +
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
    return { smtp: "SMTP", resend: "Resend", gmail: "Gmail", mock: "Demo" }[p] || String(p);
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
      (cards || "<p class=\"hint\">No senders yet — connect one below.</p>") +
      "<h3>Connect a sender</h3>" +
      "<p class=\"hint\">Where do you send email from?</p>" +
      "<div class=\"choice-row\" role=\"group\" aria-label=\"Email provider\">" +
      choiceBtn("gmail", "Gmail", "A @gmail.com address") +
      choiceBtn("smtp", "Business email", "Zoho, cPanel, Microsoft 365…") +
      choiceBtn("resend", "Resend", "API key (developers)") +
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
        "<strong>Use a Google app password — never your normal password.</strong>" +
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
        "<li><strong>Microsoft 365:</strong> usually outlook.office365.com, port 587 — your IT admin can confirm.</li></ul>" +
        "<p>No luck? Ask the person who set up your email or website. Copy this message to them:</p>" +
        "<div class=\"row\"><button type=\"button\" class=\"secondary\" data-act=\"sender-copydev\">Copy message for my developer</button></div>" +
        "</details>" +
        "<div class=\"row\"><button type=\"button\" data-act=\"sender-submit\">Test &amp; connect</button></div>" +
        "<p class=\"hint\">We store it encrypted and only use it to send campaigns you approve. Testing sends nothing.</p>";
    } else {
      box.innerHTML =
        "<label>Sender email <input data-field=\"snd-email\" type=\"email\" autocomplete=\"email\" placeholder=\"you@yourbusiness.com\" /></label>" +
        "<label>Resend API key <input data-field=\"snd-key\" type=\"password\" autocomplete=\"new-password\" placeholder=\"re_…\" /></label>" +
        "<label>Label (optional) <input data-field=\"snd-label\" placeholder=\"Resend\" /></label>" +
        "<div class=\"row\"><button type=\"button\" data-act=\"sender-submit\">Test &amp; connect</button></div>" +
        "<p class=\"hint\">Find it at resend.com → API Keys. We store it encrypted and only use it to send campaigns you approve.</p>";
    }
  }

  function senderErrorText(e, choice) {
    var detail = (e && e.detail) || "";
    if (/password|login|535|Username|auth/i.test(detail)) {
      return choice === "gmail"
        ? "Google rejected that code. It must be a 16-letter app password, not your normal Google password — follow the steps above to make one."
        : "The mail server rejected that username or password. Check both — some providers need an app password, not the login password.";
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
      if (!host) { fail("Enter the mail server host — see “Where do I find these settings?” above."); return; }
      if (!user || !pass) { fail("Enter the username and password for that mail server."); return; }
      payload = { provider: "smtp", label: get('[data-field="snd-label"]') || email, sender_email: email,
        secret: { host: host, port: port, username: user, password: pass } };
    } else {
      var key = get('[data-field="snd-key"]');
      if (!key) { fail("Paste your Resend API key (it starts with “re_”)."); return; }
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
      senderNotice = "Connected — the test passed and this sender is ready for campaigns.";
      renderSendersView(sendersReturn);
    }, function (e) {
      setSenderBusy(false);
      fail(senderErrorText(e, senderChoice));
    });
  }

  var DEV_MSG = "Hello! To connect our email sender in Prospect Research, please send me our SMTP settings: (1) SMTP host, (2) port, (3) username, and (4) password or app password. Thank you!";

  function copyDevMessage(btn) {
    var done = function () { btn.textContent = "Copied — paste it anywhere."; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(DEV_MSG).then(done, function () { btn.textContent = "Copy failed — long-press the text below."; });
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
        senderNotice = "Test passed — this sender is connected.";
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
          wiz.innerHTML = "<label>Campaign name <input data-field=\"cmp-name\" value=\"Outreach — week 1\" /></label>" +
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
        wiz.innerHTML = "<p>Scheduled — " + recipients.length + " message(s), first send " +
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
    showView("onboard");
  }

  function setModeBanner() {
    var live = false;
    try { live = new URLSearchParams(window.location.search).get("live") === "1"; } catch (e) { live = false; }
    var banner = $("demo-banner");
    var modeLine = $("mode-line");
    if (live) {
      banner.textContent = "LIVE MODE — connected to the Worker API.";
      banner.classList.add("live");
      modeLine.textContent = "Live mode: requests go to the Worker API.";
    } else {
      banner.innerHTML = "DEMO DATA — mock results for illustration, not live research. Add <code>?live=1</code> to use the real API.";
      modeLine.textContent = "Demo mode: showing sample Ikeja prospects.";
    }
  }

  function init() {
    api = (typeof window.ApiLayer !== "undefined") ? window.ApiLayer.selectApi() : null;
    if (!api) throw new Error("ApiLayer failed to load");
    setModeBanner();
    showView("onboard");
    var chips = [];
    try { chips = document.querySelectorAll("[data-preset]") || []; } catch (e) { chips = []; }
    Array.prototype.forEach.call(chips, function (btn) {
      btn.addEventListener("click", function () {
        $("f-description").value = btn.getAttribute("data-description") || "";
        $("f-q1").value = btn.getAttribute("data-q1") || "";
        $("f-q3").value = btn.getAttribute("data-q3") || "";
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
    $("evidence-body").addEventListener("click", onEvidenceClick);
    $("status-board").addEventListener("click", onBoardClick);
    $("btn-back-onboard").addEventListener("click", function () { showView("onboard"); });
    $("btn-confirm-profile").addEventListener("click", confirmBriefAndRun);
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
