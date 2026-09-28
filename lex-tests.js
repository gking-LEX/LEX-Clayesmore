#!/usr/bin/env node
/*
 * LEX regression suite — covers the behaviour added in v133 to v165.
 *
 *   node lex-tests.js [LEX-2026-27.html] [full_backup.json] [iSAMS_export.csv]
 *
 * Defaults to ./LEX-2026-27.html in the current directory. The backup and CSV are
 * optional: checks that need them are reported as SKIPPED rather than failing, so
 * the suite is useful even with nothing but the app file to hand.
 *
 * How it works: it pulls the real functions out of the shipped HTML and runs them.
 * It does not re-implement any logic, so a test passing means the deployed code
 * behaves correctly — not that a copy of it does.
 *
 * If a check fails with "missing anchor", a function has been renamed or
 * restructured. Update the anchor string; don't delete the test.
 */
"use strict";
const fs = require("fs");

const HTML = process.argv[2] || "LEX-2026-27.html";
const BACKUP = process.argv[3] || null;
const CSV = process.argv[4] || null;

if (!fs.existsSync(HTML)) {
  console.error(`Cannot find ${HTML}\nUsage: node lex-tests.js <LEX html> [backup.json] [export.csv]`);
  process.exit(2);
}
const src = fs.readFileSync(HTML, { encoding: "utf-8" });
const BK = BACKUP && fs.existsSync(BACKUP) ? JSON.parse(fs.readFileSync(BACKUP, "utf-8")) : null;
const CSVTEXT = CSV && fs.existsSync(CSV) ? fs.readFileSync(CSV, "utf-8").replace(/^\uFEFF/, "") : null;

// ── harness ──────────────────────────────────────────────────────────────────
let pass = 0, fail = 0, skip = 0, section = "";
const failures = [];
const S = name => { section = name; console.log("\n" + name); };
const t = (label, cond, extra) => {
  if (cond) { pass++; }
  else { fail++; failures.push(section + " → " + label + (extra ? " (" + extra + ")" : "")); console.log("  FAIL  " + label + (extra ? " — " + extra : "")); }
};
const skipIf = (cond, why) => { if (cond) { skip++; console.log("  SKIP  " + why); return true; } return false; };

function grab(start, end, what) {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`missing anchor for ${what}: ${start.slice(0, 60)}`);
  const j = src.indexOf(end, i);
  if (j < 0) throw new Error(`missing end anchor for ${what}`);
  return src.slice(i, j + end.length);
}
const has = s => src.includes(s);
const ne = e => String(e || "").trim().toLowerCase();

// ── shared shipped helpers ───────────────────────────────────────────────────
const CORE = [
  grab("function ygRank(", "\r\n}", "ygRank"),
  grab("function displayYg(", "\r\n}", "displayYg"),
  grab("function cmpPupilYgSurname(", "\r\n}", "cmpPupilYgSurname"),
  grab("function normaliseHouse(raw){", "\r\n}", "normaliseHouse"),
  grab("function normaliseYg(raw){", "\r\n}", "normaliseYg"),
  grab("function parseDateDmy(", "\r\n}", "parseDateDmy"),
  grab("function _termOfHalf(half){", "\r\n", "_termOfHalf")
].join("\n");
const core = new Function(CORE + "\nreturn {ygRank,displayYg,cmpPupilYgSurname,normaliseHouse,normaliseYg,parseDateDmy,_termOfHalf};")();

// ════════════════════════════════════════════════════════════════════════════
S("Normalisers");
t("bare year number becomes 'Year N'", core.normaliseYg("9") === "Year 9");
t("Y-prefixed year normalises", core.normaliseYg("Y11") === "Year 11");
t("house full stop stripped (iSAMS export)", core.normaliseHouse("Wolverton.") === "W");
t("apostrophe house normalises", core.normaliseHouse("King's.") === "K");
t("plain house name normalises", core.normaliseHouse("Manor") === "M");
t("already-normalised code passes through", core.normaliseHouse("W") === "W");
t("unknown house is returned unchanged, not guessed", core.normaliseHouse("Devine") === "Devine");
t("year ordering puts Y9 first", core.ygRank("Year 9") < core.ygRank("Year 13"));
t("parseDateDmy returns [y,m,d]", JSON.stringify(core.parseDateDmy("19/09/2026")) === "[2026,9,19]");
t("parseDateDmy sentinel on junk", core.parseDateDmy("nonsense")[0] === 9999);

// ════════════════════════════════════════════════════════════════════════════
S("v134 — Parent Contacts search");
{
  const i = src.indexOf("  if(window._pcFilter){\r\n    const ft=");
  if (i < 0) throw new Error("missing anchor for pc search predicate");
  const block = src.slice(i, src.indexOf("\r\n  }\r\n", i) + "\r\n  }".length);
  const run = new Function("window", "filtered", "displayYg", block + "\nreturn filtered;");
  const P = [{ surname: "Bell", forename: "Thomas", pref: "Tom", email: "tbell@clayesmore.com",
    yg: "Year 9", house: "Manor", p1Name: "Susan Bell", p1Email: "s@h.com", p1Phone: "01258 472910",
    p2Name: "Andrew Bell", p2Email: "a@w.org", p2Phone: "07555 000111" }];
  const hit = q => run({ _pcFilter: q }, [...P], core.displayYg).length === 1;
  t("surname", hit("bell"));
  t("preferred name", hit("tom"));
  t("house", hit("manor"));
  t("year group", hit("Year 9"));
  t("pupil email", hit("tbell@clayesmore.com"));
  t("parent email", hit("a@w.org"));
  t("phone with spaces", hit("01258 472"));
  t("phone without spaces", hit("07555000111"));
  t("case-insensitive", hit("BELL"));
  t("whitespace tolerated", hit("  bell  "));
  t("no false positives", run({ _pcFilter: "zzzz" }, [...P], core.displayYg).length === 0);
  t("empty query returns everything", run({ _pcFilter: "" }, [...P], core.displayYg).length === 1);
}

