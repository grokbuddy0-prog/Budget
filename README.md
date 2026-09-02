# Forward Balance

Personal cash-flow ledger. Enter paydays and bills; every future day shows the checking balance.

## Environment variables

Set these on Vercel (Project → Settings → Environment Variables). Do not commit secrets.

| Name | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes (production) | Neon pooled Postgres connection |
| `BETTER_AUTH_URL` | Yes (production) | Public origin of this app |
| `BETTER_AUTH_SECRET` | Yes (production) | Session signing secret |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Yes (production) | Comma-separated allowed origins |
| `APP_URL` | Yes (production) | Public app URL |
| `MCP_API_KEY` | Yes (for Grok Bot) | Bearer token for `/api/mcp` |
| `MCP_USER_ID` | Recommended | Better Auth user id this key may read and write |

## Grok Bot / MCP

After deploy:

1. Vercel → Environment Variables → add `MCP_API_KEY` (long random string) and `MCP_USER_ID` (your user id from the app).
2. Redeploy.
3. Grok Bot: Settings → Plugins / Add MCP server  
   URL: `https://YOUR-APP.vercel.app/api/mcp`  
   Header: `Authorization: Bearer YOUR_MCP_API_KEY`
4. Web Grok: grok.com/connectors → New Connector → Custom → same URL and header.
5. Test by asking: “What is my balance 30 days from now?” and “Add a $60 electric bill on the 15th.”

If `MCP_API_KEY` is missing, `/api/mcp` returns 401 and the rest of the app keeps running.
