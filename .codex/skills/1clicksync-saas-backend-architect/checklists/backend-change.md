# Backend Change Checklist

- [ ] Name the exact files, tables, routes, services, workers, and env vars touched.
- [ ] Check whether the task touches `apps`, `customers`, or both.
- [ ] Check whether the task affects manifests, prompts, exports, SalesIQ starters, or public submit behavior.
- [ ] For any Zoho action, identify exact required scopes before designing the change.
- [ ] Compare granted scopes vs required scopes and add a reconnect path if scopes are missing.
- [ ] Decide whether the change is read-only, inline-safe, or should be queue-backed.
- [ ] For public or retryable paths, define idempotency and terminal states.
- [ ] Classify retryable vs non-retryable failures explicitly.
- [ ] Keep route handlers thin and move orchestration into services.
- [ ] Keep Zoho API logic isolated in connectors.
- [ ] Add or update structured logging where the behavior changes.
- [ ] Run at least build plus the most relevant tests, then note any gaps.
