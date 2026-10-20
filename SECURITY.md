# Security policy

## Report a problem

Please report a security problem in private. Do not open a public issue, a discussion or a pull request for it.

Use one of these ways:

- **GitHub private vulnerability reporting.** Open the **Security** tab of this repository and choose
  **Report a vulnerability**.
- **Email.** Write to [admin@zog-tech.com](mailto:admin@zog-tech.com). Use the subject "Zoggyfin security".

Please include:

- what the problem is and what it can do
- the platform and the app version (iPhone, iPad, Mac, web)
- the steps to repeat it, or a small proof of concept
- your Jellyfin server version, if it matters

Do not send passwords, tokens or the media of other people.

## What to expect

- We reply within 5 working days.
- We tell you when we confirm the problem, and we keep you up to date.
- We fix confirmed problems as fast as we can, and we publish a fixed version.
- We credit you in the release notes if you want. Tell us how you want to be named.

This is a small project. We cannot pay bounties.

## Supported versions

Only the latest release gets security fixes.

| Version | Fixes |
|---|---|
| Latest release (Mac app, TestFlight build, web build from `main`) | Yes |
| Older releases | No. Update to the latest release. |

The Mac app updates itself. iPhone and iPad testers get new builds through TestFlight.

## Scope

In scope:

- The Zoggyfin app code in this repository (`src/`, `modules/`, `desktop/`)
- Nearby sessions (watch and listen together), invites, extensions and the stored sign-in data
- The release and update process of the Mac app

Out of scope:

- Problems in Jellyfin itself. Report them to the [Jellyfin project](https://github.com/jellyfin/jellyfin/security).
- Problems that need a device that is already unlocked and in the hands of the attacker
- Problems in libmpv, FFmpeg or another library with no effect on Zoggyfin. Report them to that project.
  If Zoggyfin is affected, tell us too.

## Safe harbor

If you act in good faith, follow this policy and do not harm other people or their data,
we will not take legal action against you.
