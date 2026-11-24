#!/usr/bin/env node
// @module brand-check
// @path ~/.dsh/ventures/brand-check/check.mjs
// @description First-pass availability screen for a business name across domains (RDAP), app stores (iTunes public search) and social handles (plain profile probes). It reports available / taken / could-not-confirm per row and never guesses: a register or platform that blocks automated reads becomes an explicit gap, because a false "available" costs a founder more than an honest gap.
// @skill check_names — for each name x extension/platform: RDAP domain lookup, iTunes app search, handle probe -> one row per check
// @rule no_invented_availability P0 — only a definite 404/registered answer becomes available/taken; every other status is could-not-confirm with the status code recorded
// @rule bounded_network P1 — every request has a timeout and the whole run has a cap; no retries that could hang a hire
// @depends node 20+ (global fetch)
// @error no_names — empty name list -> exit 2
// @metric checks_run [type:counter]
// usage: node check.mjs --names "acme,acme-labs" [--tlds com,net,io] [--handles x,github] [--json]

const args = process.argv.slice(2);
const val = (flag, dflt) => { const i = args.indexOf(flag); return i > -1 ? args[i + 1] : dflt; };

if (args.includes('--self-check')) {
  const fail = [];
  const expect = (label, got, want) => { if (got !== want) fail.push(`${label}: got ${got}, want ${want}`); };
  expect('domain 404', classifyDomain(404).verdict, 'available');
  expect('domain 200', classifyDomain(200).verdict, 'taken');
  expect('domain 403', classifyDomain(403).verdict, 'could-not-confirm');
  expect('domain no-response', classifyDomain(0).verdict, 'could-not-confirm');
  expect('handle 404', classifyHandle(404).verdict, 'available');
  expect('handle 410', classifyHandle(410).verdict, 'available');
  expect('handle 200', classifyHandle(200).verdict, 'taken');
  expect('handle 429', classifyHandle(429).verdict, 'could-not-confirm');
  expect('handle 403', classifyHandle(403).verdict, 'could-not-confirm');
  // Regression guard for the subject-substitution bug found 2026-11-24: an invalid name used to be
  // percent-encoded into an RDAP request the registry answers 404 to, and 404 is the "available"
  // signal. Both of the next two assertions must keep failing the old behaviour.
  expect('label "a b" valid', isValidLabel('a b'), false);
  expect('label "a..b" valid', isValidLabel('a..b'), false);
  expect('label "-lead" valid', isValidLabel('-lead'), false);
  expect('label "openai" valid', isValidLabel('openai'), true);
  expect('label "a-b2" valid', isValidLabel('a-b2'), true);
  expect('label 64 chars valid', isValidLabel('a'.repeat(64)), false);
  if (fail.length === 0) console.log('check.mjs --self-check PASS (15 verdict/label mappings, offline)');
  else { console.log('check.mjs --self-check FAIL: ' + fail.join('; ')); process.exit(1); }
  process.exit(0);
}

const names = String(val('--names', '')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const tlds = String(val('--tlds', 'com,net,org')).split(',').map((s) => s.trim()).filter(Boolean);
const handles = String(val('--handles', 'github,x')).split(',').map((s) => s.trim()).filter(Boolean);
// A platform name that is not in PROBES used to produce a normal-looking report full of
// "could-not-confirm - no public probe defined", which reads like a finding rather than a
// typo. Fail loudly instead: the caller gets the valid list and nothing is screened.
{
  const known = new Set(Object.keys({ github: 1, x: 1 }));
  const unknown = handles.filter((h) => !known.has(h));
  if (unknown.length > 0) {
    console.error(`unknown handle platform(s): ${unknown.join(', ')} - valid: ${[...known].join(', ')}`);
    console.error('Nothing was screened. Example: --handles github,x  (and put the name in --names)');
    process.exit(2);
  }
}
const asJson = args.includes('--json');

if (names.length === 0) {
  console.error('no_names: pass --names "a,b" (nothing was checked)');
  process.exit(2);
}

const HANDLE_URL = {
  github: (h) => `https://github.com/${h}`,
  x: (h) => `https://x.com/${h}`,
};

async function get(url, ms = 8000, accept = 'text/html') {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      // A named UA is not cosmetic: rdap.org answers 403 and GitHub answers 410 to Node's default agent.
      // The accept header is not cosmetic either: GitHub answers 410 to a mixed json+html accept
      // and 200 to text/html, which turned a live profile into a false "available" on the first run.
      headers: { accept, 'user-agent': 'brand-check/0.1 (name availability screen; +https://github.com/zjdyzww)' },
    });
    return { status: res.status, ok: res.ok, body: res };
  } catch (error) {
    return { status: 0, error: error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? error) };
  } finally {
    clearTimeout(t);
  }
}

