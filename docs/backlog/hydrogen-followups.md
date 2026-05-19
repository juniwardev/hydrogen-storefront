
## Replace placeholder social URLs in app/lib/const.js

**Discovered during:** add-site-footer QA pass (2026-05-18).

**Symptom:** Footer's social icon links point to Shopify corporate placeholder
URLs. Acceptable during development but must be replaced before the
storefront goes live to customers.

**Affected file:** app/lib/const.js

**Action:** Update Facebook, Instagram, X/Twitter, and TikTok URLs to match
the actual store's profiles. Verify each opens the correct profile in a
browser.

**Severity:** Low (works as-is during development; only matters at production
launch).

## Newsletter action returns 500 (not 404) on invalid locale POSTs

**Discovered during:** add-site-footer QA pass.

**Symptom:** POST to /xx-yy/api/newsletter (invalid locale prefix) returns
HTTP 500 instead of HTTP 404.

**QA conclusion:** Pre-existing Remix error boundary behavior matching the
existing api.countries route. Not a bug in the footer feature itself.

**Severity:** Low (does not affect any normal user flow; only triggered by
manually constructing an invalid URL).

**Action (optional):** Consider a Remix error boundary that returns 404 for
unknown locales across the API route family. Out of scope for the footer
feature.
