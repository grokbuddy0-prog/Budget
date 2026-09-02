# Forward Balance

Personal cash-flow ledger. Enter paydays and bills; every future day shows the checking balance.

## Environment variables

Set these on Vercel (Project → Settings → Environment Variables). Do not commit secrets.

No new env vars were added for encryption. Existing names:

| Name | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes (production) | Neon pooled Postgres connection |
| `BETTER_AUTH_URL` | Yes (production) | Public origin of this app |
| `BETTER_AUTH_SECRET` | Yes (production) | Session signing secret |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Yes (production) | Comma-separated allowed origins |
| `APP_URL` | Yes (production) | Public app URL |
| `MCP_API_KEY` | Yes (for Grok Bot) | Bearer token for `/api/mcp` |
| `MCP_USER_ID` | Recommended | Better Auth user id this key may read and write |

There is no `APP_ENCRYPTION_KEY`. Each user’s money is locked with a key derived from that user’s password.

## Encryption

Snapshot Neon before you deploy this change.

On each user’s next login, plaintext money fields are encrypted with that user’s key, then the plaintext is cleared. That migrate runs once per user.

Neon can still show dates, type (income or bill), frequency, enabled, ids, and user id. It cannot show balances, amounts, names, notes, or other money text.

**Lost password and no recovery key = that user’s budget cannot be recovered.**

The recovery key is shown once after the first unlock. Save it.

Password change in Settings unwraps with the old password and wraps with the new one.

Grok Bot / MCP can read that one bound user only after they have signed in once (so a wrap of their key exists for `MCP_API_KEY`). It cannot open other users.

## Grok Bot / MCP

After deploy:

1. Vercel → Environment Variables → add `MCP_API_KEY` (long random string) and `MCP_USER_ID` (your user id from the app).
2. Redeploy.
3. Sign in to the app once so your key can be wrapped for Grok Bot.
4. Grok Bot: Settings → Plugins / Add MCP server  
   URL: `https://YOUR-APP.vercel.app/api/mcp`  
   Header: `Authorization: Bearer YOUR_MCP_API_KEY`
5. Web Grok: grok.com/connectors → New Connector → Custom → same URL and header.
6. Test by asking: “What is my balance 30 days from now?” and “Add a $60 electric bill on the 15th.”

If `MCP_API_KEY` is missing, `/api/mcp` returns 401 and the rest of the app keeps running.
