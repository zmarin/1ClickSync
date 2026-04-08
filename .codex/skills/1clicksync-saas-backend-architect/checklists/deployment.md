# Deployment Checklist

- [ ] List new or changed environment variables.
- [ ] Confirm migration order is safe for the currently deployed app and worker.
- [ ] Check whether old app code can run against the new schema during rollout.
- [ ] Check whether the worker must be deployed with the app change in the same release.
- [ ] Confirm Dokploy service changes, if any, for app, worker, postgres, or redis.
- [ ] Check health-check or startup impacts.
- [ ] Confirm log visibility for the new behavior.
- [ ] Write rollback notes if the change alters schema or execution flow.
