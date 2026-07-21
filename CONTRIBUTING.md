# Contributing to ZeroChat

Thanks for wanting to contribute! ZeroChat is a community-driven project and every contribution matters.

## 🚀 Quick Setup

```bash
git clone https://github.com/imtusharrai/zerochat.git
cd zerochat
npm install
npm run dev    # starts local Cloudflare dev server
```

## 🛠️ Development

```bash
npx tsc --noEmit       # type check (must pass with zero errors)
npm run dev             # local dev server at http://localhost:8787
```

## 📋 How to Contribute

### Bug Reports
- Open an issue with steps to reproduce
- Include browser, OS, and error messages

### Feature Requests
- Open an issue describing the feature
- Explain the use case — *why* you need it

### Pull Requests
1. Fork the repo
2. Create a branch: `git checkout -b feature/your-feature`
3. Make changes and ensure `npx tsc --noEmit` passes
4. Commit with clear message: `git commit -m "feat: add WhatsApp integration"`
5. Push and open a PR

### Commit Convention
- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation
- `refactor:` — code restructuring
- `security:` — security fix

## 📁 Project Structure

```
src/
├── index.ts          # Worker entry — touch this for new routes
├── chatroom.ts       # Durable Object — the brain (AI, routing, storage)
├── classifier.ts     # Keyword classifier — add new keywords here
├── ratelimiter.ts    # IP rate limiter DO
├── telegram.ts       # Telegram API helpers
└── types.ts          # Shared TypeScript types

public/
├── widget.js          # Chat widget UI — modify for design changes
└── index.html         # Demo page
```

## 🎯 Good First Issues

Looking for something to work on? These are great starting points:

- [ ] Add more Hindi/Hinglish keywords to `classifier.ts`
- [ ] Add typing indicator when owner is replying
- [ ] Add dark/light mode toggle to widget
- [ ] Add emoji picker to chat input
- [ ] Write unit tests for `classifier.ts`
- [ ] Add Slack notification option alongside Telegram

## 💡 Architecture Decisions

Before making large changes, please understand:

- **Why Durable Objects?** — Each chat session is its own DO with SQLite. This gives us persistent state, WebSocket hibernation, and zero cold starts.
- **Why not a database?** — SQLite inside the DO is free and fast. External D1/Postgres would add cost and latency.
- **Why keyword classifier instead of AI?** — 60% of messages (job seekers, vendors, spam) don't need AI. This saves tokens and money.
- **Why Telegram Forum Topics?** — Each customer gets a separate thread. Much cleaner than a single group chat.

## 📄 License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

**Thank you for making ZeroChat better! ❤️**
