# Reporting a vulnerability

Report a security problem privately through GitHub: open the repository's Security tab and choose Report a vulnerability.
Please do not open a public issue or pull request for it.

Say what you found, how to reproduce it and which version you ran (`docker compose exec banking node dist/node.js version`).
Do not include real bank data. You get an answer within a few days. A fix ships as a normal release, and the release notes
name the problem once households have had time to update.

The latest release is the supported one. What the app protects, what it sends to third parties and where its limits are is
in [docs/SECURITY.md](docs/SECURITY.md).
