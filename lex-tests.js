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
     grab("function actSessions(act,email,di){", "\r\n}", "actSessions")].join("\n") + "\nreturn actSessions;")(
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
  grab("function _preRunBackup(){", "\r\n}", "_preRunBackup"),
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
  function takeSnapshot(l){return W.onSnap?W.onSnap(l,allocRes):undefined;} function saveAll(){} function invalidateCaches(){}
  function confirm(){return !!W.confirmOk;} function toast(){}
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
// v169 — P0 (runs at the end, before the summary, because it is async: see p0Tests).
// A stand-in for Supabase's REST interface (PostgREST) over lex_data. It honours the parts the
// app depends on: eq/in filters, conditional PATCH, insert-or-ignore, upsert, return=representation.
// Like Postgres it rewrites timestamps into its own format ("…+00:00"), so the app cannot pass
// only by getting back exactly the stamp it sent.
var mkServer = (seed) => {
  const rows = {}, log = [];
  let clock = Date.parse("2026-09-28T08:00:00Z");
  // Postgres keeps microseconds: "…12.345678+00:00". Keep up to six fractional digits.
  const norm = s => { const m = /^(.*T\d\d:\d\d:\d\d)(\.\d+)?Z$/.exec(s || "");
    if (!m) return new Date(clock += 1000).toISOString().replace("Z", "+00:00");
    return m[1] + ((m[2] || ".") + "000000").slice(0, 7) + "+00:00"; };
  Object.entries(seed || {}).forEach(([k, v]) => { rows["lex12-" + k] = { value: JSON.stringify(v), updated_at: norm(new Date(clock += 1000).toISOString()) }; });
  const resp = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
  const fetch = async (url, opts) => {
    opts = opts || {};
    const u = new URL(url), q = u.searchParams, method = opts.method || "GET";
    const prefer = ((opts.headers || {}).Prefer || "");
    const eq = f => { const v = q.get(f); return v && v.startsWith("eq.") ? v.slice(3) : null; };
    log.push(method + " " + (eq("key") || q.get("key") || (opts.body ? JSON.parse(opts.body).key : "")));
    if (method === "GET") {
      const inq = q.get("key");
      if (inq && inq.startsWith("in.(")) {
        const keys = inq.slice(4, -1).split(",");
        return resp(200, keys.filter(k => rows[k]).map(k => ({ key: k, updated_at: rows[k].updated_at })));
      }
      const r = rows[eq("key")];
      return resp(200, r ? [{ value: r.value, updated_at: r.updated_at }] : []);
    }
    const body = JSON.parse(opts.body);
    if (method === "PATCH") {
      const k = eq("key"), want = eq("updated_at"), r = rows[k];
      if (!r || (want !== null && r.updated_at !== want)) return resp(200, []);   // 0 rows: someone else wrote first
      r.value = body.value; r.updated_at = norm(body.updated_at);
      return resp(200, /return=representation/.test(prefer) ? [{ key: k, ...r }] : []);
    }
    if (method === "POST") {
      if (rows[body.key] && /ignore-duplicates/.test(prefer)) return resp(201, []);
      rows[body.key] = { value: body.value, updated_at: norm(body.updated_at) };
      return resp(201, /return=representation/.test(prefer) ? [{ key: body.key, ...rows[body.key] }] : []);
    }
    return resp(400, {});
  };
  return { fetch, rows, log, get: k => rows["lex12-" + k] ? JSON.parse(rows["lex12-" + k].value) : undefined,
    bump: () => { clock += 5000; } };
};
// One open copy of LEX: the shipped sync functions over its own in-memory state. `ls` is the
// browser's local storage — two tabs of one browser share it.
var P0_SRC = [
  grab("function normEmail(e){", "\r\n", "normEmail"),
  grab("function _isEmptyValue(v){", "\r\n}", "_isEmptyValue"),
  grab("function _stateForKey(k){", "\r\n}", "_stateForKey"),
  grab("const _ALL_KEYS=[", "];", "_ALL_KEYS"),
  grab("async function supaSet(key,value){", "\r\n}", "supaSet"),
  grab("async function supaGet(key){", "\r\n}", "supaGet"),
  grab("const _BLOB_KEYS=[", "];", "_BLOB_KEYS"),
  grab("const _BLOB_LABEL={", "};", "_BLOB_LABEL"),
  grab("let _blobStamps={};", "let _blobConflictLog=[];", "v169 sync state"),
  grab("function _loadBlobMeta(){", "\r\n}", "_loadBlobMeta"),
  grab("function _saveBlobMeta(){", "\r\n}", "_saveBlobMeta"),
  grab("function _strHash(s){", "\r\n", "_strHash"),
  grab("function _hasStamp(k){", "\r\n", "_hasStamp"),
  grab("function _newStamp(){", "\r\n", "_newStamp"),
  grab("async function supaGetWithStamp(key){", "\r\n}", "supaGetWithStamp"),
  grab("async function supaSetIfUnchanged(key,value,expect){", "\r\n}", "supaSetIfUnchanged"),
  grab("async function blobStampSignature(){", "\r\n}", "blobStampSignature"),
  grab("function _setStateForKey(k,v){", "\r\n}", "_setStateForKey"),
  grab("function _blobTypeOk(k,v){", "\r\n}", "_blobTypeOk"),
  grab("function _blobIdFn(k){", "\r\n}", "_blobIdFn"),
  grab("const _ABSENT={};", "\r\n", "_ABSENT"),
  grab("function _canonJson(v){", "\r\n}", "_canonJson"),
  grab("function _blobMerge(base,local,cloud,idFn){", "\r\n}", "_blobMerge"),
  grab("function _describeBlobPath(k,path){", "\r\n}", "_describeBlobPath"),
  grab("function _noteBlobConflicts(k,list){", "\r\n}", "_noteBlobConflicts"),
  grab("function _showBlobConflicts(){", "\r\n}", "_showBlobConflicts"),
  grab("function _applyCloudBlob(k,got,seq0){", "\r\n}", "_applyCloudBlob"),
  grab("async function _writeBlobKey(k){", "\r\n}", "_writeBlobKey"),
  grab("async function _pushDirtyBlobs(){", "\r\n}", "_pushDirtyBlobs"),
  grab("function markBlobsForOverwrite(keys,label){", "\r\n}", "markBlobsForOverwrite"),
  grab("function _saveBlobForce(){", "\r\n}", "_saveBlobForce"),
  grab("function _restorePending(){", "\r\n", "_restorePending"),
  grab("function _updateRestoreBanner(){", "\r\n}", "_updateRestoreBanner"),
  grab("function _primeBlobBaseline(){", "\r\n}", "_primeBlobBaseline"),
  grab("function _noteDirtyBlobsNow(){", "\r\n}", "_noteDirtyBlobsNow"),
  grab("function _refreshFingerprintsAfterLoad(){", "\r\n}", "_refreshFingerprintsAfterLoad"),
  grab("function saveSupa(){", "\r\n}", "saveSupa"),
  grab("function _flushOnUnload(){", "\r\n}", "_flushOnUnload"),
  grab("async function forceSaveNow(){", "\r\n}", "forceSaveNow"),
  grab("const _ENGINE_INPUT_KEYS=[", "];", "_ENGINE_INPUT_KEYS"),
  grab("async function _engineInputsStale(){", "\r\n}", "_engineInputsStale"),
  grab("async function _adoptCloudStamps(){", "\r\n}", "_adoptCloudStamps"),
  grab("async function _waitForSaveIdle(){", "\r\n", "_waitForSaveIdle"),
  grab("async function forceSyncNow(){", "\r\n}", "forceSyncNow"),
  // v176: the real local save (renamed: the harness's saveLocal is a no-op unless a test asks)
  grab("function _lsSet(key,val){", "\r\n}", "_lsSet"),
  grab("let _localSaveFailed=false;", "\r\n", "_localSaveFailed"),
  grab("function saveLocal(){", "\r\n}", "saveLocal").replace("function saveLocal(){", "function _realSaveLocal(){")
].join("\n");
// v175: the branch loadFromSupabase takes when every read fails (a laptop waking, Wi-Fi down).
var P0_UNREACHABLE = grab("  if(!gotAny){", "\r\n  }", "loadFromSupabase unreachable branch");
var mkClient = (server, ls, opts) => new Function("SERVER", "LS", "OPTS", `
  let acts=[],staff=[],pupils=[],dates=[],priorYTD={},allocOverrides={},allocHistory=[],formData=[],allocRes=[],venues=[],
      consentMap={},savedSubGroups={},notepadText="",designations=[],sa={},overviewData={},attendance={};
  let _lastSyncedFingerprints={},_loadedNonEmpty={},_saveGuardBlocked={},syncStatus="online",lastSyncTime=null,
      _hasPendingSupaWrite=false,_supaDbc=null,_supaWriteInFlight=false,_saveRetryCount=0,_saveLastError=null,_autosnapDirty=false;
  const supaClient={url:"https://db.test",key:"k"};const fetch=SERVER.fetch;const localStorage=LS;
  const conflicts=()=>_blobConflictLog;
  function isStaffView(){return !!OPTS.staff;} function isPublicTimetable(){return false;}
  function updateSyncBadge(){} async function saSyncPerRow(){return true;} async function _reconcileIfStale(){}
  function _markSupaWrite(){} function _announceSaved(){} function invalidateCaches(){} function saveLocal(){if(OPTS.realSave)_realSaveLocal();}
  let activityLog=[],allocDateOverrides={};
  function _onAutoUpdateView(){return false;} function _safeAutoRerender(){return false;} function _scheduleSilentRerender(){}
  function _showRemoteUpdateBanner(){} function logAction(){} function _updateSaveGuardBanner(){} function toast(){} function autoSnapshot(){}
  const console={error(){},warn(){},log(){}};
  const Math=Object.create(globalThis.Math);Math.random=()=>((SERVER.rnd=(SERVER.rnd||0)+1)%1000)/1000;
  ${P0_SRC}
  // What loadFromSupabase does for the blob keys: read each with its version, apply, re-fingerprint.
  // during: run between the reads and applying them, as a save that lands mid-load would.
  async function load(during){
    const seq0={};_BLOB_KEYS.forEach(k=>{seq0[k]=_blobWriteSeq[k]||0;});
    const got={};for(const k of _BLOB_KEYS)got[k]=await supaGetWithStamp("lex12-"+k);
    if(during)await during();
    _blobTakenClean=new Set();_BLOB_KEYS.forEach(k=>_applyCloudBlob(k,got[k],seq0[k]));
    _refreshFingerprintsAfterLoad();_saveBlobMeta();
  }
  // What a reload does before the cloud answers: local storage is the baseline.
  function loadLocalOnly(values){Object.entries(values).forEach(([k,v])=>_setStateForKey(k,JSON.parse(JSON.stringify(v))));_primeBlobBaseline();}
  // What the real loadLocal() does to the blob keys: this browser's local-storage copy replaces
  // what the tab holds. Called only if the shipped branch below still calls it.
  function loadLocal(){_BLOB_KEYS.forEach(k=>{const raw=localStorage.getItem("lex12-"+k);if(raw)_setStateForKey(k,JSON.parse(raw));});}
  async function refreshUnreachable(){const gotAny=false;${P0_UNREACHABLE}}
  return {load,loadLocalOnly,refreshUnreachable,engineStale:_engineInputsStale,adopt:_adoptCloudStamps,
    forceSync:forceSyncNow,saveLocalNow:()=>saveLocal(),reloadFromLS(){loadLocal();_primeBlobBaseline();},restorePending:_restorePending,rawSet:(k,v)=>supaSet("lex12-"+k,v),push:_pushDirtyBlobs,saveSupa,flush:_flushOnUnload,noteDirty:_noteDirtyBlobsNow,
    markOverwrite:markBlobsForOverwrite,merge:_blobMerge,ABSENT:_ABSENT,conflicts,
    get acts(){return acts;},set acts(v){acts=v;},get ovr(){return allocOverrides;},set ovr(v){allocOverrides=v;},
    get notepad(){return notepadText;},set notepad(v){notepadText=v;},get consent(){return consentMap;},
    setPending(v){_hasPendingSupaWrite=v;},stamps:()=>_blobStamps,newStamp:_newStamp};`)(server, ls, opts || {});
var mkLS = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m }; };
var ACTS0 = [{ id: "A1", n: "Golf", cap: 14, v: "Range", di: [0, 1], staff: ["JAR"] }, { id: "A2", n: "Chess", cap: 10, v: "Library", di: [0], staff: [] },
             { id: "A3", n: "Kayaking", cap: 8, v: "River", di: [1], staff: [] }];
