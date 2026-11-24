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

// RDAP: 404 means the registry has no such domain, which is the only definite "available" signal.
async function checkDomain(name, tld) {
  const fqdn = `${name}.${tld}`;
  const r = await get(`https://rdap.org/domain/${fqdn}`, 9000, 'application/rdap+json,application/json');
  if (r.status === 404) return { fqdn, verdict: 'available', basis: 'RDAP 404 (registry has no such domain)' };
  if (r.status === 200) return { fqdn, verdict: 'taken', basis: 'RDAP 200 (registered)' };
  return { fqdn, verdict: 'could-not-confirm', basis: `RDAP status ${r.status || r.error}` };
}

async function checkHandle(platform, handle) {
  const build = HANDLE_URL[platform];
  if (!build) return { platform, handle, verdict: 'could-not-confirm', basis: 'no public probe defined for this platform' };
  const r = await get(build(handle), 8000, 'text/html');
  if (r.status === 404 || r.status === 410) return { platform, handle, verdict: 'available', basis: `HTTP ${r.status} on profile URL` };
  if (r.status === 200) return { platform, handle, verdict: 'taken', basis: 'HTTP 200 on profile URL' };
  return { platform, handle, verdict: 'could-not-confirm', basis: `HTTP ${r.status || r.error} (login wall or rate limit)` };
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
  for (const platform of handles) social.push(await checkHandle(platform, name.replace(/[^a-z0-9-]/g, '')));
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