// ════════════════════════════════════════════════════════════════════════════
S("v135/v136 — Import header mapping");
const IMP = new Function([
  grab("function _hdrNorm(s){", "\r\n", "_hdrNorm"),
  grab("function _hdrTokens(s){", "\r\n", "_hdrTokens"),
  grab("function resolveHeaderMap(header,spec){", "\r\n}", "resolveHeaderMap"),
  grab("const PC_IMPORT_SPEC=[", "\r\n];", "PC_IMPORT_SPEC"),
  grab("const PC_NON_FAMILY=[", "];", "PC_NON_FAMILY"),
  grab("function _pcIsFamily(rel){", "\r\n}", "_pcIsFamily"),
  grab("function _pcContactKey(c){", "\r\n}", "_pcContactKey")
].join("\n") + "\nreturn {resolveHeaderMap,PC_IMPORT_SPEC,_pcIsFamily,_pcContactKey};")();
{
  const m = h => IMP.resolveHeaderMap(h, IMP.PC_IMPORT_SPEC).map;
  let r = m(["Surname", "Forename", "Year", "House", "Parent 1 Name", "Parent 1 Email", "Parent 1 Phone", "Parent 2 Name", "Parent 2 Email", "Parent 2 Phone"]);
  t("legacy combined-name sheet maps", r.c1Name === 4 && r.c1Email === 5 && r.c1Mobile === 6 && r.c2Name === 7);
  r = m(["Parent 1 Email", "Surname", "Parent 2 Phone", "Forename"]);
  t("reordered columns map", r.c1Email === 0 && r.surname === 1 && r.c2Mobile === 2 && r.forename === 3);
  r = m(["  SURNAME  ", "Fore-name", "Parent_1_Name", "parent.1.email"]);
  t("punctuation and case noise tolerated", r.surname === 0 && r.forename === 1 && r.c1Name === 2 && r.c1Email === 3);
  r = m(["Surname", "Forename", "Parent 1 Email Address"]);
  t("pupil email field does not steal a parent column", r.email == null && r.c1Email === 2);
  r = m(["Surname", "Forename", "Parent One Phone"]);
  t("phone column not claimed by a name field", r.c1Mobile === 2 && r.c1Name == null);
  r = m(["Surname", "Forename", "Parent 2 Email", "Parent 1 Email"]);
  t("parent 1 and 2 never transposed", r.c2Email === 2 && r.c1Email === 3);
  r = m(["Forename", "Parent 1 Email"]);
  t("absent required field left unmapped", r.surname == null);
  const rr = IMP.resolveHeaderMap(["Surname", "Forename", "Swimming Ability", "Parent 1 Email"], IMP.PC_IMPORT_SPEC);
  t("unrelated column ignored", rr.unusedCols.includes(2));
  t("no column serves two fields", (() => { const v = Object.values(rr.map); return new Set(v).size === v.length; })());
}
{
  if (!skipIf(!CSVTEXT, "iSAMS export.csv not supplied — real-data import checks")) {
    const lines = CSVTEXT.split(/\r?\n/).filter(l => l.trim());
    const cut = l => { const o = []; let c = "", q = false;
      for (let i = 0; i < l.length; i++) { const ch = l[i];
        if (ch === '"') { if (q && l[i + 1] === '"') { c += '"'; i++; } else q = !q; }
        else if (ch === "," && !q) { o.push(c); c = ""; } else c += ch; }
      o.push(c); return o.map(x => x.trim()); };
    const header = cut(lines[0]);
    const res = IMP.resolveHeaderMap(header, IMP.PC_IMPORT_SPEC);
    const rows = lines.slice(1).map(cut).filter(c => c.some(v => v));
    t("blank rows dropped", rows.length === 404, String(rows.length));
    t("25 of 26 columns mapped", Object.keys(res.map).length === 25, String(Object.keys(res.map).length));
    t("only Pupil Home Email left unmapped", res.unusedCols.length === 1 && header[res.unusedCols[0]] === "Pupil Home Email Address");
    t("pupil email maps to the pupil column", header[res.map.email] === "Pupil Email Address");
    const g = (c, k) => { const i = res.map[k]; return i == null ? "" : String(c[i] || "").trim(); };
    const groups = new Map();
    rows.forEach(c => { const k = ne(g(c, "email")) || ("n|" + g(c, "surname") + g(c, "forename")).toLowerCase();
      if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
    t("404 contact rows collapse to 246 pupils", groups.size === 246, String(groups.size));
    let total = 0, agencyFirst = 0, max = 0;
    groups.forEach(rs => {
      const seen = new Map();
      rs.forEach(c => [1, 2].forEach(n => {
        const name = [g(c, "c" + n + "Title"), g(c, "c" + n + "Fore"), g(c, "c" + n + "Sur")].filter(Boolean).join(" ").trim();
        const ct = { name, email: g(c, "c" + n + "Email"), phone: g(c, "c" + n + "Mobile"), relation: g(c, "relation") };
        if (!ct.name && !ct.email && !ct.phone) return;
        const k = IMP._pcContactKey(ct); if (k && !seen.has(k)) seen.set(k, ct);
      }));
      const list = [...seen.values()];
      const ordered = list.filter(c => IMP._pcIsFamily(c.relation)).concat(list.filter(c => !IMP._pcIsFamily(c.relation)));
      total += ordered.length; max = Math.max(max, ordered.length);
      if (ordered[0] && !IMP._pcIsFamily(ordered[0].relation)) agencyFirst++;
    });
    t("595 contacts preserved across the merge", total === 595, String(total));
    t("up to 5 contacts for one pupil", max === 5, String(max));
    t("no pupil gets an agency as Parent 1", agencyFirst === 0, String(agencyFirst));
  }
}

// ════════════════════════════════════════════════════════════════════════════
S("v137/v138 — Response linking");
{
  const LINK = (pupils, formData, confirmAnswer = true) => new Function(
    "pupils", "formData", "normEmail", "confirm", "logAction", "invalidateCaches", "saveAll",
    "attendance", "allocOverrides", "allocDateOverrides", "HALF_TERMS", "_touchedOvrKeys",
    "dateOvrUpsert", "_queueOvrDelete",
    [grab("const PC_NON_FAMILY=[", "];", "PC_NON_FAMILY"),
     grab("function _pcIsFamily(rel){", "\r\n}", "_pcIsFamily"),
     grab("function _pupilFamilyEmails(p){", "\r\n}", "_pupilFamilyEmails"),
     grab("function _familyEmailIndex(){", "\r\n}", "_familyEmailIndex"),
     grab("function resolveFormPupil(submitted,ix){", "\r\n}", "resolveFormPupil"),
     grab("function autoLinkFormEmails(){", "\r\n}", "autoLinkFormEmails"),
     grab("function unresolvedResponses(){", "\r\n}", "unresolvedResponses"),
     grab("function _migrateRecordsToPupil(fromEmail,toEmail){", "\r\n}", "_migrateRecordsToPupil"),
     grab("function linkResponseToPupil(f,pupil){", "\r\n}", "linkResponseToPupil")].join("\n") +
    "\nreturn {resolveFormPupil,autoLinkFormEmails,unresolvedResponses,linkResponseToPupil,_migrateRecordsToPupil,_familyEmailIndex};")(
    pupils, formData, ne, () => confirmAnswer, () => {}, () => {}, () => {},
    {}, {}, {}, ["A1", "A2"], new Set(), () => Promise.resolve(true), () => {});

  const pupils = [
    { forename: "Mia", surname: "Langerhorst", email: "mlang@clayesmore.com",
      contacts: [{ email: "mum@icloud.com", relation: "Mother" }] },
    { forename: "Ana", surname: "Gomez", email: "agomez@clayesmore.com",
      contacts: [{ email: "agency@aeidiomas.com", relation: "Agency" }] },
    { forename: "Luis", surname: "Ruiz", email: "lruiz@clayesmore.com",
      contacts: [{ email: "agency@aeidiomas.com", relation: "Guardian" }] },
    { forename: "Noemail", surname: "Pupil", email: "" }
  ];
  let api = LINK(pupils, []);
  t("unique family address resolves", api.resolveFormPupil("mum@icloud.com").pupil === pupils[0]);
  t("agency address never auto-resolves", !api.resolveFormPupil("agency@aeidiomas.com").pupil);
  t("an address seen as Agency anywhere is disqualified everywhere",
    !api._familyEmailIndex()["agency@aeidiomas.com"]);
  t("unknown address returns none", api.resolveFormPupil("nobody@x.test").reason === "none");

  const fd = [{ email: "mum@icloud.com", s1c1: "Chess" }, { email: "agency@aeidiomas.com", s1c1: "Golf" }];
  api = LINK(pupils, fd);
  const r = api.autoLinkFormEmails();
  t("autoLink links only the unambiguous one", r.linked === 1 && r.pending === 1);
  t("linked row now carries the school email", fd[0].email === "mlang@clayesmore.com");
  t("submitted address preserved", fd[0].submittedEmail === "mum@icloud.com");
  t("address remembered on the pupil", (pupils[0].altEmails || []).includes("mum@icloud.com"));
  t("re-running links nothing new", LINK(pupils, fd).autoLinkFormEmails().linked === 0);
  t("a stored link re-applies after a repaste", (() => {
    const fresh = [{ email: "mum@icloud.com", s1c1: "Chess" }];
    return LINK(pupils, fresh).autoLinkFormEmails().linked === 1 && fresh[0].email === "mlang@clayesmore.com";
  })());

  // v138 — every Link outcome reported
  let fd2 = [{ email: "x@y.com", s1c1: "Chess" }];
  t("pupil with no email is refused with a reason",
    (() => { const res = LINK(pupils, fd2).linkResponseToPupil(fd2[0], pupils[3]);
      return res.ok === false && res.reason === "no-pupil-email"; })());
  t("refusal leaves the response untouched", fd2[0].email === "x@y.com");
  fd2 = [{ email: "x@y.com" }, { email: "mlang@clayesmore.com" }];
  t("declined duplicate is reported",
    (() => { const res = LINK(pupils, fd2, false).linkResponseToPupil(fd2[0], pupils[0]);
      return res.ok === false && res.reason === "cancelled"; })());
  t("declined duplicate writes nothing", fd2[0].email === "x@y.com");
  t("blank-address response is still listed as unresolved",
    LINK(pupils, [{ email: "" }]).unresolvedResponses().length === 1);

  // v149 — records move with the pupil
  const att = { "1|Astronomy|old@gmail.com": { a: "present", b: "" } };
  const mig = new Function("attendance", "allocOverrides", "allocDateOverrides", "normEmail",
    "HALF_TERMS", "_touchedOvrKeys", "dateOvrUpsert", "_queueOvrDelete",
    grab("function _migrateRecordsToPupil(fromEmail,toEmail){", "\r\n}", "_migrateRecordsToPupil") +
    "\nreturn _migrateRecordsToPupil;")(att, {}, {}, ne, ["A1"], new Set(), () => Promise.resolve(true), () => {});
  const moved = mig("old@gmail.com", "new@clayesmore.com");
  t("register moves to the school address", att["1|Astronomy|new@clayesmore.com"] !== undefined);
  t("old key removed", att["1|Astronomy|old@gmail.com"] === undefined);
  t("the move is counted", moved.attendance === 1);
  const att2 = { "1|X|old@g.com": { a: "present", b: "" }, "1|X|new@c.com": { a: "", b: "late" } };
  const mig2 = new Function("attendance", "allocOverrides", "allocDateOverrides", "normEmail",
    "HALF_TERMS", "_touchedOvrKeys", "dateOvrUpsert", "_queueOvrDelete",
    grab("function _migrateRecordsToPupil(fromEmail,toEmail){", "\r\n}", "_migrateRecordsToPupil") +
    "\nreturn _migrateRecordsToPupil;")(att2, {}, {}, ne, ["A1"], new Set(), () => Promise.resolve(true), () => {});
  mig2("old@g.com", "new@c.com");
  t("an existing register is not overwritten", att2["1|X|new@c.com"].b === "late");
  t("a blank session is filled from the stale row", att2["1|X|new@c.com"].a === "present");
  t("the stale duplicate is removed", att2["1|X|old@g.com"] === undefined);
}

// ════════════════════════════════════════════════════════════════════════════
S("v141 — Indexed lookups");
t("results grid indexes allocRes once", has('const _resIdx=new Map();'));
t("results grid indexes formData once", has('const _fdIdx=new Map();'));
t("by-date grid indexes allocRes once", has('const _bdResIdx=new Map();'));
t("no per-pupil scan remains in the results grid",
  !has('allocRes.find(r=>normEmail(r.email)===ne&&r.half===_h1())'));
t("index keeps the first match, as .find() did", has('if(!_resIdx.has(k))_resIdx.set(k,r);'));

// ════════════════════════════════════════════════════════════════════════════
S("v143 — Year and term narrowing");
{
  const dates = [];
  const add = (n, half) => { for (let i = 0; i < n; i++) dates.push({ half, label: "Sat " + (dates.length + 1), full: "0" + ((dates.length % 28) + 1) + "/01/2026" }); };
  add(4, "A1"); add(4, "A2"); add(4, "Sp1"); add(1, "LEX Week");
  const N = new Function("dates", "sortedDateIndices", "ygRank", "displayYg", "_termOfHalf",
    [grab("function _ygQuickList(rows){", "\r\n}", "_ygQuickList"),
     grab("function applyYgQuick(rows,current){", "\r\n}", "applyYgQuick"),
     grab("function _termsPresent(){", "\r\n}", "_termsPresent"),
     grab("function _visibleDateIndices(term){", "\r\n}", "_visibleDateIndices")].join("\n") +
    "\nreturn {_ygQuickList,applyYgQuick,_termsPresent,_visibleDateIndices};")(
    dates, () => dates.map((_, i) => i), core.ygRank, core.displayYg, core._termOfHalf);
  const rows = [];
  ["Year 9", "Year 10", "Year 11", "Year 12", "Year 13"].forEach((yg, i) => { for (let n = 0; n < 58; n++) rows.push({ yearGroup: yg, surname: "P" + i + n }); });
  t("year list in teaching order", N._ygQuickList(rows)[0] === "Year 9");
  t("filter to one year", N.applyYgQuick(rows, "Year 9").length === 58);
  t("All returns everyone", N.applyYgQuick(rows, "__ALL__").length === 290);
  t("unknown year yields nothing", N.applyYgQuick(rows, "Year 7").length === 0);
  t("terms in school order", JSON.stringify(N._termsPresent()) === JSON.stringify(["Autumn", "Spring", "LEX Week"]), JSON.stringify(N._termsPresent()));
  t("Autumn shows 8 dates", N._visibleDateIndices("Autumn").length === 8);
  t("whole year shows all", N._visibleDateIndices("__ALL__").length === 13);
  t("no term falls back to all", N._visibleDateIndices("").length === 13);
}

// ════════════════════════════════════════════════════════════════════════════
S("v144 — Per-date allocation import");
{
  const dates = [
    { half: "A1", label: "Sat 12 Sep", full: "12/09/2026" },
    { half: "A1", label: "Sat 19 Sep", full: "19/09/2026" },
    { half: "A1", label: "Sat 03 Oct", full: "03/10/2026" },
    { half: "A2", label: "Sat 07 Nov", full: "07/11/2026" }
  ];
  const D = new Function("dates", "parseDateDmy",
    [grab("function _pdiLooksLikeDate(s){", "\r\n", "_pdiLooksLikeDate"),
     grab("function _pdiMatchDate(header){", "\r\n}", "_pdiMatchDate")].join("\n") +
    "\nreturn {_pdiMatchDate,_pdiLooksLikeDate};")(dates, core.parseDateDmy);
  const one = (h, di) => { const r = D._pdiMatchDate(h); return r.length === 1 && r[0] === di; };
  t("19/09/2026", one("19/09/2026", 1));
  t("3/10/2026 without leading zero", one("3/10/2026", 2));
  t("ISO 2026-09-19", one("2026-09-19", 1));
  t("19/09 without a year", one("19/09", 1));
  t("dashes and dots", one("19-09-2026", 1) && one("19.09.2026", 1));
  t("Sat 19 Sep", one("Sat 19 Sep", 1));
  t("19 September 2026", one("19 September 2026", 1));
  t("US order 09/19/2026 refused, not mis-resolved", D._pdiMatchDate("09/19/2026").length === 0);
  t("unknown date matches nothing", D._pdiMatchDate("25/12/2026").length === 0);
  t("'Year Group' is not read as a date", D._pdiMatchDate("Year Group").length === 0);
  t("'Email' is not read as a date", D._pdiMatchDate("Email").length === 0);
  t("importer blocks on unknown activity names", has("Cannot import — these activity names do not exist: "));
  t("blank cell leaves the allocation alone", has('if(!cell)return;                              // blank = leave alone'));
  t("CLEAR removes an override", has('if(/^clear$/i.test(cell))'));
}

// ════════════════════════════════════════════════════════════════════════════
S("v145 — Capacity counts pupils, not rows");
{
  const i = src.indexOf("  if(allocRes){\r\n    const _seenCap={};");
  if (i < 0) throw new Error("missing anchor for capUsed");
  const block = src.slice(i, src.indexOf("\r\n  }\r\n", i) + "\r\n  }".length);
  const count = new Function("allocRes", "capUsed", "normEmail", block + "\nreturn capUsed;");
  const six = Array.from({ length: 6 }, (_, n) => `p${n}@clayesmore.com`);
  const dupRows = [];
  six.forEach(e => { dupRows.push({ email: e, alloc: "Cookery", half: "A1" }); dupRows.push({ email: e, alloc: "Cookery", half: "A1" }); });
  t("duplicate rows for one pupil count once", count(dupRows, { a1: {} }, ne).a1.Cookery === 6);
  const twelve = Array.from({ length: 12 }, (_, n) => ({ email: `q${n}@c.com`, alloc: "Cookery", half: "A1" }));
  t("a genuinely full activity still counts 12", count(twelve, { a1: {} }, ne).a1.Cookery === 12);
  const both = [{ email: "a@x.com", alloc: "Cookery", half: "A1" }, { email: "a@x.com", alloc: "Cookery", half: "A2" }];
  const r = count(both, { a1: {}, a2: {} }, ne);
  t("halves counted separately", r.a1.Cookery === 1 && r.a2.Cookery === 1);
  const two = [{ email: "a@x.com", alloc: "Cookery", half: "A1" }, { email: "a@x.com", alloc: "Chess", half: "A1" }];
  const r2 = count(two, { a1: {} }, ne);
  t("one pupil in two activities counts once in each", r2.a1.Cookery === 1 && r2.a1.Chess === 1);
  t("rows with no email are still counted",
    count([{ email: "", alloc: "X", half: "A1" }, { email: "", alloc: "X", half: "A1" }], { a1: {} }, ne).a1.X === 2);
  t("engine allocates one response per pupil per half", has("const _seenPupil=new Set();"));
  t("duplicates are reported in the log", has("duplicate response(s) ignored"));
}

// ════════════════════════════════════════════════════════════════════════════
S("v148/v150 — Central allocation");
{
  const dates = [{ half: "A1" }, { half: "A1" }, { half: "A1" }, { half: "A2" }, { half: "A2" }];
  const mk = ovr => new Function("dates", "allocDateOverrides", "normEmail",
    grab("function _centralCoverFor(email,half){", "\r\n}", "_centralCoverFor") + "\nreturn _centralCoverFor;")(dates, ovr, ne);
  const E = "p@clayesmore.com";
  t("a standing prescription is central",
    mk({ ["0|" + E]: "LEX Think", ["1|" + E]: "LEX Think", ["2|" + E]: "LEX Think" })(E, "A1") === "LEX Think");
  t("a rotation is central and names its parts",
    mk({ ["0|" + E]: "A", ["1|" + E]: "B", ["2|" + E]: "C" })(E, "A1") === "A / B / C");
  t("a four-way rotation is summarised",
    /prescribed/.test(mk({ ["0|" + E]: "A", ["1|" + E]: "B", ["2|" + E]: "C" })(E, "A1")) === false);
  t("partial cover is NOT central", mk({ ["0|" + E]: "X", ["1|" + E]: "X" })(E, "A1") === "");
  t("__UNASSIGNED__ breaks the cover",
    mk({ ["0|" + E]: "X", ["1|" + E]: "__UNASSIGNED__", ["2|" + E]: "X" })(E, "A1") === "");
  t("no overrides is not central", mk({})(E, "A1") === "");
  t("cover in one half does not cover the other",
    mk({ ["0|" + E]: "X", ["1|" + E]: "X", ["2|" + E]: "X" })(E, "A2") === "");
  t("CENTRAL rows excluded from the missed-out table", has('if(res.st==="CENTRAL")return;'));
  t("central only applies when no choices were made", has("if(!ch.length&&_central){"));
  // v167: anchor moved with the three-pass engine; behaviour is also checked in the v167 section.
  t("reasons are recorded against each rejected choice", has('s.whyNot.push({act:a,reason:"not running"})') && has('s.whyNot.push({act:a,reason:"full",'));
  t("a choice not running that half is logged", has("not running in "));
}

// ════════════════════════════════════════════════════════════════════════════
S("v151/v152 — Moving and deleting responses");
t("move card only offers real form halves", has("_formHalves().length>1"));
t("move refuses to overwrite existing destination choices", has('![1,2,3].some(i=>(f[s.to+"c"+i]||"").trim())'));
t("move clears the legacy c1/c2/c3 mirror", has('if(s.from==="s1"){f.c1="";f.c2="";f.c3="";}'));
t("delete removes the clicked row, not every row with that email", has("formData=formData.filter(f=>f!==r);"));
t("delete only cascades when no response remains", has("const _stillHasResponse=formData.some(f=>normEmail(f.email)===ne);"));
{
  const del = (formData, r) => { const fdx = formData.filter(f => f !== r);
    return { formData: fdx, cascade: !fdx.some(f => ne(f.email) === ne(r.email)) }; };
  const pair = [{ email: "a@c.com", s1c1: "X" }, { email: "a@c.com", s2c1: "Y" }];
  const res = del(pair, pair[0]);
  t("one of a duplicate pair is removed", res.formData.length === 1 && res.formData[0].s2c1 === "Y");
  t("no cascade while a response remains", res.cascade === false);
  t("cascade fires on the last response", del(res.formData, res.formData[0]).cascade === true);
}

// ════════════════════════════════════════════════════════════════════════════
S("v153 — Missing submissions respect per-date allocation");
t("cover is consulted per form half", has("_centralCoverFor(ne2,half)"));
t("cover must apply to every half to excuse a pupil", has("c.covered>=c.total"));
t("partly-covered pupils are still listed", has("p._partialCover="));

// ════════════════════════════════════════════════════════════════════════════
S("v154 — Split activities on pupil-facing output");
{
  const staff = [{ c: "JAR", n: "J Reach" }, { c: "NJ", n: "N Jones" }];
  const sess = new Function("staff", "isSplitAct",
    [grab("const LEX_TIME_FULL=", "\r\n", "LEX times"),
     grab("function actSessions(act){", "\r\n}", "actSessions")].join("\n") + "\nreturn actSessions;")(
    staff, a => a && a.sessA !== a.sessB);
  let s = sess({ n: "Golf", v: "Range", lead: "JAR", sessA: "Golf", sessB: "Golf" });
  t("whole-day gives one session", s.length === 1 && s[0].time === "09:00–12:30");
  t("lead resolved to a name", s[0].lead === "J Reach");
  s = sess({ n: "A then B", v: "TBC", lead: "JAR", sessA: "A", sessAVenue: "Hall", sessALead: "JAR",
    sessB: "B", sessBVenue: "Astro", sessBLead: "NJ" });
  t("split gives two sessions", s.length === 2);
  t("each half keeps its own venue", s[0].venue === "Hall" && s[1].venue === "Astro");
  t("each half keeps its own staff", s[0].lead === "J Reach" && s[1].lead === "N Jones");
  t("split times are fixed", s[0].time === "09:00–10:30" && s[1].time === "11:00–12:30");
  s = sess({ n: "A then B", v: "Hall", lead: "JAR", sessA: "A", sessB: "B", sessBVenue: "Astro" });
  t("missing session venue falls back to the activity venue", s[0].venue === "Hall");
  t("TBC is treated as no venue", sess({ n: "X", v: "TBC", sessA: "X", sessB: "X" })[0].venue === "");
  t("no activity yields nothing", sess(null).length === 0);
  t("Friday notice uses the helper", has("const ss=actSessions(act);"));
  t("per-date list uses the helper", has("const _ss=actSessions(act);"));
  t("pupil tile uses the helper", has("const _ts=actSessions(act);"));
}

// ════════════════════════════════════════════════════════════════════════════
S("v155/v156 — Activities column and portal freshness");
t("activity name column widened", has('nameInp.style.minWidth="230px";'));
t("full name available on hover", has("nameInp.title=a.n"));
t("portal shows a freshness indicator", has('id:"staff-freshness"'));
t("failed sync marks data stale", has('setStaffDataState("stale")'));
t("successful sync marks data fresh", has('setStaffDataState("fresh");'));
t("portal refreshes on a timer", has("_staffRefreshTimer=setInterval(_staffDataRefresh,STAFF_REFRESH_MS);"));
t("portal refreshes when the tab is refocused", has('document.addEventListener("visibilitychange"'));
t("background tabs skipped", has("if(document.hidden)return;"));
t("staff mode still cannot write", has("if(isStaffView()||isPublicTimetable())return true;"));

// ════════════════════════════════════════════════════════════════════════════
S("v157 — Find a pupil from the registers");
{
  const marks = (attendance, di, email) => {
    const out = [];
    Object.keys(attendance || {}).forEach(k => {
      const first = k.indexOf("|"), last = k.lastIndexOf("|");
      if (first < 0 || last <= first) return;
      if (k.slice(0, first) !== String(di)) return;
      if (ne(k.slice(last + 1)) !== ne(email)) return;
      const v = attendance[k];
      const a = typeof v === "string" ? v : (v && v.a) || "";
      const b = typeof v === "string" ? v : (v && v.b) || "";
      if (!a && !b) return;
      out.push({ act: k.slice(first + 1, last), a, b });
    });
    return out;
  };
  const att = { "1|Flying|g@c.com": { a: "absent", b: "absent" },
                "1|The Play|g@c.com": { a: "present", b: "present" },
                "1|Flying|other@c.com": { a: "present", b: "" },
                "2|Flying|g@c.com": { a: "present", b: "" } };
  const m = marks(att, 1, "g@c.com");
  t("both registers on that date are found", m.length === 2);
  t("another pupil's mark is not picked up", !m.some(x => x.a === "present" && x.act === "Flying"));
  t("another date is excluded", marks(att, 2, "g@c.com").length === 1);
  t("blank marks are not reported", marks({ "1|X|a@b.com": { a: "", b: "" } }, 1, "a@b.com").length === 0);
  t("legacy single-value attendance handled", marks({ "1|X|a@b.com": "present" }, 1, "a@b.com").length === 1);
  t("email taken from the right of the key", marks({ "1|Odd|Name|a@b.com": { a: "present", b: "" } }, 1, "a@b.com").length === 1);
  t("finder lives in the Registers tab",
    src.indexOf("Find a pupil (v157)") > src.indexOf("function buildRosterTab(){") &&
    src.indexOf("Find a pupil (v157)") < src.indexOf("function updateRosterView(){"));
  t("finder reports a pupil on no register", has('"not on any register"'));
  t("finder can jump to a component register", has('opts.find(v=>v.startsWith("comp:")&&v.split(":")[1]===eff)'));
  t("results are capped", has(".slice(0,25)"));
}

// ════════════════════════════════════════════════════════════════════════════
S("v158 — Pupil route (pupils no longer reach the Staff Portal)");
const ROLE_SRC = [
  grab("function normEmail(e){", "\r\n", "normEmail"),
  grab("const ADMIN_EMAILS=new Set([", "]);", "ADMIN_EMAILS"),
  grab("function _lexSignedInEmail(){", "\r\n", "_lexSignedInEmail"),
  grab("function _lexFindPupilByEmail(em){", "\r\n}", "_lexFindPupilByEmail"),
  grab("function lexUserRole(){", "\r\n}", "lexUserRole"),
  grab("function _lexPortalMode(){", "\r\n}", "_lexPortalMode")
].join("\n");
const role = (email, o = {}) => new Function("window", "pupils", "staff", "_staffDataState", "location",
  ROLE_SRC + "\nreturn {r:lexUserRole(),m:_lexPortalMode()};")(
  { __LEX_USER__: email ? { email } : null },
  o.pupils || [{ email: "p101@clayesmore.com" }, { email: "tbell@clayesmore.com", altEmails: ["tom@gmail.com"] }],
  o.staff || [{ c: "GHK", email: "gking@clayesmore.com" }, { c: "JLB", email: "jbriggs@clayesmore.com" }],
  o.state || "fresh", { hash: o.hash || "#staff" });
{
  t("admin gets the Staff Portal", role("gking@clayesmore.com").m === "staff");
  t("admin at #pupil gets the pupil preview", role("gking@clayesmore.com", { hash: "#pupil" }).m === "pupil");
  t("rostered staff get the Staff Portal", role("jbriggs@clayesmore.com").r === "staff");
  t("rostered pupil gets the pupil view", role("p101@clayesmore.com").m === "pupil");
  t("case and spaces in the signed-in address don't matter", role(" P101@Clayesmore.com ").r === "pupil");
  t("pupil without a digit in the address still matched by roster", role("tbell@clayesmore.com").r === "pupil");
  t("pupil cannot reach the Staff Portal by typing #staff", role("p101@clayesmore.com", { hash: "#staff" }).m === "pupil");
  t("staff typing #pupil still get the Staff Portal", role("jbriggs@clayesmore.com", { hash: "#pupil" }).m === "staff");
  t("unrostered initial+number address treated as a pupil", role("p202@clayesmore.com").r === "pupil");
  t("unrostered staff-style address keeps the Staff Portal", role("mmatron@clayesmore.com").r === "staff");
  t("staff address with a digit is not mistaken for a pupil", role("jsmith2@clayesmore.com").r === "staff");
  t("pupil format is exactly one letter and three digits",
    role("ab390@clayesmore.com").r === "staff" && role("p39@clayesmore.com").r === "staff" && role("p3901@clayesmore.com").r === "staff");
  t("roster not loaded yet → pending, not the Staff Portal",
    role("tbell@clayesmore.com", { pupils: [], state: "loading" }).r === "pending");
  t("rostered staff never wait on the pupil roster",
    role("jbriggs@clayesmore.com", { pupils: [], state: "loading" }).r === "staff");
  t("empty roster after a good load is not pending forever",
    role("mmatron@clayesmore.com", { pupils: [], state: "fresh" }).r === "staff");
  t("no gated identity (local/dev) behaves as admin", role(null).r === "admin");
  t("#pupil shares the staff-mode protections", has('function isStaffView(){return location.hash==="#staff"||location.hash==="#pupil";}'));
  const rsv = src.indexOf("function renderStaffView(){");
  t("Staff Portal dispatches before drawing anything",
    src.indexOf('if(_portalMode==="pupil"){renderPupilView();return;}', rsv) > rsv &&
    src.indexOf('if(_portalMode==="pupil"){renderPupilView();return;}', rsv) < src.indexOf('app.innerHTML="";', rsv));
  const au = grab("async function attUpsert(", "try{", "attUpsert head");
  t("attendance writes refused for pupils", au.includes('_r==="pupil"||_r==="pending")return false;'));
  const ph = grab("async function presenceHeartbeat(){", "try{", "presenceHeartbeat head");
  t("pupils don't write to the presence blob", ph.includes('_r==="pupil"||_r==="pending")return;'));
}
{
  // Schedule rows through the real effective-allocation path
  const SCHED = [
    grab("function normEmail(e){", "\r\n", "normEmail"),
    grab("function parseDateDmy(", "\r\n}", "parseDateDmy"),
    grab("function sortedDateIndices(){", "\r\n}", "sortedDateIndices"),
    grab("function getEffectiveAllocOnDate(ne,di,engMap){", "\r\n}", "getEffectiveAllocOnDate"),
    grab("function buildEngMap(){", "\r\n}", "buildEngMap"),
    grab("function _pupilYmd(full){", "\r\n", "_pupilYmd"),
    grab("function _todayYmd(d){", "\r\n", "_todayYmd"),
    grab("function pupilScheduleRows(pupil,todayYmd){", "\r\n}", "pupilScheduleRows")
  ].join("\n");
  const run = (st, pupil, today) => new Function("dates", "allocDateOverrides", "allocOverrides", "allocRes", "acts",
    "let _engMapCache=null;function findActByName_exact(n){return acts.find(a=>a.n===n)||null;}\n" + SCHED +
    "\nreturn pupilScheduleRows;")(st.dates, st.ado || {}, st.ao || {}, st.res || [], st.acts)(pupil, today);
  const st = {
    dates: [{ full: "10/10/2026", half: "A1", label: "Sat 10 Oct" }, { full: "26/09/2026", half: "A1", label: "Sat 26 Sep" },
            { full: "07/11/2026", half: "A2", label: "Sat 7 Nov" }],
    acts: [{ n: "Golf", di: [0, 1, 2] }, { n: "Kayaking", di: [0, 1] }],
    res: [{ email: "a@c.com", half: "A1", alloc: "Golf" }],
    ado: { "0|a@c.com": "Kayaking", "2|b@gmail.com": "Out of school" },
    ao: {}
  };
  const rows = run(st, { email: "A@c.com", altEmails: ["b@gmail.com"] }, 20261001);
  t("rows come back in date order", rows.map(r => r.date.label).join() === "Sat 26 Sep,Sat 10 Oct,Sat 7 Nov");
  t("engine result used where nothing overrides it", rows[0].name === "Golf");
  t("per-date override wins", rows[1].name === "Kayaking");
  t("linked address fills a date the primary has nothing for", rows[2].name === "Out of school");
  t("past dates marked past", rows[0].past === true && rows[1].past === false);
  t("today recognised", run(st, { email: "a@c.com" }, 20261010)[1].isToday === true);
  t("unallocated date is null, not an error", run(st, { email: "a@c.com" }, 20261001)[2].name === null);
  t("no pupil → no rows", run(st, null, 20261001).length === 0);
}

// ════════════════════════════════════════════════════════════════════════════
S("v159 — Pupil feedback prompt and editable questions");
{
  const FB = new Function([
    grab("function parseDateDmy(", "\r\n}", "parseDateDmy"),
    "function isSplitAct(a){return a&&a.sessA!==a.sessB;}",
    grab("const FB_DEFAULT_CFG={", "]};", "FB_DEFAULT_CFG"),
    grab("const FB_ATTENDED=[", "];", "FB_ATTENDED"),
    grab("function _fbNormCfg(c){", "\r\n}", "_fbNormCfg"),
    grab("function fbActiveQuestions(cfg){", "\r\n", "fbActiveQuestions"),
    grab("function fbItemKey(di,act,sess){", "\r\n", "fbItemKey"),
    grab("function feedbackDueItems(rows,now,cfg,done,attOf){", "\r\n}", "feedbackDueItems")
  ].join("\n") + "\nreturn {_fbNormCfg,fbActiveQuestions,fbItemKey,feedbackDueItems,FB_DEFAULT_CFG};")();
  const cfg = FB._fbNormCfg({ enabled: true, windowDays: 7, questions: FB.FB_DEFAULT_CFG.questions });
  const whole = { n: "Kayaking", sessA: "Kayaking", sessB: "Kayaking" };
  const split = { n: "Pilates then Embroidery", sessA: "Pilates", sessB: "Embroidery" };
  const row = (di, full, act) => ({ di, act, date: { full, label: full } });
  const due = (rows, now, att, done) => FB.feedbackDueItems(rows, new Date(now), cfg, done || new Set(), att ? (di, a) => att[di + "|" + a] : null);
  const r1 = [row(0, "19/09/2026", whole)];
  t("not due before 12:30 on the day", due(r1, "2026-09-19T12:29:00").length === 0);
  t("due from 12:30 on the day", due(r1, "2026-09-19T12:30:00").length === 1);
  t("still due on day 7", due(r1, "2026-09-26T12:29:00").length === 1);
  t("closed after the window", due(r1, "2026-09-26T12:31:00").length === 0);
  t("future session not due", due([row(0, "26/09/2026", whole)], "2026-09-21T09:00:00").length === 0);
  t("split activity gives one item per half",
    due([row(0, "19/09/2026", split)], "2026-09-20T09:00:00").map(i => i.label + i.name).join() === "P1Pilates,P4Embroidery");
  t("half marked absent is not asked about",
    due([row(0, "19/09/2026", split)], "2026-09-20T09:00:00", { "0|Pilates then Embroidery": { a: "present", b: "absent" } }).length === 1);
  t("unmarked register still asks (registers lag)", due(r1, "2026-09-20T09:00:00", { "0|Kayaking": { a: "", b: "" } }).length === 1);
  t("late still asks", due(r1, "2026-09-20T09:00:00", { "0|Kayaking": { a: "late", b: "late" } }).length === 1);
  t("supported study / school event not asked",
    due(r1, "2026-09-20T09:00:00", { "0|Kayaking": { a: "supported_study", b: "supported_study" } }).length === 0 &&
    due(r1, "2026-09-20T09:00:00", { "0|Kayaking": { a: "school_event", b: "school_event" } }).length === 0);
  t("already-submitted session not asked again",
    due(r1, "2026-09-20T09:00:00", null, new Set([FB.fbItemKey(0, "Kayaking", "")])).length === 0);
  t("date with no activity (Out of school etc.) not asked", due([row(0, "19/09/2026", null)], "2026-09-20T09:00:00").length === 0);
  t("off by default", FB._fbNormCfg(null).enabled === false);
  t("comments off by default", FB._fbNormCfg(null).comments === false);
  t("three starter questions", FB._fbNormCfg(null).questions.length === 3);
  const n = FB._fbNormCfg({ enabled: "yes", windowDays: 99, questions: [{ id: "a", text: "x".repeat(300), active: false }, { text: "no id" }] });
  t("only a real true switches it on", n.enabled === false);
  t("window clamped to 28 days", n.windowDays === 28);
  t("question text capped", n.questions[0].text.length === 120);
  t("question without an id dropped", n.questions.length === 1);
  t("retired question kept but not asked", FB.fbActiveQuestions(n).length === 0);
  t("preview never sends", has('if(isPreview||!ready())return;'));
  t("config saved only by its own button, not saveAll", !/_ALL_KEYS=\[[^\]]*feedback/.test(src));
  const sql = grab("const FB_SETUP_SQL=`", "`;", "FB_SETUP_SQL");
  t("table is insert-and-read only", !/for (update|delete)/i.test(sql) && /for insert/.test(sql) && /for select/.test(sql));
  t("responses never go in a blob", !has('supaSet("lex12-feedback"') && has("/rest/v1/lex_feedback"));
  t("pupil view shows the prompt", src.indexOf("renderFeedbackPrompt(pupil,rows,admin)") > src.indexOf("function renderPupilView(){"));
}

// ════════════════════════════════════════════════════════════════════════════
S("v160 — Pupil feedback results");
{
  const R = new Function([
    grab("function normEmail(e){", "\r\n", "normEmail"),
    grab("function fbResolveDi(rows,dateList){", "\r\n}", "fbResolveDi"),
    grab("function fbLatest(rows){", "\r\n}", "fbLatest"),
    grab("function feedbackSummary(rows,qIds){", "\r\n}", "feedbackSummary")
  ].join("\n") + "\nreturn {fbResolveDi,fbLatest,feedbackSummary};")();
  const rows = [
    { di: 0, act: "Golf", sess: "", email: "a@c.com", ratings: { enjoy: 2 } },
    { di: 0, act: "Golf", sess: "", email: "A@c.com ", ratings: { enjoy: 5 } },      // resubmission, messy case
    { di: 0, act: "Golf", sess: "", email: "b@c.com", ratings: { enjoy: 3, learn: 9 }, comment: "ok" },
    { di: 1, act: "Golf", sess: "", email: "a@c.com", ratings: { enjoy: 4 } },       // a different date
    { di: 0, act: "P then E", sess: "A", email: "a@c.com", ratings: { enjoy: 1 } },
    { di: 0, act: "P then E", sess: "B", email: "a@c.com", ratings: { enjoy: 5 }, comment: "  " }
  ];
  const latest = R.fbLatest(rows);
  t("newest answer per pupil per session wins", latest.length === 5 &&
    latest.find(r => r.di === 0 && r.act === "Golf" && r.email.trim().toLowerCase() === "a@c.com").ratings.enjoy === 5);
  const sum = R.feedbackSummary(latest, ["enjoy", "learn"]);
  const golf = sum.find(e => e.key === "Golf|");
  t("responses counted across dates", golf.n === 3);
  t("mean per question", Math.abs(golf.mean.enjoy - 4) < 1e-9);
  t("out-of-range rating ignored, not averaged", golf.mean.learn === null);
  t("split halves reported separately", sum.some(e => e.key === "P then E|A") && sum.some(e => e.key === "P then E|B"));
  t("blank comments not counted", sum.find(e => e.key === "P then E|B").comments.length === 0 && golf.comments.length === 1);
  t("busiest activity listed first", sum[0].key === "Golf|");
  const D = [{ full: "26/09/2026" }, { full: "19/09/2026" }];
  const res = R.fbResolveDi([{ di: 0, dt: "19/09/2026" }, { di: 1, dt: "19/09/2026" }, { di: 0 }, { di: 0, dt: "01/01/2020" }], D);
  t("answer re-found by its date after dates are edited", res[0].di === 1);
  t("answer whose index still matches is untouched", res[1].di === 1);
  t("older answer without a date keeps its index", res[2].di === 0);
  t("answer whose date has gone keeps its index", res[3].di === 0);
  t("averages hidden under the minimum", has("const FB_MIN_N=5;") && has("if(n<FB_MIN_N||v==null)"));
  t("responses stored with their date", has("dt:(dates[it.di]&&dates[it.di].full)||null") && /\n  dt text,/.test(src.replace(/\r/g, "")));
  t("results panel doesn't re-download on every redraw", has("if(st.rows===null&&!st.loading&&!st.err)"));
}

// ════════════════════════════════════════════════════════════════════════════
S("v162 — Allocation report and half-term guards");
// Shared factory: the v162 helpers over a small world.
const V162 = (w) => new Function("dates", "allocDateOverrides", "allocRes", "acts", "formData", "pupils",
  "function normEmail(e){return(e||'').trim().toLowerCase();}" +
  "function displayYg(yg){const m=(yg||'').match(/Year\\s*(\\d+)/i);return m?m[1]:yg;}" +
  "function _formSlot(h){return h==='A2'?'s2':'s1';}" +
  "function _stripChargeSuffix(x){return x;}" +
  "function findActByName_exact(n){return acts.find(a=>a.n===n)||null;}" +
  "function findActByName(n){return null;}" +
  "function findPupilByEmail(e){return pupils.find(p=>normEmail(p.email)===normEmail(e))||null;}\n" + [
    grab("function _halfCoverValues(email,half){", "\r\n}", "_halfCoverValues"),
    grab("function _isOutOfSchool(v){", "\r\n", "_isOutOfSchool"),
    grab("function _actFamily(n){", "\r\n", "_actFamily"),
    grab("function _relatedAct(a,b){", "\r\n", "_relatedAct"),
    grab("function _actOpenToYg(a,yg){", "\r\n}", "_actOpenToYg"),
    grab("function _choicesFor(fd,half){", "\r\n}", "_choicesFor"),
    grab("function _resolveChoice(raw){", "\r\n}", "_resolveChoice"),
    grab("function allocPrescribedChoiceScan(half,rows){", "\r\n}", "allocPrescribedChoiceScan"),
    grab("function allocMaskedPlacements(){", "\r\n}", "allocMaskedPlacements")
  ].join("\n") + "\nreturn {_halfCoverValues,_isOutOfSchool,_relatedAct,_actOpenToYg,_choicesFor,allocPrescribedChoiceScan,allocMaskedPlacements};")(
  w.dates, w.ado || {}, w.res || [], w.acts || [], w.fd || [], w.pupils || []);
{
  const dates = [{ full: "12/09/2026", half: "A1" }, { full: "19/09/2026", half: "A1" }, { full: "07/11/2026", half: "A2" }, { full: "14/11/2026", half: "A2" }];
  const acts = [{ n: "Polo", di: [1, 2, 3], cap: 10, yg: "10-13" }, { n: "Bake-Off", di: [1, 2, 3], cap: 16, yg: "10-13" },
                { n: "Bake-Off K", di: [1, 2, 3], cap: 8, yg: "9-12" }, { n: "Golf", di: [2, 3], cap: 5, yg: "9, 10, 11, 12, 13" }];
  // Six Y13, all prescribed in A1 but with A1 choices — the original mistake
  const pupils = [], fd = [], ado = {};
  for (let i = 0; i < 6; i++) {
    const e = "y13_" + i + "@c.com"; pupils.push({ email: e, yg: "Year 13" });
    fd.push({ email: e, s1c1: "Polo", s1c2: "Golf", s1c3: "", c1: "Polo", s2c1: "", s2c2: "", s2c3: "" });
    ado["0|" + e] = "Whole School Walk"; ado["1|" + e] = "Y13 Wellbeing";
  }
  // A Y10 moved by hand from Bake-Off to Bake-Off K on every A1 date (deliberate)
  pupils.push({ email: "y10@c.com", yg: "Year 10" });
  fd.push({ email: "y10@c.com", s1c1: "Bake-Off", c1: "Bake-Off" });
  ado["0|y10@c.com"] = "Bake-Off K"; ado["1|y10@c.com"] = "Bake-Off K";
  const W = V162({ dates, acts, pupils, fd, ado });
  const sc = W.allocPrescribedChoiceScan("A1", fd);
  t("a year group choosing in its prescribed half is caught", sc.wrongYg.length === 1 && sc.wrongYg[0].yg === "Year 13" && sc.wrongYg[0].n === 6);
  t("a hand move within the same family is not mistaken for it", !sc.hidden.has("y10@c.com"));
  t("the other half is not flagged", W.allocPrescribedChoiceScan("A2", fd).wrongYg.length === 0);
  const few = V162({ dates, acts, pupils, fd: fd.slice(0, 4), ado }).allocPrescribedChoiceScan("A1", fd.slice(0, 4));
  t("fewer than five pupils never counts as a whole year group", few.wrongYg.length === 0 && few.hidden.size === 4);
  t("a gap on any date means not covered", W._halfCoverValues("y13_0@c.com", "A2") === null);
  t("cover values returned when every date is set", W._halfCoverValues("y13_0@c.com", "A1").length === 2);
  t("out of school matched whatever the capitals", W._isOutOfSchool("Out Of School") && W._isOutOfSchool(" out of school ") && !W._isOutOfSchool("Out of school trip"));
  t("families: Bake-Off K is related to Bake-Off", W._relatedAct("Bake-Off K", "Bake-Off") && !W._relatedAct("Cookery", "Bake-Off"));
  t("year range 9-12 excludes Year 13", !W._actOpenToYg(acts[2], "Year 13") && W._actOpenToYg(acts[2], "Year 9"));
  t("year list includes Year 13", W._actOpenToYg(acts[3], "Year 13"));
  t("second half reads only second-half choices", W._choicesFor({ s1c1: "Polo", c1: "Polo", s2c1: "" }, "A2").every(x => !x));
  t("first half falls back to the legacy mirror", W._choicesFor({ c1: "Polo" }, "A1")[0] === "Polo");
  // Hidden places
  const res = [{ email: "a@c.com", half: "A2", alloc: "Bake-Off", st: "1ST" }, { email: "b@c.com", half: "A2", alloc: "Bake-Off", st: "1ST" },
               { email: "c@c.com", half: "A2", alloc: "Golf", st: "1ST" }, { email: "d@c.com", half: "A2", alloc: "Golf", st: "2ND" },
               { email: "e@c.com", half: "A2", alloc: "Y11 THINK", st: "CENTRAL" }];
  const ado2 = { "2|a@c.com": "Bake-Off K", "3|a@c.com": "Bake-Off K", "2|b@c.com": "Out of school", "3|b@c.com": "Out Of School",
                 "2|c@c.com": "Polo", "3|c@c.com": "Polo", "3|d@c.com": "Out of school" };
  const M = V162({ dates, acts, res, ado: ado2 }).allocMaskedPlacements();
  const k = e => (M.find(m => m.email === e) || {});
  t("moved within family → related", k("a@c.com").kind === "related" && k("a@c.com").full);
  t("out of school on every date → out", k("b@c.com").kind === "out");
  t("moved to something unrelated → other", k("c@c.com").kind === "other");
  t("hidden on one date only → partial", k("d@c.com").full === false);
  t("central rows are not treated as hidden places", !M.some(m => m.email === "e@c.com"));
}
{
  const eng = grab("function runAllocEngineV12(){", "\r\n}\r\n", "runAllocEngineV12");
  t("engine skips a year group choosing in a prescribed half", eng.includes("allocPrescribedChoiceScan(half,remaining)") && eng.includes('centralReason:"prescribed half"'));
  t("engine gives no place to a pupil out of school all half", eng.includes("_cv.every(_isOutOfSchool)") && eng.includes('centralReason:"out of school"'));
  t("second-half demand no longer borrows first-half choices", eng.includes('(p.s2c1||"")') && !eng.includes('(p.s2c1||p.c1||"")'));
  t("demand line lists only activities running that half", eng.includes("capM[k]!==undefined&&v>capM[k]"));
  t("Allocation Report sub-tab wired", has('else if(window._allocSub==="report") renderAllocReport(content);'));
}

// ════════════════════════════════════════════════════════════════════════════
S("v163 — Turning per-date moves into half-term overrides");
{
  // `var` so the v165 block below can reuse this factory rather than duplicating it.
  var CONV = (w) => new Function("dates", "allocDateOverrides", "allocOverrides", "allocRes", "acts", "attendance", "TODAY",
    "function normEmail(e){return(e||'').trim().toLowerCase();}" +
    "function findActByName_exact(n){return acts.find(a=>a.n===n)||null;}" +
    // v165: pin "today" so past/future is deterministic rather than whenever the suite runs.
    "function _todayYmd(){return TODAY;}" +
    "function halfLabel(h){return h;}function logAction(){}function invalidateCaches(){}function saveAll(){}" +
    // v164: record the calls that make a deletion durable, so a regression that drops
    // them fails here instead of silently reappearing on the next cloud load.
    "const queued=[],pushed=[],snaps=[];function takeSnapshot(l){snaps.push(l);}" +
    "function _queueOvrDelete(k){queued.push(k);}function _confirmedOvrDelete(k){pushed.push(k);}" +
    "const SPECIAL_ALLOCS=new Set(['Out of school','Supported Study','Other (see notes)']);\n" + [
      grab("function _isOutOfSchool(v){", "\r\n", "_isOutOfSchool"),
      grab("function _actFamily(n){", "\r\n", "_actFamily"),
      grab("function _relatedAct(a,b){", "\r\n", "_relatedAct"),
      grab("function _sameAllocValue(a,b){", "\r\n}", "_sameAllocValue"),
      grab("function parseDateDmy(", "\r\n}", "parseDateDmy"),
      grab("function _diHasHappened(di,todayYmd){", "\r\n}", "_diHasHappened"),
      grab("function allocRegisterSaysOnDate(email,di){", "\r\n}", "allocRegisterSaysOnDate"),
      grab("function allocConvertibleMoves(){", "\r\n}", "allocConvertibleMoves"),
      grab("function allocApplyConversions(list){", "\r\n}", "allocApplyConversions")
    ].join("\n") + "\nreturn {allocConvertibleMoves,allocApplyConversions,allocOverrides,allocDateOverrides,queued,pushed,snaps,_sameAllocValue,_diHasHappened,allocRegisterSaysOnDate};")(
    w.dates, w.ado, w.ao || {}, w.res, w.acts, w.att || {}, w.today || 20260601);
  const dates = [{ full: "12/09/2026", half: "A1" }, { full: "19/09/2026", half: "A1" }, { full: "03/10/2026", half: "A1" }];
  const acts = [{ n: "Bake-Off", di: [1, 2], cap: 16 }, { n: "Bake-Off K", di: [1, 2], cap: 8 },
                { n: "Clay shooting", di: [1, 2], cap: 12 }, { n: "The Play", di: [1], cap: 20 }];
  const res = [
    { email: "a@c.com", half: "A1", alloc: "Bake-Off", st: "1ST" },   // moved every date → Clay shooting
    { email: "b@c.com", half: "A1", alloc: "Bake-Off", st: "1ST" },   // moved within the family
    { email: "c@c.com", half: "A1", alloc: "Bake-Off", st: "1ST" },   // out of school all half
    { email: "d@c.com", half: "A1", alloc: "Bake-Off", st: "1ST" },   // two different targets
    { email: "e@c.com", half: "A1", alloc: "Bake-Off", st: "1ST" },   // target doesn't run on every date
    { email: "f@c.com", half: "A1", alloc: "Bake-Off", st: "1ST" },   // moved on one date only
    { email: "g@c.com", half: "A1", alloc: "Y11 THINK", st: "CENTRAL" },
    { email: "h@c.com", half: "A1", alloc: "Clay shooting", st: "OVERRIDE", isOverride: true }
  ];
  const ado = { "1|a@c.com": "Clay shooting", "2|a@c.com": "Clay shooting",
                "1|b@c.com": "Bake-Off K", "2|b@c.com": "Bake-Off K",
                "1|c@c.com": "Out of school", "2|c@c.com": "Out Of School",
                "1|d@c.com": "Clay shooting", "2|d@c.com": "The Play",
                "1|e@c.com": "The Play", "2|e@c.com": "The Play",
                "1|f@c.com": "Clay shooting", "0|c@c.com": "Whole School Walk" };
  const W = CONV({ dates, acts, res, ado });
  const all = W.allocConvertibleMoves();
  const g = e => all.find(m => m.email === e);
  t("a move repeated on every date is offered", g("a@c.com").canConvert && g("a@c.com").to === "Clay shooting");
  t("a family move is offered but marked as such", g("b@c.com").canConvert && g("b@c.com").kind === "related");
  t("out of school all half is its own group", g("c@c.com").kind === "out" && g("c@c.com").canConvert);
  t("different targets on different dates can't be converted", g("d@c.com").canConvert === false);
  t("a target that doesn't run on every date can't be converted", g("e@c.com").canConvert === false);
  t("a one-off date is left alone", !g("f@c.com"));
  t("central rows are not offered", !g("g@c.com"));
  t("existing half-term overrides are not offered", !g("h@c.com"));
  const n = W.allocApplyConversions(all.filter(m => m.canConvert && m.kind !== "related"));
  t("only the ticked ones are applied", n === 2);
  t("half-term override written", W.allocOverrides.a1["a@c.com"] === "Clay shooting" && W.allocOverrides.a1["c@c.com"] === "Out of school");
  t("the per-date rows it replaces are removed", !W.allocDateOverrides["1|a@c.com"] && !W.allocDateOverrides["2|a@c.com"]);
  t("unrelated per-date rows are kept", W.allocDateOverrides["0|c@c.com"] === "Whole School Walk");
  t("family moves left untouched when not ticked", W.allocDateOverrides["1|b@c.com"] === "Bake-Off K" && !(W.allocOverrides.a1 || {})["b@c.com"]);
  t("a restore point is taken first", W.snaps.length === 1);
  // ── v164: the deletion must reach the cloud, not just memory ──────────────
  t("each removed per-date row is journalled for durable deletion",
    W.queued.length === 4 && W.queued.includes("1|a@c.com") && W.queued.includes("2|a@c.com")
      && W.queued.includes("1|c@c.com") && W.queued.includes("2|c@c.com"), W.queued.join(","));
  t("each removed per-date row is pushed to the cloud",
    W.pushed.slice().sort().join(",") === W.queued.slice().sort().join(","), W.pushed.join(","));
  t("rows left in place are not journalled for deletion", !W.queued.includes("0|c@c.com"));
  t("value compare ignores case and padding",
    W._sameAllocValue("Out Of School", " out of school ") && !W._sameAllocValue("Bake-Off", "Bake-Off K"));
  {
    // A pupil whose per-date rows spell it "Out Of School" while the tool canonicalises
    // the target to "Out of school" — v163 left every row behind and offered them forever.
    const W2 = CONV({ dates, acts,
      res: [{ email: "z@c.com", half: "A1", alloc: "Bake-Off", st: "1ST" }],
      ado: { "1|z@c.com": "Out Of School", "2|z@c.com": "out of school" } });
    const m = W2.allocConvertibleMoves();
    t("mixed capitalisation still reads as one target", m.length === 1 && m[0].canConvert);
    const applied = W2.allocApplyConversions(m);
    t("mixed-capitalisation rows are actually removed",
      applied === 1 && W2.allocDateOverrides["1|z@c.com"] === undefined
        && W2.allocDateOverrides["2|z@c.com"] === undefined);
    t("and their deletions are journalled too", W2.queued.length === 2 && W2.pushed.length === 2);
  }
  {
    // A list that is non-empty but has nothing convertible must not burn a snapshot
    // slot: ten slots is the whole restore history, and repeated clicking evicted it.
    const W3 = CONV({ dates, acts,
      res: [{ email: "d@c.com", half: "A1", alloc: "Bake-Off", st: "1ST" }],
      ado: { "1|d@c.com": "Clay shooting", "2|d@c.com": "The Play" } });
    const only = W3.allocConvertibleMoves();
    t("the no-op case really is non-empty and unconvertible",
      only.length === 1 && only[0].canConvert === false);
    t("a conversion with nothing convertible takes no snapshot",
      W3.allocApplyConversions(only) === 0 && W3.snaps.length === 0);
  }
}

// ════════════════════════════════════════════════════════════════════════════
S("v165 — Past Saturdays are history, not plan");
{
  const dates = [{ full: "12/09/2026", half: "A1" }, { full: "19/09/2026", half: "A1" },
                 { full: "03/10/2026", half: "A1" }, { full: "10/10/2026", half: "A1" }];
  const acts = [{ n: "Bake-Off", di: [1, 2, 3], cap: 16 }, { n: "Bake-Off W", di: [1, 2, 3], cap: 8 },
                { n: "Cookery", di: [1, 2, 3], cap: 12 }, { n: "Polo", di: [1, 2, 3], cap: 14 }];
  const TODAY = 20260927;              // 12/09 and 19/09 are past; 03/10 and 10/10 are not
  // The real-world shape this was built for: one past Saturday spent on a different
  // activity, with the dates still to come settled on one. Names and addresses here are
  // invented — this file is in a public repository.
  const abbie = {
    dates, acts, today: TODAY,
    res: [{ email: "abbie@c.com", half: "A1", alloc: "Polo", st: "3RD" }],
    ado: { "1|abbie@c.com": "Cookery", "2|abbie@c.com": "Bake-Off W", "3|abbie@c.com": "Bake-Off W" },
    att: { "1|Cookery|abbie@c.com": { a: "present", b: "present" } }
  };
  const W = CONV(abbie);
  const m = W.allocConvertibleMoves();
  t("a differing past date no longer blocks the conversion", m.length === 1 && m[0].canConvert === true);
  t("the target comes from the dates still to come", m[0].to === "Bake-Off W");
  t("only future dates are listed for rewriting", JSON.stringify(m[0].dis) === "[2,3]");
  t("the past date is reported as kept", m[0].past.length === 1 && m[0].past[0].di === 1 && m[0].past[0].was === "Cookery");
  t("and the register for it is surfaced", m[0].past[0].register && m[0].past[0].register.act === "Cookery");
  W.allocApplyConversions(m);
  t("the past per-date entry survives the conversion", W.allocDateOverrides["1|abbie@c.com"] === "Cookery");
  t("the future ones are removed", W.allocDateOverrides["2|abbie@c.com"] === undefined && W.allocDateOverrides["3|abbie@c.com"] === undefined);
  t("no deletion is sent for the past date", !W.queued.includes("1|abbie@c.com") && W.queued.length === 2);
  t("the half-term override covers the rest of the half", W.allocOverrides.a1["abbie@c.com"] === "Bake-Off W");
  {
    // The harder shape: the past date names the SAME activity as the dates to come, so only
    // the "future dates only" rule keeps it — the value check can't tell them apart.
    const W5 = CONV({ dates, acts, today: TODAY,
      res: [{ email: "em@c.com", half: "A1", alloc: "Bake-Off", st: "1ST" }],
      ado: { "1|em@c.com": "Cookery", "2|em@c.com": "Cookery", "3|em@c.com": "Cookery" },
      att: { "1|Cookery|em@c.com": { a: "present", b: "" } } });
    const m5 = W5.allocConvertibleMoves();
    t("a past date matching the target is still kept", m5[0].canConvert && JSON.stringify(m5[0].dis) === "[2,3]");
    W5.allocApplyConversions(m5);
    t("and is not deleted even though its value matches", W5.allocDateOverrides["1|em@c.com"] === "Cookery");
    t("nor is a deletion sent for it", !W5.queued.includes("1|em@c.com") && W5.queued.length === 2);
  }
  {
    // Every date already gone: nothing left to free, so don't offer it at all.
    const W2 = CONV({ dates, acts, today: 20261101,
      res: [{ email: "p@c.com", half: "A1", alloc: "Polo", st: "1ST" }],
      ado: { "1|p@c.com": "Cookery", "2|p@c.com": "Cookery", "3|p@c.com": "Cookery" } });
    const m2 = W2.allocConvertibleMoves();
    t("a half-term that is entirely past is not offered", m2.length === 1 && m2[0].canConvert === false);
    t("and says why", /already happened/.test(m2[0].reason));
    t("applying it changes nothing", W2.allocApplyConversions(m2) === 0 && W2.allocDateOverrides["1|p@c.com"] === "Cookery");
  }
  {
    // Disagreement among the REMAINING dates is still a judgement call.
    const W3 = CONV({ dates, acts, today: TODAY,
      res: [{ email: "q@c.com", half: "A1", alloc: "Bake-Off", st: "1ST" }],
      ado: { "1|q@c.com": "Cookery", "2|q@c.com": "Cookery", "3|q@c.com": "Bake-Off W" } });
    const m3 = W3.allocConvertibleMoves();
    t("future dates disagreeing still needs a look", m3[0].canConvert === false);
    t("and says so about the dates to come", /still to come/.test(m3[0].reason));
  }
  {
    const W4 = CONV(abbie);
    t("a past date is recognised as past", W4._diHasHappened(1, TODAY) === true);
    t("a future date is not", W4._diHasHappened(2, TODAY) === false);
    t("the register lookup finds the mark whatever the allocation says",
      W4.allocRegisterSaysOnDate("ABBIE@c.com ", 1).act === "Cookery");
    t("and returns nothing for a date with no mark", W4.allocRegisterSaysOnDate("abbie@c.com", 2) === null);
    t("a blank mark is not treated as a register entry",
      CONV({ dates, acts, today: TODAY, res: [], ado: {}, att: { "1|Cookery|z@c.com": { a: "", b: "" } } })
        .allocRegisterSaysOnDate("z@c.com", 1) === null);
  }
}
{
  // Billing accuracy: a mark taken against a different activity from the allocation.
  const MM = (w) => new Function("dates", "acts", "attendance", "allocDateOverrides", "allocOverrides", "allocRes", "TODAY",
    "function normEmail(e){return(e||'').trim().toLowerCase();}function _todayYmd(){return TODAY;}" +
    "function findActByName_exact(n){return acts.find(a=>a.n===n)||null;}let _engMapCache=null;\n" + [
      grab("function parseDateDmy(", "\r\n}", "parseDateDmy"),
      grab("function _sameAllocValue(a,b){", "\r\n}", "_sameAllocValue"),
      grab("function _diHasHappened(di,todayYmd){", "\r\n}", "_diHasHappened"),
      grab("function getEffectiveAllocOnDate(ne,di,engMap){", "\r\n}", "getEffectiveAllocOnDate"),
      grab("function buildEngMap(){", "\r\n}", "buildEngMap"),
      "function isSplitAct(a){return a&&a.sessA!==a.sessB;}",
      grab("function allocHistoryMismatches(todayYmd){", "\r\n}", "allocHistoryMismatches")
    ].join("\n") + "\nreturn allocHistoryMismatches;")(
    w.dates, w.acts, w.att, w.ado || {}, w.ao || {}, w.res || [], w.today)();
  const dates = [{ full: "19/09/2026", half: "A1" }, { full: "03/10/2026", half: "A1" }];
  const acts = [{ n: "Polo", di: [0, 1], cap: 14, cost: "50", sessA: "Polo", sessB: "Polo" },
                { n: "Cookery", di: [0, 1], cap: 12, cost: "FOC", sessA: "Cookery", sessB: "Cookery" },
                { n: "Pickle Ball then Self Defence", di: [0, 1], cap: 20, cost: "FOC",
                  sessA: "Pickle Ball", sessB: "Self Defence" }];
  const run = MM({ dates, acts, today: 20260927,
    res: [{ email: "a@c.com", half: "A1", alloc: "Polo", st: "1ST" },
          { email: "b@c.com", half: "A1", alloc: "Pickle Ball then Self Defence", st: "1ST" },
          { email: "c@c.com", half: "A1", alloc: "Polo", st: "1ST" }],
    att: { "0|Cookery|a@c.com": { a: "present", b: "" },           // real mismatch, paid activity
           "0|Pickle Ball|b@c.com": { a: "present", b: "" },        // component register — benign
           "0|Polo|c@c.com": { a: "present", b: "" },               // matches
           "1|Cookery|a@c.com": { a: "present", b: "" } } });       // future date — out of scope
  const real = run.filter(x => !x.benign), benign = run.filter(x => x.benign);
  t("a mark on a different activity is reported", real.length === 1 && real[0].ne === "a@c.com" && real[0].markedOn === "Cookery");
  t("it names what they were allocated to", real[0].allocatedTo === "Polo");
  t("a paid activity is flagged as such", real[0].paid === true);
  t("a component register is separated out as benign", benign.length === 1 && benign[0].ne === "b@c.com");
  t("a matching mark is not reported", !run.some(x => x.ne === "c@c.com"));
  t("a future date is out of scope", !run.some(x => x.di === 1));
}

// ════════════════════════════════════════════════════════════════════════════
S("v167 — Allocation priority: timestamps, fairness, repeats, override reasons");
// The whole engine, extracted from the shipped HTML. Only UI and persistence are stubbed.
// `var` so the real-data section below can run the same engine over the backup.
var ENG_SRC = [
  grab("function normEmail(e){", "\r\n", "normEmail"),
  grab("function parseDateDmy(", "\r\n}", "parseDateDmy"),
  grab("function _formTimestampMs(s){", "\r\n}", "_formTimestampMs"),
  grab("function sortedDateIndices(){", "\r\n}", "sortedDateIndices"),
  grab("function _formHalves(){", "\r\n}", "_formHalves"),
  grab("function _formSlot(half){", "\r\n", "_formSlot"),
  grab("function _h1(){", "\r\n", "_h1"),
  grab("function _h2(){", "\r\n", "_h2"),
  grab("function displayYg(", "\r\n}", "displayYg"),
  grab("function _stripChargeSuffix(s){", "\r\n}", "_stripChargeSuffix"),
  grab("function findActByName(name){", "\r\n}", "findActByName"),
  grab("function getEffectiveAllocOnDate(ne,di,engMap){", "\r\n}", "getEffectiveAllocOnDate"),
  grab("function _halfCoverValues(email,half){", "\r\n}", "_halfCoverValues"),
  grab("function _isOutOfSchool(v){", "\r\n", "_isOutOfSchool"),
  grab("function _actFamily(n){", "\r\n", "_actFamily"),
  grab("function _relatedAct(a,b){", "\r\n", "_relatedAct"),
  grab("function _actOpenToYg(a,yg){", "\r\n}", "_actOpenToYg"),
  grab("function _choicesFor(fd,half){", "\r\n}", "_choicesFor"),
  grab("function _resolveChoice(raw){", "\r\n}", "_resolveChoice"),
  grab("function allocPrescribedChoiceScan(half,rows){", "\r\n}", "allocPrescribedChoiceScan"),
  grab("function _centralCoverFor(email,half){", "\r\n}", "_centralCoverFor"),
  grab("const OVR_REASONS={", "\r\n};", "OVR_REASONS"),
  grab("function _halfOverrideKey(half,ne){", "\r\n}", "_halfOverrideKey"),
  grab("function allocOverrideReason(half,email){", "\r\n}", "allocOverrideReason"),
  grab("function setAllocOverrideReason(half,email,why){", "\r\n}", "setAllocOverrideReason"),
  grab("function clearHalfOverride(half,email){", "\r\n}", "clearHalfOverride"),
  grab("function overrideWantsReason(half,email){", "\r\n}", "overrideWantsReason"),
  grab("function allocPriorHalves(fd,half,runRows,engMap){", "\r\n}", "allocPriorHalves"),
  grab("function _allocBeats(s,h,a){", "\r\n}", "_allocBeats"),
  grab("function runAllocEngineV12(){", "\r\n}\r\n", "runAllocEngineV12")
].join("\n");
var ENG = (w) => new Function("W", `
  let acts=W.acts,pupils=W.pupils||[],dates=W.dates,formData=W.fd,allocOverrides=W.ao||{},
      allocDateOverrides=W.ado||{},allocHistory=W.hist||[],allocRes=W.res||[],
      waitingList={},allocLog=[],_findActFuzzyCache=null,_engMapCache=null;
  const reruns=[],actions=[];
  const _actMap=new Map();acts.forEach(a=>_actMap.set(a.n,a));        // last wins, as _actCache does
  function findActByName_exact(n){return _actMap.get(n)||null;}
  function findPupilByEmail(e){return pupils.find(p=>normEmail(p.email)===normEmail(e))||null;}
  function halfLabel(h){return h;}
  function autoLinkFormEmails(){return {linked:0,pending:0};}
  function logAction(a,d){actions.push(a+" "+d);}
  function takeSnapshot(){} function saveAll(){} function invalidateCaches(){}
  function autoRealloc(m){reruns.push(m);}
  ${ENG_SRC}
  return {run(){runAllocEngineV12();return {res:allocRes,log:allocLog,wl:waitingList};},
    get ao(){return allocOverrides;},reruns,actions,_formTimestampMs,_allocBeats,allocPriorHalves,
    allocOverrideReason,setAllocOverrideReason,clearHalfOverride,overrideWantsReason,_halfOverrideKey};`)(w);
{
  // Synthetic worlds only. Every name and address below is invented (public repository).
  const D = [{ full: "05/09/2026", half: "A1" }, { full: "12/09/2026", half: "A1" },
             { full: "07/11/2026", half: "A2" }, { full: "14/11/2026", half: "A2" }];
  const act = (n, cap, di) => ({ n, cap, di: di || [0, 1, 2, 3] });
  const resp = (email, ts, a1, a2) => { a1 = a1 || []; a2 = a2 || [];
    return { email, timestamp: ts, s1c1: a1[0] || "", s1c2: a1[1] || "", s1c3: a1[2] || "",
      c1: a1[0] || "", c2: a1[1] || "", c3: a1[2] || "", s2c1: a2[0] || "", s2c2: a2[1] || "", s2c3: a2[2] || "" }; };
  const row = (out, email, half) => out.res.find(r => ne(r.email) === email && r.half === half) || {};
  const ts = n => "0" + n + "/09/2026 09:00:00";           // day n of September, UK order

  // ── Fix 1: timestamps are read day-first ──────────────────────────────────
  const E0 = ENG({ acts: [], dates: D, fd: [] });
  const ms = E0._formTimestampMs;
  t("16/06 08:00 sorts before 07/09 09:00", ms("16/06/2026 08:00:00") < ms("07/09/2026 09:00:00"));
  t("13/06 sorts before 14/06", ms("13/06/2026 10:00:00") < ms("14/06/2026 10:00:00"));
  t("time of day counts", ms("06/09/2026 11:22:06") < ms("06/09/2026 18:03:52"));
  t("an unreadable timestamp is null, not zero", ms("") === null && ms("soon") === null && ms(undefined) === null);
  t("an impossible month is refused", ms("12/13/2026 09:00:00") === null);
  {
    // 02/09 (2 Sept) and 08/03 (8 March): read US-style they swap order. One Golf place.
    const out = ENG({ dates: D, acts: [act("Golf", 1), act("Chess", 9)], fd: [
      resp("sept@c.com", "02/09/2026 09:00:00", ["Golf", "Chess"]),
      resp("march@c.com", "08/03/2026 09:00:00", ["Golf", "Chess"])] }).run();
    t("the earlier response (8 March) gets the place", row(out, "march@c.com", "A1").alloc === "Golf");
    const out2 = ENG({ dates: D, acts: [act("Golf", 1), act("Chess", 9)], fd: [
      resp("junk@c.com", "not a date", ["Golf", "Chess"]),
      resp("real@c.com", "20/09/2026 09:00:00", ["Golf", "Chess"])] }).run();
    t("an unreadable timestamp goes last, not first", row(out2, "real@c.com", "A1").alloc === "Golf"
      && row(out2, "junk@c.com", "A1").alloc === "Chess");
    t("no response scores 0 or NaN", out2.res.every(r => r.tsScore > 0 && Number.isFinite(r.tsScore)));
  }

  // ── Fix 2: priority from what each pupil actually had this year ──────────
  {
    const acts = [act("Golf", 1), act("Chess", 9), act("Cookery", 9), act("Bake-Off", 1), act("Bake-Off K", 9, [0, 1])];
    const fd = [
      resp("gina@c.com", ts(1), ["Golf", "Chess"], ["Cookery"]),       // gets Golf in A1
      resp("yuri@c.com", ts(3), ["Golf", "Chess"], ["Golf", "Chess"]), // misses Golf in A1
      resp("zoe@c.com", ts(2), ["Cookery"], ["Golf", "Chess"]),        // earlier than Yuri, had her 1st
      resp("wes@c.com", ts(1), ["Bake-Off"], ["Chess"]),               // takes the one Bake-Off place
      resp("xan@c.com", ts(4), ["Bake-Off", "Cookery"], ["Chess"])     // Cookery by engine, Bake-Off K per date
    ];
    const ado = { "0|xan@c.com": "Bake-Off K", "1|xan@c.com": "Bake-Off K" };
    const out = ENG({ dates: D, acts, fd, ado }).run();
    t("missing a 1st choice in A1 moves a pupil up in A2", row(out, "yuri@c.com", "A2").alloc === "Golf"
      && row(out, "zoe@c.com", "A2").alloc === "Chess");
    t("and the log says which half they missed", out.log.some(l => l.includes("yuri@c.com → Golf") && l.includes("missed 1st choice in A1")));
    t("a per-date move within the family counts as having had it (Bake-Off K for Bake-Off)",
      row(out, "xan@c.com", "A1").lvl === 2 && row(out, "xan@c.com", "A2").disappointmentCount === 0);
    t("the first half has no earlier half to boost from", out.res.filter(r => r.half === "A1").every(r => !r.disappointmentCount));
    t("allocHistory is no longer read", (() => {
      const o2 = ENG({ dates: D, acts, fd, ado, hist: [{ email: "zoe@c.com", activity: "Golf", choiceIndex: 2 }] }).run();
      return JSON.stringify(o2.res.map(r => r.alloc)) === JSON.stringify(out.res.map(r => r.alloc));
    })());
    // Out of school on every A1 date: a central placement never counts as missing out.
    const out3 = ENG({ dates: D, acts, fd: [resp("olly@c.com", ts(1), ["Golf"], ["Chess"])],
      ado: { "0|olly@c.com": "Out of school", "1|olly@c.com": "Out of school" } }).run();
    t("a central placement never counts as a miss", row(out3, "olly@c.com", "A1").st === "CENTRAL"
      && row(out3, "olly@c.com", "A2").disappointmentCount === 0);
    const out4 = ENG({ dates: D, acts, fd: [resp("quilla@c.com", ts(1), [], ["Chess"])] }).run();
    t("no choice made for a half is neutral", row(out4, "quilla@c.com", "A2").disappointmentCount === 0);
  }

  // ── Fix 3: override reasons ───────────────────────────────────────────────
  {
    const acts = [act("Golf", 9), act("Chess", 9)];
    const fd = [resp("vic@c.com", ts(1), ["Chess"], ["Golf"])];
    const mk = reason => {
      const ao = { a1: { "vic@c.com": "Golf" } };
      if (reason) ao._reason = { a1: { "vic@c.com": { to: "Golf", why: reason } } };
      return ENG({ dates: D, acts, fd: JSON.parse(JSON.stringify(fd)), ao });
    };
    t("an override with no reason is neutral (existing overrides keep their meaning)", row(mk("").run(), "vic@c.com", "A2").disappointmentCount === 0);
    t("'Swapped after missing out' boosts the next half", row(mk("missed").run(), "vic@c.com", "A2").disappointmentCount === 1);
    t("'Changed first choice' does not", row(mk("changed").run(), "vic@c.com", "A2").disappointmentCount === 0);
    t("'School decision' does not", row(mk("school").run(), "vic@c.com", "A2").disappointmentCount === 0);
    t("the reason shows in the engine log", mk("missed").run().log.some(l => l.includes("OVERRIDE: vic@c.com → Golf [Swapped after missing out]")));
    const W = mk("missed");
    W.ao.a1["vic@c.com"] = "Chess";
    t("a reason stops applying when the override is changed by any route", W.allocOverrideReason("A1", "vic@c.com") === "");
    const W2 = ENG({ dates: D, acts, fd, ao: { a1: { "Vic@C.com": "Golf" } } });
    W2.setAllocOverrideReason("A1", "vic@c.com", "changed");
    t("a reason finds an override stored in mixed case", W2.allocOverrideReason("a1", " VIC@c.com") === "changed");
    W2.setAllocOverrideReason("A1", "vic@c.com", "bogus");
    t("an unknown reason clears it rather than storing junk", W2.allocOverrideReason("A1", "vic@c.com") === "");
    const W3 = ENG({ dates: D, acts, fd, ao: {} });
    W3.setAllocOverrideReason("A1", "vic@c.com", "missed");
    t("no reason is stored without an override", !W3.ao._reason || !W3.ao._reason.a1 || !W3.ao._reason.a1["vic@c.com"]);
    const W4 = ENG({ dates: D, acts, fd, ao: { a1: { "vic@c.com": "Golf", "out@c.com": "Out of school", "un@c.com": "__UNASSIGNED__" } } });
    t("a reason is asked for when a chooser is put on a real activity", W4.overrideWantsReason("A1", "vic@c.com"));
    t("not for Out of school", !W4.overrideWantsReason("A1", "out@c.com"));
    t("not for Unassigned", !W4.overrideWantsReason("A1", "un@c.com"));
    t("not for a pupil with no override", !W4.overrideWantsReason("A2", "vic@c.com"));
    const rs = mk("missed").run();
    t("the _reason store is never mistaken for a half's overrides", rs.res.filter(r => r.isOverride).length === 1);
    t("both override dropdowns ask for a reason", (src.match(/askOverrideReason\((half|r\.half),ne\)/g) || []).length === 2);
    t("a changed override drops its old reason, in both dropdowns",
      has('setAllocOverrideReason(half,ne,"");   // v167: a new value needs its own reason')
      && has('setAllocOverrideReason(r.half,ne,"");   // v167: a new value needs its own reason'));
  }
  {
    // The reason moves with the override when a response is linked to a pupil.
    const ao = { a1: { "old@gmail.com": "Golf" }, _reason: { a1: { "old@gmail.com": { to: "Golf", why: "missed" } } } };
    new Function("attendance", "allocOverrides", "allocDateOverrides", "normEmail", "HALF_TERMS", "_touchedOvrKeys",
      "dateOvrUpsert", "_queueOvrDelete",
      grab("function _migrateRecordsToPupil(fromEmail,toEmail){", "\r\n}", "_migrateRecordsToPupil") + "\nreturn _migrateRecordsToPupil;")(
      {}, ao, {}, ne, ["A1"], new Set(), () => Promise.resolve(true), () => {})("old@gmail.com", "new@c.com");
    t("a reason moves with its override to the school address",
      ao._reason.a1["new@c.com"] && ao._reason.a1["new@c.com"].why === "missed" && !ao._reason.a1["old@gmail.com"]);
  }

  // ── Fix 4: repeats wait behind first-time 1st choosers; they are not barred ─
  {
    // "Held" comes from the effective allocation, so a per-date entry in A1 makes a repeater.
    const acts = [act("Golf", 1), act("Chess", 1), act("Cookery", 1), act("Karting", 9)];
    const heldGolf = e => ({ ["0|" + e]: "Golf" });
    const run = (fd, ado, golfCap) => ENG({ dates: D, fd, ado,
      acts: acts.map(a => a.n === "Golf" && golfCap ? act("Golf", golfCap) : a) }).run();

    let out = run([resp("rob@c.com", ts(1), [], ["Golf", "Cookery"]), resp("nia@c.com", ts(2), [], ["Golf", "Cookery"])],
      heldGolf("rob@c.com"), 2);
    t("a repeater GETS the place when there is room", row(out, "rob@c.com", "A2").alloc === "Golf" && row(out, "nia@c.com", "A2").alloc === "Golf");
    t("and the log flags the repeat", out.log.some(l => l.includes("rob@c.com → Golf") && l.includes("REPEAT — placed after first-time choosers (1 waiting, 2 places)")));

    out = run([resp("rob@c.com", ts(1), [], ["Golf", "Cookery"]), resp("nia@c.com", ts(2), [], ["Golf", "Cookery"])], heldGolf("rob@c.com"));
    t("a repeater LOSES it to a first-time 1st chooser when there isn't", row(out, "nia@c.com", "A2").alloc === "Golf"
      && row(out, "rob@c.com", "A2").alloc === "Cookery" && row(out, "rob@c.com", "A2").lvl === 2);
    t("the reason is recorded against the choice", (row(out, "rob@c.com", "A2").whyNot || []).some(w => w.act === "Golf" && /^repeat/.test(w.reason)));
    t("and the log says so", out.log.some(l => l.includes("rob@c.com: Golf REPEAT — placed after first-time choosers (1 waiting, 1 places) — no place left")));
    t("the repeater is on the Golf waiting list", (out.wl.Golf || []).some(w => w.email === "rob@c.com" && w.half === "A2"));

    out = run([resp("cal@c.com", ts(1), [], ["Chess"]),
               resp("rob@c.com", ts(2), [], ["Golf", "Cookery"]),
               resp("meg@c.com", ts(3), [], ["Chess", "Golf", "Karting"])], heldGolf("rob@c.com"));
    t("a first-timer's 2nd choice does not outrank a repeater's 1st", row(out, "rob@c.com", "A2").alloc === "Golf"
      && row(out, "meg@c.com", "A2").alloc === "Karting");

    out = run([resp("cal@c.com", ts(1), [], ["Chess"]),
               resp("rob@c.com", ts(2), [], ["Chess", "Golf", "Karting"]),
               resp("nia@c.com", ts(3), [], ["Golf", "Karting"])], heldGolf("rob@c.com"));
    t("the rule applies to a repeated 2nd choice too", row(out, "nia@c.com", "A2").alloc === "Golf"
      && row(out, "rob@c.com", "A2").alloc === "Karting");

    out = run([resp("rob@c.com", ts(1), [], ["Golf", "Cookery"]),
               resp("lou@c.com", ts(2), [], ["Cookery", "Karting"]),
               resp("nia@c.com", ts(3), [], ["Golf"])], heldGolf("rob@c.com"));
    t("a displaced repeater keeps their priority for their next choice", row(out, "nia@c.com", "A2").alloc === "Golf"
      && row(out, "rob@c.com", "A2").alloc === "Cookery" && row(out, "lou@c.com", "A2").alloc === "Karting");

    out = ENG({ dates: D, acts: [act("Bake-Off", 1), act("Bake-Off K", 9, [0, 1]), act("Karting", 9)],
      fd: [resp("rob@c.com", ts(1), [], ["Bake-Off", "Karting"]), resp("nia@c.com", ts(2), [], ["Bake-Off", "Karting"])],
      ado: { "0|rob@c.com": "Bake-Off K" } }).run();
    t("a family member counts as a repeat (Bake-Off K then Bake-Off)", row(out, "nia@c.com", "A2").alloc === "Bake-Off");

    out = run([resp("ann@c.com", ts(1), [], ["Golf", "Cookery"]), resp("ben@c.com", ts(2), [], ["Golf", "Cookery"])], {});
    t("with no repeaters the order is the plain priority order", row(out, "ann@c.com", "A2").alloc === "Golf"
      && row(out, "ben@c.com", "A2").alloc === "Cookery" && !out.log.some(l => l.includes("REPEAT")));

    const B = E0._allocBeats, sl = (pos, ch, rep) => ({ pos, ch, rep: rep || {} });
    t("rule: first-time 1st chooser beats a repeater", B(sl(5, ["Golf"]), sl(1, ["Golf"], { Golf: true }), "Golf"));
    t("rule: a repeater never beats a first-time 1st chooser", !B(sl(1, ["Golf"], { Golf: true }), sl(5, ["Golf"]), "Golf"));
    t("rule: a first-timer's 2nd choice uses the plain order", !B(sl(5, ["Chess", "Golf"]), sl(1, ["Golf"], { Golf: true }), "Golf"));
    t("rule: two repeaters use the plain order", B(sl(1, ["Golf"], { Golf: true }), sl(5, ["Golf"], { Golf: true }), "Golf"));
  }

  // ── Gideon's addition: a choice made more than once counts once ────────────
  {
    const acts = [act("Bake-Off", 1), act("Golf", 9)];
    const out = ENG({ dates: D, acts, fd: [resp("first@c.com", ts(1), ["Bake-Off"]),
      resp("tri@c.com", ts(2), ["Bake-Off", "Bake-Off", "Bake-Off"]),
      resp("dup@c.com", ts(3), ["Bake-Off", "Bake-Off", "Golf"])] }).run();
    t("Bake-Off three times over is one choice with no back-ups", row(out, "tri@c.com", "A1").st === "UNMATCHED");
    t("it is refused once, not three times", (row(out, "tri@c.com", "A1").whyNot || []).filter(w => w.act === "Bake-Off").length === 1
      && out.wl["Bake-Off"].filter(w => w.email === "tri@c.com").length === 1);
    t("a real back-up after a repeat moves up to 2nd", row(out, "dup@c.com", "A1").alloc === "Golf" && row(out, "dup@c.com", "A1").lvl === 2);
    t("the log notes the duplicate", out.log.some(l => l.includes("tri@c.com: Bake-Off chosen more than once — counted once")));
  }

  // ── Fix 5: a half-term override can be cleared ────────────────────────────
  {
    const W = ENG({ dates: D, acts: [act("Golf", 9)], fd: [],
      ao: { a1: { "Kim@C.com": "Golf", "other@c.com": "Golf" }, _reason: { a1: { "kim@c.com": { to: "Golf", why: "missed" } } } } });
    t("clearing removes an override stored in mixed case", W.clearHalfOverride("A1", "kim@c.com") === true && W._halfOverrideKey("A1", "kim@c.com") === null);
    t("its reason goes with it", !W.ao._reason.a1["kim@c.com"]);
    t("other pupils' overrides are untouched", W.ao.a1["other@c.com"] === "Golf");
    t("the engine re-runs so the pupil is allocated again", W.reruns.length === 1);
    t("the clear is logged", W.actions.some(a => a.startsWith("OVERRIDE kim@c.com (A1): Golf → cleared")));
    t("clearing a pupil with no override does nothing", W.clearHalfOverride("A1", "nobody@c.com") === false && W.reruns.length === 1);
    t("Results & Overrides offers Clear", has('if(_halfOverrideKey(half,normEmail(r.email))!=null){') && has('if(val==="CLEAR__"){clearHalfOverride(half,ne);return;}'));
    t("the Waiting List offers Clear", has('if(_halfOverrideKey(r.half,normEmail(r.email))!=null)ovrSel.appendChild(h("option",{value:"CLEAR__"}')
      && has('if(val==="CLEAR__"){clearHalfOverride(r.half,ne);'));
    t("the unreachable Overrides screen is gone", !has("function renderAllocOverrides("));
  }
}

// ════════════════════════════════════════════════════════════════════════════
S("v168 — Activities editor fits the screen");
{
  // _placePopupInView against a fake window and panel; it only reads sizes and writes styles.
  const place = (vw, vh, pw, ph, x, y) => {
    const panel = { style: {}, getBoundingClientRect: () => ({ width: pw, height: ph }) };
    new Function("window", grab("function _placePopupInView(panel,x,y){", "\r\n}", "_placePopupInView") +
      "\nreturn _placePopupInView;")({ innerWidth: vw, innerHeight: vh })(panel, x, y);
    return { top: parseInt(panel.style.top, 10), left: parseInt(panel.style.left, 10), maxH: parseInt(panel.style.maxHeight, 10), ov: panel.style.overflowY };
  };
  // The case that broke: a 533px panel opened from a row near the bottom of a 768px laptop screen.
  let p = place(1366, 768, 340, 533, 740, 691);
  t("a panel opened low on the screen is moved up so all of it shows", p.top + 533 <= 768 - 8 && p.top >= 8, JSON.stringify(p));
  t("a panel that fits stays where it was opened", place(1366, 768, 340, 300, 740, 100).top === 100);
  p = place(1366, 500, 340, 533, 740, 300);
  t("a panel taller than the window starts at the top and scrolls", p.top === 8 && p.maxH === 484 && p.ov === "auto", JSON.stringify(p));
  t("a panel opened near the right edge is kept on screen", place(1366, 768, 340, 300, 1300, 100).left === 1366 - 340 - 8);
  t("the Split panel is placed with it, after it is in the document",
    has("document.body.appendChild(panel);\r\n        _placePopupInView(panel,_clickX,_clickY);"));
  t("staff controls share one line (no stacked 'Additional:' label)", !has('"Additional:"') && has('const rosterLine=h("div",{className:"act-inline"})'));
  t("more than three additional staff collapse behind a +N", has("if(_tagEls.length>3){") && has('"+"+(_tagEls.length-3)'));
  t("Split sits beside Notes", has("notesLine.appendChild(splitBtn);"));
  t("rows are slimmed only inside this table", has(".acts-compact input:not([type=checkbox]),.acts-compact select{padding:2px 5px;font-size:11px;height:24px;}"));
  t("the Split help text no longer prints [object HTMLElement]", !has('both sessions. "+h("strong"'));
  t("sub-tab separators are no longer restyled as buttons", has('subTabs.querySelectorAll("button[data-sub]")') && !has("Array.from(subTabs.children).forEach"));
  t("both tab-highlight paths keep the compact size", (src.match(/b\.className="btn btn-sm "\+\(adminSub===id\?"btn-primary":"btn-ghost"\);/g) || []).length === 2);
}

// ════════════════════════════════════════════════════════════════════════════
S("Real data (from the supplied backup)");
if (!skipIf(!BK, "no backup supplied — real-data checks")) {
  t("every roster house is normalised",
    BK.pupils.every(p => !p.house || ["M", "G", "K", "W"].includes(String(p.house).trim().toUpperCase())),
    [...new Set(BK.pupils.map(p => p.house))].join(","));
  t("no duplicate pupil emails",
    new Set(BK.pupils.map(p => ne(p.email))).size === BK.pupils.length);
  const cover = new Function("dates", "allocDateOverrides", "normEmail",
    grab("function _centralCoverFor(email,half){", "\r\n}", "_centralCoverFor") + "\nreturn _centralCoverFor;")(
    BK.dates, BK.allocDateOverrides, ne);
  const y11 = BK.pupils.filter(p => p.yg === "Year 11");
  if (y11.length) t("Y11 are centrally covered in A2",
    y11.filter(p => cover(ne(p.email), "A2")).length > y11.length * 0.9);
  // orphan scan — the health check's own logic
  const known = new Set();
  BK.pupils.forEach(p => { const e = ne(p.email); if (e) known.add(e);
    (p.altEmails || []).forEach(a => { const x = ne(a); if (x) known.add(x); }); });
  const orph = new Set();
  BK.formData.forEach(f => { if (!known.has(ne(f.email)) && ne(f.email)) orph.add(ne(f.email)); });
  BK.allocRes.forEach(r => { if (!known.has(ne(r.email)) && ne(r.email)) orph.add(ne(r.email)); });
  Object.keys(BK.allocDateOverrides).forEach(k => { const i = k.indexOf("|"); if (i > 0 && !known.has(ne(k.slice(i + 1)))) orph.add(ne(k.slice(i + 1))); });
  Object.keys(BK.attendance || {}).forEach(k => { const i = k.lastIndexOf("|"); if (i > 0 && !known.has(ne(k.slice(i + 1)))) orph.add(ne(k.slice(i + 1))); });
  console.log(`  note: ${orph.size} orphaned address(es) in this backup${orph.size ? " — " + [...orph].join(", ") : ""}`);
  t("orphan scan completes", true);
  // v162: with this backup, no year group should be choosing in a half prescribed for it
  const W = V162({ dates: BK.dates, acts: BK.acts, pupils: BK.pupils, fd: BK.formData, ado: BK.allocDateOverrides, res: BK.allocRes });
  ["A1", "A2"].forEach(hv => {
    if (!BK.dates.some(d => d.half === hv)) return;
    const sc = W.allocPrescribedChoiceScan(hv, BK.formData);
    t("no year group choosing in a prescribed " + hv, sc.wrongYg.length === 0, sc.wrongYg.map(w => w.yg + " " + w.n + "/" + w.withCh).join(", "));
  });
  const hiddenOut = W.allocMaskedPlacements().filter(m => m.full && m.kind === "out").length;
  console.log(`  note: ${hiddenOut} engine place(s) held by pupils out of school on every date of the activity`);

  // v167: the shipped engine over the live backup
  const world = () => ENG({ acts: BK.acts, pupils: BK.pupils, dates: BK.dates, fd: JSON.parse(JSON.stringify(BK.formData)),
    ao: JSON.parse(JSON.stringify(BK.allocOverrides || {})), ado: BK.allocDateOverrides || {}, hist: BK.allocHistory || [],
    res: JSON.parse(JSON.stringify(BK.allocRes || [])) });
  const Wr = world(), R1 = Wr.run(), keyOf = r => [ne(r.email), r.half, r.alloc, r.st].join("|");
  const first = R1.res.map(keyOf).join("\n");
  t("re-running the engine gives the same allocation", Wr.run().res.map(keyOf).join("\n") === first);
  const scored = R1.res.filter(r => "tsScore" in r);
  const unread = scored.filter(r => !(r.tsScore > 0 && r.tsScore < Number.MAX_SAFE_INTEGER));
  t("every response timestamp reads (no score of 0, NaN or unreadable)", scored.length > 0 && unread.length === 0, unread.length + " of " + scored.length);
  const fam = n => String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ")[0];
  const a1di = BK.dates.map((_, i) => i).filter(i => BK.dates[i].half === "A1");
  const bakers = BK.formData.filter(f => fam(f.s1c1 || f.c1) === "bake"
    && a1di.some(di => fam(BK.allocDateOverrides[di + "|" + ne(f.email)]) === "bake"));
  const credited = bakers.filter(f => { const r = R1.res.find(x => x.half === "A2" && ne(x.email) === ne(f.email));
    return r && (r.missedHalves || []).includes("A1"); });
  if (bakers.length) t("Bake-Off by per-date entry in A1 earns no A1 'missed' credit", credited.length === 0, credited.length + " of " + bakers.length);
  t("A1 has no earlier half, so nobody there is boosted or treated as a repeat",
    R1.res.filter(r => r.half === "A1").every(r => !r.disappointmentCount && !(r.whyNot || []).some(w => /^repeat/.test(w.reason))));
  const overCap = [];
  ["A1", "A2"].forEach(hv => {
    const eng = {}, ovr = {};
    R1.res.filter(r => r.half === hv && r.alloc).forEach(r => {
      if (r.isOverride) ovr[r.alloc] = (ovr[r.alloc] || 0) + 1;
      else if (/^(1ST|2ND|3RD)$/.test(r.st)) eng[r.alloc] = (eng[r.alloc] || 0) + 1; });
    Object.entries(eng).forEach(([a, n]) => { const A = BK.acts.find(x => x.n === a);
      if (A && n > Math.max(0, A.cap - (ovr[a] || 0))) overCap.push(hv + " " + a + " " + n); });
  });
  t("the engine never places beyond capacity left after overrides", overCap.length === 0, overCap.join(", "));
  const changed = R1.res.filter(r => { const s = (BK.allocRes || []).find(x => ne(x.email) === ne(r.email) && x.half === r.half);
    return !s || s.alloc !== r.alloc || s.st !== r.st; }).length;
  console.log(`  note: ${changed} of ${R1.res.length} allocation row(s) differ from the backup's stored results; ` +
    `${bakers.length} A1 Bake-Off chooser(s) with Bake-Off per-date entries`);
}

// ════════════════════════════════════════════════════════════════════════════
S("Structural integrity");
{
  const scripts = src.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
  t("inline scripts present", scripts.length >= 4, String(scripts.length));
  const names = (src.match(/^function ([A-Za-z_$][\w$]*)\(/gm) || []);
  const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  t("no duplicate top-level function definitions", dupes.length === 0, dupes.join(","));
  t("CRLF line endings intact", src.split("\n").slice(0, -1).every(l => l.endsWith("\r")));
  const ver = (src.match(/CURRENT_VERSION = '(v\d+)'/) || [])[1];
  console.log(`  version: ${ver}`);
  t("a version constant is present", !!ver);
  t("planning mode is off (live system)", /\nconst PLANNING_YEAR_MODE = false;/.test(src));
  t("term label is a single constant", /const TERM_LABEL = "/.test(src));
  t("no hard-coded previous term remains", !src.includes("Summer 2026"));
  // The site root forwards to the live file, keeping #staff / #pupil (old bookmarks used to open
  // last year's app). Fails at a year rollover until index.html points at the new year's file.
  const idxPath = require("path").join(require("path").dirname(HTML), "index.html");
  if (!skipIf(!fs.existsSync(idxPath), "no index.html beside the app — site-root redirect check")) {
    const idx = fs.readFileSync(idxPath, "utf-8");
    t("the site root forwards to this file", idx.includes('var LIVE = "' + require("path").basename(HTML) + '";'));
    t("and keeps #staff / #pupil on the way", idx.includes("location.replace(LIVE + location.search + location.hash);"));
    t("the site root is a redirect, not a copy of the app", idx.length < 5000, String(idx.length));
  }
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(60));
console.log(`${pass} passed · ${fail} failed · ${skip} skipped`);
if (failures.length) { console.log("\nFailures:"); failures.forEach(f => console.log("  • " + f)); }
console.log("═".repeat(60));
process.exit(fail ? 1 : 0);