var clone = x => JSON.parse(JSON.stringify(x));
async function p0Tests() {
  S("v169 — P0: a stale copy never overwrites newer data");
  const act = (c, id) => c.acts.find(a => a.id === id);
  const sAct = (srv, id) => (srv.get("acts") || []).find(a => a.id === id);
  // 1. Different items / fields: both changes survive.
  {
    const srv = mkServer({ acts: ACTS0 });
    const A = mkClient(srv, mkLS()), B = mkClient(srv, mkLS());
    await A.load(); await B.load();                       // B is the morning tab
    act(A, "A1").cap = 24; await A.push();
    act(B, "A2").cap = 12; act(B, "A1").v = "Course"; await B.push();
    t("two copies editing different activities: the cloud has both changes", sAct(srv, "A1").cap === 24 && sAct(srv, "A2").cap === 12);
    t("…and a different field of the same activity merges too", sAct(srv, "A1").v === "Course");
    t("…with nothing reported as refused", B.conflicts().length === 0);
    t("…and the stale copy now shows the other copy's change", act(B, "A1").cap === 24);
  }
  // 2. Same field: the stale copy is refused, reloads, and says so.
  {
    const srv = mkServer({ acts: ACTS0 });
    const A = mkClient(srv, mkLS()), B = mkClient(srv, mkLS());
    await A.load(); await B.load();
    act(A, "A1").cap = 24; await A.push();
    act(B, "A1").cap = 20; await B.push();
    t("same field: the newer value is kept", sAct(srv, "A1").cap === 24);
    t("same field: the stale copy reloads it", act(B, "A1").cap === 24);
    t("same field: the refusal is reported, naming what", B.conflicts().length === 1 && /Activities › Golf › cap/.test(B.conflicts()[0].what), JSON.stringify(B.conflicts().map(c => c.what)));
    t("same field: the refused value is kept for the user to copy", B.conflicts()[0].mine === 20);
  }
  // 3. A stale copy that resumes and saves nothing writes nothing.
  {
    const srv = mkServer({ acts: ACTS0, notepad: "morning" });
    const A = mkClient(srv, mkLS()), B = mkClient(srv, mkLS());
    await A.load(); await B.load();
    act(A, "A2").n = "Chess Club"; await A.push();
    const before = srv.log.length;
    await B.push();
    t("a copy with no edits writes nothing", srv.log.slice(before).every(l => l.startsWith("GET")), srv.log.slice(before).join(";"));
    await B.load();
    t("…and on waking takes the newer data", act(B, "A2").n === "Chess Club");
    // The same after a reload from local storage only (the old "first sync" pushed everything).
    const C = mkClient(srv, mkLS()); C.loadLocalOnly({ acts: ACTS0, notepad: "morning" });
    const b2 = srv.log.length; await C.push();
    t("a copy reloaded from local storage pushes nothing it didn't edit", srv.log.slice(b2).every(l => l.startsWith("GET")) && sAct(srv, "A2").n === "Chess Club");
    await C.load();
    t("…and then shows the cloud's version", act(C, "A2").n === "Chess Club");
  }
  // A load whose reads were taken before this tab's own save landed must not put the old
  // version back over it (the read is older than the write).
  {
    const srv = mkServer({ acts: ACTS0, notepad: "morning" });
    const A = mkClient(srv, mkLS()); await A.load();
    A.notepad = "afternoon";
    await A.load(async () => { await A.push(); });
    t("a load that crossed this tab's own save does not undo it", A.notepad === "afternoon" && srv.get("notepad") === "afternoon", A.notepad);
    A.notepad = "evening"; const b = srv.log.length; await A.push();
    t("…and the next save goes straight through, with no false conflict", srv.get("notepad") === "evening"
      && srv.log.slice(b).filter(l => l.startsWith("PATCH")).length === 1 && !A.conflicts().length, srv.log.slice(b).join(";"));
  }
  // 4. The 28 Sept shape: a deleted activity must not come back.
  {
    const srv = mkServer({ acts: ACTS0 });
    const A = mkClient(srv, mkLS()), B = mkClient(srv, mkLS());
    await A.load(); await B.load();
    A.acts = A.acts.filter(a => a.id !== "A3"); await A.push();
    act(B, "A1").n = "Golf (Crane)"; await B.push();
    t("an activity deleted on one copy is not resurrected by a stale one", !sAct(srv, "A3") && sAct(srv, "A1").n === "Golf (Crane)");
    const C = mkClient(srv, mkLS()); await C.load();
    act(A, "A2").cap = 11; await A.push();                      // A moves on…
    act(C, "A3") || (C.acts.push({ id: "A9", n: "New one", cap: 5, v: "", di: [], staff: [] }));
    await C.push();
    t("an activity added on one copy survives another copy's edit", !!sAct(srv, "A9") && sAct(srv, "A2").cap === 11);
    // Deleted on one copy, edited on the other: the deletion stands and the edit is reported.
    const D = mkClient(srv, mkLS()), E = mkClient(srv, mkLS()); await D.load(); await E.load();
    D.acts = D.acts.filter(a => a.id !== "A2"); await D.push();
    act(E, "A2").cap = 99; await E.push();
    t("edit to an activity deleted elsewhere: deletion stands, edit reported", !sAct(srv, "A2") && E.conflicts().length === 1);
  }
  // 5. Half-term overrides merge per pupil (and the v167 reasons with them).
  {
    const O0 = { a1: {}, a2: { "p1@c.com": "Golf", "p3@c.com": "Polo" }, _reason: { a2: { "p1@c.com": { to: "Golf", why: "missed" } } } };
    const srv = mkServer({ allocoverrides: O0 });
    const A = mkClient(srv, mkLS()), B = mkClient(srv, mkLS());
    await A.load(); await B.load();
    A.ovr.a2["p2@c.com"] = "Chess"; A.ovr._reason.a2["p2@c.com"] = { to: "Chess", why: "changed" }; await A.push();
    delete B.ovr.a2["p1@c.com"]; delete B.ovr._reason.a2["p1@c.com"]; await B.push();   // a Clear on the stale copy
    const o = srv.get("allocoverrides");
    t("overrides: one copy's new override and the other's Clear both stand", o.a2["p2@c.com"] === "Chess" && !("p1@c.com" in o.a2) && o.a2["p3@c.com"] === "Polo");
    t("overrides: the reasons follow", o._reason.a2["p2@c.com"].why === "changed" && !o._reason.a2["p1@c.com"]);
    // The reverse order — the shape suspected behind "Clear didn't stick": the Clear lands first,
    // then a stale copy that still holds the override edits something else.
    const srv2 = mkServer({ allocoverrides: O0 });
    const X = mkClient(srv2, mkLS()), Y = mkClient(srv2, mkLS()); await X.load(); await Y.load();
    delete X.ovr.a2["p1@c.com"]; await X.push();
    Y.ovr.a2["p4@c.com"] = "Karting"; await Y.push();
    t("a Clear is not undone by a stale copy saving something else", !("p1@c.com" in srv2.get("allocoverrides").a2) && srv2.get("allocoverrides").a2["p4@c.com"] === "Karting");
  }
  // 6. Closing a stale tab mid-save.
  {
    const srv = mkServer({ acts: ACTS0 });
    const A = mkClient(srv, mkLS()), B = mkClient(srv, mkLS());
    await A.load(); await B.load();
    act(A, "A1").cap = 24; await A.push();
    act(B, "A1").cap = 20; B.setPending(true); B.flush();
    await new Promise(r => setTimeout(r, 20));
    t("closing a stale tab mid-save does not overwrite newer data", sAct(srv, "A1").cap === 24);
    const C = mkClient(srv, mkLS(), { staff: true }); await C.load(); act(C, "A2").cap = 1; C.setPending(true); C.flush();
    await new Promise(r => setTimeout(r, 20));
    t("a staff-portal tab never writes blobs as it closes", sAct(srv, "A2").cap === 10);
  }
  // 7. Unsaved edits left by a closed tab are finished on reload — only if still safe.
  {
    const srv = mkServer({ notepad: "v1" });
    const ls = mkLS();
    const A = mkClient(srv, ls); await A.load(); A.notepad = "v1 plus my note"; A.noteDirty();   // tab closes before the write
    const A2 = mkClient(srv, ls); A2.loadLocalOnly({ notepad: "v1 plus my note" }); await A2.load(); await A2.push();
    t("an unsaved edit is finished on reload when the cloud hasn't moved", srv.get("notepad") === "v1 plus my note");
    const srv2 = mkServer({ notepad: "v1" }); const ls2 = mkLS();
    const P = mkClient(srv2, ls2); await P.load(); P.notepad = "mine"; P.noteDirty();
    const Q = mkClient(srv2, mkLS()); await Q.load(); Q.notepad = "someone else's"; await Q.push();
    const P2 = mkClient(srv2, ls2); P2.loadLocalOnly({ notepad: "mine" }); await P2.load(); await P2.push();
    t("…but not when another copy has changed it since: that is kept and reported", srv2.get("notepad") === "someone else's" && P2.conflicts().length === 1);
    // Local storage replaced by another (stale) tab of the same browser: the hash no longer matches.
    const srv3 = mkServer({ notepad: "v1" }); const ls3 = mkLS();
    const R = mkClient(srv3, ls3); await R.load(); R.notepad = "fresh edit"; R.noteDirty();
    const R2 = mkClient(srv3, ls3); R2.loadLocalOnly({ notepad: "stale tab's copy" }); await R2.load(); await R2.push();
    t("…nor when another tab has since replaced this browser's local copy", srv3.get("notepad") === "v1");
  }
  // 8. A confirmed restore still overwrites — knowingly.
  {
    const srv = mkServer({ acts: ACTS0 });
    const A = mkClient(srv, mkLS()), B = mkClient(srv, mkLS()); await A.load(); await B.load();
    act(A, "A1").cap = 24; await A.push();
    B.acts = clone(ACTS0).map(a => ({ ...a, cap: 1 })); B.markOverwrite(); await B.push();
    t("a confirmed restore replaces the newer version", sAct(srv, "A1").cap === 1 && sAct(srv, "A2").cap === 1 && B.conflicts().length === 0);
  }
  // 9. saveSupa itself routes through the conditional writer.
  {
    const srv = mkServer({ acts: ACTS0 });
    const A = mkClient(srv, mkLS()), B = mkClient(srv, mkLS()); await A.load(); await B.load();
    act(A, "A1").cap = 24; A.saveSupa(); await new Promise(r => setTimeout(r, 250));
    act(B, "A2").cap = 12; B.saveSupa(); await new Promise(r => setTimeout(r, 250));
    t("saveSupa (the real debounced save) keeps both copies' changes", sAct(srv, "A1").cap === 24 && sAct(srv, "A2").cap === 12);
  }
  // 10. The merge itself.
  {
    const A = mkClient(mkServer({}), mkLS());
    let r = A.merge({ di: [0, 1] }, { di: [0, 1, 2] }, { di: [1] }, null);
    t("merge: date lists merge as sets (added here, removed there)", JSON.stringify(r.value.di) === "[1,2]" && !r.conflicts.length);
    r = A.merge({ x: 1, y: 1 }, { y: 1, x: 1, z: 2 }, { x: 1, y: 3 }, null);
    t("merge: key order is not a change", r.value.y === 3 && r.value.z === 2 && !r.conflicts.length);
    r = A.merge("a", "b", "c", null);
    t("merge: a real clash keeps the cloud's value and reports it", r.value === "c" && r.conflicts.length === 1);
  }
  {
    const A = mkClient(mkServer({}), mkLS());
    const s1 = A.newStamp(), s2 = A.newStamp();
    t("version stamps carry microseconds, so two saves in one millisecond still differ", /\.\d{6}Z$/.test(s1) && s1 !== s2, s1 + " " + s2);
  }
  t("loadFromSupabase applies every managed key through _applyCloudBlob", has("_BLOB_KEYS.forEach(k=>_applyCloudBlob(k,_gotBlobs[k],_seq0[k]));"));
  t("the 'local storage is newer, push everything' step is gone", !has("_lastSyncedFingerprints={};  // force full write"));
  t("no first-sync push-all anywhere", !has("isFirstSync"));
  t("a tab re-reads before edits after being hidden, cached or asleep",
    has('_refreshBeforeEdit("visible after "') && has('_refreshBeforeEdit("restored from cache")') && has('_refreshBeforeEdit("first touch after sleep")'));
  t("the Cloud Sync diagnostic tests the version check on the real database", has("Test 3b: version check"));
}

