# Acceptance criteria

Every roadmap issue states its behaviour as Given/When/Then acceptance criteria, and each criterion is locked in by an automated test before the issue closes. This folder holds them as Gherkin scenarios, one file per issue, grouped by the milestone that ships them:

```text
docs/acceptance/v<milestone>/<ISSUE-KEY>.feature
```

Each scenario is tagged with its ID and the test suite that covers it, and the test's title starts with the same ID. `npm run test:trace` checks the mapping both ways and runs in CI. The convention, and how to add criteria for a new issue, are in [CONTRIBUTING.md](../../CONTRIBUTING.md#acceptance-criteria-and-regression-tests).
