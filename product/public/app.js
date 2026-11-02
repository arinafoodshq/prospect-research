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
  var me = null; // signed-in user {email, name}; live mode only — the demo has no accounts

  /** Reflect the auth state in the header and the landing nav. */
  function renderAuthUi() {
    var live = api && api.mode === "live";
    var hdrSignin = $("hdr-signin");
    var hdrUser = $("hdr-user");
    var hdrOut = $("btn-signout");
    var landing = $("link-signin");
    var landingDash = $("link-dash");
    if (!live) {
      if (hdrSignin) hdrSignin.hidden = true;
      if (hdrUser) hdrUser.hidden = true;
      if (hdrOut) hdrOut.hidden = true;
      if (landingDash) landingDash.hidden = true;
      if (landing) { landing.hidden = false; landing.setAttribute("href", "#signin"); }
      return;
    }
    var signed = !!me;
    if (hdrSignin) hdrSignin.hidden = signed;
    if (hdrUser) { hdrUser.hidden = !signed; if (signed) hdrUser.textContent = me.name || me.email; }
    if (hdrOut) hdrOut.hidden = !signed;
    if (landingDash) landingDash.hidden = !signed;
    if (landing) landing.hidden = signed;
  }

  function goSignin(expiryMessage) {
    showView("signin");
    var note = $("signin-view-note");
    if (note) note.textContent = expiryMessage || "";
  }

  // --- Run recovery: a run survives reloads and dead networks on the server.
  // On boot (signed in, live, no run in flight) the landing offers to bring
  // the owner back to it — continue, never restart.
  var pendingRestore = null;

  function resumeStatusText(run) {
    var name = run.profile_name || "Your business";
    var state2 = {
      created: "ready to start its research.",
      awaiting_brief: "waiting for your brief confirmation.",
      discovering: "searching for buyers right now.",
      investigating: "opening businesses' own pages right now.",
      assessing: "checking fit against your must-haves right now.",
      drafting: "writing messages for your approval right now.",
      awaiting_approval: "drafts are waiting for your approval.",
      complete: "research finished. Messages are ready for review.",
      failed: "stopped early. You can retry it any time."
    }[run.status];
    return name + " — " + (state2 || "is at “" + run.status + "”.");
  }

  function checkResumableRun() {
    if (api.mode !== "live" || !me || state.runId || !api.getLatestRun) return null;
    return api.getLatestRun().then(function (res) {
      var run = res && res.run;
      if (!run) return;
      var resumable = ["created", "awaiting_brief", "discovering", "investigating", "assessing", "drafting", "awaiting_approval"];
      if (resumable.indexOf(run.status) < 0) return;
      pendingRestore = run;
      var card = $("resume-card");
      if (!card) return;
      $("resume-status").textContent = resumeStatusText(run);
      // The button names the destination: drafts already written open the
      // messages, not another lap through the shortlist.
      var btn = $("btn-resume-continue");
      if (btn) btn.textContent = run.status === "awaiting_approval" ? "Open my messages \u2192" : "Continue \u2192";
      card.hidden = false;
    }).catch(function () { /* recovery check is best-effort */ });
  }

  function wireResumeCard() {
    var card = $("resume-card");
    if (!card) return;
    $("btn-resume-continue").addEventListener("click", function () {
      var run = pendingRestore;
      if (!run) return;
      state.runId = run.id;
      state.profile = { id: run.profile_id, name: run.profile_name || "" };
      card.hidden = true;
      pendingRestore = null;
      // One path for every state: the progress poll resolves to the
      // shortlist when the run reaches approval/complete (all data from D1
      // — continue, never restart).
      showView("progress");
      pollProgress();
    });
    $("btn-resume-dismiss").addEventListener("click", function () {
      card.hidden = true;
      pendingRestore = null;
    });
  }

  // The Dashboard is the status board hydrated from the latest run: the one
  // screen that answers "where do my messages stand". Reachable from every
  // view — header button, mid-flow bar, landing nav (user request 2026-11-02).
  function adoptPendingRun() {
    if (!state.runId && pendingRestore) {
      state.runId = pendingRestore.id;
      state.profile = { id: pendingRestore.profile_id, name: pendingRestore.profile_name || "" };
      pendingRestore = null;
      var card = $("resume-card");
      if (card) card.hidden = true;
    }
  }

  function openDashboard() {
    adoptPendingRun();
    var jobs = [];
    if (state.runId) {
      if (!state.prospects.length) {
        jobs.push(api.getShortlist(state.runId).then(function (r) {
          state.prospects = r.prospects;
        }, function () { /* the board still renders, empty */ }));
      }
      if (!state.drafts.length) {
        jobs.push(api.getDrafts(state.runId).then(function (r) {
          state.drafts = r.drafts;
        }, function () { /* the board still renders, empty */ }));
      }
    }
    Promise.all(jobs).then(function () { renderStatuses(); });
  }

  // Post-sign-in return lands on the owner's home (the dashboard), not the
  // marketing page: /api/auth/callback redirects back with ?dash=1.
  function maybeOpenDashboard(ready) {
    var q = null;
    try { q = new URLSearchParams(window.location.search); } catch (e) { return; }
    if (!q || q.get("dash") !== "1" || api.mode !== "live" || !me) return;
    try { window.history.replaceState(null, "", window.location.pathname); } catch (e) { /* the param may survive on old browsers */ }
    (ready || Promise.resolve()).then(function () {
      if (!state.runId && !pendingRestore) return; // fresh account: nothing to show yet, stay on the landing
      openDashboard();
    });
  }

  function $(id) { return document.getElementById(id); }

  // The five stages of ONE campaign, in order. They are not the app's
  // navigation (that is the sidebar) — they are a trail the owner can walk
  // back through to see what was done.
  var STAGES = ["onboard", "profile", "progress", "shortlist", "drafts"];
  // Views without the app sidebar: the marketing landing (its own nav) and
  // the pre-auth sign-in screen.
  var NO_SIDEBAR = ["landing", "signin"];
  var EXTRA_VIEWS = ["signin"];

  function showView(name) {
    VIEWS.forEach(function (v) {
      var el = $("view-" + v);
      if (el) el.hidden = (v !== name);
    });
    EXTRA_VIEWS.forEach(function (v) {
      var el = $("view-" + v);
      if (el) el.hidden = (v !== name);
    });
    var plain = NO_SIDEBAR.indexOf(name) >= 0;
    var shell = $("shell");
    if (shell) shell.classList.toggle("no-side", plain);
    var side = $("sidebar");
    if (side) side.hidden = plain;
    var footer = $("site-footer");
    if (footer) footer.hidden = plain;
    // The stage strip only makes sense while a campaign is in play.
    var strip = $("stage-wrap");
    if (strip) strip.hidden = STAGES.indexOf(name) < 0;
    ["progress-kicker", "shortlist-kicker", "drafts-kicker", "status-kicker",
     "campaigns-kicker", "senders-kicker"].forEach(setDemoKicker);
    var nav = $("step-nav");
    if (nav) {
      var items = nav.querySelectorAll("li");
      items.forEach(function (li) {
        var v = li.getAttribute("data-view");
        var vi = STAGES.indexOf(v), ni = STAGES.indexOf(name);
        li.classList.toggle("active", v === name);
        li.classList.toggle("done", vi >= 0 && ni > vi);
      });
    }
    // Sidebar active state: which app section is on screen.
    var sbMap = { status: "btn-sb-dashboard", drafts: "btn-sb-messages",
      campaigns: "btn-sb-campaigns", senders: "btn-sb-senders" };
    ["btn-sb-dashboard", "btn-sb-messages", "btn-sb-campaigns", "btn-sb-senders"].forEach(function (id) {
      var el = $(id);
      if (el) el.classList.toggle("active", sbMap[name] === id);
    });
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
    service_area: ["One quick answer keeps the search where you deliver.", "For example: Ikeja, Lagos, Nigeria — or 'Worldwide' if you serve online"],
    order_size: ["One quick answer helps us size each chance.", "For example: 20 to 200 packs per order"],
    decision_maker: ["One quick answer helps us write to the right person.", "For example: the office admin, sometimes HR"],
    timeline: ["One quick answer helps us time each approach.", "For example: they order weekly, a day ahead"],
    budget: ["One quick answer keeps every quote realistic.", "For example: 1500 to 2500 naira per pack"],
    exclusions: ["One quick answer keeps wrong fits off your list.", "For example: no events under 50 guests"],
    __name: ["So your shortlist has a name on it.", "For example: Adaeze Catering Services"]
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

  function obFirstPhase() {
    $("ob-head").hidden = true;
    $("btn-ob-back").hidden = false;
    $("ob-step").hidden = true;
    $("ob-first").hidden = false;
    $("ob-chat").hidden = true;
    $("view-onboard").classList.add("ob-first-phase");
    updateObSegs(1);
  }

  function obChatPhase() {
    $("ob-head").hidden = false;
    $("btn-ob-back").hidden = true;
    $("ob-step").hidden = false;
    $("ob-first").hidden = true;
    $("ob-chat").hidden = false;
    $("view-onboard").classList.remove("ob-first-phase");
  }

  var OB_EXAMPLE = "We deliver packed lunches to offices in Ikeja and Yaba. Mostly 20 to 200 staff.";

  /* Thinking state (Gemini-style): shimmering status line + soft dots while
   * the model reads the reply; the Continue button morphs to "Working…"
   * with a spinner instead of going dead. Copy rotates, honestly. */
  var THINKING_LINES = [
    "Reading what you said…",
    "Pulling out the facts…",
    "Deciding what to ask next…",
    "Almost there…",
  ];
  var thinkingTimer = null;

  function setObThinking(on) {
    var el = $("ob-thinking");
    var text = $("ob-thinking-text");
    var answerUi = $("ob-answer-ui");
    var q = $("ob-question");
    var sub = $("ob-sub");
    if (!el) return;
    if (thinkingTimer) { clearInterval(thinkingTimer); thinkingTimer = null; }
    if (on) {
      var i = 0;
      if (text) text.textContent = THINKING_LINES[0];
      el.hidden = false;
      if (answerUi) answerUi.hidden = true;
      if (q) q.hidden = true;
      if (sub) sub.hidden = true;
      thinkingTimer = setInterval(function () {
        i = (i + 1) % THINKING_LINES.length;
        if (text) text.textContent = THINKING_LINES[i];
      }, 2200);
    } else {
      el.hidden = true;
      if (answerUi) answerUi.hidden = false;
      if (q) q.hidden = !ob || !ob.question;
      if (sub) sub.hidden = !ob || !ob.question;
    }
  }

  /* Dictation via Muse Voice Transcribe (Meta Model API). The browser records
   * one utterance per click, converts it to a 24 kHz mono WAV, and POSTs it to
   * /api/transcribe; the Worker holds the key and calls Meta server-side.
   * Each click appends exactly ONE clean utterance to the textarea — the old
   * browser-recognizer handler appended every partial result, stacking
   * "We do inn systems for businesses" garbage into the field. */
  function setupVoice() {
    var btn = $("btn-ob-speak");
    if (!btn) return;
    var nav = typeof navigator !== "undefined" ? navigator : null;
    var Ctx = (typeof window !== "undefined") && (window.AudioContext || window.webkitAudioContext);
    var OfflineCtx = (typeof window !== "undefined") && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
    if (!nav || !nav.mediaDevices || !nav.mediaDevices.getUserMedia
      || typeof MediaRecorder === "undefined" || !Ctx || !OfflineCtx) {
      btn.hidden = true; return;
    }
    btn.hidden = false;
    var session = null; // { recorder, stream, base, chunks, startedAt, done }

    function say(msg) {
      var el = $("onboard-error");
      if (!el) return;
      el.textContent = msg || "";
      el.hidden = !msg;
    }

    function setLabel(state) {
      var listening = state === "listening";
      var busy = state === "busy";
      var long = btn.querySelector(".speak-long");
      var short = btn.querySelector(".speak-short");
      if (long) long.textContent = busy ? "Transcribing…" : listening ? "Listening. Tap to finish" : "Speak instead";
      if (short) short.textContent = busy ? "…" : listening ? "Finish" : "Speak";
      btn.classList.toggle("recording", listening);
      btn.classList.toggle("transcribing", busy);
      btn.disabled = busy;
    }

    function stopTracks(stream) {
      try {
        (stream.getTracks() || []).forEach(function (t) { try { t.stop(); } catch (e) { /* stopped */ } });
      } catch (e) { /* stream already gone */ }
    }

    function tooShort(waitedMs) {
      say(waitedMs < 700
        ? "That was too quick. Tap the mic, speak your line, then tap again."
        : "We didn't catch that. Try speaking a bit longer.");
    }

    function encodeWav(buffer) {
      var rate = 24000, frames = buffer.length;
      var bytes = new ArrayBuffer(44 + frames * 2);
      var view = new DataView(bytes);
      var writeStr = function (off, s) {
        for (var i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
      };
      writeStr(0, "RIFF"); view.setUint32(4, 36 + frames * 2, true); writeStr(8, "WAVE");
      writeStr(12, "fmt "); view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      writeStr(36, "data"); view.setUint32(40, frames * 2, true);
      var d = buffer.getChannelData(0);
      for (var i = 0, off = 44; i < frames; i++, off += 2) {
        var s = Math.max(-1, Math.min(1, d[i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
      return new Blob([bytes], { type: "audio/wav" });
    }

    function resampleToWav(blob) {
      var ac = new Ctx();
      return blob.arrayBuffer().then(function (raw) { return ac.decodeAudioData(raw); })
        .then(function (decoded) {
          try { ac.close(); } catch (e) { /* already closed */ }
          var frames = Math.max(1, Math.ceil(decoded.duration * 24000));
          var off = new OfflineCtx(1, frames, 24000);
          var src = off.createBufferSource();
          src.buffer = decoded;
          src.connect(off.destination);
          src.start(0);
          return off.startRendering();
        });
    }

    function processClip(s) {
      if (s.done) return;
      s.done = true;
      var waited = Date.now() - s.startedAt;
      if (waited < 700 || !s.chunks.length) { tooShort(waited); return; }
      setLabel("busy");
      resampleToWav(new Blob(s.chunks, { type: s.recorder.mimeType || "audio/webm" })).then(function (rendered) {
        if (rendered.duration < 0.4) { setLabel(false); tooShort(2000); return; }
        return fetch("/api/transcribe", {
          method: "POST",
          headers: { "content-type": "audio/wav" },
          body: encodeWav(rendered),
        }).then(function (r) {
          return r.json().then(function (j) { return { ok: r.ok, body: j }; }, function () { return { ok: r.ok, body: {} }; });
        }).then(function (out) {
          setLabel(false);
          if (!out.ok) {
            var code = out.body && out.body.error;
            say(code === "model_not_configured" ? "Voice is not connected right now. Please type instead."
              : code === "transcribe_empty" ? "We heard nothing we could use. Try again, a little closer to the mic."
              : "Transcription failed. Please type instead.");
            return;
          }
          var box = $("f-description");
          if (!box) return;
          var text = String(out.body.text || "").trim();
          if (!text) { tooShort(2000); return; }
          var merged = (s.base ? s.base.replace(/\s+$/, "") + " " : "") + text;
          box.value = merged.slice(0, box.maxLength || 2000);
          if (box.focus) box.focus();
        }, function () {
          setLabel(false);
          say(NETWORK_MSG);
        });
      }, function () {
        setLabel(false);
        say("We could not read that recording. Please try again or type instead.");
      });
    }

    function startRecording() {
      say("");
      nav.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        var recorder;
        try { recorder = new MediaRecorder(stream); }
        catch (e) {
          stopTracks(stream);
          say("Voice recording is not available in this browser. Please type instead.");
          return;
        }
        var chunks = [];
        var s = {
          recorder: recorder, stream: stream, chunks: chunks, done: false,
          base: ($("f-description").value || ""), startedAt: Date.now(),
        };
        recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.onstop = function () { processClip(s); };
        recorder.onerror = function () { stopTracks(stream); setLabel(false); say("Recording failed. Please try again."); };
        session = s;
        try { recorder.start(); } catch (e) {
          session = null; stopTracks(stream);
          say("Recording could not start. Please type instead.");
          return;
        }
        setLabel("listening");
      }, function () {
        say("Microphone access was blocked. Allow it in the browser, or type instead.");
      });
    }

    function finishRecording() {
      var s = session;
      session = null;
      if (!s) return;
      setLabel(false);
      try { s.recorder.stop(); } catch (e) { /* already stopped: onstop still fires */ }
      stopTracks(s.stream);
    }

    btn.addEventListener("click", function () {
      if (session) { finishRecording(); return; }
      startRecording();
    });
  }

  function submitOnboard(event) {
    event.preventDefault();
    // Double-submit guard: a fresh `ob` here would reset busy:false and fire
    // two POST /api/onboard/turn calls (double model spend, clobbered state).
    if (ob && ob.busy) return false;
    var err = $("onboard-error");
    var description = $("f-description").value.trim();
    if (!description) {
      err.textContent = "Please describe what you sell in a sentence or two.";
      err.hidden = false;
      return false;
    }
    err.hidden = true;
    ob = {
      businessName: "", nameAssumed: false, firstText: description,
      fields: {}, followupsUsed: 0, question: null,
      done: false, busy: false, editingKey: null
    };
    obChatPhase();
    $("ob-yousaid-text").textContent = description;
    // obSend flips busy and renders the thinking state itself.
    return obSend(description, {});
  }

  function obSend(text, extra) {
    if (ob.busy) return Promise.resolve(false);
    ob.busy = true;
    // Every turn shows the thinking state: park the previous question so the
    // shimmer + working button take over while the model responds.
    ob.question = null;
    renderObChat();
    ob.lastSend = { text: text, extra: extra || {} };
    ob.lastAction = "send";
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
      // The chat may state the business name — capture it so the summary
      // never has to ask for what the owner already said.
      if (res.name && !ob.businessName) { ob.businessName = res.name; ob.nameAssumed = false; }
      setObButtons(false);
      renderObChat();
      return true;
    }, function (e) {
      ob.busy = false;
      setObButtons(false);
      obError(friendlyObError(e), true);
      // Re-render without the thinking state; the owner's typed answer
      // survives (only a NEW question clears it) and Retry sits below.
      renderObChat();
      return false;
    });
  }

  var NETWORK_MSG = "We could not reach the service. Check your connection and try again.";

  function isNetworkError(e) {
    if (!e) return true;
    if (typeof TypeError !== "undefined" && e instanceof TypeError && e.status === undefined) return true;
    return (e.status === undefined || e.status === null) && !e.detail;
  }

  function friendlyObError(e) {
    if (isNetworkError(e)) return NETWORK_MSG;
    var detail = e && e.detail ? String(e.detail) : "";
    if (detail === "model_not_configured") return "The assistant is not connected. Come back later.";
    if (detail === "model_error" || (e && e.status === 502)) return "The assistant did not reply. Check your connection and try again.";
    if (detail === "text_too_long") return "That message is too long. Please shorten it and try again.";
    return "Something went wrong. Please try again.";
  }

  function obError(msg, canRetry) {
    var el = $("ob-error");
    var retry = $("btn-ob-retry");
    if (!msg) { el.hidden = true; el.textContent = ""; if (retry) retry.hidden = true; return; }
    el.textContent = msg;
    el.hidden = false;
    if (retry) retry.hidden = !canRetry;
  }

  function obRetry() {
    if (!ob || ob.busy) return false;
    obError(null);
    if (ob.lastAction === "finish") return obFinish();
    var last = ob.lastSend || { text: ob.firstText, extra: {} };
    return obSend(last.text, last.extra);
  }

  function setObButtons(disabled) {
    ["btn-ob-continue", "btn-ob-skip", "btn-ob-finish"].forEach(function (id) {
      var b = $(id);
      if (b) b.disabled = disabled;
    });
    // Working-state morph (never a dead gray button): spinner inside the
    // Continue button, label "Working…", arrow parked, aria-busy set.
    var cont = $("btn-ob-continue");
    if (cont) {
      var spin = $("ob-continue-spinner");
      var arrow = $("ob-continue-arrow");
      var lbl = $("ob-continue-label");
      if (spin) spin.hidden = !disabled;
      if (arrow) arrow.hidden = disabled;
      if (lbl) lbl.textContent = disabled ? "Working…" : "Continue";
      cont.setAttribute("aria-busy", disabled ? "true" : "false");
    }
    var ans = $("ob-answer");
    if (ans) ans.disabled = disabled;
  }

  function obContinue() {
    if (!ob || ob.busy || ob.done) return false;
    var v = $("ob-answer").value.trim();
    if (!v) { obError("Type your answer, or skip to mark it as a guess."); return false; }
    if (ob.question && ob.question.key === "__name") {
      ob.businessName = v.slice(0, 120);
      ob.nameAssumed = false;
      ob.question = null;
      ob.done = true;
      renderObChat();
      return obFinish();
    }
    return obSend(v, {});
  }

  function obSkip() {
    if (!ob || ob.busy || ob.done || !ob.question) return false;
    if (ob.question.key === "__name") {
      ob.businessName = "My business";
      ob.nameAssumed = true;
      ob.question = null;
      ob.done = true;
      renderObChat();
      return obFinish();
    }
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
    // Honest progress: count what is actually captured, never a fake
    // "Step 2 of 3 · 28 seconds" script — questions adapt to what's missing.
    var filled = OB_CORE.filter(function (k) { return ob.fields[k] && ob.fields[k].value; }).length;
    if (ob.done) {
      setObThinking(false);
      step.textContent = "All understood · review and start below";
      updateObSegs(3);
      $("ob-question-wrap").hidden = true;
      $("ob-done-wrap").hidden = false;
    } else {
      step.textContent = filled + " of " + OB_CORE.length + " details captured · we only ask what is missing";
      updateObSegs(Math.max(1, Math.round((filled / OB_CORE.length) * 3)));
      $("ob-question-wrap").hidden = false;
      $("ob-done-wrap").hidden = true;
      var thinking = !!ob.busy && !ob.question;
      setObThinking(thinking);
      // Only clear the typed answer when a NEW question is shown — never
      // on a failure (the owner's text must survive for retry).
      $("ob-question").textContent = ob.question ? ob.question.prompt : "";
      if (ob.question) {
        $("ob-answer").value = "";
        renderObChips();
        updateObSub();
      }
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
    obFirstPhase();
    $("f-description").value = ob.firstText;
    ob = null;
  }

  var OB_DRAFT_KEY = "pr-draft";

  function obSaveExit() {
    try {
      if (typeof localStorage === "undefined") { showView("landing"); return; }
      var draft = { v: 1, savedAt: Date.now(), firstText: "", fields: {}, followupsUsed: 0 };
      if (ob) {
        draft.firstText = ob.firstText || "";
        draft.fields = ob.fields || {};
        draft.followupsUsed = ob.followupsUsed || 0;
      } else {
        var box = $("f-description");
        if (box) draft.firstText = box.value.trim();
      }
      if (draft.firstText) localStorage.setItem(OB_DRAFT_KEY, JSON.stringify(draft));
    } catch (e) { /* private mode: exiting still works */ }
    showView("landing");
  }

  function obRestoreDraft() {
    var box = $("f-description");
    if (!box || box.value.trim()) return;
    try {
      if (typeof localStorage === "undefined") return;
      var raw = localStorage.getItem(OB_DRAFT_KEY);
      if (!raw) return;
      var draft = JSON.parse(raw);
      if (draft && draft.firstText) box.value = draft.firstText;
    } catch (e) { /* corrupt draft: start blank */ }
  }

  function obFinish() {
    if (!ob || ob.busy || !ob.done) return false;
    ob.lastAction = "finish";
    var fv = function (k) { return (ob.fields[k] && ob.fields[k].value) || ""; };
    var desc = fv("offering") || ob.firstText;
    var ideal = fv("ideal_customer");
    // Skip "for X" when the offering already names the buyer ("to offices for offices…").
    if (ideal && desc.toLowerCase().indexOf(ideal.toLowerCase().split(" ")[0]) < 0) desc += " for " + ideal;
    if (fv("timeline")) desc += ". Timing: " + fv("timeline");
    if (fv("budget")) desc += ". Budget per order: " + fv("budget");
    var input = {
      businessName: ob.businessName || "", name_assumed: !!ob.nameAssumed, site: "", description: desc,
      q1: fv("service_area"), q2: fv("order_size"), q3: fv("decision_maker"),
      q4: fv("exclusions"), q5: fv("ideal_customer")
    };
    setObButtons(true);
    return api.createProfile(input).then(function (res) {
      setObButtons(false);
      state.profile = res.profile;
      renderProfileConfirm(res.profile);
      showView("profile");
    }, function (e) {
      setObButtons(false);
      if (e && e.detail === "missing_name") {
        ob.done = false;
        ob.question = { key: "__name", prompt: "What should we call your business?", chips: [] };
        renderObChat();
        var ans = $("ob-answer");
        if (ans && ans.focus) ans.focus();
        return false;
      }
      obError(isNetworkError(e) ? NETWORK_MSG : "Could not save your profile. Please try again.", true);
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
    var perr = $("profile-error");
    if (perr) { perr.hidden = true; perr.textContent = ""; }
    // Double-submit guard: two clicks would chain two POST /api/runs (two
    // Workflow instances, one parked at created forever).
    var btn = $("btn-confirm-profile");
    if (btn && btn.disabled) return false;
    if (btn) btn.disabled = true;
    return api.confirmBrief(state.profile).then(function (res) {
      if (btn) btn.disabled = false;
      state.runId = res.runId;
      showView("progress");
      return pollProgress();
    }, function (e) {
      if (btn) btn.disabled = false;
      if (perr) {
        perr.textContent = isNetworkError(e) ? NETWORK_MSG : "We could not start the research. Please try again.";
        perr.hidden = false;
      }
      return false;
    });
  }

  var PROGRESS_IDX = {
    created: 0, awaiting_brief: 0, discovering: 1, investigating: 2,
    assessing: 3, drafting: 4, awaiting_approval: 5, complete: 5,
    stopped: 5, failed: 5
  };
  var progressSeq = 0;

  function pollProgress() {
    // Capture the run this poll belongs to: if the owner starts over (or
    // re-confirms), a finished OLD run must not yank the UI to the NEW run's
    // empty shortlist — stale resolutions are dropped instead.
    var myRun = state.runId;
    $("progress-note").textContent = isDemo()
      ? "Example run. Keep this page open while it works."
      : "Research keeps running on the server. Come back any time.";
    $("progress-error").hidden = true;
    $("btn-restart-progress").hidden = true;
    var steps = $("progress-steps");
    if (steps && !steps.children.length) {
      steps.innerHTML = '<li class="skel skel-step" aria-hidden="true"></li>'.repeat(3);
    }
    refreshProgressSnapshot();
    return api.runProgress(myRun, function () {
      // A live tick after an error clears the stopped latch: the banner and
      // buttons go back to the working state (retry healed the stream).
      $("progress-eyebrow").innerHTML = '<span class="dot" aria-hidden="true"></span>Working now';
      $("progress-title").textContent = "Finding the buyers that truly fit.";
      $("progress-error").hidden = true;
      var retry = $("btn-retry-progress");
      if (retry) retry.hidden = true;
      refreshProgressSnapshot();
    }).then(function () {
      if (myRun !== state.runId) return null;
      return api.getShortlist(myRun).then(function (res) {
        if (myRun !== state.runId) return null;
        state.prospects = res.prospects;
        state.selectedId = null;
        state.selectedIds = null;
        state.tab = null;
        // The owner may have moved on (stop, preview): never yank them back.
        if ($("view-progress").hidden && $("view-shortlist").hidden) return null;
        // Live only: a run that finished while the owner was away may already
        // have messages written. Land in the drafts studio, not on a
        // shortlist that makes them click "Write my messages" again
        // (user report 2026-11-02, Duban).
        if (!isDemo()) {
          return api.getDrafts(myRun).then(function (dr) {
            if (myRun !== state.runId) return null;
            if (dr.drafts && dr.drafts.length) { renderDrafts(); return null; }
            renderShortlist();
            showView("shortlist");
            return null;
          }, function () {
            if (myRun !== state.runId) return null;
            renderShortlist();
            showView("shortlist");
            return null;
          });
        }
        renderShortlist();
        showView("shortlist");
        return null;
      });
    }, function (err) {
      if (myRun !== state.runId) return null;
      $("progress-eyebrow").textContent = "Stopped";
      $("progress-title").textContent = "Research stopped before it finished.";
      var perr = $("progress-error");
      perr.textContent = isNetworkError(err) ? NETWORK_MSG
        : "Research stopped before it finished. Your progress is saved. Retry, or start over below.";
      perr.hidden = false;
      var retry = $("btn-retry-progress");
      if (retry) retry.hidden = false;
      var again = $("btn-restart-progress");
      if (again) again.hidden = false;
      return null;
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
    var list = $("prospect-list");
    showView("shortlist");
    if (list && !list.children.length) {
      list.innerHTML = '<li class="skel skel-card" aria-hidden="true"></li>'.repeat(3);
    }
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
    // Spec C (2026-10-31): Ready now = strong fit AND a dated, sourced
    // signal (readiness >= 4). Warm up = strong or good fit, no signal.
    // Needs a look = unclear identity, weak fit, or no own source.
    var ownSource = prospectSource(p);
    if (!p.verdict || !ownSource) return "look";
    if (p.verdict !== "qualified" && p.verdict !== "no_signal") return "look";
    var datedSignal = (p.readiness || 0) >= 4;
    if (p.verdict === "qualified") return datedSignal ? "ready" : "warm";
    return "warm"; // no_signal: good fit, no signal yet
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
    var tab = tabOf(p);
    if (tab === "ready") return "STRONG FIT";
    if (tab === "warm") return p.verdict === "qualified" ? "GOOD FIT" : "GOOD FIT, NO SIGNAL YET";
    return "NEEDS A LOOK";
  }

  function fitClass(p) {
    var tab = tabOf(p);
    if (tab === "ready") return "tag-green";
    if (tab === "warm") return "tag-gold";
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
    // Spec D: default selection is Ready-now ONLY — never everything.
    if (!state.selectedIds) {
      state.selectedIds = shown.filter(function (p) { return tabOf(p) === "ready"; }).map(function (p) { return p.id; });
    }
    var counts = { ready: 0, warm: 0, look: 0 };
    shown.forEach(function (p) { counts[tabOf(p)] += 1; });
    // Land on the first group with picks; an explicit tab choice always sticks.
    if (!state.tab) {
      state.tab = counts.ready ? "ready" : counts.warm ? "warm" : counts.look ? "look" : "ready";
    }

    $("shortlist-title").textContent = numWord(shown.length) + (shown.length === 1 ? " buyer worth your time." : " buyers worth your time.");
    // Honest copy, generated from the real counts (never "passed your
    // must-haves" unless every shown pick truly did).
    $("shortlist-sub").textContent = state.tab === "look"
      ? "These need a human look before they join your list."
      : counts.ready + " ready to contact, " + counts.warm + " to warm up, " + counts.look + " to check first.";
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
      var routeState = first && first.verification === "verified"
        ? "<br/><span class=\"muted small\">Checked: the link opens and matches</span>"
        : "<br/><span class=\"muted small\">Published, not yet checked</span>";
      var routeLine = first
        ? esc(ROUTE_LABELS[first.channel] || "Contact") + ": " + esc(String(first.value).slice(0, 48)) +
          (routes.length > 1 ? " (+" + (routes.length - 1) + " more)" : "") + routeState
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
      var who = res.prospect.name;
      $("evidence-hint").textContent = isDemo()
        ? "Why " + who + " made the example shortlist:"
        : "The research behind this pick:";
      var proofs = res.evidence.map(function (ev) {
        var quote = String(ev.quote || "");
        if (quote.length > 240) quote = quote.slice(0, 240).replace(/\s+\S*$/, "") + "…";
        quote = tidyProse(quote);
        return "<li class=\"proof\"><p class=\"proof-claim\">" + esc(quote) + "</p>" +
          "<p class=\"proof-src\">" + esc(typeLabel(ev.type)) + " · <a href=\"" + esc(ev.source) + "\" target=\"_blank\" rel=\"noopener\">" + esc(hostOfUrl(ev.source)) + "</a>" +
          (isDemo() ? " · example data" : "") + "</p></li>";
      }).join("");
      body.innerHTML =
        "<details class=\"acc\" open><summary>Reach out</summary>" + reachOutHtml(res) + "</details>" +
        "<details class=\"acc\" open><summary>Why " + esc(who) + " was shortlisted</summary>" +
        "<ul class=\"proofs\">" +
        (proofs || "<li class=\"proof\"><p class=\"proof-claim\">No proof captured yet.</p></li>") +
        "</ul></details>" +
        "<div id=\"history-slot\"></div>";
      return renderTimeline(id, $("history-slot"));
    });
  }

  var ROUTE_LABELS = {
    website_form: "Website form", email: "Email", phone: "Phone",
    social_profile: "Social profile", other: "Other",
  };
  var ROUTE_VERIFY = {
    public_listing: "Published", verified: "Verified", unchecked: "not yet checked",
  };

  function routeLabel(r) {
    if (r.channel !== "social_profile") return ROUTE_LABELS[r.channel] || r.channel;
    try {
      var h = new URL(r.value).hostname.replace(/^www\./, "").toLowerCase();
      if (h.indexOf("instagram") >= 0) return "Instagram";
      if (h.indexOf("facebook") >= 0 || h === "fb.com") return "Facebook";
      if (h === "x.com" || h.indexOf("twitter") >= 0) return "X (Twitter)";
      if (h.indexOf("linkedin") >= 0) return "LinkedIn";
      if (h.indexOf("tiktok") >= 0) return "TikTok";
    } catch (e) { /* fall through */ }
    return "Social profile";
  }

  function reachOutHtml(res) {
    var routes = res.routes || [];
    var rows = routes.map(function (r) {
      var label = routeLabel(r);
      var verify = ROUTE_VERIFY[r.verification] || "";
      return "<li class=\"route\"><span class=\"route-chip\">" + esc(label) + "</span>" +
        "<span class=\"route-value\">" + esc(r.value) + "</span>" +
        (verify ? "<span class=\"route-verify\">" + esc(verify) + "</span>" : "") +
        "<button type=\"button\" class=\"copy-route\" data-copy=\"" + esc(r.value) + "\">Copy</button></li>";
    }).join("");
    var person = res.prospect || {};
    var personHtml =
      "<li class=\"route route-person\"><span class=\"route-chip\">Contact person</span>" +
      "<span class=\"route-value\">" +
      (person.contact_name
        ? esc(person.contact_name) + (person.contact_title ? " · " + esc(person.contact_title) : "")
        : "<em>Not named yet — add them when you know.</em>") +
      "</span></li>" +
      "<li class=\"route route-edit\"><input data-field=\"person-name\" placeholder=\"Contact person's name\" maxlength=\"120\" />" +
      "<input data-field=\"person-title\" placeholder=\"Their role (optional)\" maxlength=\"120\" />" +
      "<button type=\"button\" data-act=\"save-person\" data-id=\"" + esc(person.id) + "\">Save</button></li>";
    return "<ul class=\"routes\">" + personHtml + (rows || "<li class=\"route\"><span class=\"route-value\"><em>No published route yet.</em></span></li>") + "</ul>";
  }

  function typeLabel(t) {
    var labels = { fetched_page: "their own page", search_snippet: "search result", fetched_page_failed: "page could not be opened" };
    return labels[t] || t;
  }

  function hostOfUrl(u) {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; }
  }

  var EVENT_LABEL = {
    created: "Added",
    shortlisted: "Shortlisted",
    drafted: "Draft written",
    approved: "Approved",
    rejected: "Rejected",
    deferred: "Deferred",
    disqualified: "Set aside",
    "auto: contact logged": "Contact logged",
  };

  function cleanTime(iso) {
    try { return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
    catch (e) { return String(iso || ""); }
  }

  function timelineItem(t) {
    var when = cleanTime(t.at);
    var note = t.note ? ". " + esc(String(t.note).replace(/^dedupe merge:\s*/i, "Merged with duplicate ")) : "";
    if (t.kind === "contact") {
      return "<li class=\"contact\">" + esc(t.direction === "inbound" ? "Heard back" : "Contacted") +
        " via " + esc(t.channel) + " · " + esc(when) + note + "</li>";
    }
    var label = EVENT_LABEL[t.event] || String(t.event || "update").replace(/_/g, " ");
    return "<li>" + esc(label) + " · " + esc(when) + note + "</li>";
  }

  function renderTimeline(id, body) {
    return api.getTimeline(id).then(function (res) {
      var items = (res.timeline || []).map(timelineItem).join("");
      body.innerHTML =
        "<details class=\"acc\"><summary>History</summary><ul class=\"timeline\">" +
        (items || "<li>No contact yet. Log your first touch below.</li>") + "</ul>" +
        "<form class=\"log-contact\" data-id=\"" + esc(id) + "\">" +
        "<div class=\"lf\"><label for=\"lc-channel\">Channel</label><select id=\"lc-channel\" data-field=\"contact-channel\">" +
        ["whatsapp", "email", "telegram", "phone", "sms", "in_person", "other"].map(function (c) {
          var label = { whatsapp: "WhatsApp", email: "Email", telegram: "Telegram", phone: "Phone call", sms: "SMS", in_person: "In person", other: "Other" }[c];
          return "<option value=\"" + c + "\">" + label + "</option>";
        }).join("") + "</select></div>" +
        "<div class=\"lf\"><label for=\"lc-date\">Date</label><input id=\"lc-date\" data-field=\"contact-date\" type=\"date\" /></div>" +
        "<div class=\"lf lf-wide\"><label for=\"lc-note\">Note</label><input id=\"lc-note\" data-field=\"contact-note\" placeholder=\"e.g. Sent the intro, asked about their next event\" /></div>" +
        "<div class=\"row\"><button type=\"button\" data-act=\"log-contact\" data-id=\"" + esc(id) + "\">Log contact</button></div>" +
        "</form></details>";
    }, function () { /* timeline is best-effort; evidence already rendered */ });
  }

  function onEvidenceClick(e) {
    var t = e.target || {};
    var ds = t.dataset || {};
    if (ds.act === "copy-route" || t.classList && t.classList.contains("copy-route")) {
      var val = t.getAttribute("data-copy") || "";
      if (val && navigator.clipboard) navigator.clipboard.writeText(val).catch(function () { /* best effort */ });
      t.textContent = "Copied";
      setTimeout(function () { t.textContent = "Copy"; }, 1500);
      return;
    }
    if (ds.act === "save-person" && ds.id) {
      var body = $("evidence-body");
      var name = body.querySelector('[data-field="person-name"]');
      var title = body.querySelector('[data-field="person-title"]');
      var payload = { contact_name: name ? name.value.trim() : "", contact_title: title ? title.value.trim() : "" };
      if (!payload.contact_name && !payload.contact_title) return;
      api.setContactPerson(ds.id, payload).then(function () { selectProspect(ds.id); });
      return;
    }
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
    whatsapp: "Manual send: the button below opens WhatsApp with this message pre-filled — you press send.",
    email: "Manual send: opens your email app with the draft pre-filled — you press send.",
    dm: "Manual send: open their profile and paste the message yourself."
  };

  // --- WhatsApp manual send (504Yard pattern). The owner clicks per lead;
  // nothing is ever sent for them. Emoji-safe: every message rides
  // encodeURIComponent (UTF-8 percent-encoding, 🔥 → %F0%9F%94%A5).
  function waNumber(raw) {
    var d = String(raw || "").replace(/[^0-9]/g, "");
    if (d.indexOf("234") === 0) return d;
    if (d.indexOf("0") === 0 && d.length === 11) return "234" + d.slice(1);
    if (d.length === 10) return "234" + d;
    return d;
  }
  function waWarning(d) {
    if (d.length !== 12 && d.length !== 13) return "unusual number length";
    if ("12".indexOf(d.charAt(3)) >= 0) return "landline — may not have WhatsApp";
    return "";
  }
  function waApp() {
    try { return localStorage.getItem("wa_app") || "auto"; } catch (e) { return "auto"; }
  }
  function waUrl(to, msg, app) {
    // api.whatsapp.com preserves emoji; wa.me's own redirect mangles them
    // (measured 2026-11-01: wa.me 302 re-encoded 🔥 to U+FFFD, api.whatsapp
    // carried "🔥" intact to the app link).
    var base = "https://api.whatsapp.com/send/?phone=" + to + "&text=" + encodeURIComponent(msg) + "&type=phone_number&app_absent=0";
    if (app === "wa") {
      return "intent://" + base.slice("https://".length) + "#Intent;scheme=https;package=com.whatsapp;S.browser_fallback_url=" + encodeURIComponent(base) + ";end";
    }
    if (app === "biz") {
      return "intent://" + base.slice("https://".length) + "#Intent;scheme=https;package=com.whatsapp.w4b;S.browser_fallback_url=" + encodeURIComponent(base) + ";end";
    }
    return base;
  }
  function personalize(t, name) {
    var n = (name || "").trim();
    var has = n && !/\b(?:to verify|verify|tbd|unknown|pending)\b/i.test(n);
    t = t.replace(/\b(Hello|Hi|Dear)[ \t]*\[Name\][ \t]*,?/gi, function (m, g) { return has ? g + " " + n + "," : g + ","; });
    t = t.replace(/[ \t]*\[Name\][ \t]*,?/gi, " ").replace(/[ \t]{2,}/g, " ");
    return t.trim();
  }
  /** Citation markers are internal provenance (audit keeps them); the message
   * a prospect reads — on screen or in transit — never shows "[source 1]". */
  function cleanCitations(t) {
    return String(t || "")
      .replace(/\s*\[(?:source|ev_|cite)[\s\d]*\d*\]/gi, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([.,;:!?])/g, "$1")
      .trim();
  }

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

  /** Prose tidier for anything the owner reads: no space before punctuation,
   * a comma after road/street before a place name ("Ogunnusi Road Ogba" ->
   * "Ogunnusi Road, Ogba"), collapsed double spaces. Applied to evidence
   * quotes and hypotheses — never to business names. */
  function tidyProse(s) {
    var t = String(s || "");
    t = t.replace(/\s+([.,;:!?])/g, "$1");
    t = t.replace(/\b(Road|Street|Avenue|Ave|Way|Close|Lane|Drive|Crescent)\s+(?=[A-Z])(?![A-Za-z]*\b(Hotel|Centre|Center|Ltd|Limited|Gym|Clinic|School|Church|Events?|Planners?|Services)\b)/g, "$1, ");
    t = t.replace(/[ \t]{2,}/g, " ");
    return t.trim();
  }

  /** Internal verdict codes never reach the owner — translated, not shown. */
  var VERDICT_HUMAN = {
    qualified: "Strong fit — the research saw a live buying signal.",
    no_signal: "Good fit — no dated buying signal yet, so a patient introduction is suggested.",
    needs_research: "Promising — a few things still need verifying before you reach out.",
    manual_review: "You should make the final call here — the research is not sure.",
    disqualified: "Set aside — it did not pass your must-haves.",
  };
  function verdictHuman(v) {
    return VERDICT_HUMAN[v] || "";
  }
  function stripVerdict(r) {
    return String(r || "").replace(/\s*\[verdict:[^\]]*\]\s*$/i, "").trim();
  }

  function countWords(s) {
    var t = String(s || "").trim();
    return t ? t.split(/\s+/).length : 0;
  }

  function wordGuidance(n, tab) {
    if (tab === "whatsapp") {
      if (n <= 60) return "Good length for WhatsApp.";
      if (n <= 100) return "A bit long for a cold WhatsApp — “More direct” trims it.";
      return "Too long for a cold WhatsApp — cut to the point or use “More direct”.";
    }
    if (n <= 40) return "Short enough to read in one glance.";
    if (n <= 80) return "Room for context, still under 80 words.";
    return "Over 80 words. Shorter usually earns the reply.";
  }

  /** Manual-send block per channel (504Yard patterns): WhatsApp app selector
   * (Auto/WhatsApp/WhatsApp Business, saved per device), multi-number buttons
   * with landline + unverified warnings, mailto and social-profile links. */
  function waTestNum() {
    try { return localStorage.getItem("wa_test_num") || ""; } catch (e) { return ""; }
  }
  function ownerEmail() {
    try { return localStorage.getItem("owner_email") || ""; } catch (e) { return ""; }
  }
  function studioSendHtml(d, p, st) {
    var routes = ((st.evidence[d.prospectId] || {}).routes) || [];
    var person = (p && p.contact_name) || "";
    if (st.tab === "whatsapp") {
      var phones = routes.filter(function (r) { return r.channel === "phone"; });
      var btns = phones.slice(0, 4).map(function (r, i) {
        var to = waNumber(r.value);
        var warn = waWarning(to);
        var unv = r.verification === "unchecked" || r.verification === "public_listing";
        return "<button type=\"button\" class=\"wa-open\" data-act=\"wa-open\" data-wato=\"" + esc(to) + "\"" +
          (unv ? " data-unv=\"1\"" : "") + (warn ? " data-warn=\"" + esc(warn) + "\"" : "") +
          ">Open WhatsApp" + (phones.length > 1 ? " (" + (i + 1) + ")" : "") +
          (warn ? " <span class=\"wa-warn\">" + esc(warn) + "</span>" : "") + "</button>";
      }).join("");
      if (!btns) btns = "<p class=\"hint\">No WhatsApp number yet for this pick. Add one on the lead's Reach out panel.</p>";
      var appSel = [["auto", "Auto"], ["wa", "WhatsApp"], ["biz", "WhatsApp Business"]].map(function (a) {
        return "<button type=\"button\" class=\"chip wa-app" + (waApp() === a[0] ? " selected" : "") +
          "\" data-act=\"wa-app\" data-id=\"" + a[0] + "\">" + a[1] + "</button>";
      }).join("");
      return "<div class=\"card send-card\"><p class=\"kicker kicker-dim\">Send now, by hand</p>" +
        "<p class=\"muted small\">Clicking opens WhatsApp with this message pre-filled — you press send." +
        (person ? " Greeting uses " + esc(person) + "." : "") + "</p>" +
        "<div class=\"chips wa-app-row\">" + appSel + "</div>" + btns +
        "<div class=\"wa-test\"><label for=\"wa-test-num\">Test on yourself first</label>" +
        "<input id=\"wa-test-num\" data-field=\"wa-test-num\" value=\"" + esc(waTestNum()) + "\" placeholder=\"Your own WhatsApp number\" />" +
        "<button type=\"button\" data-act=\"wa-test\">Open on my number</button>" +
        "<p class=\"muted small\">Opens the same message on YOUR WhatsApp — the lead never sees a test.</p></div></div>";
    }
    if (st.tab === "email") {
      var emails = routes.filter(function (r) { return r.channel === "email"; });
      var leadBtns = emails.slice(0, 2).map(function (r) {
        return "<button type=\"button\" class=\"wa-open\" data-act=\"mail-open\" data-email=\"" + esc(r.value) + "\"" +
          (r.verification === "unchecked" || r.verification === "public_listing" ? " data-unv=\"1\"" : "") +
          ">Open email draft (" + esc(r.value) + ")</button>";
      }).join("");
      if (!leadBtns) leadBtns = "<p class=\"hint\">No email route yet for this pick.</p>";
      return "<div class=\"card send-card\"><p class=\"kicker kicker-dim\">Send now, by hand</p>" + leadBtns +
        "<div class=\"wa-test\"><label for=\"mail-test-email\">Test on yourself first</label>" +
        "<input id=\"mail-test-email\" data-field=\"mail-test-email\" value=\"" + esc(ownerEmail()) + "\" placeholder=\"Your own email\" />" +
        "<button type=\"button\" data-act=\"mail-test\">Email it to me</button>" +
        "<p class=\"muted small\">Arrives in your own inbox — the lead never sees a test.</p></div></div>";
    }
    var socials = routes.filter(function (r) { return r.channel === "social_profile"; });
    if (!socials.length) return "";
    return "<div class=\"card send-card\"><p class=\"kicker kicker-dim\">Open their profile to DM</p>" +
      socials.slice(0, 3).map(function (r) {
        return "<a class=\"link-gold\" href=\"" + esc(r.value) + "\" target=\"_blank\" rel=\"noopener\">Open " +
          esc(routeLabel(r)) + "</a>";
      }).join(" ") + "</div>";
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
    var st = state.studio;
    if (act === "wa-open") {
      var p0 = studioProspect(d);
      if (ds.unv === "1" && !window.confirm("This route is published, not yet verified. Verify via official channels first. Continue?")) return;
      if (ds.warn && !window.confirm(ds.warn + ". Continue?")) return;
      var bodyEl = st.el.querySelector('[data-field="body"]');
      var msg = personalize(cleanCitations(bodyEl && bodyEl.value ? bodyEl.value : studioBodyFor(d, "whatsapp")), p0 && p0.contact_name);
      api.logContact(d.prospectId, { channel: "whatsapp", note: "Opened WhatsApp +" + ds.wato });
      window.open(waUrl(ds.wato, msg, waApp()), "_blank");
      return;
    }
    if (act === "mail-open") {
      var p1 = studioProspect(d);
      if (ds.unv === "1" && !window.confirm("This route is published, not yet verified. Verify via official channels first. Continue?")) return;
      var bEl = st.el.querySelector('[data-field="body"]');
      var sEl = st.el.querySelector('[data-field="subject"]');
      var body1 = personalize(cleanCitations(bEl && bEl.value ? bEl.value : studioBodyFor(d, "email")), p1 && p1.contact_name);
      var subj1 = personalize(cleanCitations(sEl && sEl.value ? sEl.value : (d.subject || "")), p1 && p1.contact_name);
      api.logContact(d.prospectId, { channel: "email", note: "Opened email draft " + ds.email });
      window.location.href = "mailto:" + ds.email + "?subject=" + encodeURIComponent(subj1) + "&body=" + encodeURIComponent(body1);
      return;
    }
    if (act === "wa-app" && ds.id) {
      try { localStorage.setItem("wa_app", ds.id); } catch (e2) { /* private mode */ }
      renderStudioInner();
      return;
    }
    if (act === "wa-test") {
      var numEl = st.el.querySelector('[data-field="wa-test-num"]');
      var toMe = waNumber(numEl ? numEl.value : "");
      if (!toMe || toMe.length < 11) { window.alert("Enter your own WhatsApp number (e.g. 0803 123 4567)."); return; }
      try { localStorage.setItem("wa_test_num", numEl.value); } catch (e3) { /* private mode */ }
      var pT = studioProspect(d);
      var bT = st.el.querySelector('[data-field="body"]');
      var msgT = personalize(cleanCitations(bT && bT.value ? bT.value : studioBodyFor(d, "whatsapp")), pT && pT.contact_name);
      window.open(waUrl(toMe, msgT, waApp()), "_blank");
      return;
    }
    if (act === "mail-test") {
      var meEl = st.el.querySelector('[data-field="mail-test-email"]');
      var mine = meEl ? meEl.value.trim() : "";
      if (!mine || mine.indexOf("@") < 0) { window.alert("Enter your own email address."); return; }
      try { localStorage.setItem("owner_email", mine); } catch (e4) { /* private mode */ }
      var pM = studioProspect(d);
      var bM = st.el.querySelector('[data-field="body"]');
      var sM = st.el.querySelector('[data-field="subject"]');
      var bodyM = personalize(bM && bM.value ? bM.value : d.body, pM && pM.contact_name);
      var subjM = personalize(sM && sM.value ? sM.value : (d.subject || ""), pM && pM.contact_name);
      window.location.href = "mailto:" + mine + "?subject=" + encodeURIComponent(subjM) + "&body=" + encodeURIComponent(bodyM);
      return;
    }
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
      var isVariant = st.tab !== studioTabFor(d.channel) && d.variants;
      decideDraft(d.prospectId, "save-edit", el).then(function () {
        var text = el.querySelector('[data-field="body"]').value;
        if (isVariant) {
          d.variants[st.tab] = text; // local echo; the decide payload stored it
        } else {
          d.body = text;
        }
        d.subject = el.querySelector('[data-field="subject"]').value;
        state.studio.editing = false;
        renderStudioInner();
      });
      return;
    }
    if (act === "studio-sender") { renderSendersView("drafts"); return; }
    if (act === "studio-tone" && ds.id) { studioTone(d, ds.id); return; }
    if (act === "studio-test") { studioTest(d); return; }
    if (act === "approve") {
      // "Approve and schedule" earns its label: approving the last undecided
      // message carries the owner to the campaign scheduler.
      decideDraft(d.prospectId, act, state.studio.el).then(function () {
        var rest = state.studio.list.filter(function (x) {
          var dec = decisionOf(x);
          return dec !== "approved" && dec !== "rejected" && dec !== "deferred";
        });
        if (!rest.length) renderCampaignView();
      });
      return;
    }
    if (act === "save-edit" || act === "reject" || act === "skip") {
      decideDraft(d.prospectId, act, state.studio.el);
    }
  }

  /** The message for the active tab: the per-channel variant when the
   * research wrote one, else the shared body. */
  function studioBodyFor(d, tab) {
    var v = (d && d.variants) || {};
    return cleanCitations(v[tab] || d.body);
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
    var shownBody = studioBodyFor(d, st.tab);
    var hasVariant = !!(d.variants && d.variants[st.tab]);
    if (st.tab === primary) {
      var subj = st.tab === "email" && d.subject ? "<p class=\"studio-subject\">" + esc(d.subject) + "</p>" : "";
      var paras = esc(shownBody).split("\n").map(function (line) {
        return "<p>" + (line || "&nbsp;") + "</p>";
      }).join("");
      bodyHtml = subj + "<div class=\"studio-text\">" + paras + "</div>" +
        "<button type=\"button\" class=\"linklike\" data-act=\"studio-edit\">Tap to edit</button>";
    } else {
      // Per-channel versions: the research wrote a WhatsApp/Email/DM shape
      // when it could; a missing variant falls back to the shared message,
      // honestly labelled (user feedback 2026-11-01).
      bodyHtml = (hasVariant ? "" :
        "<p class=\"hint\">No per-channel version yet — showing the research's " +
        esc(studioSuggestionLabel(d.channel).toLowerCase()) + " message; it reads fine here.</p>") +
        "<div class=\"studio-text\">" + esc(shownBody).split("\n").map(function (line) {
          return "<p>" + (line || "&nbsp;") + "</p>";
        }).join("") + "</div>" +
        "<button type=\"button\" class=\"linklike\" data-act=\"studio-edit\">Tap to edit</button>";
    }
    var n = countWords(shownBody);
    var tones = st.tab === primary
      ? [["warmer", "Warmer"], ["more_direct", "More direct"], ["another", "Write another"]].map(function (t) {
        return "<button type=\"button\" data-act=\"studio-tone\" data-id=\"" + t[0] + "\"" +
          (st.busy ? " disabled" : "") + ">" + t[1] + "</button>";
      }).join("")
      : "";
    var editor = "<div class=\"studio-editor\"" + (st.editing ? "" : " hidden") + ">" +
      "<label>Subject <input data-field=\"subject\" value=\"" + esc(d.subject || "") + "\" /></label>" +
      "<label>Message <textarea data-field=\"body\" rows=\"6\">" + esc(shownBody) + "</textarea></label>" +
      "<div class=\"row\"><button type=\"button\" data-act=\"studio-save\">Save</button>" +
      "<button type=\"button\" class=\"secondary\" data-act=\"studio-cancel\">Cancel</button></div></div>";
    // Hidden mirror keeps decideDraft + smoke working when the editor is closed.
    var mirror = st.editing ? "" : "<div hidden><input data-field=\"subject\" value=\"" + esc(d.subject || "") +
      "\" /><textarea data-field=\"body\">" + esc(shownBody) + "</textarea></div>";
    var ev = (st.evidence[d.prospectId] && st.evidence[d.prospectId].evidence) || [];
    var fact = ev[0];
    var hypothesis = (p && p.hypothesis) || tidyProse(stripVerdict(p && p.rationale)) ||
      "The research flagged no separate hypothesis.";
    var statusLine = verdictHuman(p && p.verdict);
    var why = "<div class=\"card why\"><p class=\"kicker kicker-dim\">Why this message</p>" +
      "<div class=\"why-row\"><h4 class=\"why-fact\">A fact we found</h4>" +
      (fact ? "<p>" + esc(tidyProse(fact.quote)) + "</p><p class=\"muted small\">" +
        sourceLink(fact.source, sourceLabel(fact.source)) + "</p>"
        : "<p class=\"muted\">No linked evidence for this draft.</p>") + "</div>" +
      "<div class=\"why-row\"><h4 class=\"why-hyp\">Our hypothesis, not confirmed</h4><p>" + esc(hypothesis) + "</p>" +
      (statusLine ? "<p class=\"status-chip\">" + esc(statusLine) + "</p>" : "") + "</div>" +
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
      n + " words. " + esc(wordGuidance(n, st.tab)) + "</p><div class=\"chips tone-row\" id=\"studio-tones\">" + tones + "</div></div>" +
      "<div class=\"card sender-card\"><p>" + esc(STUDIO_SENDER[st.tab]) + " Every message includes a way to opt out.</p>" +
      "<button type=\"button\" class=\"link-gold\" data-act=\"studio-sender\">Change sender</button></div>" +
      studioSendHtml(d, p, st) +
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
    var st = state.studio;
    var d = st && state.drafts.filter(function (x) { return x.prospectId === prospectId; })[0];
    var primary = d ? studioTabFor(d.channel) : null;
    var isVariantEdit = d && st.tab && st.tab !== primary && d.variants;
    if (act === "save-edit") {
      state.decisions[prospectId] = { decision: decision === "pending" ? (state.decisions[prospectId] ? state.decisions[prospectId].decision : "pending") : decision, body: subject + "\n\n" + body };
    }
    var payload = subject + "\n\n" + body;
    var args = [prospectId, decision === "pending" ? "edited" : decision, payload];
    if (api.mode === "live") {
      var dref = d || {};
      if (isVariantEdit) {
        args = [dref.id, decision === "pending" ? "edited" : decision,
          { variant: st.tab, variant_body: body, edited: true }];
      } else {
        args = [dref.id, decision === "pending" ? "edited" : decision,
          { subject: subject, body: body, edited: subject !== (dref.subject || "") || body !== (dref.body || "") }];
      }
    }
    return api.decideDraft(args[0], args[1], args[2]).then(function () {
      if (isVariantEdit && d) {
        d.variants[st.tab] = body; // local echo of the stored variant
      }
      var prev = state.decisions[prospectId];
      state.decisions[prospectId] = { decision: act === "save-edit" ? (prev ? prev.decision : "pending") : decision, body: payload };
      var badge = divEl.querySelector(".decision");
      if (badge) {
        badge.textContent = "[" + state.decisions[prospectId].decision + "]";
        badge.className = "decision " + state.decisions[prospectId].decision;
      }
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
      approved: "No approved drafts yet. Open Messages and approve one — it lands here.",
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
      div.setAttribute("data-col", c.key);
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
        return "<li><button type=\"button\" class=\"board-item\" data-act=\"open-draft\" data-id=\"" + esc(d.prospectId) + "\">" +
          esc(p ? p.name : d.prospectId) + "</button>" + esc(suffix) + "</li>";
      });
      if (!names.length) names = [emptyCopy(c.key)];
      div.innerHTML = "<h3>" + esc(c.title) + "</h3><ul>" + names.join("") + "</ul>";
      board.appendChild(div);
    });
    showView("status");
  }

  // Campaign states, in the owner's words. Raw provider words ("complete",
  // "queued", "accepted") never reach the screen.
  var CAMPAIGN_STATE = {
    complete: "Went out", completed: "Went out", scheduled: "Scheduled",
    sending: "Going out now", failed: "Failed", error: "Failed"
  };
  var RECIPIENT_STATE = {
    sent: "sent", accepted: "sent", delivered: "sent",
    queued: "waiting", scheduled: "waiting",
    failed: "failed", error: "failed", bounced: "failed"
  };

  function humanCampaignStat(key, value) {
    if (typeof value !== "number") {
      // e.g. stats.error = "provider smtp unavailable" — a message, not a count.
      return key === "error" ? "the mail provider was unreachable" : String(value);
    }
    var label = { sent: "sent", accepted: "sent", queued: "waiting", failed: "failed" }[key] || key;
    return value + " " + label;
  }

  function renderCampaigns(board) {
    return api.getCampaigns().then(function (res) {
      var div = document.createElement("div");
      div.className = "campaigns";
      var list = res.campaigns || [];
      if (!list.length) {
        div.innerHTML = "<h3>Email sends</h3><p class=\"hint\">No sends yet. Approve messages, then schedule a send.</p>";
      } else {
        div.innerHTML = "<h3>Email sends</h3>" + list.map(function (c) {
          var recs = (c.recipients || []).map(function (r) {
            return "<li>" + esc(r.email) + " — " + esc(RECIPIENT_STATE[r.status] || r.status) + "</li>";
          }).join("");
          var stats = c.stats && Object.keys(c.stats).length
            ? " · " + esc(Object.keys(c.stats).map(function (k) { return humanCampaignStat(k, c.stats[k]); }).join(", ")) : "";
          // Times in the owner's clock, never ISO strings; internal ids
          // never reach the screen.
          var when = "";
          if (c.scheduled_at_utc) {
            var past = true;
            try { past = new Date(c.scheduled_at_utc).getTime() <= Date.now(); } catch (e) { /* assume sent */ }
            when = " · " + (past ? "Sent " : "Sends ") + esc(cleanTime(c.scheduled_at_utc));
          }
          var cancel = (c.status === "scheduled" || c.status === "sending")
            ? " <button type=\"button\" class=\"secondary\" data-act=\"cancel-campaign\" data-id=\"" + esc(c.id) + "\">Cancel</button>" : "";
          return "<div class=\"campaign\"><h4>" + esc(c.name) + ". " + esc(CAMPAIGN_STATE[c.status] || c.status) + "</h4>" +
            "<p class=\"meta\">" + when + stats + "</p><ul>" + recs + "</ul>" + cancel + "</div>";
        }).join("");
      }
      board.appendChild(div);
    }, function () { /* sends are best-effort */ });
  }

  function onBoardClick(e) {
    var t = e.target || {};
    var ds = t.dataset || {};
    if (ds.act === "new-campaign") { renderCampaignView(); return; }
    if (ds.act === "open-draft" && ds.id) { openDraftFor(ds.id); return; }
    if (ds.act !== "cancel-campaign" || !ds.id) return;
    api.cancelCampaign(ds.id).then(function () { renderStatuses(); });
  }

  // A board item is a door: it opens that lead's message in the studio,
  // focused on the exact draft (user request 2026-11-02).
  function openDraftFor(prospectId) {
    var focus = function () {
      var st = state.studio;
      if (st && st.list && st.list.length) {
        var idx = -1;
        for (var i = 0; i < st.list.length; i++) {
          if (st.list[i].prospectId === prospectId) { idx = i; break; }
        }
        if (idx >= 0) { st.idx = idx; st.editing = false; st.tab = null; renderStudioInner(); }
      }
      showView("drafts");
    };
    if (state.drafts.length && state.studio && state.studio.list && state.studio.list.length) {
      focus(); // the studio is already built this session: no refetch flicker
      return;
    }
    renderDrafts().then(focus, focus);
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

  // The current campaign card: the run IS the campaign (the owner's model:
  // it starts the moment the business is described and stays resumable).
  var currentCampaignRun = null;

  function renderCampaignCard() {
    var wrap = $("campaign-card");
    if (!wrap) return Promise.resolve();
    if (!api.getLatestRun) { wrap.hidden = true; return Promise.resolve(); }
    return api.getLatestRun().then(function (res) {
      var run = res && res.run;
      if (!run) { wrap.hidden = true; return; }
      currentCampaignRun = run;
      var midRun = ["discovering", "investigating", "assessing", "drafting"].indexOf(run.status) >= 0;
      var act = (midRun || run.status === "failed") ? "resume-run" : "open-messages";
      var label = run.status === "failed" ? "Retry research"
        : midRun ? "Continue research" : "Open messages";
      var started = run.started_at ? " · Started " + esc(cleanTime(run.started_at)) : "";
      wrap.hidden = false;
      wrap.innerHTML =
        "<div class=\"campaign-card\">" +
        "<p class=\"kicker\">Current campaign</p>" +
        "<h3>" + esc(run.profile_name || "Your business") + "</h3>" +
        "<p class=\"meta\">" + esc(resumeStatusText(run)) + started + "</p>" +
        "<div class=\"row\"><button type=\"button\" data-act=\"" + act + "\">" + esc(label) + "</button>" +
        "<button type=\"button\" class=\"secondary\" data-act=\"go-onboard\">Start another campaign</button></div>" +
        "</div>";
    }, function () { /* the card is best-effort; the wizard still renders */ });
  }

  function onCampaignCardClick(e) {
    var t = e.target || {};
    var ds = t.dataset || {};
    if (!ds.act) return;
    if (ds.act === "open-messages") {
      if (currentCampaignRun) {
        state.runId = currentCampaignRun.id;
        state.profile = { id: currentCampaignRun.profile_id, name: currentCampaignRun.profile_name || "" };
      }
      renderDrafts();
      return;
    }
    if (ds.act === "resume-run") {
      if (currentCampaignRun) {
        state.runId = currentCampaignRun.id;
        state.profile = { id: currentCampaignRun.profile_id, name: currentCampaignRun.profile_name || "" };
      }
      showView("progress");
      pollProgress();
      return;
    }
    if (ds.act === "go-onboard") { showView("onboard"); obFirstPhase(); }
  }

  function renderCampaignView() {
    showView("campaigns");
    var wiz = $("campaign-wizard");
    wiz.innerHTML = "<p class=\"hint\">Loading…</p>";
    wiz.onclick = onWizardClick;
    renderCampaignCard();
    var monitor = $("sends-monitor");
    if (monitor) renderCampaigns(monitor);
    if (!state.runId) {
      wiz.innerHTML = "<p>No campaign yet. Describe your business to start your first one.</p>" +
        "<div class=\"row\"><button type=\"button\" data-act=\"go-onboard\">Start a campaign</button></div>";
      return;
    }
    // The send scheduler needs approved messages first: say where the work
    // actually stands instead of a dead end (user report 2026-11-02).
    api.getDrafts(state.runId).then(function (res) {
      var drafts = res.drafts || [];
      var approved = drafts.filter(function (d) { return d.status === "approved"; });
      if (!approved.length) {
        var waiting = drafts.length;
        wiz.innerHTML = waiting
          ? "<p>This campaign has " + waiting + " message" + (waiting === 1 ? "" : "s") +
            " waiting for your review. Approve them in Messages, then come back here to schedule a send.</p>" +
            "<div class=\"row\"><button type=\"button\" data-act=\"go-drafts\">Open messages</button></div>"
          : "<p>Nothing qualified for messages in this campaign yet.</p>";
        return;
      }
      return api.listConnections().then(function (creds) {
        var conns = (creds.connections || []).filter(function (c) { return c.status === "connected"; });
        if (!conns.length) {
          wiz.innerHTML = "<p>No verified email account yet. Connect one first, then come back.</p>" +
            "<div class=\"row\"><button type=\"button\" data-act=\"go-senders\">Connect an email account</button></div>";
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
            "<label>Send from <select data-field=\"cmp-sender\">" + opts + "</select></label>" +
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
          esc(cleanTime(ok.scheduled_at_utc || scheduled)) + ". Watch it under Email sends on this page.</p>" +
          "<div class=\"row\"><button type=\"button\" data-act=\"go-campaigns\">Refresh campaigns</button>" +
          "<button type=\"button\" class=\"secondary\" data-act=\"go-landing\">Describe another business</button></div>";
      }, function (e) {
        wiz.innerHTML = "<p>Could not schedule: " + esc((e && e.message) || e) + "</p>";
      });
  }

  function onWizardClick(e) {
    var t = e.target || {};
    var ds = t.dataset || {};
    if (ds.act === "create-campaign") submitCampaign();
    if (ds.act === "go-senders") renderSendersView("campaigns");
    if (ds.act === "go-status") renderStatuses();
    if (ds.act === "go-campaigns") renderCampaignView();
    if (ds.act === "go-drafts") renderDrafts();
    if (ds.act === "go-onboard") { showView("onboard"); obFirstPhase(); }
    if (ds.act === "go-landing") restartToLanding();
  }

  function stopRunAndEdit() {
    if (!state.runId) { showView("profile"); return; }
    api.stopRun(state.runId).then(function () {
      showView("profile");
    }, function (e) {
      var perr = $("progress-error");
      perr.textContent = isNetworkError(e) ? NETWORK_MSG : "We could not stop the research. Please try again.";
      perr.hidden = false;
    });
  }

  function restart() {
    // Invalidate in-flight polls/snapshots from the old run before clearing.
    progressSeq += 1;
    state.profile = null; state.prospects = []; state.selectedId = null;
    state.drafts = []; state.decisions = {}; state.runId = null;
    ob = null;
    obFirstPhase();
    showView("onboard");
  }

  /** Landing navigation: clear the session and return to the front door
   * (the owner's "describe another business" path from anywhere). */
  function restartToLanding() {
    progressSeq += 1;
    state.profile = null; state.prospects = []; state.selectedId = null;
    state.drafts = []; state.decisions = {}; state.runId = null;
    ob = null;
    showView("landing");
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

  /* Landing animations from landing.html: type the WhatsApp draft, flip to
   * approved, loop; reveal sections on scroll. Disabled for reduced motion. */
  function initLandingAnim() {
    var reduce = false;
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { /* keep defaults */ }
    var typed = $("l-typed");
    if (typed) {
      var full = typed.getAttribute("data-text") || "";
      var status = $("l-status");
      var statusText = $("l-status-text");
      var pill = $("l-status-pill");
      var setApproved = function () {
        if (status) status.classList.add("ok");
        if (statusText) statusText.textContent = "Approved. Ready to send";
        if (pill) pill.textContent = "Done";
      };
      var setWaiting = function () {
        if (status) status.classList.remove("ok");
        if (statusText) statusText.textContent = "Waiting for your approval";
        if (pill) pill.textContent = "Approve";
      };
      if (reduce) { typed.textContent = full; setApproved(); }
      else {
        var run = function () {
          var i = 0;
          setWaiting();
          typed.textContent = "";
          typed.classList.add("typing");
          var t = setInterval(function () {
            i += 1;
            typed.textContent = full.slice(0, i);
            if (i >= full.length) {
              clearInterval(t);
              typed.classList.remove("typing");
              setTimeout(setApproved, 900);
              setTimeout(run, 6200);
            }
          }, 30);
        };
        setTimeout(run, 900);
      }
    }
    var items = document.querySelectorAll(".reveal");
    if (!reduce && "IntersectionObserver" in window && items.length) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { entry.target.classList.add("in"); io.unobserve(entry.target); }
        });
      }, { threshold: 0.15 });
      Array.prototype.forEach.call(items, function (el) { io.observe(el); });
    } else {
      Array.prototype.forEach.call(items, function (el) { el.classList.add("in"); });
    }
  }

  function init() {
    api = (typeof window.ApiLayer !== "undefined") ? window.ApiLayer.selectApi() : null;
    if (!api) throw new Error("ApiLayer failed to load");
    showView("landing");
    Array.prototype.forEach.call(document.querySelectorAll("[data-start]"), function (btn) {
      btn.addEventListener("click", function () {
        // The live product sends email and WhatsApp on the user's behalf, so
        // it starts only from a signed-in session. The demo needs no account.
        if (api.mode === "live" && !me) { goSignin(); return; }
        showView("onboard"); obFirstPhase(); obRestoreDraft();
      });
    });
    // Sign-in state: whoAmI on boot (live), then the header reflects it.
    if (api.whoAmI) {
      api.whoAmI().then(function (user) {
        me = user;
        renderAuthUi();
        maybeOpenDashboard(checkResumableRun());
      });
    }
    renderAuthUi();
    if (api.mode === "live" && typeof window.ApiLayer !== "undefined") {
      window.ApiLayer.onAuthRequired = function () {
        me = null;
        renderAuthUi();
        goSignin("Your session expired. Sign in again to continue.");
      };
    }
    // No accounts in demo: the Sign in link says so honestly. In live mode it
    // navigates to Google (/api/auth/start) without JS.
    var signin = $("link-signin");
    if (signin) signin.addEventListener("click", function (e) {
      if (api.mode === "live") return;
      if (e && e.preventDefault) e.preventDefault();
      var note = $("signin-note");
      note.textContent = "This demo needs no account. The live product signs in with Google before anything can be sent.";
      note.hidden = false;
    });
    var back = $("signin-back");
    if (back) back.addEventListener("click", function () { showView("landing"); });
    wireResumeCard();
    var out = $("btn-signout");
    if (out) out.addEventListener("click", function () {
      if (api.signOut) api.signOut().catch(function () { /* best effort */ });
      me = null;
      renderAuthUi();
      showView("landing");
    });

    // Sidebar navigation (the app's left menu). Dashboard always renders;
    // the other sections need a run (live, signed out: sign in first).
    var sbDash = $("btn-sb-dashboard");
    if (sbDash) sbDash.addEventListener("click", openDashboard);
    var sbMsg = $("btn-sb-messages");
    if (sbMsg) sbMsg.addEventListener("click", function () {
      if (state.runId) { renderDrafts(); return; }
      if (api.mode === "live" && !me) { goSignin(); return; }
      showView("onboard");
      obFirstPhase();
    });
    var sbCmp = $("btn-sb-campaigns");
    if (sbCmp) sbCmp.addEventListener("click", function () {
      if (api.mode === "live" && !me) { goSignin(); return; }
      renderCampaignView();
    });
    var sbSnd = $("btn-sb-senders");
    if (sbSnd) sbSnd.addEventListener("click", function () {
      if (api.mode === "live" && !me) { goSignin(); return; }
      renderSendersView();
    });
    var landingDashBtn = $("link-dash");
    if (landingDashBtn) landingDashBtn.addEventListener("click", openDashboard);
    var campCard = $("campaign-card");
    if (campCard) campCard.addEventListener("click", onCampaignCardClick);

    $("btn-ob-back").addEventListener("click", function () { showView("landing"); });
    $("btn-ob-example").addEventListener("click", function () {
      var box = $("f-description");
      box.value = OB_EXAMPLE;
      if (box.focus) box.focus();
    });
    setupVoice();
    initLandingAnim();
    var stepNav = $("step-nav");
    if (stepNav) {
      stepNav.addEventListener("click", function (e) {
        var li = e.target && e.target.closest ? e.target.closest("li[data-view]") : null;
        if (!li) return;
        var v = li.getAttribute("data-view");
        // The step rail is the dashboard nav (user request 2026-11-02: "how
        // do I navigate to my dashboard"). Jump to any stage the app can
        // render right now; stages without data fall back sensibly.
        if (v === "status") { renderStatuses(); return; }
        if (v === "campaigns") { renderCampaignView(); return; }
        if (v === "senders") { renderSendersView("status"); return; }
        if (v === "drafts") { if (state.runId) renderDrafts(); return; }
        if (v === "shortlist") { if (state.prospects.length) showView("shortlist"); return; }
        if (v === "progress") { if (state.runId) { showView("progress"); pollProgress(); } return; }
        if (v === "profile") { if (state.profile) { showView("profile"); return; } }
        if (v === "onboard") { if (!state.runId) { showView("onboard"); obFirstPhase(); } return; }
        if (v === "landing") showView("landing");
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
    $("btn-ob-retry").addEventListener("click", obRetry);
    $("btn-ob-exit").addEventListener("click", obSaveExit);
    $("btn-ob-edit-first").addEventListener("click", obEditFirst);
    $("evidence-body").addEventListener("click", onEvidenceClick);
    $("status-board").addEventListener("click", onBoardClick);
    $("btn-back-onboard").addEventListener("click", function () { showView("onboard"); });
    $("btn-preview-progress").addEventListener("click", previewProgress);
    $("btn-stop-progress").addEventListener("click", stopRunAndEdit);
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
    $("btn-back-campaigns").addEventListener("click", function () { showView("drafts"); });
    $("btn-restart").addEventListener("click", restart);
    $("btn-restart-progress").addEventListener("click", restart);
    $("btn-retry-progress").addEventListener("click", pollProgress);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { VIEWS: VIEWS, showView: showView, submitOnboard: submitOnboard, confirmBriefAndRun: confirmBriefAndRun, pollProgress: pollProgress, renderShortlist: renderShortlist, selectProspect: selectProspect, renderDrafts: renderDrafts, decideDraft: decideDraft, renderStatuses: renderStatuses, restart: restart, waNumber: waNumber, waUrl: waUrl, waWarning: waWarning, personalize: personalize, waApp: waApp, tidyProse: tidyProse, verdictHuman: verdictHuman, cleanCitations: cleanCitations };
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})();
