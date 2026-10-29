/* api.js — API contract layer.
 * MockApi: realistic S-0-derived demo data (Ikeja prospects, evidence, drafts).
 * RealApi: fetch() stubs against Worker routes (specs/architecture.md §4).
 * Selection: default mock; ?live=1 selects RealApi.
 */
(function (global) {
  "use strict";

  var DEMO_PROSPECTS = [
    { id: "p01", name: "Brightline Logistics Ltd", area: "Ikeja GRA", category: "Logistics", score: 87,
      summary: "45 staff, weekday lunch rota, admin orders catering weekly.",
      evidence: [
        { quote: "Our Ikeja office runs a weekday lunch rota for about 45 staff.", source: "brightline.ng/about", type: "site" },
        { quote: "Office admin requests catering vendors every Monday.", source: "web search: Brightline Ikeja catering", type: "search" }
      ] },
    { id: "p02", name: "Kingsway Tech Hub", area: "Ikeja Allen", category: "Coworking", score: 83,
      summary: "200 members, daily lunch vendor slots, paid by hub.",
      evidence: [
        { quote: "Food vendors serve members daily; hub pays weekly.", source: "kingswayhub.com/membership", type: "site" },
        { quote: "Listed among Allen Avenue hubs with in-house lunch service.", source: "web search: Kingsway Tech Hub lunch", type: "search" }
      ] },
    { id: "p03", name: "St. Raphael Clinic", area: "Ikeja Opebi", category: "Healthcare", score: 79,
      summary: "60 staff across shifts, patient meals outsourced.",
      evidence: [
        { quote: "Shift meal provision for 60 clinical and admin staff.", source: "straphael-ikeja.ng/careers", type: "site" },
        { quote: "Patient catering tender reissued yearly.", source: "web search: St Raphael Ikeja catering tender", type: "search" }
      ] },
    { id: "p04", name: "Coral Schools Ikeja", area: "Ikeja Ogba", category: "Education", score: 76,
      summary: "800 pupils, term-time lunch contract, decision by bursar.",
      evidence: [
        { quote: "Term-time lunch programme for 800 pupils.", source: "coralschools.ng/admissions", type: "site" },
        { quote: "Bursar invites lunch vendors each term.", source: "web search: Coral Schools lunch vendor", type: "search" }
      ] },
    { id: "p05", name: "Northgate Bank Branch", area: "Ikeja Computer Village", category: "Banking", score: 72,
      summary: "Branch events monthly, approved vendor list via HR.",
      evidence: [
        { quote: "Monthly branch events with outside catering.", source: "northgatebank.ng/branch-events", type: "site" },
        { quote: "HR manages an approved vendor list.", source: "web search: Northgate Ikeja vendor list", type: "search" }
      ] },
    { id: "p06", name: "FitLife Gym Ikeja", area: "Ikeja Adeniyi Jones", category: "Fitness", score: 68,
      summary: "Meal-plan partners wanted for 300 members.",
      evidence: [
        { quote: "Seeking healthy meal partners for members.", source: "fitlifeikeja.ng/notice", type: "site" },
        { quote: "Gym cafes in Adeniyi Jones outsource food prep.", source: "web search: FitLife gym meals", type: "search" }
      ] }
  ];

  function demoDraftFor(p) {
    return {
      id: "dd-" + p.id,
      prospectId: p.id,
      subject: "Weekday lunches for " + p.name,
      body: "Hello " + p.name + " team,\n\nWe deliver office lunch packs around " + p.area +
        " before noon, 20–200 portions. Could we run a one-week trial for your team?\n\n— Adaeze Catering Services\n0803 000 1234",
      status: "pending"
    };
  }

  function MockApi() {}
  MockApi.prototype.mode = "mock";
  MockApi.prototype.createProfile = function (input) {
    var profile = {
      id: "demo-profile-1",
      businessName: input.businessName,
      site: input.site || "",
      description: input.description,
      answers: [input.q1, input.q2, input.q3, input.q4, input.q5],
      fields: [
        { key: "Business", value: input.businessName, provenance: "stated" },
        { key: "Offer", value: input.description, provenance: "stated" },
        { key: "Service area", value: input.q1 || "Ikeja and environs (assumed — please edit)", provenance: input.q1 ? "stated" : "assumed" },
        { key: "Buyer", value: input.q3 || "Office admin / HR manager (assumed — please edit)", provenance: input.q3 ? "stated" : "assumed" },
        { key: "Site headline", value: input.site ? "Checked " + input.site + " — catering page found" : "No site given — using your description only", provenance: input.site ? "extracted" : "assumed" }
      ]
    };
    return Promise.resolve({ profile: profile });
  };
  MockApi.prototype.confirmBrief = function () {
    return Promise.resolve({ briefId: "demo-brief-1", runId: "demo-run-1" });
  };
  MockApi.prototype.runProgress = function (runId, onTick) {
    var steps = ["Planning search", "Discovering candidates", "Checking business sites", "Scoring fit", "Writing drafts"];
    var i = 0;
    return new Promise(function (resolve) {
      var timer = setInterval(function () {
        i += 1;
        onTick({ done: i, total: steps.length, steps: steps, searches: Math.min(6 * i, 28), fetches: Math.min(7 * i, 33) });
        if (i >= steps.length) { clearInterval(timer); resolve({ runId: "demo-run-1", status: "complete" }); }
      }, 350);
    });
  };
  MockApi.prototype.getShortlist = function () {
    return Promise.resolve({ prospects: DEMO_PROSPECTS.slice() });
  };
  MockApi.prototype.getEvidence = function (prospectId) {
    var found = DEMO_PROSPECTS.filter(function (p) { return p.id === prospectId; })[0] || DEMO_PROSPECTS[0];
    return Promise.resolve({ prospect: found, evidence: found.evidence });
  };
  MockApi.prototype.getDrafts = function () {
    return Promise.resolve({ drafts: DEMO_PROSPECTS.slice(0, 4).map(demoDraftFor) });
  };
  MockApi.prototype.decideDraft = function (prospectId, decision, editedBody) {
    return Promise.resolve({ prospectId: prospectId, decision: decision, body: editedBody || null });
  };
  MockApi.prototype.getCampaigns = function () {
    return Promise.resolve({ campaigns: [{
      id: "demo-cmp-1", name: "Ikeja offices — week 1", status: "scheduled",
      scheduled_at_utc: new Date(Date.now() + 3600000).toISOString(), timezone: "Africa/Lagos",
      stats: {}, recipients: [
        { email: "admin@brightline.ng", status: "queued" },
        { email: "hr@kingswayhub.ng", status: "queued" }
      ]
    }] });
  };
  MockApi.prototype.cancelCampaign = function () { return Promise.resolve({ status: "cancelled" }); };
  MockApi.prototype.getTimeline = function () {
    return Promise.resolve({ timeline: [
      { kind: "activity", at: new Date(Date.now() - 7200000).toISOString(), event: "shortlisted", note: "rank 1 of 6" },
      { kind: "contact", at: new Date(Date.now() - 3600000).toISOString(), channel: "whatsapp", direction: "outbound", note: "Sent intro + menu (demo)" }
    ] });
  };
  MockApi.prototype.logContact = function (prospectId, payload) {
    return Promise.resolve({ id: "demo-ce-1", prospect_id: prospectId, channel: payload.channel, note: payload.note || null });
  };
  MockApi.prototype.listConnections = function () {
    return Promise.resolve({ connections: [
      { id: "demo-conn-1", provider: "mock", label: "Demo sender", sender_email: "sender@example.ng", status: "connected" }
    ] });
  };
  MockApi.prototype.getProspectDetail = function (id) {
    var self = this;
    return Promise.all([self.getShortlist(), self.getDrafts()]).then(function (res) {
      var prospects = res[0].prospects || [];
      var p = prospects.filter(function (x) { return x.id === id; })[0] || prospects[0];
      var drafts = res[1].drafts || [];
      var d = drafts.filter(function (x) { return x.prospectId === p.id; })[0] || drafts[0] || {};
      return { prospect: p, routes: [{ channel: "email", value: "demo-" + p.id + "@example.ng" }], draft: d.draft || d };
    });
  };
  MockApi.prototype.createCampaign = function (payload) {
    return Promise.resolve({ id: "demo-cmp-new", status: "draft", name: payload.name, recipients: payload.recipients });
  };
  MockApi.prototype.approveCampaign = function (id, payload) {
    return Promise.resolve({ id: id, status: "scheduled", scheduled_at_utc: payload.scheduled_at_utc });
  };

  /* RealApi — live Worker routes with UI-shape adapters. */
  function RealApi(base) { this.base = base || ""; this._evCache = {}; }
  RealApi.prototype.mode = "live";
  RealApi.prototype._req = function (path, opts) {
    return fetch(this.base + path, Object.assign({ headers: { "content-type": "application/json" } }, opts || {}))
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  };

  function profileFields(row) {
    var prov = row.provenance || {};
    var sa = (row.service_area && typeof row.service_area === "object") ? row.service_area : {};
    var cons = (row.constraints && typeof row.constraints === "object") ? row.constraints : {};
    var str = function (v) { return v == null ? "" : String(v); };
    var mk = function (label, value, pkey, backend) {
      return { key: label, value: str(value), provenance: prov[pkey] || "assumed", backend: backend };
    };
    return [
      mk("Business", row.name, "name", "name"),
      mk("Website", row.website_url, "website_url", "website_url"),
      mk("Offer", row.description, "description", "description"),
      mk("Service area", sa.note, "service_area", "service_area.note"),
      mk("Buyer", row.target_market, "target_market", "target_market"),
      mk("Order size", cons.order_size, "constraints", "constraints.order_size"),
      mk("Exclusions", cons.exclusions, "constraints", "constraints.exclusions")
    ];
  }

  RealApi.prototype.createProfile = function (input) {
    var buyer = [input.q3, input.q5].filter(function (s) { return !!s; }).join(" | ");
    var payload = { name: input.businessName, description: input.description };
    if (input.site) payload.website_url = input.site;
    if (buyer) payload.target_market = buyer;
    if (input.q1) payload.service_area = { note: input.q1 };
    var cons = {};
    if (input.q2) cons.order_size = input.q2;
    if (input.q4) cons.exclusions = input.q4;
    if (Object.keys(cons).length) payload.constraints = cons;
    return this._req("/api/profiles", { method: "POST", body: JSON.stringify(payload) })
      .then(function (row) {
        return { profile: { id: row.id, businessName: row.name, fields: profileFields(row) } };
      });
  };

  RealApi.prototype.confirmBrief = function (profile) {
    var self = this;
    var answers = {};
    (profile.fields || []).forEach(function (f) {
      if (!f.backend) return;
      if (f.provenance !== "stated" && (f.value === "" || f.value == null)) return;
      var parts = String(f.backend).split(".");
      if (parts.length === 2) {
        answers[parts[0]] = answers[parts[0]] || {};
        answers[parts[0]][parts[1]] = f.value;
      } else {
        answers[f.backend] = f.value;
      }
    });
    var id = profile.id;
    var chain = Object.keys(answers).length > 0
      ? self._req("/api/profiles/" + encodeURIComponent(id) + "/answers", { method: "POST", body: JSON.stringify({ answers: answers }) })
      : Promise.resolve(null);
    return chain
      .then(function () { return self._req("/api/profiles/" + encodeURIComponent(id) + "/confirm", { method: "POST", body: "{}" }); })
      .then(function () { return self._req("/api/runs", { method: "POST", body: JSON.stringify({ profile_id: id }) }); })
      .then(function (run) {
        // Production: the Workflow owns execution and the start-route answers
        // 501 use_workflow. Treat that as "already running" and poll the run.
        return self._req("/api/runs/" + encodeURIComponent(run.id) + "/start", { method: "POST", body: "{}" })
          .then(function (started) { return { briefId: id, runId: started.id }; },
            function (err) {
              if (err && err.message === "HTTP 501") return { briefId: id, runId: run.id };
              throw err;
            });
      });
  };

  var PROGRESS_STEPS = ["Planning search", "Discovering candidates", "Checking business sites", "Scoring fit", "Writing drafts"];
  var PROGRESS_DONE = { created: 0, discovering: 1, investigating: 2, assessing: 3, drafting: 4, awaiting_approval: 5, complete: 5, stopped: 5, failed: 5 };
  var PROGRESS_TERMINAL = { awaiting_approval: 1, complete: 1, stopped: 1, failed: 1 };

  RealApi.prototype.runProgress = function (runId, onTick) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var timer = null;
      var poll = function () {
        self._req("/api/runs/" + encodeURIComponent(runId)).then(function (run) {
          var done = PROGRESS_DONE[run.status] == null ? 0 : PROGRESS_DONE[run.status];
          onTick({ done: done, total: PROGRESS_STEPS.length, steps: PROGRESS_STEPS, live: true });
          if (PROGRESS_TERMINAL[run.status]) {
            if (timer) clearInterval(timer);
            if (run.status === "failed") reject(new Error(run.stop_reason || "research failed"));
            else resolve({ runId: run.id, status: run.status });
          }
        }, function (err) {
          if (timer) clearInterval(timer);
          reject(err);
        });
      };
      poll();
      timer = setInterval(poll, 1500);
    });
  };

  RealApi.prototype.getShortlist = function (runId) {
    var self = this;
    return self._req("/api/runs/" + encodeURIComponent(runId) + "/prospects").then(function (res) {
      var list = res.prospects || [];
      return Promise.all(list.map(function (p) { return self.getEvidence(p.id); })).then(function (details) {
        var out = list.map(function (p, i) {
          var asmt = details[i].assessments && details[i].assessments[0];
          var rating = asmt ? asmt.fit_rating : 0;
          var loc = p.location || {};
          return {
            id: p.id, name: p.name,
            area: loc.area || loc.note || loc.city || "Area unconfirmed",
            category: p.category || "unclassified",
            score: rating ? rating * 20 : 0,
            summary: asmt && asmt.rationale ? String(asmt.rationale).slice(0, 140) : "Not scored yet — thin evidence.",
            status: p.status
          };
        });
        out.sort(function (a, b) { return b.score - a.score || (a.name < b.name ? -1 : 1); });
        return { prospects: out };
      });
    });
  };

  RealApi.prototype.getEvidence = function (prospectId) {
    var self = this;
    if (self._evCache[prospectId]) return Promise.resolve(self._evCache[prospectId]);
    return self._req("/api/prospects/" + encodeURIComponent(prospectId)).then(function (res) {
      var mapped = {
        prospect: { id: res.prospect.id, name: res.prospect.name },
        assessments: res.assessments || [],
        evidence: (res.evidence || []).map(function (e) {
          return { quote: e.quote, source: e.source_url || "model inference", type: e.source_type };
        })
      };
      self._evCache[prospectId] = mapped;
      return mapped;
    });
  };

  RealApi.prototype.getDrafts = function (runId) {
    return this._req("/api/runs/" + encodeURIComponent(runId) + "/drafts").then(function (res) {
      return {
        drafts: (res.drafts || []).map(function (d) {
          return { id: d.id, prospectId: d.prospect_id, subject: d.subject || "(no subject)", body: d.body, status: d.status === "draft" ? "pending" : d.status };
        })
      };
    });
  };

  RealApi.prototype.decideDraft = function (draftId, decision, extra) {
    var ex = extra || {};
    if (decision === "edited") {
      if (!ex.edited) return Promise.resolve({ draftId: draftId, decision: decision });
      return this._req("/api/drafts/" + encodeURIComponent(draftId), { method: "PATCH", body: JSON.stringify({ subject: ex.subject, body: ex.body }) })
        .then(function (res) { return { draftId: draftId, decision: decision, draft: res.draft }; });
    }
    var payload = { decision: decision };
    if (ex.edited) { payload.subject = ex.subject; payload.body = ex.body; }
    return this._req("/api/drafts/" + encodeURIComponent(draftId) + "/decision", { method: "POST", body: JSON.stringify(payload) })
      .then(function (res) { return { draftId: draftId, decision: decision, draft: res.draft }; });
  };

  RealApi.prototype.getCampaigns = function () {
    var self = this;
    return self._req("/api/campaigns").then(function (res) {
      var list = res.campaigns || [];
      return Promise.all(list.map(function (c) {
        return self._req("/api/campaigns/" + encodeURIComponent(c.id));
      })).then(function (details) { return { campaigns: details }; });
    });
  };
  RealApi.prototype.cancelCampaign = function (id) {
    return this._req("/api/campaigns/" + encodeURIComponent(id) + "/cancel", { method: "POST", body: "{}" });
  };
  RealApi.prototype.getTimeline = function (prospectId) {
    return this._req("/api/prospects/" + encodeURIComponent(prospectId) + "/timeline");
  };
  RealApi.prototype.logContact = function (prospectId, payload) {
    return this._req("/api/prospects/" + encodeURIComponent(prospectId) + "/contacts",
      { method: "POST", body: JSON.stringify(payload) });
  };

  RealApi.prototype.listConnections = function () {
    return this._req("/api/connections");
  };
  RealApi.prototype.getProspectDetail = function (id) {
    return this._req("/api/prospects/" + encodeURIComponent(id));
  };
  RealApi.prototype.createCampaign = function (payload) {
    return this._req("/api/campaigns", { method: "POST", body: JSON.stringify(payload) });
  };
  RealApi.prototype.approveCampaign = function (id, payload) {
    return this._req("/api/campaigns/" + encodeURIComponent(id) + "/approve",
      { method: "POST", body: JSON.stringify(payload) });
  };

  function selectApi() {
    var live = false;
    try { live = new URLSearchParams(global.location.search).get("live") === "1"; } catch (e) { live = false; }
    return live ? new RealApi("") : new MockApi();
  }

  global.ApiLayer = { MockApi: MockApi, RealApi: RealApi, selectApi: selectApi, DEMO_PROSPECTS: DEMO_PROSPECTS };
})(typeof window !== "undefined" ? window : globalThis);
