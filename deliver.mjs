#!/usr/bin/env node
// @module deliver-name-screen
// @path ~/.dsh/ventures/brand-check/deliver.mjs
// @description Turn a customer's list of names into the report they paid for: runs the screen, formats one section per name, states the basis for every row, and keeps the "could-not-confirm" gaps in their own section instead of hiding them. It never upgrades a gap to "available".
// @skill deliver_report — names -> check.mjs --json -> customer-facing Markdown with per-row basis and a gaps section
// @rule gap_is_not_a_verdict P0 — a row whose basis is could-not-confirm must appear in the gaps section; the formatter never renders it as available or taken
// @rule reproduce_hint_always P1 — every report ends with the exact command that produced it, so the buyer can re-run it
// @depends check.mjs (same directory), node 18+
// @error no_names — empty name list -> exit 2
// usage: node deliver.mjs --names "a,b,c" [--out report.md]

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : d; };

// The honesty rule ("a gap is not a verdict") is only real if it can be shown to fire,
// so it is checked here against a fixture instead of being left to the live network, where
// a could-not-confirm row is rare and therefore untestable on demand.
if (argv.includes('--self-test')) {
  const fixture = { checkedAt: 'fixture', report: [
    { name: 'taken-one', domains: [{ fqdn: 'taken-one.com', verdict: 'taken', basis: 'RDAP 200 (registered)' }], social: [], apps: { verdict: 'taken', basis: 'x' } },
    { name: 'free-one', domains: [{ fqdn: 'free-one.com', verdict: 'available', basis: 'RDAP 404' }], social: [], apps: { verdict: 'available', basis: 'none' } },
    { name: 'gap-one', domains: [{ fqdn: 'gap-one.org', verdict: 'could-not-confirm', basis: 'RDAP status 400' }], social: [{ platform: 'x', handle: 'gapone', verdict: 'could-not-confirm', basis: 'HTTP 429' }], apps: { verdict: 'available', basis: 'none' } },
  ] };
  const md = formatReport(fixture, ['taken-one', 'free-one', 'gap-one'], 'com,org');
  const fail = [];
  if (!md.includes('## Could not confirm')) fail.push('no gaps section');
  if (md.includes('None - every row above rested on a status code.')) fail.push('gaps section claims none while a gap exists');
  if (!/gap-one\.org .*RDAP status 400/.test(md)) fail.push('the domain gap is missing from the gaps list');
  if (!/x\/gapone .*HTTP 429|gap-one: x\/gapone/.test(md)) fail.push('the handle gap is missing from the gaps list');
  const gapRow = (md.split('\n').find(l => l.includes('gap-one.org')) || '');
  if (/\| gap-one\.org \| available \|/.test(md)) fail.push('a gap row was rendered as available');
  if (fail.length === 0) console.log('deliver.mjs --self-test PASS (fixture: gaps listed, not upgraded)');
  else { console.log('deliver.mjs --self-test FAIL: ' + fail.join('; ')); process.exit(1); }
  process.exit(0);
}

const names = String(val('--names', '')).split(',').map(s => s.trim()).filter(Boolean);
if (names.length === 0) {
  console.error('no_names: pass --names "a,b,c" (up to 5 for the $10 product)');
  process.exit(2);
}
if (names.length > 5) console.error(`note: ${names.length} names given; the $10 product covers up to 5 - extra names are still screened and shown`);

const here = dirname(fileURLToPath(import.meta.url));
const tlds = String(val('--tlds', 'com,io,net'));
const raw = execFileSync('node', [join(here, 'check.mjs'), '--names', names.join(','), '--tlds', tlds, '--handles', 'github,x', '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const data = JSON.parse(raw);

function formatReport(data, names, tlds) {
const lines = [];
lines.push(`# Name screen — ${names.length} name${names.length > 1 ? 's' : ''}`);
lines.push(`Checked ${data.checkedAt}. Every row below states the basis it rested on.`);
lines.push('');
lines.push('**How to read the verdicts.** `available` means a registry or platform answered that the name is free. `taken` means it answered that it is not. `could not confirm` means the register blocked an automated read - that is a gap in my coverage, not a verdict, and it is listed separately at the end rather than folded into an answer.');
lines.push('');

const gaps = [];
for (const r of data.report) {
  lines.push(`## ${r.name}`);
  lines.push('');
  lines.push('| check | verdict | basis |');
  lines.push('|---|---|---|');
  for (const d of r.domains) {
    lines.push(`| domain \`${d.fqdn}\` | ${d.verdict} | ${d.basis} |`);
    if (d.verdict === 'could-not-confirm') gaps.push(`${r.name}: ${d.fqdn} — ${d.basis}`);
  }
  for (const s of r.social) {
    lines.push(`| ${s.platform} \`/${s.handle}\` | ${s.verdict} | ${s.basis} |`);
    if (s.verdict === 'could-not-confirm') gaps.push(`${r.name}: ${s.platform}/${s.handle} — ${s.basis}`);
  }
  if (r.apps) {
    lines.push(`| app stores | ${r.apps.verdict} | ${r.apps.basis} |`);
    if (r.apps.verdict === 'could-not-confirm') gaps.push(`${r.name}: app stores — ${r.apps.basis}`);
  }
  lines.push('');
}

lines.push('## Could not confirm');
if (gaps.length === 0) {
  lines.push('None - every row above rested on a status code.');
} else {
  for (const g of gaps) lines.push(`- ${g} - check this one by hand before you commit to the name.`);
}
lines.push('');
lines.push('## What this is not');
lines.push('');
lines.push('- Not trademark clearance and not legal advice. A company-name register can block a name that is free as a domain.');
lines.push('- Not a promise that the name is "probably fine". Rows I could not confirm stay unconfirmed.');
lines.push('');
lines.push('## Reproduce it');
lines.push('');
lines.push('```bash');
lines.push(`node check.mjs --names "${names.join(',')}" --tlds ${tlds} --handles github,x`);
lines.push('```');
lines.push('');
lines.push('The tool is open source at github.com/zjdyzww/brand-check, so you can run this yourself and compare.');
lines.push('');

return lines.join('\n');
}

const out = formatReport(data, names, String(val('--tlds', 'com,io,net')));
const dest = val('--out', '');
if (dest) { writeFileSync(dest, out, 'utf8'); console.log(`wrote ${dest} (${out.length} chars)`); }
else console.log(out);
