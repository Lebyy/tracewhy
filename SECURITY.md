# Security policy

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could expose trace data, bypass redaction, execute unintended commands, or make the local report reachable remotely. Use [GitHub private vulnerability reporting](https://github.com/Lebyy/tracewhy/security/advisories/new) and include the affected version, reproduction, impact, and a safe proof of concept. Expect acknowledgement within five business days.

## Supported versions

The latest stable release receives security fixes. Pre-release builds and old schemas may require upgrading before a fix is available.

## Trace-data sensitivity

TraceWhy minimizes and redacts evidence, but recordings can still reveal executable names, relative project paths, error messages, library identities, and system metadata. Treat `.tracewhy`, JSON, and HTML artifacts as sensitive. Never attach an unreviewed artifact to a public issue.
