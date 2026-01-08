# Browser Data Directory

This directory stores the persistent Chromium browser profile used by Playwright MCP.

## What's stored here:
- Facebook login session (cookies, local storage)
- Browser cache
- Session tokens

## Important:
- This directory is git-ignored (contains sensitive data)
- Do NOT commit browser profile data
- Run `npm run fb:login` to establish a new session
- Session persists across server restarts

## To reset:
Delete all contents except `.gitignore` and `README.md`, then run login script again.