// A DNS label has a shape. Without this check, `a b.com` is percent-encoded into a request the
// registry answers 404 to, and 404 is the signal for "available" - so an invalid name would come
// back as a confident availability claim. Found 2026-11-24 after a reader on thecolony.cc pointed
// out that a check can run on the request and never on the subject.
export function isValidLabel(name) {
  return typeof name === 'string' && /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(name);
}

// RDAP: 404 means the registry has no such domain, which is the only definite "available" signal.
async function checkDomain(name, tld) {
  const fqdn = `${name}.${tld}`;
  // Not a valid name, so nothing is queried and nothing is claimed. This is the one place where
  // refusing to ask is the honest answer: the 404 we would get is indistinguishable from a real one.
  if (!isValidLabel(name) || !/^[a-z]{2,63}$/i.test(tld)) {
    return { fqdn, verdict: 'could-not-confirm', basis: 'not a valid domain name (not queried)' };
  }
  const r = await get(`https://rdap.org/domain/${fqdn}`, 9000, 'application/rdap+json,application/json');
  return { fqdn, ...classifyDomain(r.status) };
}

// The three-way verdict is the product, so it lives in pure functions that can be
// asserted offline. Keeping the mapping inline made it untestable without the network,
// which meant the only thing never tested was the rule customers pay for.
export function classifyDomain(status) {
  if (status === 404) return { verdict: 'available', basis: 'RDAP 404 (registry has no such domain)' };
  if (status === 200) return { verdict: 'taken', basis: 'RDAP 200 (registered)' };
  return { verdict: 'could-not-confirm', basis: `RDAP status ${status || 'no response'}` };
}
export function classifyHandle(status) {
  if (status === 404 || status === 410) return { verdict: 'available', basis: `HTTP ${status} on profile URL` };
  if (status === 200) return { verdict: 'taken', basis: 'HTTP 200 on profile URL' };
  return { verdict: 'could-not-confirm', basis: `HTTP ${status || 'no response'} (login wall or rate limit)` };
}

async function checkHandle(platform, handle) {
  const build = HANDLE_URL[platform];
  if (!build) return { platform, handle, verdict: 'could-not-confirm', basis: 'no public probe defined for this platform' };
  const r = await get(build(handle), 8000, 'text/html');
  return { platform, handle, ...classifyHandle(r.status) };
}

async function checkApps(name) {
  const r = await get(`https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=software&limit=5`, 8000, 'application/json');
  if (r.status !== 200) return { source: 'iTunes search', verdict: 'could-not-confirm', basis: `HTTP ${r.status || r.error}` };
  try {
    const data = await r.body.json();
    const exact = (data.results ?? []).filter((x) => String(x.trackName ?? '').toLowerCase().includes(name));
    return { source: 'iTunes search', verdict: exact.length ? 'taken' : 'available', basis: exact.length ? `${exact.length} app(s) with the name` : 'no app title contains the name' };
  } catch {
    return { source: 'iTunes search', verdict: 'could-not-confirm', basis: 'unparseable response' };
  }
}

const report = [];
for (const name of names) {
  const domains = [];
  for (const tld of tlds) domains.push(await checkDomain(name, tld));
  const social = [];
  // Stripping characters silently changes the subject: `a b` became `ab`, and the report said
  // "a b is taken on github" after checking `ab`. If normalization changes the name, say so and
  // claim nothing - the same rule as the invalid-domain case, applied to handles.
  const handle = name.replace(/[^a-z0-9-]/g, '')
  for (const platform of handles) {
    if (handle !== name) {
      social.push({ platform, handle, verdict: 'could-not-confirm', queriedAs: handle,
        basis: `handle normalization changed the name (${JSON.stringify(name)} -> ${JSON.stringify(handle)}), not queried` })
      continue
    }
    social.push(await checkHandle(platform, handle))
  }
  const apps = await checkApps(name);
  report.push({ name, domains, social, apps });
}

if (asJson) {
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), report }, null, 2));
} else {
  console.log(`# Name screen — checked ${new Date().toISOString()}`);
  console.log('\nFirst pass only. "available" means a registry answered that the name is unregistered, or a profile URL returned 404.');
  console.log('It is not a trademark clearance and not legal advice.\n');
  for (const r of report) {
    console.log(`## ${r.name}`);
    for (const d of r.domains) console.log(`- domain ${d.fqdn}: **${d.verdict}** — ${d.basis}`);
    for (const s of r.social) console.log(`- ${s.platform} /${s.handle}: **${s.verdict}** — ${s.basis}`);
    console.log(`- app stores: **${r.apps.verdict}** — ${r.apps.basis}`);
    console.log('');
  }
  const gaps = report.flatMap((r) => [...r.domains.filter((d) => d.verdict === 'could-not-confirm').map((d) => d.fqdn), ...r.social.filter((s) => s.verdict === 'could-not-confirm').map((s) => `${s.platform}/${s.handle}`)]);
  console.log(`Could not confirm: ${gaps.length === 0 ? 'none' : gaps.join(', ')}`);
}