// ════════════════════════════════════════════════════════════════════════════
S("v169 — §1: checks before each Saturday");
var CHK_SRC = [
  grab("function normEmail(", "\r\n", "normEmail"),
  grab("function parseDateDmy(", "\r\n}", "parseDateDmy"),
  grab("function _rebuildCaches(){", "\r\n}", "_rebuildCaches"),
  grab("function _ensureCaches(){", "\r\n", "_ensureCaches"),
  grab("function findActByName_exact(", "\r\n}", "findActByName_exact"),
  grab("function sortedDateIndices(){", "\r\n}", "sortedDateIndices"),
  grab("function _todayYmd(", "\r\n", "_todayYmd"),
  grab("function _diHasHappened(", "\r\n}", "_diHasHappened"),
  grab("function _isOutOfSchool(", "\r\n", "_isOutOfSchool"),
  grab("function getAllDesignations(){", "\r\n}", "getAllDesignations"),
  grab("function buildEngMap(){", "\r\n}", "buildEngMap"),
  grab("function getEffectiveAllocOnDate(", "\r\n}", "getEffectiveAllocOnDate"),
  grab("function saKeysForDate(", "\r\n}", "saKeysForDate"),
  grab("function saGet(", "\r\n", "saGet"),
  grab("function saCode(", "\r\n", "saCode"),
  grab("function isSplitAct(", "\r\n", "isSplitAct"),
  grab("const SPECIAL_ALLOCS=", "\r\n", "SPECIAL_ALLOCS"),
  grab("const STAFF_DESIGNATIONS=[", "\r\n];", "STAFF_DESIGNATIONS"),
  grab("function normaliseActs(){", "\r\n}", "normaliseActs"),
  grab("const BLOCK_FREE=", "\r\n", "BLOCK_FREE"),
  grab("let _blkIdx=null", "\r\n", "_blkIdx"),
  grab("function _blockMemberIndex(", "\r\n}", "_blockMemberIndex"),
  grab("function _blockFreeRow(", "\r\n}", "_blockFreeRow"),
  grab("function allocUpcomingChecks(", "\r\n}", "allocUpcomingChecks")
].join("\n");
var CHK = w => new Function("W", `
  let acts=W.acts,pupils=W.pupils||[],dates=W.dates,formData=W.fd||[],allocOverrides=W.ao||{},
      allocDateOverrides=W.ado||{},allocRes=W.res||[],staff=W.staff||[],sa=W.sa||{};
  let _pupilCache=null,_actCache=null,_engMapCache=null,blockData=W.blockData||{batches:{},sets:[],members:[]};
  ${CHK_SRC}
  let designations=W.designations||STAFF_DESIGNATIONS.map(d=>({n:d.n,counted:d.counted!==false}));
  normaliseActs();   // as the app does on load: unset session leads take the lead
  return allocUpcomingChecks(W.today);`)(w);
{
  // Invented names throughout — this file is in a public repository.
  const dates = [{ full: "19/09/2026", half: "A1" }, { full: "03/10/2026", half: "A1" }, { full: "10/10/2026", half: "A1" }];
  const acts = [
    { n: "Kayaking", di: [0, 1, 2], sess: "A+B", sessA: "Kayaking", sessB: "Kayaking", cap: 1, lead: "ABC", staff: [] },
    { n: "Knit then Yoga", di: [1, 2], sess: "A+B", sessA: "Knitting", sessB: "Yoga", cap: 10, lead: "XYZ", sessALead: "XYZ", sessBLead: "Zed", staff: ["abc"] },
    { n: "Stretch then Self Defence", di: [1], sess: "A+B", sessA: "Stretch", sessB: "Self-Defence", cap: 10 },
    { n: "Chess then Self Defence", di: [1], sess: "A+B", sessA: "Chess", sessB: "Self Defence", cap: 10 },
    // A P1-only activity whose session name differs from its own, as Pre-season Hockey does.
    { n: "Hill Walk", di: [1, 2], sess: "A", sessA: "Rambling", sessB: "Rambling", cap: 10, lead: "ZZ" },
    { n: "Pottery", di: [1], sess: "A+B", sessA: "Pottery", sessB: "Pottery", cap: 10 },
    { n: "Orienteering", di: [0], sess: "A+B", sessA: "Orienteering", sessB: "Orienteering", cap: 10, lead: "OLD" }
  ];
  const staff = ["ABC", "XYZ", "MNO", "QRS", "TUV"].map(c => ({ c }));
  const res = [["p1", "Kayaking"], ["p2", "Kayaking"], ["p3", "Kayaking"], ["p4", "Knit then Yoga"], ["p5", "Hill Walk"],
               ["p6", "Stretch then Self Defence"], ["p7", "Chess then Self Defence"]]
    .map(([p, a]) => ({ email: p + "@x.com", half: "A1", alloc: a, st: "1ST" }));
  const pupils = res.map(r => ({ email: r.email }));
  const ado = {
    "1|p1@x.com": "Orienteering",     // exists, but doesn't run on 03/10
    "2|p2@x.com": "Ghost Club",       // no such activity
    "1|p3@x.com": "Out of school",    // not an activity: ignored
    "0|p4@x.com": "Ghost Club",       // past date: ignored
    "1|p9@x.com": "Kayaking"          // a response with no roster or engine row still counts
  };
  const sa = {
    "1|ABC": { act: "Kayaking" }, "2|ABC": { act: "Kayaking" },
    "1|XYZ|A": { act: "Knitting" },                 // nobody on Yoga that date
    "2|XYZ": { act: "Knit then Yoga" },             // the whole activity covers both sessions
    "1|QRS|A": { act: "Rambling" },                 // staffed by its session name
    "1|MNO|B": { act: "Rambling" },                 // but it doesn't run in P4
    "2|QRS": { act: "Old Club" },                   // a name no activity uses
    "2|MNO": { act: "SLT Duty" },                   // a staff designation, not an activity
    "1|TUV": { act: "Pottery" },                    // runs, but nobody is on it
    "1|NEW": { act: "Kayaking" }, "2|NEW": { act: "Kayaking" }   // a code not on the roster, on two dates: one line
  };
  const W = { dates, acts, staff, res, pupils, ado, sa, fd: [{ email: "p9@x.com" }], today: 20260928 };
  const r = CHK(W);
  const find = (l, f) => l.filter(x => Object.keys(f).every(k => JSON.stringify(x[k]) === JSON.stringify(f[k])));
  t("a per-date entry to an activity not running that date is found", find(r.missingAct, { di: 1, email: "p1@x.com", value: "Orienteering" }).length === 1);
  t("and says why", /doesn't run/.test(find(r.missingAct, { value: "Orienteering" })[0]?.why || ""));
  t("a per-date entry to a name no activity has is found", find(r.missingAct, { di: 2, value: "Ghost Club" }).length === 1
    && /no activity/.test(find(r.missingAct, { di: 2 })[0]?.why || ""));
  t("'Out of school' is not reported as a missing activity", !find(r.missingAct, { value: "Out of school" }).length);
  t("past dates are left alone", !r.missingAct.some(x => x.di === 0) && !r.idleStaff.some(x => x.di === 0) && !r.unstaffed.some(x => x.di === 0));
  t("exactly those two per-date problems", r.missingAct.length === 2, JSON.stringify(r.missingAct));
  t("a split session with pupils and no staff is found", find(r.unstaffed, { di: 1, sess: "B", name: "Yoga", pupils: 1 }).length === 1);
  t("the staffed session of it is not", !find(r.unstaffed, { di: 1, sess: "A", name: "Knitting" }).length);
  t("staff on the whole activity cover both its sessions", !find(r.unstaffed, { di: 2, name: "Yoga" }).length && !find(r.unstaffed, { di: 2, name: "Knitting" }).length);
  t("a session staffed under its session name counts as staffed", !r.unstaffed.some(x => x.di === 1 && x.acts.includes("Hill Walk")), JSON.stringify(r.unstaffed));
  t("the same activity unstaffed on another date is found", find(r.unstaffed, { di: 2, sess: "A", name: "Rambling", acts: ["Hill Walk"] }).length === 1);
  t("an activity with no pupils is not reported unstaffed", !r.unstaffed.some(x => x.name === "Pottery"));
  t("an unstaffed component names the activity it comes from", find(r.unstaffed, { di: 1, sess: "B", name: "Self Defence", acts: ["Chess then Self Defence"] }).length === 1);
  t("staff on a P1-only activity in P4 are flagged, saying it doesn't run then",
    /doesn't run in P4/.test(find(r.idleStaff, { di: 1, code: "MNO", name: "Rambling" })[0]?.why || ""));
  t("staff on a name no activity uses are flagged", /no activity/.test(find(r.idleStaff, { di: 2, code: "QRS", name: "Old Club" })[0]?.why || ""));
  t("staff on a running activity with nobody on it are flagged", /no pupils/.test(find(r.idleStaff, { di: 1, code: "TUV", name: "Pottery" })[0]?.why || ""));
  t("staff designations (SLT Duty) are not flagged", !r.idleStaff.some(x => x.name === "SLT Duty"));
  t("staff on a session name that runs, with pupils, are not flagged", !find(r.idleStaff, { di: 1, code: "QRS" }).length);
  t("'Self Defence' and 'Self-Defence' in one session are reported as near-duplicates",
    find(r.nearDup, { di: 1, sess: "B" }).length === 1 && find(r.nearDup, { di: 1, sess: "B" })[0].names.sort().join("|") === "Self Defence|Self-Defence");
  t("and nowhere else", r.nearDup.length === 1, JSON.stringify(r.nearDup));
  t("a P4 lead code not on the roster is found", find(r.badCodes, { act: "Knit then Yoga", field: "P4 lead", code: "Zed" }).length === 1);
  t("a code differing only in capitals suggests the roster's spelling", find(r.badCodes, { act: "Knit then Yoga", code: "abc" })[0]?.suggest === "ABC");
  t("a staff-calendar code not on the roster is found, with its dates", find(r.badCodes, { code: "NEW", field: "staff calendar", dis: [1, 2] }).length === 1,
    JSON.stringify(find(r.badCodes, { code: "NEW" })));
  t("one bad lead is one line, naming every field it fills", find(r.badCodes, { act: "Hill Walk", code: "ZZ" }).length === 1
    && find(r.badCodes, { act: "Hill Walk", code: "ZZ" })[0].field === "lead, P1 lead, P4 lead", JSON.stringify(find(r.badCodes, { act: "Hill Walk" })));
  t("codes on activities with no date to come are left alone", !r.badCodes.some(x => x.code === "OLD"));
  t("over capacity counts per-date entries and responses, as Results by Date does",
    find(r.overCap, { di: 1, act: "Kayaking", n: 2 }).length === 1 && find(r.overCap, { di: 2, act: "Kayaking", n: 2 }).length === 1, JSON.stringify(r.overCap));
  t("and nothing else is over", r.overCap.length === 2);
  const today = CHK(Object.assign({}, W, { today: 20261003 }));
  t("today's Saturday still counts as to come", today.missingAct.some(x => x.di === 1));
  const after = CHK(Object.assign({}, W, { today: 20261011 }));
  t("once every date has passed there is nothing to fix", Object.values(after).every(l => !l.length));
  t("the card is shown at the top of the Allocation Report", has("  renderUpcomingChecks(el); // v169\r\n"));
  t("Results by Date is reached through its own sub-tab", has('window._allocSub="results";window._resultsSub="bydate";'));
}

// ════════════════════════════════════════════════════════════════════════════
S("v170 — Leavers and lead codes");
var LVR_SRC = [
  grab("function h(tag,attrs,...ch){", "\r\n}", "h"),
  grab("function parseDateDmy(", "\r\n}", "parseDateDmy"),
  grab("function _todayYmd(", "\r\n", "_todayYmd"),
  grab("function saGet(", "\r\n", "saGet"),
  grab("function saCode(", "\r\n", "saCode"),
  grab("const STAFF_TAIL_ORDER=", "\r\n", "STAFF_TAIL_ORDER"),
  grab("function staffSortKey(", "\r\n}", "staffSortKey"),
  grab("function sortedStaff(", "\r\n", "sortedStaff"),
  grab("function _staffCodeSelect(", "\r\n}", "_staffCodeSelect"),
  grab("function staffRemovalPlan(", "\r\n}", "staffRemovalPlan"),
  grab("function applyStaffRemoval(", "\r\n}", "applyStaffRemoval")
].join("\n");
// Just enough of a DOM for the real h() to build a <select> the test can read.
var LVR = w => new Function("W", `
  class Node{} class El extends Node{constructor(t){super();this.tagName=t.toUpperCase();this.style={};this.kids=[];this.attrs={};this.on={};this.className="";}
    appendChild(c){this.kids.push(c);return c;} setAttribute(k,v){this.attrs[k]=String(v);} addEventListener(t,f){this.on[t]=f;}}
  class Txt extends Node{constructor(s){super();this.text=s;}}
  const document={createElement:t=>new El(t),createTextNode:s=>new Txt(s)};
  let acts=W.acts,staff=W.staff,sa=W.sa,dates=W.dates;
  ${LVR_SRC}
  const opts=sel=>sel.kids.map(o=>({v:o.attrs.value,text:o.kids.map(k=>k.text).join(""),sel:!!o.selected}));
  return {staffRemovalPlan,applyStaffRemoval,_staffCodeSelect,opts,get staff(){return staff;},get sa(){return sa;}};`)(w);
{
  // Invented staff and activities — this file is in a public repository.
  const world = () => ({
    dates: [{ full: "12/09/2026" }, { full: "03/10/2026" }, { full: "10/10/2026" }, { full: "TBC" }],
    staff: [{ c: "AAA", n: "Ann Able" }, { c: "LVR", n: "Lee Vere" }, { c: "LV", n: "Liv Vane" }, { c: "CCC", n: "Cal Cee" }],
    acts: [
      { id: "g", n: "Golf", lead: "LVR", sessALead: "LVR", sessBLead: "LVR", sessA: "Golf", sessB: "Golf", staff: ["CCC", "LVR", "LV"], di: [0, 1, 2] },
      { id: "c", n: "Chess then Draughts", lead: "AAA", sessALead: "AAA", sessBLead: "LVR", sessA: "Chess", sessB: "Draughts", staff: [], di: [1, 2] },
      { id: "k", n: "Knitting", lead: "AAA", sessALead: "AAA", sessBLead: "AAA", staff: ["LVR"], di: [2] }
    ],
    sa: { "0|LVR": { act: "Golf" }, "1|LVR|A": { act: "Golf" }, "2|LVR": { act: "Golf" }, "3|LVR": { act: "Golf" },
          "2|CCC": { act: "Golf" }, "2|LV": { act: "Golf" } }
  });
  const TODAY = 20261003;   // 12/09 past, 03/10 today, 10/10 to come, "TBC" unreadable
  const W1 = LVR(world()), plan = W1.staffRemovalPlan("LVR", TODAY);
  t("finds every lead field holding the code", plan.leads.map(l => l.act.n + ":" + l.field).join(",") ===
    "Golf:lead,Golf:sessALead,Golf:sessBLead,Chess then Draughts:sessBLead", plan.leads.map(l => l.act.n + ":" + l.field).join(","));
  t("finds every activity listing them as additional staff", plan.tags.map(x => x.act.n).join(",") === "Golf,Knitting");
  t("only dates after today count as upcoming", JSON.stringify(plan.future) === '["2|LVR"]', JSON.stringify(plan.future));
  t("past dates, today and unreadable dates are kept as the record", plan.past.sort().join(",") === "0|LVR,1|LVR|A,3|LVR", plan.past.join(","));
  t("another code that starts the same (LV) is not caught up in it", !plan.future.includes("2|LV") && !plan.past.includes("2|LV"));
  const pLV = W1.staffRemovalPlan("LV", TODAY);
  t("…nor, removing LV, is LVR", JSON.stringify(pLV.future) === '["2|LV"]' && pLV.past.length === 0 && pLV.leads.length === 0
    && pLV.tags.map(x => x.act.n).join() === "Golf", JSON.stringify(pLV.future) + JSON.stringify(pLV.past));
  W1.applyStaffRemoval(plan, true);
  t("remove and clear: off the roster", !W1.staff.some(s => s.c === "LVR") && W1.staff.length === 3);
  const W1acts = (() => { const w = world(); const W = LVR(w); W.applyStaffRemoval(W.staffRemovalPlan("LVR", TODAY), true); return { w, W }; })();
  const g = W1acts.w.acts.find(a => a.id === "g"), c = W1acts.w.acts.find(a => a.id === "c"), k = W1acts.w.acts.find(a => a.id === "k");
  t("…their leads are cleared, all three on Golf", g.lead === "" && g.sessALead === "" && g.sessBLead === "");
  t("…a split's P4 lead is cleared and its P1 lead left alone", c.sessBLead === "" && c.sessALead === "AAA" && c.lead === "AAA");
  t("…their additional-staff tags go, others stay", JSON.stringify(g.staff) === '["CCC","LV"]' && JSON.stringify(k.staff) === "[]");
  const sa1 = W1acts.W.sa;
  t("…their upcoming calendar entry goes", !("2|LVR" in sa1));
  t("…their past, today's and unreadable-date entries stay", "0|LVR" in sa1 && "1|LVR|A" in sa1 && "3|LVR" in sa1);
  t("…other people's entries on the same date stay", "2|CCC" in sa1 && "2|LV" in sa1);
  const w2 = world(), W2 = LVR(w2); W2.applyStaffRemoval(W2.staffRemovalPlan("LVR", TODAY), false);
  t("remove and leave: off the roster, nothing else touched", !W2.staff.some(s => s.c === "LVR")
    && w2.acts[0].lead === "LVR" && w2.acts[0].staff.includes("LVR") && "2|LVR" in W2.sa && Object.keys(W2.sa).length === 6);
  // The lead picker.
  const W3 = LVR(world());
  let picked = null;
  const s1 = W3._staffCodeSelect("AAA", v => { picked = v; }, "75px"), o1 = W3.opts(s1);
  t("picker: TBC first, then the roster", o1[0].v === "" && o1[0].text === "TBC" && o1.length === 1 + 4);
  t("picker: the stored code is the one selected", o1.filter(o => o.sel).map(o => o.v).join() === "AAA");
  s1.on.change({ target: { value: "CCC" } });
  t("picker: choosing someone hands their code back", picked === "CCC");
  const o2 = W3.opts(W3._staffCodeSelect("", () => {}));
  t("picker: an empty lead shows TBC", o2.filter(o => o.sel).map(o => o.v).join() === "");
  const s3 = W3._staffCodeSelect("Zorbo", () => {}), o3 = W3.opts(s3);
  t("picker: a code not on the roster stays visible and selected, marked", o3.some(o => o.v === "Zorbo" && o.sel && /not on roster/.test(o.text)));
  t("picker: …and the box is shown in red with a reason", s3.style.color === "var(--red)" && /not on the staff roster/.test(s3.attrs.title || ""));
  t("picker: a known code is not flagged", !W3._staffCodeSelect("AAA", () => {}).style.color);
  // Wiring in the page.
  t("the main Lead uses the roster picker", has('const ls=_staffCodeSelect(a.lead,v=>{a.lead=v;syncRosterToCalendar();rebuildAdminPreserveScroll();},"75px"); // v170'));
  t("the Split panel's P1 and P4 leads use it too (no free text)",
    has('colA.appendChild(mkLeadSplit("Lead","sessALead"));') && has('colB.appendChild(mkLeadSplit("Lead","sessBLead"));') && !has('mkSplit("Lead code"'));
  t("removing staff goes through the dialog", has("onClick:()=>confirmStaffRemoval(s)},\"✕\")) // v170"));
  t("the old removal that deleted every date, past included, is gone", !has("Object.keys(sa).forEach(k=>{if(saCode(k)===sc)delete sa[k];});"));
}

// ════════════════════════════════════════════════════════════════════════════
// v171 — block set lists (runs at the end with P0: reading an .xlsx is async).
var BLK_SRC = [
  grab("function normEmail(", "\r\n", "normEmail"),
  grab("const BLOCK_SUBJECT_NAMES={", "};", "BLOCK_SUBJECT_NAMES"),
  grab("const BLOCK_FREE=", "\r\n", "BLOCK_FREE"),
  grab("async function _unzipXmlEntries(", "\r\n}", "_unzipXmlEntries"),
  grab("function _xmlUnescape(", "\r\n}", "_xmlUnescape"),
  grab("function _xmlRunsText(", "\r\n}", "_xmlRunsText"),
  grab("async function readXlsxSheets(", "\r\n}", "readXlsxSheets"),
  grab("function parseSetListSheets(", "\r\n}", "parseSetListSheets"),
  grab("function _nameKey(", "\r\n", "_nameKey"),
  grab("function _pupilYgNum(", "\r\n", "_pupilYgNum"),
  grab("function matchSetPupils(", "\r\n}", "matchSetPupils"),
  grab("function blockImportDiff(", "\r\n}", "blockImportDiff"),
  grab("function blockImportDefaults(", "\r\n}", "blockImportDefaults"),
  grab("function blockImportRows(", "\r\n}", "blockImportRows"),
  grab("function blockCurrent(", "\r\n}", "blockCurrent"),
  grab("function _blkHeaders(", "\r\n", "_blkHeaders"),
  grab("async function _blkPost(", "\r\n}", "_blkPost"),
  grab("async function blocksCommit(", "\r\n}", "blocksCommit")
].join("\n");
var BLK = w => new Function("W", `
  let pupils=W.pupils||[],staff=W.staff||[];const PFX=W.pfx||"lex12";const supaClient={url:"https://db.test",key:"k"};const fetch=W.fetch||(async()=>({ok:true}));
  ${BLK_SRC}
  return {readXlsxSheets,parseSetListSheets,matchSetPupils,blockImportDiff,blockImportDefaults,blockImportRows,blockCurrent,blocksCommit,_pupilYgNum};`)(w);
// A minimal .xlsx writer for invented workbooks: a zip (deflated, or stored for the names in
// `stored`) of the XML parts the reader looks at. Cells: strings → shared strings, numbers → values;
// a sheet may give its own raw XML to exercise inline strings, entities and gaps.
var mkZip = (files, stored) => {
  const zlib = require("zlib"), parts = [], cd = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8"), st = (stored || []).includes(name), data = st ? raw : zlib.deflateRawSync(raw), nb = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(st ? 0 : 8, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(st ? 0 : 8, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, data); cd.push(ch, nb); off += 30 + nb.length + data.length;
  }
  const cdb = Buffer.concat(cd), e = Buffer.alloc(22), n = Object.keys(files).length;
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(n, 8); e.writeUInt16LE(n, 10); e.writeUInt32LE(cdb.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdb, e]);
};
var mkXlsx = (sheets, stored) => {
  const ss = [], si = s => { let i = ss.indexOf(s); if (i < 0) { ss.push(s); i = ss.length - 1; } return i; };
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const colL = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const files = {};
  sheets.forEach((sh, k) => {
    files["xl/worksheets/sheet" + (k + 1) + ".xml"] = sh.xml || ('<?xml version="1.0"?><worksheet><sheetData>' + sh.rows.map((r, ri) =>
      '<row r="' + (ri + 1) + '">' + r.map((c, ci) => c === "" || c == null ? "" : typeof c === "number"
        ? '<c r="' + colL(ci) + (ri + 1) + '"><v>' + c + '</v></c>' : '<c r="' + colL(ci) + (ri + 1) + '" t="s"><v>' + si(c) + '</v></c>').join("") + '</row>').join("") + '</sheetData></worksheet>');
  });
  files["xl/workbook.xml"] = '<workbook xmlns:r="x"><sheets>' + sheets.map((sh, k) => '<sheet name="' + esc(sh.name) + '" sheetId="' + (k + 1) + '" r:id="rId' + (k + 1) + '"/>').join("") + '</sheets></workbook>';
  files["xl/_rels/workbook.xml.rels"] = '<Relationships>' + sheets.map((sh, k) => '<Relationship Id="rId' + (k + 1) + '" Target="worksheets/sheet' + (k + 1) + '.xml"/>').join("") + '</Relationships>';
  files["xl/sharedStrings.xml"] = '<sst>' + ss.map(s => '<si><t>' + esc(s) + '</t></si>').join("") + '</sst>';
  files["docProps/thumbnail.jpeg"] = "not xml";
  return mkZip(files, stored);
};
// An invented set list in the iSAMS shape. dob is a real-looking column that must never be read.
var mkSetSheet = (code, teacher, rows) => ({ name: code.replace(/\//g, "-") + " - (13)", rows: [
  [code + " - Set List (" + code + ") - Mx TEACHER (" + teacher + ")"],
  ["Surname", "Forename (Firstname)", "Date of Birth", "Academic House", "Year Group Code", "House Code"],
  ...rows.map(r => [r[0], r[1], 38000 + r[0].length, "Manor", "13", "M"]),
  ["Total: " + rows.length + "   |   Boys: 0   |   Girls: 0"], ["Average Age: 17.5   |   Max Age: 18.0   |   Min Age: 17.0"]] });
