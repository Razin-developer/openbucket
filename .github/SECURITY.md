# Security policy

OpenBucket exposes local files through management and S3-compatible network APIs. Treat suspected authentication bypasses, path traversal, signature-validation flaws, credential disclosure, unauthorized object access, and denial-of-service vectors as security-sensitive.

## Supported versions

Security fixes are applied to the latest published release and the `main` branch. Upgrade to the newest patch release before reporting a problem that may already be fixed. Older release lines do not receive routine security updates before OpenBucket reaches 1.0.

## Reporting a vulnerability

Use **Security → Report a vulnerability** in this GitHub repository to submit a private vulnerability report. Repository owners must enable GitHub private vulnerability reporting under **Settings → Security → Code security** before public launch.

Do not open a public issue, discussion, or pull request for an undisclosed vulnerability. Do not include real access keys, bearer tokens, presigned URLs, private filenames, or customer data in any report. Use synthetic test data and redact logs.

Include:

- affected OpenBucket version or commit;
- affected daemon, CLI, dashboard, SDK, or container surface;
- impact and realistic attack prerequisites;
- minimal reproduction steps or a proof of concept using synthetic data;
- suggested remediation, if known.

The maintainers target an acknowledgement within three business days, an initial assessment within seven business days, and status updates at least every fourteen days until resolution. These are response targets rather than a service-level guarantee.

## Coordinated disclosure

Please allow maintainers reasonable time to reproduce, patch, test, and release a fix before public disclosure. The project will credit reporters who request attribution, unless doing so would create additional risk.

## Research safe harbor

Good-faith research limited to systems and data you own or are explicitly authorized to test is welcome. Avoid privacy violations, service disruption, destructive testing, persistence, lateral movement, and accessing data beyond what is necessary to demonstrate the issue. Stop testing and report promptly if you encounter real user data or credentials.
