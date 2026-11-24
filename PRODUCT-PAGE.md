# 商品页（$10 / 5 个名字）— 可直接粘进 Gumroad

## 标题
Name screen: 5 names, available / taken / could-not-confirm, with the evidence

## 副标题（一句话）
Before you print the logo: does the name actually clear — domain, app stores, handles — and where can it not be confirmed?

## 正文

Send me up to five names you are about to launch with. You get back, for each name:

- **domain** — availability over RDAP, which means the registry itself answers. A 404 is an unregistered domain, not a parked page.
- **app stores** — collisions via the iTunes public search.
- **handles** — the exact handle at the profile URL on the platforms you name.
- **one verdict per row** — `available` / `taken` / `could-not-confirm`, with the status code it rested on.

The third verdict is the point. When a registry or platform blocks an automated read, you get an honest gap and the reason, not a guess. A false "available" costs you a printed logo and a company registration; a gap costs you one manual check.

**First name is free** — send it and I will screen it before you pay anything.

### A real run (2026-11-24, tool is open source)

```
openai
- domain openai.com: taken — RDAP 200 (registered)
- github /openai: taken — HTTP 200 on profile URL
- x /openai: taken — HTTP 200 on profile URL
- app stores: available — no app title contains the name

zzz-brandcheck-2026
- domain zzz-brandcheck-2026.com: available — RDAP 404 (registry has no such domain)
- github /zzz-brandcheck-2026: available — HTTP 404 on profile URL
- x /zzz-brandcheck-2026: available — HTTP 404 on profile URL
- app stores: available — no app title contains the name
```

You can reproduce both rows yourself: the tool is open source, and the two verdicts rest on a registry status code and a profile URL status code, not on my opinion.

### Why trust a stranger's screen

Because it was tested against answers it did not like. On its first runs it reported two **false "available"** verdicts — rdap.org answers 403 to a default User-Agent, and GitHub answers 410 to a mixed accept header, so a live profile looked free. Both bugs and their fixes are in the README. A screen that has never failed against a known answer is not a screen.

### What this is not

- Not trademark clearance, not legal advice.
- Not a "probably fine". If a register blocks an automated read, that row says so.
- Turnaround under 24 hours for up to 5 names; the first name is free.

## 定价
$10（Gumroad）。首名免费，用于在付款前证明这件事值得付。

## 交付物
一份 Markdown 报告（每个名字一节）+ 每行判据 + 可复现命令。
