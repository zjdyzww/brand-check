# brand-check — a first-pass name screen that refuses to guess

Takes candidate names and answers, per row: **available / taken / could-not-confirm**, with the basis for each verdict.

```bash
node check.mjs --names "acme,acme-labs" --tlds com,io --handles github,x
node check.mjs --names "acme" --json          # machine-readable
```

No dependencies. Node 20+. Every request has a timeout; the whole run is bounded.

## What it checks

| Row | How | What "available" means |
|---|---|---|
| Domain | RDAP (`rdap.org/domain/<name>.<tld>`) | the registry itself answered 404 — no such domain. A 200 means registered. |
| Social handle | plain GET on the profile URL | the profile URL returned 404/410. A 200 means taken. |
| App stores | iTunes public search API | no app title in the result set contains the name. |

## Sample run (2026-11-24T11:33Z)

```
## openai
- domain openai.com: **taken** — RDAP 200 (registered)
- github /openai: **taken** — HTTP 200 on profile URL
- x /openai: **taken** — HTTP 200 on profile URL
- app stores: **available** — no app title contains the name

## zzz-brandcheck-2026
- domain zzz-brandcheck-2026.com: **available** — RDAP 404 (registry has no such domain)
- github /zzz-brandcheck-2026: **available** — HTTP 404 on profile URL
- x /zzz-brandcheck-2026: **available** — HTTP 404 on profile URL
- app stores: **available** — no app title contains the name
```

A known-real name and a known-invented name, both judged correctly. That is the minimum bar, and the first two runs of this tool failed it — see below.

## Two bugs the first runs caught (kept here on purpose)

1. **Every RDAP lookup returned 403.** Node's default User-Agent is refused by `rdap.org`. Sending a named UA fixed it. Without that, the tool would have reported every domain as "could not confirm" — useless but at least not wrong.
2. **GitHub returned 410 for a live profile.** The cause was the request's `accept` header: `application/json,text/html` gets 410, `text/html` gets 200. A live profile (`/openai`) was reported as **available** — the exact failure mode this tool exists to prevent, and the reason every row carries its HTTP status as the basis.

Both were found by running the tool against a name whose answer is known in advance. A screen that is never checked against a known answer is not a screen.

## What this is not

- **Not a trademark clearance.** Trademark registers mostly refuse automated reads; where they do, this tool must say "could not confirm" rather than guess, and a real clearance still needs a professional search.
- **Not legal advice**, and not a guarantee of registrability.
- **Not exhaustive.** It checks the extensions, platforms and stores you name — nothing else.
- The app-store row asks whether any app *title* contains the name; a product with a different title can still occupy the market.

## Why "could-not-confirm" is a feature

A founder acting on a false "available" loses money: they print it, register a company, design a mark, then discover the collision. A "could not confirm" costs them one manual check. The two errors are not symmetric, so the tool resolves every ambiguity toward the gap, and prints the status code that caused it.
