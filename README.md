<div align="center">

# ⚡ ZeroChat

### The $0/month AI Chat Widget for Your Website

**Smart AI sales agent → Telegram notifications → Zero hosting cost**

[![Deploy to Cloudflare](https://img.shields.io/badge/Deploy-Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-❤️-ea4aaa?style=for-the-badge)](https://github.com/sponsors/imtusharrai)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)]()

---

**ZeroChat** is an open-source, AI-powered live chat widget that runs entirely on **Cloudflare's free tier**.
Drop a `<script>` tag on any website → customers chat with AI → you reply from **Telegram**.

**No servers. No databases. No monthly bills. Just deploy and go.**

[Live Demo](https://zerochat.traiinc.workers.dev/) · [Quick Start](#-quick-start-5-minutes) · [How It Works](#-how-it-works) · [Sponsor](#-support-this-project)

</div>

---

## 🤔 Why ZeroChat?

Every small business needs live chat. But look at the options:

| Solution | Monthly Cost | AI Built-in? | Self-Hosted? | Setup Time |
|----------|-------------|--------------|-------------|------------|
| Intercom | $74/mo | ✅ | ❌ | 10 min |
| Zendesk | $55/mo | Plugin | ❌ | 30 min |
| Chatwoot | $20-50/mo (VPS) | Plugin | ✅ | 1 hour |
| Tawk.to | Free | ❌ | ❌ | 10 min |
| **ZeroChat** | **$0/mo** | **✅ Built-in** | **✅** | **5 min** |

### ZeroChat gives you:

- 🤖 **AI Sales Agent** — Llama 3.1 8B answers customer questions automatically
- 📱 **Telegram Notifications** — Every chat becomes a Forum Topic thread on your phone
- 💰 **$0/month** — Runs on Cloudflare Workers free tier (100K requests/day)
- 🧠 **Smart Routing** — Only potential customers talk to AI. Job seekers, vendors, spammers get filtered automatically (zero token waste)
- ⚡ **5-Minute Deploy** — One command: `wrangler deploy`
- 🌍 **Edge-Native** — Runs in 300+ data centers worldwide
- 🔒 **Security-Hardened** — IP rate limiting, HTML injection protection, input validation

---

## 🏗️ How It Works

```
┌──────────────┐     WebSocket      ┌───────────────────┐     Telegram API     ┌──────────────┐
│   Website    │ ◄──────────────► │  Cloudflare Worker  │ ◄────────────────► │   Telegram   │
│  (widget.js) │                   │  (Durable Object)   │                     │  (Your Phone)│
└──────────────┘                   └───────┬───────────────┘                     └──────────────┘
                                           │
                              ┌────────────┼────────────┐
                              ▼            ▼            ▼
                        ┌──────────┐ ┌──────────┐ ┌──────────┐
                        │ Keyword  │ │  AI      │ │  Info    │
                        │Classifier│ │ (Llama)  │ │Collector │
                        │ (Free)   │ │ (Smart)  │ │ (Free)   │
                        └──────────┘ └──────────┘ └──────────┘
```

### The 3-Layer Smart Router

1. **Layer 1 — Zero-Cost Classifier** (no AI tokens used)
   - Detects: sales inquiry, job seeker, vendor pitch, complaint, spam
   - Supports English + Hindi/Hinglish keywords
   - Spammers and job seekers → auto-reply + collect info (zero tokens)

2. **Layer 2 — AI Sales Agent** (token-budgeted)
   - Only activated for potential customers
   - Dynamic budget: 3 replies for cold leads, 15 for hot leads
   - Extracts intent signals: `[INTENT:HOT]`, `[INTENT:WARM]`, `[INTENT:COLD]`
   - Responses cached in KV for 1 hour (saves 20-40% AI neurons)

3. **Layer 3 — Human Handoff**
   - When AI budget exhausts → collects name, email, phone
   - Sends formatted summary to Telegram Forum Topic
   - Owner replies from Telegram → customer sees it in the widget

---

## 🚀 Quick Start (5 Minutes)

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
- [Telegram Bot](https://t.me/botfather) (free)

### Step 1: Clone & Install

```bash
git clone https://github.com/imtusharrai/zerochat.git
cd zerochat
npm install
```

### Step 2: Create KV Namespace

```bash
npx wrangler kv namespace create THREAD_MAP
```

Copy the `id` from the output and paste it into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "THREAD_MAP"
id = "paste-your-id-here"
```

### Step 3: Set Your Telegram Config

```toml
# In wrangler.toml
[vars]
TELEGRAM_CHAT_ID = "your-group-chat-id"
```

```bash
# Set secrets (never stored in code)
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

### Step 4: Set Your Business Context

```bash
npx wrangler kv key put --binding=THREAD_MAP "business:context" \
  "You are the sales assistant for [Your Business]. You sell [products]. Be friendly and helpful."

npx wrangler kv key put --binding=THREAD_MAP "business:config" \
  '{"name":"Your Business","hours":{"start":9,"end":19,"timezone":"Asia/Kolkata","days":[1,2,3,4,5,6]}}'
```

### Step 5: Deploy

```bash
npx wrangler deploy
```

### Step 6: Add to Any Website

```html
<script src="https://zerochat.YOUR-SUBDOMAIN.workers.dev/widget.js"></script>
```

**That's it. You're live.** 🎉

---

## 📊 Architecture

```
zerochat/
├── src/
│   ├── index.ts          # Worker entry point (routing, CORS, webhooks)
│   ├── chatroom.ts       # Durable Object (the brain — AI, routing, storage)
│   ├── classifier.ts     # Zero-token keyword classifier
│   ├── ratelimiter.ts    # IP-based rate limiter (separate DO)
│   ├── telegram.ts       # Telegram Bot API helpers
│   └── types.ts          # TypeScript interfaces
├── public/
│   ├── widget.js          # Embeddable chat widget (responsive)
│   └── index.html         # Demo page
├── wrangler.toml          # Cloudflare config
└── package.json
```

### Cloudflare Services Used (All Free Tier)

| Service | What For | Free Limit |
|---------|----------|-----------|
| **Workers** | HTTP routing + WebSocket | 100K requests/day |
| **Durable Objects** | Chat state + SQLite storage | 1M requests/month |
| **Workers AI** | Llama 3.1 8B inference | 10K neurons/day |
| **Workers KV** | Thread mapping + AI cache | 100K reads/day |

---

## 🔒 Security

ZeroChat is production-hardened, modeled after [Cloudflare's official Workers Chat Demo](https://github.com/cloudflare/workers-chat-demo):

- ✅ **IP-based rate limiting** — Separate Durable Object per IP (global, not per-session)
- ✅ **Global error handler** — Never exposes stack traces
- ✅ **HTML injection protection** — All user content escaped before Telegram delivery
- ✅ **Session ID validation** — UUID format enforced, prevents hijacking
- ✅ **Message length limits** — 1000 chars max, prevents abuse
- ✅ **WebSocket deduplication** — One connection per session
- ✅ **Monotonic timestamps** — Guaranteed message ordering
- ✅ **Try-catch everywhere** — Unhandled exceptions can't crash the DO

---

## 🗺️ Roadmap

- [x] AI-powered sales chat
- [x] Telegram Forum Topics integration
- [x] Smart 3-layer routing (keyword → AI → human)
- [x] Dynamic token budgeting
- [x] IP-based rate limiting
- [x] Mobile-responsive widget
- [ ] Analytics dashboard (`/admin`)
- [ ] WhatsApp Business integration
- [ ] Multi-tenant (one deploy, many businesses)
- [ ] File/image sharing
- [ ] Typing indicator from owner
- [ ] End-to-end encryption
- [ ] Webhook integrations (Slack, Discord)

---

## 🆚 Comparison

| Feature | ZeroChat | Intergram | Chatwoot | Tawk.to |
|---------|----------|-----------|----------|---------|
| **Monthly cost** | $0 | $5-20 (VPS) | $20-50 (VPS) | Free |
| **AI built-in** | ✅ Llama 3.1 | ❌ | Plugin | ❌ |
| **Smart routing** | ✅ 3-layer | ❌ | ❌ | ❌ |
| **Token budgeting** | ✅ Dynamic | N/A | N/A | N/A |
| **Telegram** | ✅ Forum Topics | ✅ Basic | ✅ Basic | ❌ |
| **Self-hosted** | ✅ | ✅ | ✅ | ❌ |
| **No server needed** | ✅ | ❌ | ❌ | ✅ (SaaS) |
| **Hindi/Hinglish** | ✅ | ❌ | ❌ | ❌ |
| **Open source** | ✅ MIT | ✅ | ✅ | ❌ |

---

## ❤️ Support This Project

ZeroChat is **100% free and open source**. If it saves you money (Intercom costs $74/mo!), consider supporting development:

<div align="center">

[![Sponsor on GitHub](https://img.shields.io/badge/Sponsor_on_GitHub-❤️-ea4aaa?style=for-the-badge&logo=github)](https://github.com/sponsors/imtusharrai)

</div>

Your sponsorship helps:
- 🚀 Build new features (WhatsApp, dashboard, multi-tenant)
- 🐛 Fix bugs and security issues fast
- 📚 Write better documentation
- 🌍 Keep it free for everyone

### Sponsor Tiers

| Tier | Amount | Perks |
|------|--------|-------|
| ☕ Coffee | $3/mo | Name in README + early access to features |
| 🍕 Pizza | $10/mo | Above + priority bug fixes + sponsor badge |
| 🚀 Rocket | $25/mo | Above + 1:1 setup help + feature requests |
| 🏢 Business | $100/mo | Above + custom branding + dedicated support |

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Development
npm run dev        # Start local dev server
npx tsc --noEmit   # Type check
```

---

## 📄 License

[MIT](LICENSE) — Use it however you want. Free forever.

---

<div align="center">

**Built with ❤️ on [Cloudflare Workers](https://workers.cloudflare.com/)**

If ZeroChat helped you, [give it a ⭐](https://github.com/imtusharrai/zerochat)

</div>