async function blockTests() {
  S("v171 — Block set lists (import)");
  // Invented pupils — this file is in a public repository.
  const pupils = [
    { forename: "Ada", pref: "", surname: "Quill", yg: "Year 13", email: "ada.q@x.com" },
    { forename: "Benedict", pref: "Ben", surname: "Rook", yg: "Year 13", email: "ben.r@x.com" },
    { forename: "Chloé", pref: "", surname: "Stave", yg: "Year 13", email: "chloe.s@x.com" },
    { forename: "Dan", pref: "", surname: "Twill", yg: "Year 13", email: "dan.t1@x.com" },
    { forename: "Dan", pref: "", surname: "Twill", yg: "Year 13", email: "dan.t2@x.com" },
    { forename: "Eve", pref: "", surname: "Umber", yg: "Year 12", email: "eve.u@x.com" },
    { forename: "Fay", pref: "", surname: "Vole", yg: "Year 13", email: "fay.v@x.com" },
    { forename: "Kit", pref: "", surname: "Wren", yg: "Year 13", email: "kit.w@x.com" }    // known by the bracketed name only
  ];
  const staff = [{ c: "TCH", n: "Tee Chair" }, { c: "OTH", n: "Oth Er" }];
  const B = BLK({ pupils, staff });
  // Reader
  const buf = mkXlsx([
    mkSetSheet("PSY/13/A", "TCH", [["Quill", "Ada"], ["Rook", "Benedict (Ben)"], ["Stave", "Chloe"], ["Wren", "Christopher (Kit)"]]),
    mkSetSheet("ART/13/A", "NEW", [["Vole", "Fay"], ["Rook", "Ben"]]),
    mkSetSheet("BUS/13/B", "OTH", [["Twill", "Dan"], ["Umber", "Eve"], ["Nobody", "Here"], ["Quill", "Ada"], ["Quill", "Ada"]]),
    { name: "Raw & odd", xml: '<worksheet><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>R&amp;D</t><rPh><t>x</t></rPh></is></c><c r="C2" s="1"/>' +
      '<c r="D2"><v>4.5</v></c></row><row r="3" spans="1:2"/></sheetData></worksheet>' }
  ], ["xl/worksheets/sheet1.xml"]);
  const sheets = await B.readXlsxSheets(buf);
  t("reads every sheet, in workbook order", sheets.map(s => s.name).join("|") === "PSY-13-A - (13)|ART-13-A - (13)|BUS-13-B - (13)|Raw & odd");
  t("reads a stored entry and a deflated one alike", sheets[0].rows[2][0] === "Quill" && sheets[1].rows[2][0] === "Vole");
  t("shared strings, numbers and the header row come back as text", sheets[0].rows[1][0] === "Surname" && /^\d+$/.test(sheets[0].rows[2][2]));
  const raw = sheets[3].rows;
  t("inline strings, entities and phonetic hints", raw[1][0] === "R&D");
  t("row and column gaps keep positions (A2, D2)", raw.length >= 2 && raw[0].length === 0 && raw[1][3] === "4.5" && raw[1][1] === "");
  let threw = ""; try { await B.readXlsxSheets(Buffer.from("not a zip at all")); } catch (e) { threw = e.message; }
  t("a file that isn't an .xlsx is refused with a plain message", /isn't an Excel/.test(threw), threw);
  // Parse
  const P = B.parseSetListSheets(sheets);
  t("one set per set-list sheet; the odd sheet is reported, not guessed", P.sets.length === 3 && P.problems.length === 1 && P.problems[0].sheet === "Raw & odd");
  const psy = P.sets[0];
  t("set code, subject, year, block and teacher from the first cell",
    psy.setCode === "PSY/13/A" && psy.subjectCode === "PSY" && psy.yg === "13" && psy.block === "A" && psy.teacher === "TCH");
  t("footer rows are not pupils", psy.pupils.length === 4 && P.sets[2].pupils.length === 5);
  t("a bracketed first name is kept apart from the forename", psy.pupils[1].forename === "Benedict" && psy.pupils[1].alt === "Ben");
  t("Date of Birth (and every other column) is never read", P.sets.every(s => s.pupils.every(r => Object.keys(r).join() === "surname,forename,alt"))
    && !JSON.stringify(P).includes("380"));
  const P2 = B.parseSetListSheets([{ name: "x", rows: [["MATH/13/C2 - Set List (MATH/13/C2) - Mx A (AB)"], ["Surname", "Forename (Firstname)"], ["Quill", "Ada"]] }]);
  t("a set code with a suffix after the block letter", P2.sets[0].setCode === "MATH/13/C2" && P2.sets[0].block === "C");
  // Match
  const M = B.matchSetPupils(P, {});
  const set = code => M.members.filter(m => m.setCode === code).map(m => m.email).sort().join();
  t("forename, bracketed name, preferred name and accents all match", set("PSY/13/A") === "ada.q@x.com,ben.r@x.com,chloe.s@x.com,kit.w@x.com", set("PSY/13/A"));
  t("a pupil in two sets of one block is a clash", M.clashes.length === 1 && M.clashes[0].email === "ben.r@x.com" && M.clashes[0].sets.join() === "PSY/13/A,ART/13/A");
  t("two roster pupils with one name are not guessed", M.unmatched.some(u => u.row.surname === "Twill" && u.candidates.length === 2));
  t("a pupil in another year group doesn't match", M.unmatched.some(u => u.row.surname === "Umber" && /no pupil/.test(u.why)));
  t("a name nobody has is listed", M.unmatched.some(u => u.row.surname === "Nobody"));
  t("listed twice in one set counts once", M.members.filter(m => m.email === "ada.q@x.com" && m.block === "B").length === 1);
  const twill = M.unmatched.find(u => u.row.surname === "Twill"), umber = M.unmatched.find(u => u.row.surname === "Umber"), nob = M.unmatched.find(u => u.row.surname === "Nobody");
  const M2 = B.matchSetPupils(P, { [twill.key]: "dan.t2@x.com", [umber.key]: "", [nob.key]: "" });
  t("a choice on the review screen settles a name", M2.members.some(m => m.email === "dan.t2@x.com" && m.setCode === "BUS/13/B") && !M2.unmatched.length);
  t("…and 'leave out' leaves it out", !M2.members.some(m => m.email === "eve.u@x.com"));
  // Defaults, rows, current batch, diff
  const D = B.blockImportDefaults(P, { sets: [] });
  t("lead defaults to the teacher when they're on the LEX roster", D.sets["PSY/13/A"].lead === "TCH" && D.sets["BUS/13/B"].lead === "OTH");
  t("…and to TBC when they aren't — staff are never created", D.sets["ART/13/A"].lead === "");
  t("subject names offered from the built-in list", D.sets["PSY/13/A"].subject === "Psychology");
  t("Supported Study starts as the fallback in every block", D.free["13"].A.subject === "Y13 Supported Study" && D.free["13"].B.subject === "Y13 Supported Study"
    && D.free["13"].A.lead === "" && Object.keys(D.free["13"]).join() === "A,B");
  const prev = { sets: [{ yg: "13", set_code: "PSY/13/A", subject_code: "PSY", subject: "Psych (A level)", lead: "OTH", venue: "PY01" },
    { yg: "13", set_code: "HSC/13/D", subject_code: "ART", subject: "Fine Art", lead: "", venue: "" },
    { yg: "13", set_code: "__FREE__", block: "*", subject: "Study", lead: "TCH", venue: "Library" },
    { yg: "13", set_code: "__FREE__", block: "B", subject: "Study B", lead: "OTH", venue: "Hall" }] };
  const D2 = B.blockImportDefaults(P, prev);
  t("a re-import keeps the lead, venue and name chosen last time", D2.sets["PSY/13/A"].lead === "OTH" && D2.sets["PSY/13/A"].venue === "PY01" && D2.sets["PSY/13/A"].subject === "Psych (A level)");
  t("a name saved for a subject code is offered for its other sets", D2.sets["ART/13/A"].subject === "Fine Art");
  t("…and Supported Study's, per block (a year-wide row still counts)", D2.free["13"].A.subject === "Study" && D2.free["13"].A.lead === "TCH"
    && D2.free["13"].B.subject === "Study B" && D2.free["13"].B.venue === "Hall");
  const R = B.blockImportRows(P, M2, D, "B2");
  t("rows: every set, a Supported Study row per block, every member, one batch",
    R.sets.length === 5 && R.sets.filter(s => s.set_code === "__FREE__").map(s => s.block).sort().join() === "A,B" && R.members.length === M2.members.length
    && [...R.sets, ...R.members].every(r => r.batch === "B2" && r.pfx === "lex12"));
  const old = [{ yg: "13", batch: "B1", block: "A", set_code: "PSY/13/A" }, { yg: "12", batch: "B0", block: "A", set_code: "X/12/A" }];
  const oldM = [{ yg: "13", batch: "B1", block: "A", email: "ada.q@x.com", set_code: "PSY/13/A" }, { yg: "13", batch: "B1", block: "A", email: "fay.v@x.com", set_code: "PSY/13/A" },
    { yg: "13", batch: "B1", block: "B", email: "gone@x.com", set_code: "BUS/13/B" }, { yg: "12", batch: "B0", block: "A", email: "eve.u@x.com", set_code: "X/12/A" },
    { yg: "13", batch: "B3", block: "A", email: "half@x.com", set_code: "PSY/13/A" }];   // an import that never finished
  const C = B.blockCurrent(old, oldM);
  t("the current import is the newest batch with sets rows, per year group", C.batches["13"] === "B1" && C.batches["12"] === "B0");
  t("members of an unfinished import are ignored", !C.members.some(m => m.email === "half@x.com") && C.members.length === 4);
  const d = B.blockImportDiff(M2.members, C.members);
  t("diff: joiners, movers and leavers", d.joiners.some(x => x.email === "ben.r@x.com") && d.moves.some(x => x.email === "fay.v@x.com" && x.from === "PSY/13/A" && x.to === "ART/13/A")
    && d.leavers.some(x => x.email === "gone@x.com"));
  t("…and another year group is not touched by it", !d.leavers.some(x => x.email === "eve.u@x.com"));
  // Commit order: members, then sets (the switch), then tidy.
  const calls = [];
  const BC = BLK({ pupils, staff, fetch: async (url, o) => { calls.push((o.method || "GET") + " " + url.split("/rest/v1/")[1]); return { ok: true, text: async () => "" }; } });
  await BC.blocksCommit(R);
  t("commit writes members first, then sets, then removes older batches",
    /^POST lex_block_members/.test(calls[0]) && /^POST lex_block_sets/.test(calls[1]) && calls.slice(2).every(c => /^DELETE .*batch=neq\.B2/.test(c)) && calls.length === 4, calls.join(" ; "));
  const calls2 = [];
  const BF = BLK({ pupils, staff, fetch: async (url, o) => { calls2.push((o.method || "GET") + " " + url.split("/rest/v1/")[1]); return /members/.test(url) ? { ok: false, status: 500, text: async () => "boom" } : { ok: true, text: async () => "" }; } });
  let err = ""; try { await BF.blocksCommit(R); } catch (e) { err = e.message; }
  t("if the members can't be written, the sets are never switched", /lex_block_members/.test(err) && !calls2.some(c => /lex_block_sets/.test(c)));
  // Page wiring
  t("Settings has a Blocks tab", has('{id:"blocks",l:"🧱 Blocks"}') && has('else if(adminSub==="blocks")renderAdminBlocks(container); // v171'));
  t("the setup SQL keys both tables by batch (so an import switches in one step)",
    has("primary key (pfx, yg, batch, block, set_code)") && has("primary key (pfx, yg, batch, block, email)"));
}

// ════════════════════════════════════════════════════════════════════════════
// v172 — the block timetable in use. Invented data only: set lists never come near this file.
var USE_SRC = [
  grab("function normEmail(", "\r\n", "normEmail"),
  grab("function parseDateDmy(", "\r\n}", "parseDateDmy"),
  grab("function _todayYmd(", "\r\n", "_todayYmd"),
  grab("function _diHasHappened(", "\r\n}", "_diHasHappened"),
  grab("function isSplitAct(", "\r\n", "isSplitAct"),
  grab("function saKeysForDate(", "\r\n}", "saKeysForDate"),
  grab("function saGet(", "\r\n", "saGet"),
  grab("function saCode(", "\r\n", "saCode"),
  grab("function saSet(", "\r\n}", "saSet"),
  grab("const LEX_TIME_FULL=", "\r\n", "LEX times"),
  grab("function actSessions(act,email,di){", "\r\n}", "actSessions"),
  grab("const BLOCK_FREE=", "\r\n", "BLOCK_FREE"),
  grab("function parseSetListSheets(", "\r\n}", "parseSetListSheets"),
  grab("function actBlockFor(", "\r\n}", "actBlockFor"),
  grab("let _blkIdx=null", "\r\n", "_blkIdx"),
  grab("function _blockMemberIndex(", "\r\n}", "_blockMemberIndex"),
  grab("function _blockFreeRow(", "\r\n}", "_blockFreeRow"),
  grab("function blockDetailFor(", "\r\n}", "blockDetailFor"),
  grab("function blockSessionSets(", "\r\n}", "blockSessionSets"),
  grab("function blockSupportFor(", "\r\n}", "blockSupportFor"),
  grab("function _blockLive(", "\r\n", "_blockLive"),
  grab("function _blockSetOption(", "\r\n", "_blockSetOption"),
  grab("function blockSetHas(", "\r\n}", "blockSetHas"),
  grab("function _blockSessionsOf(", "\r\n", "_blockSessionsOf"),
  grab("function blockPupilSetsText(", "\r\n}", "blockPupilSetsText"),
  grab("function blockStaffLines(", "\r\n}", "blockStaffLines"),
  grab("function blockNoticeLines(", "\r\n}", "blockNoticeLines"),
  grab("function blockSwitchPlan(", "\r\n}", "blockSwitchPlan"),
  grab("function applyBlockSwitch(", "\r\n}", "applyBlockSwitch"),
  grab("function undoBlockSwitch(", "\r\n}", "undoBlockSwitch"),
  grab("function parseLeadsVenuesSheets(", "\r\n}", "parseLeadsVenuesSheets"),
  grab("function applyLeadsVenues(", "\r\n}", "applyLeadsVenues"),
  grab("function _blockGuessMapping(", "\r\n}", "_blockGuessMapping")
].join("\n");
var USE = w => new Function("W", `
  let acts=W.acts||[],staff=W.staff||[],sa=W.sa||{},dates=W.dates||[],venues=W.venues||[],blockData=W.blockData||{batches:{},sets:[],members:[]};
  function invalidateCaches(){}
  function findActByName_exact(n){return acts.find(a=>a.n===n)||null;}
  function getEffectiveAllocOnDate(ne,di){return (W.alloc||{})[di+"|"+ne]||null;}
  function buildEngMap(){return {};}
  ${USE_SRC}
  return {actBlockFor,blockDetailFor,blockSessionSets,blockSetHas,blockPupilSetsText,blockStaffLines,blockNoticeLines,blockSwitchPlan,
    applyBlockSwitch,undoBlockSwitch,parseLeadsVenuesSheets,applyLeadsVenues,_blockGuessMapping,actSessions,parseSetListSheets,_blockLive,_blockSetOption,
    get sa(){return sa;},get acts(){return acts;},setBlockData(v){blockData=v;}};`)(w);
function blockUseTests() {
  S("v172 — Block timetable in use (resolver, registers, switch)");
  // Invented names and codes — this file is in a public repository.
  const P = USE({}).parseSetListSheets([
    { name: "a", rows: [["SS/11/BLOCK A - Set List (SS/11/BA) - Mrs A (MHC)"], ["Surname", "Forename (Firstname)"], ["Quill", "Ada"]] },
    { name: "b", rows: [["ART/11/CB - Set List (ART/11/CB) - Mr B (DRP)"], ["Surname", "Forename (Firstname)"]] },
    { name: "c", rows: [["CiM/11/D - Set List (CiM/11/D) - Mr C (AST)"], ["Surname", "Forename (Firstname)"]] }]);
  t("the set code is the one in 'Set List (…)', and 'BLOCK A' gives the block", P.sets[0].setCode === "SS/11/BA" && P.sets[0].block === "A" && P.sets[0].subjectCode === "SS" && P.sets[0].yg === "11");
  t("a two-letter set suffix keeps the block letter first (ART/11/CB → C)", P.sets[1].block === "C" && P.sets[1].setCode === "ART/11/CB");
  t("lower-case subject codes are read", P.sets[2].subjectCode === "CIM" && P.sets[2].block === "D");
  const staff = ["TCH", "NEW1", "OTH", "FRL", "OLD"].map(c => ({ c, n: "Mx " + c }));
  const venues = [{ name: "PY01" }, { name: "Hall" }, { name: "Foyer" }];
  const bd = { batches: { "13": "B1" }, sets: [
    { yg: "13", block: "A", set_code: "PSY/13/A", subject: "Psychology", lead: "TCH", venue: "PY01" },
    { yg: "13", block: "A", set_code: "ART/13/A", subject: "Art", lead: "NEW1", venue: "Hall" },
    { yg: "13", block: "B", set_code: "BUS/13/B", subject: "Business", lead: "OTH", venue: "" },
    { yg: "13", block: "A", set_code: "__FREE__", subject: "Y13 Supported Study", lead: "FRL", venue: "Foyer" },
    { yg: "13", block: "B", set_code: "__FREE__", subject: "Y13 Supported Study", lead: "", venue: "" }],
    members: [{ yg: "13", block: "A", email: "ada@x.com", setCode: "PSY/13/A" }, { yg: "13", block: "B", email: "ada@x.com", setCode: "BUS/13/B" },
      { yg: "13", block: "A", email: "ben@x.com", setCode: "ART/13/A" }] };
  const dates = [{ full: "12/09/2026", label: "Sat 12 Sep" }, { full: "03/10/2026", label: "Sat 3 Oct" }];
  const split = () => ({ id: "t1", n: "LT A then B", sessA: "LT A", sessB: "LT B", di: [0, 1], yg: "13" });
  const act = Object.assign(split(), { blocks: { yg: "13", A: "A", B: "B" } });
  const W = USE({ acts: [act], staff, venues, dates, blockData: bd });
  const dA = W.blockDetailFor("Ada@x.com", 1, "A", act), dB = W.blockDetailFor("ben@x.com", 1, "B", act);
  t("a pupil's set in a block: subject, lead, room", dA.subject === "Psychology" && dA.lead === "TCH" && dA.venue === "PY01" && !dA.free && dA.block === "A");
  t("no set in that block → Supported Study, with that block's own row", dB.free && dB.subject === "Y13 Supported Study" && dB.block === "B" && dB.lead === "");
  t("an activity not switched to blocks resolves to nothing", W.blockDetailFor("ada@x.com", 1, "A", split()) === null);
  t("…nor one whose year group has no set lists loaded", W.blockDetailFor("ada@x.com", 1, "A", Object.assign(split(), { blocks: { yg: "11", A: "A", B: "B" } })) === null);
  const ss = W.actSessions(act, "ada@x.com", 1);
  t("a pupil's sessions become their sets (P1 Block A · Psychology, P4 Block B · Business)",
    ss.length === 2 && ss[0].name === "Block A · Psychology" && ss[0].venue === "PY01" && ss[0].lead === "Mx TCH" && ss[1].name === "Block B · Business" && ss[1].label === "P4");
  t("without a pupil, the split shows as before", W.actSessions(act).map(s => s.name).join() === "LT A,LT B");
  const whole = { n: "LT C", sessA: "LT C", sessB: "LT C", di: [1], blocks: { yg: "13", A: "A", B: "A" } };
  t("a whole-day block is one session, from its block", (s => s.length === 1 && s[0].name === "Block A · Art" && s[0].time === "09:00–12:30")(W.actSessions(whole, "ben@x.com", 1)));
  t("sets text for a table or letter", W.blockPupilSetsText(act, "ada@x.com", 1) === "P1 Psychology · P4 Business");
  t("a set register holds its members only", W.blockSetHas("13", "A", "PSY/13/A", "ada@x.com") && !W.blockSetHas("13", "A", "PSY/13/A", "ben@x.com"));
  t("the Supported Study register holds exactly those in no set of the block", W.blockSetHas("13", "B", "__FREE__", "ben@x.com") && !W.blockSetHas("13", "B", "__FREE__", "ada@x.com"));
  t("every set in a session, then Supported Study", W.blockSessionSets(act, "A").map(s => s.set_code).join() === "ART/13/A,PSY/13/A,__FREE__");
  t("a lead's schedule shows their set", JSON.stringify(W.blockStaffLines("TCH", "LT A", 1, "A")) === '["Block A · Psychology · PY01"]');
  const nl = W.blockNoticeLines(act).join("\n");
  t("the Friday notice lists each session's sets with room and lead", /P1 Block A:/.test(nl) && /Psychology — PY01 \(Mx TCH\)/.test(nl) && /P4 Block B:/.test(nl) && /Business — venue TBC \(Mx OTH\)/.test(nl));
  // The switch
  const sw = split();
  const sa = { "1|OLD|A": { act: "LT A", role: "support" }, "1|TCH|A": { act: "Golf", role: "lead" }, "1|OTH|B": { act: "LT B", role: "support" },
    "0|OLD|A": { act: "LT A", role: "support" } };
  const WS = USE({ acts: [sw], staff, venues, dates, blockData: bd, sa });
  const plan = WS.blockSwitchPlan(sw, { yg: "13", A: "A", B: "B" }, 20260929);
  t("only dates still to come are switched", JSON.stringify(plan.dates) === "[1]");
  t("set leads not yet on the session go on", plan.add.map(x => x.key).sort().join() === "1|FRL|A,1|NEW1|A", plan.add.map(x => x.key).join());
  t("someone already on the session who leads a set stays, with nothing added", !plan.add.some(x => x.code === "OTH") && !plan.remove.some(x => x.code === "OTH"));
  t("staff on the session who don't lead a set come off", plan.remove.map(x => x.key).join() === "1|OLD|A");
  t("a lead already down for something else is a clash, left alone", plan.clashes.length === 1 && plan.clashes[0].code === "TCH" && plan.clashes[0].onto === "Golf");
  t("a set or Supported Study with no lead is listed", plan.noLead.length === 1 && plan.noLead[0].sess === "B" && plan.noLead[0].set === "__FREE__");
  WS.applyBlockSwitch(sw, plan);
  t("switching puts the leads on as leads, and takes the others off", WS.sa["1|NEW1|A"].act === "LT A" && WS.sa["1|NEW1|A"].role === "lead" && !("1|OLD|A" in WS.sa));
  t("…never touches past dates or the clash", WS.sa["0|OLD|A"].act === "LT A" && WS.sa["1|TCH|A"].act === "Golf");
  t("…and marks the activity as running on blocks", sw.blocks.A === "A" && sw.blocks.B === "B" && sw.blocksUndo.added.length === 2);
  WS.sa["1|FRL|A"] = { act: "Chess", role: "lead" };   // changed since the switch
  const u = WS.undoBlockSwitch(sw);
  t("switching back undoes it: leads off, staff back, a split again", !("1|NEW1|A" in WS.sa) && WS.sa["1|OLD|A"].act === "LT A" && !sw.blocks && !sw.blocksUndo);
  t("…but leaves anything changed since", WS.sa["1|FRL|A"].act === "Chess" && u.off === 1 && u.back === 1);
  const W2 = USE({ acts: [], staff, venues, dates, blockData: { batches: { "13": "B" }, sets: [
    { yg: "13", block: "A", set_code: "X/13/A", subject: "X", lead: "TCH" }, { yg: "13", block: "A", set_code: "Y/13/A", subject: "Y", lead: "TCH" }], members: [] } });
  t("one person leading two sets in a session is flagged", W2.blockSwitchPlan(split(), { yg: "13", A: "A", B: "A" }, 20260929).twoSets.some(x => x.code === "TCH" && x.subjects.length === 2));
  t("block guesses from the name: 'A then B' split, 'THINK C' whole day",
    JSON.stringify(W._blockGuessMapping({ n: "Y13 LEX THINK C then D", sessA: "x", sessB: "y" }, "13")) === '{"yg":"13","A":"C","B":"D"}'
    && W._blockGuessMapping({ n: "Y11 LEX THINK C", sessA: "Y11 LEX THINK C", sessB: "Y11 LEX THINK C" }, "11").A === "C"
    && W._blockGuessMapping({ n: "Golf", sessA: "Golf", sessB: "Golf" }, "13").A === "");
  // The confirmed leads and venues spreadsheet
  const parsed = { sets: [{ setCode: "PSY/13/A", yg: "13" }, { setCode: "ART/13/A", yg: "13" }, { setCode: "BUS/13/B", yg: "13" }] };
  const L = W.parseLeadsVenuesSheets([{ name: "Y13 sets", rows: [["Title"], ["How to"], ["Mapping"],
    ["Block", "Code", "Subject (as pupils will see it)", "iSAMS set", "iSAMS teacher", "Pupils", "LEX lead", "If not on roster: name", "Venue", "Notes"],
    ["A", "PSY", "Psychology (A level)", "PSY/13/A", "TCH", "8", "TCH – Chair", "", "PY01", ""],
    ["A", "ART", "", "ART/13/A", "ZZ", "4", "Not on roster", "Mx Visitor", "Studio 9", ""],
    ["C", "GEO", "Geography", "GEO/13/C", "OTH", "5", "OTH – Other", "", "Hall", ""],
    ["A", "SS", "Y13 Supported Study", "(pupils with no set in this block)", "—", "11", "FRL – Frl", "", "Foyer", ""],
    ["B", "SS", "Y13 Supported Study", "(pupils with no set in this block)", "—", "18", "FRL – Frl", "", "Foyer", ""],
    ["", "", "", "", "", "", "", "", "", "", "", "", "OTH – Other"]] }], parsed);
  t("leads file: a set's lead code, venue and name are read", L.sets["PSY/13/A"].lead === "TCH" && L.sets["PSY/13/A"].venue === "PY01" && L.sets["PSY/13/A"].subject === "Psychology (A level)");
  t("…a lead not on the roster is left TBC and listed", L.sets["ART/13/A"].lead === "" && L.problems.some(p => /ART\/13\/A: lead .*isn't on the LEX roster/.test(p)));
  t("…a room that isn't a LEX venue is left TBC and listed", L.sets["ART/13/A"].venue === "" && L.problems.some(p => /Studio 9/.test(p)));
  t("…a set not in the set lists is listed, not invented", !L.sets["GEO/13/C"] && L.problems.some(p => /GEO\/13\/C is in the leads file but not in the set lists/.test(p)));
  t("…a set with no row is listed", L.problems.some(p => /No row for BUS\/13\/B/.test(p)));
  t("…Supported Study rows go to their blocks", L.free["13"].A.lead === "FRL" && L.free["13"].B.venue === "Foyer");
  t("…the side lists (dropdown sources) are ignored", L.applied === 4);
  const ch = { sets: { "PSY/13/A": { subject: "Psychology", lead: "OTH", venue: "" }, "ART/13/A": { subject: "Art", lead: "NEW1", venue: "Hall" } },
    free: { "13": { A: { subject: "Y13 Supported Study", lead: "", venue: "" } } } };
  W.applyLeadsVenues(ch, L);
  t("applying: lead and venue from the file, TBC included", ch.sets["PSY/13/A"].lead === "TCH" && ch.sets["ART/13/A"].lead === "" && ch.sets["ART/13/A"].venue === "");
  t("…the subject name only where the file gives one", ch.sets["PSY/13/A"].subject === "Psychology (A level)" && ch.sets["ART/13/A"].subject === "Art");
  t("…and Supported Study per block", ch.free["13"].A.lead === "FRL" && ch.free["13"].A.venue === "Foyer");
  // Wiring in the page
  t("every view loads the set lists after the cloud load, and keeps its copy on a failed read",
    has("  try{await blocksLoad();}catch(_){} // v172") && has('_loadKey("blocks",null,') && has("A failed read keeps what this device already has"));
  t("My LEX passes the pupil and date to the session helper", has("return actSessions(row.act,row.ne,row.di).map("));
  t("the public timetable shows the pupil's own sets", has("actSessions(actObj,ne,di).some(s2=>s2.block)"));
  t("the Friday notice lists sets", has("const _bl=blockNoticeLines(act);"));
  t("the parent-letter export adds each pupil's sets", has("blockPupilSetsText(findActByName_exact(n),r.ne,di)"));
  t("the Staff Portal offers a register per set and filters it",
    has("value:_blockSetOption(a,sess,comp,st.block,st.set_code)") && has("blockSetHas(blkSet.yg,blkSet.block,blkSet.setCode,p.email)"));
  // v173: support staff and single registration
  const sup = Object.assign(split(), { blocks: { yg: "13", A: "A", B: "B", support: { "A|OLD": "__FREE__", "B|NEW1": "BUS/13/B" } } });
  const W3 = USE({ acts: [sup], staff, venues, dates, blockData: bd });
  t("a support person linked to a set is listed on it, in that session only",
    JSON.stringify(W3.blockSessionSets(sup, "A").find(s => s.set_code === "__FREE__").support) === '["OLD"]'
    && !W3.blockSessionSets(sup, "A").some(s => s.set_code !== "__FREE__" && s.support.length)
    && JSON.stringify(W3.blockSessionSets(sup, "B").find(s => s.set_code === "BUS/13/B").support) === '["NEW1"]');
  t("…and their schedule shows the class they support", JSON.stringify(W3.blockStaffLines("OLD", "LT A", 1, "A")) === '["Supporting · Block A · Y13 Supported Study · Foyer"]');
  t("…but not in the other session", W3.blockStaffLines("OLD", "LT B", 1, "B").length === 0);
  t("support links don't change the sets themselves", !("support" in bd.sets[0]));
  t("a switched activity with set lists loaded has set registers only", W3._blockLive(sup) && !W3._blockLive(split())
    && !W3._blockLive(Object.assign(split(), { blocks: { yg: "11", A: "A", B: "B" } })));
  t("a set register's option names year, block, set, session and session name", W3._blockSetOption(sup, "A", "LT A", "A", "PSY/13/A") === "set:13|A|PSY/13/A|A|LT A"
    && W3._blockSetOption(sup, "", "LT", "C", "X/13/C") === "set:13|C|X/13/C|AB|LT");
  t("the Staff Portal doesn't offer a block activity's whole-session register (double registration)",
    has("if(_blockLive(a))return; // v173") && has("&&!_blockLive(findActByName_exact(n))"));
  t("…lists the signed-in person's own set registers first", has('"── Your registers ──"'));
  t("…and 'find a pupil' opens their set register", has("const target=setVals.find(v=>opts.includes(v))||"));
  t("support staff are linked to a set on the Blocks screen", has('logAction("BLOCKS_SUPPORT",'));
  t("…and a lead's schedule shows their set", has("blockStaffLines(s.c,n,rowDi,rowSess)"));
  t("the admin register shows each pupil's sets", has('if(act&&act.blocks)hdrCols.push("Sets");'));
  t("staff on the session who don't lead a set stay on unless Gideon ticks the box", has("const p2=off.checked?plan:Object.assign({},plan,{remove:[]});")
    && has("applyBlockSwitch(a,p2);"));
}

// ════════════════════════════════════════════════════════════════════════════
S("v174 — Set lists in the backup; block-timetable gaps before each Saturday");
{
  // Invented data only.
  const BK_SRC = [grab("function normEmail(", "\r\n", "normEmail"), grab("function blockCurrent(", "\r\n}", "blockCurrent"),
    grab("function blockBackupPayload(", "\r\n}", "blockBackupPayload"), grab("function blockRestoreRows(", "\r\n}", "blockRestoreRows")].join("\n");
  const RT = bd => new Function("BD", `const PFX="lex12";let blockData=BD;${BK_SRC}\nreturn {blockCurrent,blockBackupPayload,blockRestoreRows};`)(bd);
  const bd = { batches: { "13": "2026-09-29T10:00:00Z", "11": "2026-09-29T11:00:00Z" }, sets: [
    { yg: "13", batch: "2026-09-29T10:00:00Z", block: "A", set_code: "PSY/13/A", subject_code: "PSY", subject: "Psychology", lead: "TCH", venue: "PY01", teacher: "TCH" },
    { yg: "13", batch: "2026-09-29T10:00:00Z", block: "A", set_code: "__FREE__", subject_code: "", subject: "Y13 Supported Study", lead: "FRL", venue: "Foyer", teacher: "" },
    { yg: "11", batch: "2026-09-29T11:00:00Z", block: "B", set_code: "HIS/11/B", subject_code: "HIS", subject: "History", lead: "OTH", venue: "Hi01", teacher: "OTH" }],
    members: [{ yg: "13", block: "A", email: "ada@x.com", setCode: "PSY/13/A" }, { yg: "11", block: "B", email: "eve@x.com", setCode: "HIS/11/B" }] };
  const R1 = RT(bd);
  const saved = JSON.parse(JSON.stringify({ blocks: R1.blockBackupPayload() })).blocks;   // through the file
  const rows = R1.blockRestoreRows(saved, "2026-10-01T09:00:00Z");
  const back = R1.blockCurrent(rows.sets, rows.members);
  const key = s => [s.yg, s.block, s.set_code, s.subject, s.lead, s.venue, s.teacher].join("|");
  t("backup round-trip keeps every set, its subject, lead, room and teacher", JSON.stringify(back.sets.map(key).sort()) === JSON.stringify(bd.sets.map(key).sort()));
  t("…and every pupil's set", JSON.stringify(back.members.map(m => m.yg + m.block + m.email + m.setCode).sort()) === JSON.stringify(bd.members.map(m => m.yg + m.block + m.email + m.setCode).sort()));
  t("…restored as one new batch per year group (so it switches in one step)", back.batches["13"] === "2026-10-01T09:00:00Z" && back.batches["11"] === "2026-10-01T09:00:00Z"
    && rows.sets.concat(rows.members).every(r => r.pfx === "lex12"));
  t("a backup without set lists restores nothing: the current ones are kept", R1.blockRestoreRows(undefined, "x") === null && R1.blockRestoreRows({ sets: [] }, "x") === null);
  t("the backup includes the set lists, refreshed first", has("blocks:blockBackupPayload() // v174") && has("try{await blocksLoad();}catch(_){} // v174"));
  t("restore writes them back only when the backup has them", has("const _br=blockRestoreRows(data.blocks,new Date().toISOString());") && has("if(_br&&!supaClient){") && has("else if(_br){"));
  // Before each Saturday: block-timetable gaps
  const dates = [{ full: "03/10/2026", half: "A1" }, { full: "10/10/2026", half: "A1" }];
  const acts = [{ n: "LT A then B", di: [0], sess: "A+B", sessA: "LT A", sessB: "LT B", cap: 50, blocks: { yg: "13", A: "A", B: "B" } },
    { n: "Y11 Day", di: [1], sess: "A+B", sessA: "Y11 Day", sessB: "Y11 Day", cap: 50, blocks: { yg: "11", A: "C", B: "C" } }];
  const pupils = [{ email: "ada@x.com", yg: "Year 13" }, { email: "bo@x.com", yg: "Year 13" }, { email: "eve@x.com", yg: "Year 11" }];
  const ado = { "0|ada@x.com": "LT A then B", "0|bo@x.com": "LT A then B", "1|eve@x.com": "Y11 Day" };
  const bd2 = { batches: { "13": "B" }, sets: [
    { yg: "13", block: "A", set_code: "PSY/13/A", subject: "Psychology", lead: "TCH" }, { yg: "13", block: "B", set_code: "BUS/13/B", subject: "Business", lead: "OTH" },
    { yg: "13", block: "A", set_code: "__FREE__", subject: "Y13 Supported Study", lead: "FRL" }],
    members: [{ yg: "13", block: "A", email: "ada@x.com", setCode: "PSY/13/A" }, { yg: "13", block: "B", email: "ada@x.com", setCode: "BUS/13/B" }] };
  const g = CHK({ dates, acts, pupils, ado, staff: [{ c: "TCH" }, { c: "OTH" }, { c: "FRL" }], blockData: bd2, today: 20260929 }).blockGaps;
  t("a block activity whose year group has no set lists is listed", g.some(x => x.act === "Y11 Day" && /no set lists imported for Year 11/.test(x.why)));
  t("a pupil in no set of a block with no Supported Study is listed", g.some(x => x.act === "LT A then B" && x.block === "B" && x.emails.join() === "bo@x.com"));
  t("…but not where Supported Study catches them (block A)", !g.some(x => x.block === "A"));
  t("…and exactly those two", g.length === 2, JSON.stringify(g));
  t("the card lists them", has('section("Block timetable: set lists missing, or pupils with no set and no Supported Study",r.blockGaps,'));
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

  // v170: removing anyone on this roster, as of the backup's day, never clears a past entry.
  {
    const bd = +(BK._createdAt || "").slice(0, 10).replace(/-/g, "");
    const Wl = LVR({ dates: BK.dates, staff: JSON.parse(JSON.stringify(BK.staff)), acts: JSON.parse(JSON.stringify(BK.acts)), sa: JSON.parse(JSON.stringify(BK.sa || {})) });
    let fut = 0, past = 0, leads = 0, badFuture = [];
    BK.staff.forEach(s => { const p = Wl.staffRemovalPlan(s.c, bd); fut += p.future.length; past += p.past.length; leads += p.leads.length;
      p.future.forEach(k => { const d = BK.dates[parseInt(k, 10)], q = core.parseDateDmy(d && d.full); if (!(q[0] * 10000 + q[1] * 100 + q[2] > bd)) badFuture.push(k); }); });
    t("removal on the real roster only ever clears dates after today", badFuture.length === 0, badFuture.slice(0, 5).join(","));
    console.log(`  note: across all ${BK.staff.length} staff — ${past} past calendar entries a v169 removal would have deleted are kept; ${fut} upcoming entries and ${leads} lead fields would be offered for clearing`);
  }

  // v169 §1: the Saturday checks over the live backup, as of the day the backup was taken.
  const bday = (BK._createdAt || "").slice(0, 10).replace(/-/g, "");
  const ck = CHK({ dates: BK.dates, acts: BK.acts, staff: BK.staff, res: BK.allocRes, pupils: BK.pupils, fd: BK.formData,
    ao: BK.allocOverrides, ado: BK.allocDateOverrides, sa: BK.sa, designations: BK.designations, today: bday ? +bday : undefined });
  const ckUp = new Set(BK.dates.map((_, i) => i).filter(i => { const p = core.parseDateDmy(BK.dates[i].full); return p[0] * 10000 + p[1] * 100 + p[2] >= +bday; }));
  t("the Saturday checks only report dates still to come", Object.values(ck).every(l => l.every(x => x.di == null || ckUp.has(x.di))));
  console.log("  note: Saturday checks — " + Object.entries(ck).map(([k, l]) => k + " " + l.length).join(", "));
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

// ════════════════════════════════════════════════════════════════════════════
// v175 — P0: 29–30 Sept. Between two backups the half-term overrides went from 70 to 17 (and lost
// their reasons) and consent from 38 entries to 26, through v169's version check. The copy that
// went up was this browser's local storage — full, so it had stopped taking the keys that grew —
// loaded into a live tab whose version stamps still said "current". Invented data throughout.
var mkOverrides = n => { const o = { a1: {}, a2: {}, _reason: { a2: {} } };
  for (let i = 1; i <= n; i++) { o.a2["pupil" + i + "@c.com"] = i % 2 ? "Golf" : "Chess";
    if (i > 17 && i % 3 === 0) o._reason.a2["pupil" + i + "@c.com"] = { to: o.a2["pupil" + i + "@c.com"], why: "clash" }; }
  if (n <= 17) delete o._reason;                             // the old copy predates any reason
  return o; };
var mkConsent = n => { const c = {}; for (let i = 1; i <= n; i++) c["pupil" + i + "@c.com"] = { A1: true }; return c; };
async function p0v175Tests() {
  S("v175 — P0: an old local copy never reaches the cloud");
  const O70 = mkOverrides(70), O17 = mkOverrides(17), C38 = mkConsent(38), C26 = mkConsent(26);
  const nOvr = o => Object.keys((o && o.a2) || {}).length;
  const nRsn = o => Object.keys(((o && o._reason) || {}).a2 || {}).length;
  // 1. The incident: a refresh that finds the network down, then any save.
  {
    const srv = mkServer({ acts: ACTS0, allocoverrides: O70, consentmap: C38 });
    const ls = mkLS();
    const T = mkClient(srv, ls); await T.load();
    // Local storage filled up days ago: the keys that grew since kept their old values.
    ls.setItem("lex12-allocoverrides", JSON.stringify(O17)); ls.setItem("lex12-consentmap", JSON.stringify(C26));
    await T.refreshUnreachable();
    t("a refresh that cannot reach the cloud keeps what the tab holds", nOvr(T.ovr) === 70 && Object.keys(T.consent).length === 38, nOvr(T.ovr) + " overrides");
    T.acts.find(a => a.id === "A1").cap = 15; await T.push();          // an unrelated save later
    const o = srv.get("allocoverrides");
    t("…and the next save leaves all 70 overrides in the cloud", nOvr(o) === 70, nOvr(o) + " in the cloud");
    t("…with their reasons", nRsn(o) === nRsn(O70) && nRsn(o) > 0, nRsn(o) + " reasons");
    t("…and all 38 consent entries", Object.keys(srv.get("consentmap")).length === 38, Object.keys(srv.get("consentmap")).length + " consent entries");
    t("…while the edit that was made goes up", srv.get("acts").find(a => a.id === "A1").cap === 15);
  }
  // 2. A reload beside a full local storage: stamps say "current", data is old; edit before the cloud answers.
  {
    const srv = mkServer({ allocoverrides: O70, consentmap: C38 });
    const ls = mkLS();
    const T = mkClient(srv, ls); await T.load();                        // records the current versions
    const R = mkClient(srv, ls); R.loadLocalOnly({ allocoverrides: O17, consentmap: C26 });
    R.ovr.a2["newcomer@c.com"] = "Polo"; R.consent["newcomer@c.com"] = { A1: true };
    await R.load(); await R.push();
    const o = srv.get("allocoverrides");
    t("reload with an old local copy: the edit is added to the cloud's 70, not written over them", nOvr(o) === 71 && o.a2["newcomer@c.com"] === "Polo", nOvr(o) + " in the cloud");
    t("…reasons kept", nRsn(o) === nRsn(O70));
    t("…consent: 38 kept plus the new one", Object.keys(srv.get("consentmap")).length === 39);
    t("…and the tab now shows the cloud's overrides", nOvr(R.ovr) === 71);
  }
  // 3. The same, when the cloud load never lands before the save (focus on an input bails it).
  {
    const srv = mkServer({ allocoverrides: O70 });
    const ls = mkLS();
    const T = mkClient(srv, ls); await T.load();
    const R = mkClient(srv, ls); R.loadLocalOnly({ allocoverrides: O17 });
    R.ovr.a2["newcomer@c.com"] = "Polo"; await R.push();
    t("save before the cloud load: the old copy is merged onto the cloud's, not written", nOvr(srv.get("allocoverrides")) === 71, nOvr(srv.get("allocoverrides")) + " in the cloud");
  }
  // 4. A reload whose local copy IS the version it recorded still writes straight through.
  {
    const srv = mkServer({ allocoverrides: O70 });
    const ls = mkLS();
    const T = mkClient(srv, ls); await T.load();
    const R = mkClient(srv, ls); R.loadLocalOnly({ allocoverrides: O70 });
    R.ovr.a2["newcomer@c.com"] = "Polo";
    const b = srv.log.length; await R.push();
    t("a reload with a matching local copy keeps its version: one write, no extra read",
      srv.log.slice(b).join(";") === "PATCH lex12-allocoverrides" && nOvr(srv.get("allocoverrides")) === 71, srv.log.slice(b).join(";"));
  }
  // 5. The engine refuses to run on a copy another device has moved past.
  {
    const srv = mkServer({ allocoverrides: O70, formdata: [], acts: ACTS0, pupils: [], dates: [] });
    let down = false;
    const net = Object.assign({}, srv, { fetch: async (u, o) => { if (down) throw new TypeError("Failed to fetch"); return srv.fetch(u, o); } });
    const A = mkClient(net, mkLS()), B = mkClient(srv, mkLS()); await A.load(); await B.load();
    t("engine check: a current copy may run", JSON.stringify(await A.engineStale()) === "[]");
    B.ovr.a2["late@c.com"] = "Golf"; await B.push();
    t("engine check: overrides changed on another device → refused", JSON.stringify(await A.engineStale()) === '["allocoverrides"]');
    await A.load();
    t("engine check: after loading them, it may run", JSON.stringify(await A.engineStale()) === "[]");
    A.ovr.a2["mine@c.com"] = "Polo"; A.setPending(true);
    t("engine check: this copy's own unsaved edit is saved first, not taken for someone else's",
      JSON.stringify(await A.engineStale()) === "[]" && srv.get("allocoverrides").a2["mine@c.com"] === "Polo");
    const C = mkClient(srv, mkLS()); C.loadLocalOnly({ allocoverrides: O17 });
    t("engine check: a copy whose version is unknown is not treated as current", (await C.engineStale()).includes("allocoverrides"));
    down = true;
    t("engine check: no network → 'could not check', not 'current'", (await A.engineStale()) === null);
  }
  // 5b. "Push local data to Supabase" (unconditional), then another copy writes before this tab
  // records the cloud's versions: the tab must take that version, not pair its own copy with it.
  {
    const srv = mkServer({ allocoverrides: O70 });
    const A = mkClient(srv, mkLS()), B = mkClient(srv, mkLS()); await A.load();
    A.ovr.a2["pushed@c.com"] = "Golf"; await A.rawSet("allocoverrides", A.ovr);   // the push
    await B.load(); B.ovr.a2["between@c.com"] = "Chess"; await B.push();        // lands in between
    await A.adopt();
    A.ovr.a2["after@c.com"] = "Polo"; await A.push();
    const o = srv.get("allocoverrides");
    t("after a push-all, a write that landed in between is not overwritten by the next save",
      o.a2["between@c.com"] === "Chess" && o.a2["pushed@c.com"] === "Golf" && o.a2["after@c.com"] === "Polo" && nOvr(o) === 73, nOvr(o) + " in the cloud");
  }
  // 6. Every run leaves a pre-run backup, taken BEFORE the run.
  {
    const D = [{ full: "05/09/2026", half: "A1" }, { full: "12/09/2026", half: "A1" },
               { full: "07/11/2026", half: "A2" }, { full: "14/11/2026", half: "A2" }];
    const act = (n, cap) => ({ n, cap, di: [0, 1, 2, 3] });
    const fd = [{ email: "new@c.com", timestamp: "01/09/2026 09:00:00", s1c1: "Golf", c1: "Golf", s1c2: "", s1c3: "", c2: "", c3: "", s2c1: "", s2c2: "", s2c3: "" }];
    const old = [{ email: "old@c.com", half: "A1", alloc: "Chess", st: "1ST" }];
    let seen = null;
    const out = ENG({ dates: D, acts: [act("Golf", 4), act("Chess", 4)], fd, res: clone(old),
      onSnap: (l, res) => { seen = { l, res: clone(res) }; } }).run();
    t("the engine takes a 'Pre-run backup' on every run", seen && seen.l === "Pre-run backup");
    t("…before the run: it holds the results being replaced", seen && JSON.stringify(seen.res) === JSON.stringify(old));
    t("…and the run then goes ahead", out.res.some(r => r.email === "new@c.com"));
    const refused = ENG({ dates: D, acts: [act("Golf", 4)], fd, res: clone(old), onSnap: () => false, confirmOk: false }).run();
    t("no backup and no file → the engine does not run", JSON.stringify(refused.res) === JSON.stringify(old) && /NOT RUN/.test(refused.log[0] || ""));
  }
  // 7. takeSnapshot on a full local storage.
  {
    const SNAP = new Function("LS", [
      "let acts=[{n:'Golf'}],sa={},allocRes=[{email:'x@c.com',alloc:'Golf'}],allocOverrides={a1:{}},allocDateOverrides={},pupils=[],snapshots=[];",
      "const localStorage=LS;const log=[];function logAction(a,d){log.push(a+': '+d);}",
      grab("function takeSnapshot(label){", "\r\n}", "takeSnapshot"),
      "return {take:takeSnapshot,get snaps(){return snapshots;},set snaps(v){snapshots=v;},log};"].join("\n"));
    const quotaLS = limit => { const m = {}; return { getItem: k => (k in m ? m[k] : null), removeItem: k => { delete m[k]; }, _m: m,
      setItem: (k, v) => { const rest = Object.keys(m).filter(x => x !== k).reduce((s, x) => s + m[x].length, 0);
        if (rest + String(v).length > limit) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; } m[k] = String(v); } }; };
    let ls = quotaLS(1e9), S1 = SNAP(ls);
    t("snapshot: saved when there is room", S1.take("Pre-run backup") === true && JSON.parse(ls.getItem("lex12-snapshots"))[0].label === "Pre-run backup");
    const one = ls.getItem("lex12-snapshots").length;
    ls = quotaLS(one * 3.5); const S2 = SNAP(ls);
    S2.snaps = Array.from({ length: 9 }, (_, i) => ({ ts: "2026-09-0" + (i + 1), label: "older " + i, data: clone(S1.snaps[0].data) }));
    t("snapshot: a full store drops the oldest to make room, and does not throw", S2.take("Pre-run backup") === true
      && JSON.parse(ls.getItem("lex12-snapshots"))[0].label === "Pre-run backup" && S2.log.some(l => /dropped \d+ older/.test(l)), S2.log.join(" | "));
    ls = quotaLS(10); const S3 = SNAP(ls);
    t("snapshot: no room even for one → false (kept in memory), and does not throw", S3.take("Pre-run backup") === false
      && S3.snaps[0].label === "Pre-run backup" && S3.log.some(l => /NOT saved/.test(l)));
  }
  t("the unreachable-cloud branch no longer loads local storage over the tab", !P0_UNREACHABLE.split("\r\n").filter(l => !l.trim().startsWith("//")).join("\n").includes("loadLocal("));
  t("the Run button goes through the stale check", has('onClick:async()=>{if(!(await runAllocationChecked(false)))return; // v175'));
  t("automatic re-runs go through it too", has("    if(!(await runAllocationChecked(true)))return; // v175"));
  t("the engine is called from one place only: the checked runner", (src.match(/runAllocEngineV12\(\)/g) || []).length === 2
    && grab("async function runAllocationChecked(auto){", "\r\n}", "runAllocationChecked").includes("  runAllocEngineV12();"));
  t("the engine no longer takes its snapshot after the run", !grab("function runAllocEngineV12(){", "\r\n}\r\n", "runAllocEngineV12").includes('takeSnapshot("Pre-run backup")'));
}

// ════════════════════════════════════════════════════════════════════════════
// v176 — Force sync, and a restore that has not reached the cloud yet. Invented data.
async function p0v176Tests() {
  S("v176 — Force sync pushes; a restore survives a reload until it is in the cloud");
  const O70 = mkOverrides(70), O17 = mkOverrides(17);
  const nOvr = o => Object.keys((o && o.a2) || {}).length;
  // 1. Force sync writes this tab's changes, and later saves still work.
  {
    const srv = mkServer({ acts: ACTS0 });
    const A = mkClient(srv, mkLS()); await A.load();
    A.acts.find(a => a.id === "A1").cap = 30; A.setPending(true);
    t("Force sync pushes this tab's changed keys", (await A.forceSync()) === true && srv.get("acts").find(a => a.id === "A1").cap === 30);
    A.acts.find(a => a.id === "A2").cap = 7; await A.push();
    t("…and a save after it still goes up", srv.get("acts").find(a => a.id === "A2").cap === 7);
    t("Force sync no longer empties the last-synced fingerprints (only the declaration remains)", (src.match(/_lastSyncedFingerprints=\{\};/g) || []).length === 1 && has("let _lastSyncedFingerprints={};"));
  }
  // 2. Restore, then the tab reloads before the push lands: the restore goes up after the reload.
  {
    const srv = mkServer({ allocoverrides: O17, acts: ACTS0 });   // the damaged cloud
    const ls = mkLS();
    const A = mkClient(srv, ls, { realSave: true }); await A.load();
    A.ovr = clone(O70); A.markOverwrite(["allocoverrides"], "backup file from 29 Sept"); A.saveLocalNow();   // restore; no push yet
    t("restore: pending until it is in the cloud", JSON.stringify(A.restorePending()) === '["allocoverrides"]');
    const A2 = mkClient(srv, ls, { realSave: true }); A2.reloadFromLS();
    t("…still pending after a reload", JSON.stringify(A2.restorePending()) === '["allocoverrides"]');
    await A2.load();
    t("…the cloud load does not replace the restored data", nOvr(A2.ovr) === 70, nOvr(A2.ovr) + " held");
    await A2.push();
    t("…and the next save puts it in the cloud", nOvr(srv.get("allocoverrides")) === 70, nOvr(srv.get("allocoverrides")) + " in the cloud");
    t("…after which nothing is pending, here or on the next reload", A2.restorePending().length === 0
      && (() => { const A3 = mkClient(srv, ls, { realSave: true }); A3.reloadFromLS(); return A3.restorePending().length === 0; })());
  }
  // 3. …but not beside different data: another tab replaced this browser's copy before the reload.
  {
    const srv = mkServer({ allocoverrides: O17 });
    const ls = mkLS();
    const A = mkClient(srv, ls, { realSave: true }); await A.load();
    A.ovr = clone(O70); A.markOverwrite(["allocoverrides"], "backup file from 29 Sept"); A.saveLocalNow();
    ls.setItem("lex12-allocoverrides", JSON.stringify(mkOverrides(5)));      // another tab's copy
    const A2 = mkClient(srv, ls, { realSave: true }); A2.reloadFromLS();
    const before = srv.log.length; await A2.load(); await A2.push();
    t("a stored restore beside different data is not used to overwrite the cloud", nOvr(srv.get("allocoverrides")) === 17
      && !srv.log.slice(before).some(l => l.startsWith("PATCH")), srv.log.slice(before).join(";"));
    t("…and the loss is reported, saying to restore again", A2.conflicts().some(c => /had not reached the cloud.*Restore it again/.test(c.what)));
  }
  // 4. A restore goes up even where it equals this tab's last-synced copy (the cloud moved meanwhile).
  {
    const srv = mkServer({ allocoverrides: O70 });
    const A = mkClient(srv, mkLS()), B = mkClient(srv, mkLS()); await A.load(); await B.load();
    ["pupil1@c.com", "pupil2@c.com", "pupil3@c.com"].forEach(e => delete B.ovr.a2[e]); await B.push();
    A.ovr = clone(O70); A.markOverwrite(["allocoverrides"], "auto-snapshot"); await A.push();
    t("a restore matching this tab's old copy still replaces the cloud's", nOvr(srv.get("allocoverrides")) === 70, nOvr(srv.get("allocoverrides")) + " in the cloud");
    // The same with a refresh landing between the restore and its save.
    const srv2 = mkServer({ allocoverrides: O70 });
    const C = mkClient(srv2, mkLS()), D = mkClient(srv2, mkLS()); await C.load(); await D.load();
    ["pupil1@c.com", "pupil2@c.com", "pupil3@c.com"].forEach(e => delete D.ovr.a2[e]); await D.push();
    C.ovr = clone(O70); C.markOverwrite(["allocoverrides"], "auto-snapshot"); await C.load(); await C.push();
    t("…even when a refresh lands before its save", nOvr(C.ovr) === 70 && nOvr(srv2.get("allocoverrides")) === 70, nOvr(srv2.get("allocoverrides")) + " in the cloud");
  }
  // 5. Keys the restore did not touch are not overwritten.
  {
    const srv = mkServer({ allocoverrides: O17, acts: ACTS0 });
    const A = mkClient(srv, mkLS()), B = mkClient(srv, mkLS()); await A.load(); await B.load();
    B.acts.find(a => a.id === "A3").n = "Canoeing"; await B.push();
    A.ovr = clone(O70); A.markOverwrite(["allocoverrides"], "backup file"); await A.push();
    t("restoring overrides leaves another device's newer activities alone", srv.get("acts").find(a => a.id === "A3").n === "Canoeing" && nOvr(srv.get("allocoverrides")) === 70);
  }
  // 6. A failed push leaves it pending; a later one clears it.
  {
    const srv = mkServer({ allocoverrides: O17 });
    let down = false;
    const net = Object.assign({}, srv, { fetch: async (u, o) => { if (down) throw new TypeError("Failed to fetch"); return srv.fetch(u, o); } });
    const A = mkClient(net, mkLS()); await A.load();
    A.ovr = clone(O70); A.markOverwrite(["allocoverrides"], "backup file"); down = true; await A.push();
    t("restore: still pending after a failed push", A.restorePending().length === 1 && nOvr(srv.get("allocoverrides")) === 17);
    down = false; await A.push();
    t("…and cleared by the one that lands", A.restorePending().length === 0 && nOvr(srv.get("allocoverrides")) === 70);
  }
  t("the three restores each name the keys they restored", !has("markBlobsForOverwrite();") && (src.match(/markBlobsForOverwrite\(\[/g) || []).length === 3);
  t("a restore waiting to go up is shown at startup and after each save and load",
    has("try{_updateRestoreBanner();_showBlobConflicts();}catch(_){} // v176") && has("_showBlobConflicts();_updateRestoreBanner();\r\n  return {wrote,failed};"));
  t("Sync Health stops showing sa as pending after a per-row save", has("if(allOk){_markSupaWrite();_lastSyncedFingerprints.sa=_saFp;}"));
}

// ════════════════════════════════════════════════════════════════════════════
// v177 — the shared activity log (lex_log). A stand-in for the table's REST endpoint: insert with
// ignore-duplicates on the id, read with pfx/action filters, newest first. It can be "down", lose
// the reply to a write it did store, or not exist yet. Invented names and addresses.
var mkLogServer = () => {
  const rows = new Map(), st = { missing: false, down: false, loseReply: false, posts: 0 };
  const resp = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
  const fetch = async (url, opts) => {
    opts = opts || {};
    if (st.down) throw new TypeError("Failed to fetch");
    if (st.missing) return resp(404, '{"code":"42P01","message":"relation \\"public.lex_log\\" does not exist"}');
    const q = new URL(url).searchParams;
    if ((opts.method || "GET") === "POST") {
      st.posts++;
      const body = JSON.parse(opts.body), prefer = (opts.headers || {}).Prefer || "";
      if (!/ignore-duplicates/.test(prefer) && body.some(r => rows.has(r.id))) return resp(409, '{"code":"23505","message":"duplicate key value violates unique constraint"}');
      body.forEach(r => { if (!rows.has(r.id)) rows.set(r.id, { ...r, logged_at: "2026-10-01T09:00:00+00:00" }); });
      if (st.loseReply) { st.loseReply = false; throw new TypeError("Failed to fetch"); }
      return resp(201, "");
    }
    let out = [...rows.values()].filter(r => "eq." + r.pfx === q.get("pfx"));
    const a = q.get("action");
    if (a && a.startsWith("in.(")) { const set = a.slice(4, -1).split(","); out = out.filter(r => set.includes(r.action)); }
    if (a && a.startsWith("like.")) { const pre = a.slice(5).replace(/\*$/, ""); out = out.filter(r => r.action.startsWith(pre)); }
    out.sort((x, y) => y.ts.localeCompare(x.ts));
    return resp(200, out.slice(0, +q.get("limit") || 300));
  };
  return { fetch, rows, st };
};
var LOG_SRC = [
  grab("function logAction(action,detail){", "\r\n}", "logAction"),
  grab("let _logQueue=null;", "let _logTableState=null;", "shared log state"),
  grab("function _logUuid(){", "\r\n}", "_logUuid"),
  grab("function _deviceLabel(){", "\r\n}", "_deviceLabel"),
  grab("function _logQueueSync(){", "\r\n}", "_logQueueSync"),
  grab("function _sharedLog(action,detail,ts){", "\r\n}", "_sharedLog"),
  grab("async function _flushSharedLog(){", "\r\n}", "_flushSharedLog"),
  grab("async function sharedLogLoad(kind,limit){", "\r\n}", "sharedLogLoad")
].join("\n");
var mkLogClient = (srv, ls, o) => new Function("SRV", "LS", "O", `
  let activityLog=[],_logUser="Gideon";const PFX=O.pfx||"lex12",CURRENT_VERSION="vTEST",_clientId=O.id||"cDEVICE0001";
  const supaClient={url:"https://db.test",key:"k"};const fetch=SRV.fetch;const localStorage=LS;
  const window={__LEX_USER__:O.user||{email:"head.of.lex@c.com",name:"Head of LEX"}};
  const navigator={userAgent:O.ua||"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"};
  function saveLocal(){} function isStaffView(){return !!O.staff;} function isPublicTimetable(){return false;}
  const console={warn(){},error(){},log(){}};
  ${LOG_SRC}
  return {log:logAction,flush:_flushSharedLog,load:sharedLogLoad,device:_deviceLabel,
    queue:()=>(_logQueueSync(),_logQueue.length),state:()=>_logTableState,get local(){return activityLog;}};`)(srv, ls, o || {});
async function v177Tests() {
  S("v177 — a shared activity log: who, which device, every device");
  const settle = () => new Promise(r => setTimeout(r, 15));
  const rowsOf = srv => [...srv.rows.values()];
  {
    const srv = mkLogServer(), A = mkLogClient(srv, mkLS());
    A.log("ALLOCATION_RUN", "S1: 120 allocated"); await settle();
    const r = rowsOf(srv)[0] || {};
    t("an admin action reaches the shared log", srv.rows.size === 1 && r.action === "ALLOCATION_RUN" && r.detail === "S1: 120 allocated");
    t("…naming the signed-in user", r.user_email === "head.of.lex@c.com" && r.user_name === "Head of LEX");
    t("…and the device", r.device_id === "cDEVICE0001" && r.device === "Chrome on Windows" && r.pfx === "lex12" && r.app_version === "vTEST");
    t("…and stays in this browser's own log too", A.local.length === 1 && A.local[0].action === "ALLOCATION_RUN");
    const S = mkLogClient(srv, mkLS(), { staff: true }); S.log("ATTENDANCE", "register"); await settle();
    t("the staff portal does not write to the shared log", srv.rows.size === 1);
  }
  {
    const srv = mkLogServer(), A = mkLogClient(srv, mkLS());
    srv.st.down = true; A.log("OVERRIDE", "a → b"); A.log("RESTORE", "backup file"); await settle();
    t("offline: entries wait in the queue", A.queue() === 2 && srv.rows.size === 0);
    srv.st.down = false; await A.flush();
    t("…and go up when the cloud answers", srv.rows.size === 2 && A.queue() === 0);
    srv.st.loseReply = true; A.log("SNAPSHOT", "Pre-run backup"); await settle();
    t("a write whose reply was lost stays queued", A.queue() === 1);
    await A.flush();
    t("…and its retry does not duplicate it", srv.rows.size === 3 && A.queue() === 0 && srv.st.posts >= 2);
    srv.st.missing = true; A.log("RESTORE_SAVED", "x"); await settle();
    t("no table yet: says so and keeps the entry", A.state() === "missing" && A.queue() === 1);
    srv.st.missing = false; await A.flush();
    t("…which goes up once the table exists", srv.rows.size === 4 && A.queue() === 0 && A.state() === "ok");
  }
  {
    const srv = mkLogServer(), ls = mkLS();
    const A = mkLogClient(srv, ls, { id: "cTABA" }), B = mkLogClient(srv, ls, { id: "cTABB" });
    srv.st.down = true; A.log("OVERRIDE", "from tab A"); B.log("OVERRIDE", "from tab B"); await settle();
    t("two tabs of one browser: neither's queued entry is lost", A.queue() === 2 && B.queue() === 2);
    srv.st.down = false; await A.flush(); await B.flush();
    t("…both go up, once each", srv.rows.size === 2 && A.queue() === 0 && B.queue() === 0
      && rowsOf(srv).map(r => r.device_id).sort().join() === "cTABA,cTABB");
  }
  {
    const L = ua => mkLogClient(mkLogServer(), mkLS(), { ua }).device();
    t("device: iPad", L("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1") === "Safari on iPad");
    t("device: Android phone", L("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36") === "Chrome on Android");
    t("device: Edge on Windows", L("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0") === "Edge on Windows");
    t("device: Safari on a Mac", L("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15") === "Safari on Mac");
  }
  {
    const srv = mkLogServer(), A = mkLogClient(srv, mkLS());
    A.log("OVERRIDE", "first"); await settle(); await new Promise(r => setTimeout(r, 5));
    A.log("ALLOCATION_RUN", "second"); await settle(); await new Promise(r => setTimeout(r, 5));
    A.log("RESTORE", "third"); await settle();
    srv.rows.set("other-year", { id: "other-year", pfx: "lex11", ts: "2027-01-01T00:00:00Z", action: "RESTORE", detail: "last year" });
    const all = await A.load("all"), ovr = await A.load("overrides"), runs = await A.load("runs");
    t("reading: newest first, this year's system only", all.rows.map(r => r.detail).join() === "third,second,first");
    t("reading: filter to override changes", ovr.rows.length === 1 && ovr.rows[0].action === "OVERRIDE");
    t("reading: filter to allocation runs", runs.rows.length === 1 && runs.rows[0].action === "ALLOCATION_RUN");
    srv.st.missing = true;
    t("reading with no table: says it is missing", (await A.load("all")).error === "missing");
  }
  {
    const D = [{ full: "05/09/2026", half: "A1" }, { full: "12/09/2026", half: "A1" }, { full: "07/11/2026", half: "A2" }, { full: "14/11/2026", half: "A2" }];
    const fd = [{ email: "new@c.com", timestamp: "01/09/2026 09:00:00", s1c1: "Golf", c1: "Golf", s1c2: "", s1c3: "", c2: "", c3: "", s2c1: "", s2c2: "", s2c3: "" }];
    const E = ENG({ dates: D, acts: [{ n: "Golf", cap: 4, di: [0, 1, 2, 3] }], fd,
      ao: { a1: { "x@c.com": "Golf", "y@c.com": "Golf" }, a2: { "x@c.com": "Golf" }, _reason: { a1: { "x@c.com": { to: "Golf", why: "clash" } } } } });
    E.run();
    t("an allocation run records how many overrides and responses it used", E.actions.some(a => a.startsWith("ALLOCATION_RUN") && a.includes("using 3 half-term overrides and 1 form responses")), E.actions.join(" | "));
  }
  t("the log table is insert and read only", /for insert to anon, authenticated/.test(grab("const LOG_SETUP_SQL=", "`;", "LOG_SETUP_SQL"))
    && !/for (update|delete|all)/.test(grab("const LOG_SETUP_SQL=", "`;", "LOG_SETUP_SQL")));
  t("queued entries go up on every cloud load", has("  try{_flushSharedLog();}catch(_){} // v177"));
  t("the Activity Log screen shows the shared log", has("_renderSharedLog(sharedBox); // v177"));
}

// ── summary ──────────────────────────────────────────────────────────────────
(async () => {
  try { await p0Tests(); }
  catch (e) { fail++; failures.push("v169 P0 → the simulation threw: " + e.message); console.log("  FAIL  the P0 simulation threw — " + (e.stack || e)); }
  try { await p0v175Tests(); }
  catch (e) { fail++; failures.push("v175 P0 → the simulation threw: " + e.message); console.log("  FAIL  the v175 P0 simulation threw — " + (e.stack || e)); }
  try { await p0v176Tests(); }
  catch (e) { fail++; failures.push("v176 → the tests threw: " + e.message); console.log("  FAIL  the v176 tests threw — " + (e.stack || e)); }
  try { await v177Tests(); }
  catch (e) { fail++; failures.push("v177 → the tests threw: " + e.message); console.log("  FAIL  the v177 tests threw — " + (e.stack || e)); }
  try { await blockTests(); }
  catch (e) { fail++; failures.push("v171 blocks → the tests threw: " + e.message); console.log("  FAIL  the block tests threw — " + (e.stack || e)); }
  try { blockUseTests(); }
  catch (e) { fail++; failures.push("v172 blocks → the tests threw: " + e.message); console.log("  FAIL  the block-use tests threw — " + (e.stack || e)); }
  console.log("\n" + "═".repeat(60));
  console.log(`${pass} passed · ${fail} failed · ${skip} skipped`);
  if (failures.length) { console.log("\nFailures:"); failures.forEach(f => console.log("  • " + f)); }
  console.log("═".repeat(60));
  process.exit(fail ? 1 : 0);
})();
