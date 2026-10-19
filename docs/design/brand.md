# Zoggyfin brand

Status: v1, 2026-10-19. Assets: `docs/design/assets/logo.svg`, `docs/design/assets/app-icon.svg`.
Tokens: `docs/design/theme.ts`. Rules for screens: `docs/design/design-system.md`.

## The idea

A fin rises above a calm horizon. It is the signal that something good is on, and that it moves forward without a splash.

Zoggyfin is the quiet client for your own media server. The artwork is the hero. The app stays out of the way and does each thing well.

## Name usage

| Context | Form |
|---|---|
| Product name in text | **Zoggyfin** (one word, capital Z, no camel case) |
| Wordmark | **zoggyfin**, lowercase, system font Semibold, tracking −0.01 em |
| App name under the icon | Zoggyfin |
| Bundle and package ids | `zoggyfin` (lowercase) |
| Not allowed | ZoggyFin, Zoggy Fin, ZOGGYFIN, "Zoggyfin for Jellyfin" as the app name |

Write "a client for Jellyfin" in descriptions. Do not use the Jellyfin logo, colours or name as part of the Zoggyfin mark. "Jellyfin" is the name of the server software and appears only in text.

## Personality

| Trait | We are | We are not |
|---|---|---|
| Calm | Few words, few colours, smooth motion | Loud, busy, flashy |
| Precise | Exact numbers: "812 MB of 1.4 GB · 8.6 MB/s" | Vague: "Downloading…" with no progress |
| Respectful | Your server, your files, your choice | Upsells, nags, tracking |
| Warm | One warm accent on a dark, quiet canvas | Cold neon, gamer purple |

Position on the voice spectra: formal 3/10 (plain, not stiff), simple 2/10, serious 6/10, reserved 7/10.

## Voice

Rules for all copy in the app, the store listing and the docs:

- Use short sentences. Put the verb first in buttons: "Play", "Resume 1:02:14", "Add to playlist", "Retry".
- Tell the user what happened and what to do next. Write "Server not reachable. Check the address or try again." Do not write "Oops! Something went wrong."
- Use sentence case for all labels and titles. Use Title Case only for proper names.
- Do not use exclamation marks, emoji or jokes in UI text.
- Use numbers, not words, for counts, sizes and times. Use tabular figures.
- Use the same term for the same thing: "Downloads" (not "Offline", "Saved"), "Playlist", "Queue", "Library".

| Context | Tone | Example |
|---|---|---|
| Empty state | Helpful | "No downloads yet. Tap the download button on any movie, episode or album." |
| Error | Direct, calm | "Could not load Movies. Retry" |
| Success toast | Short | "Added to Road Trip" |
| Destructive confirm | Exact | "Delete 6 episodes (8.1 GB) from this iPhone?" |
| Onboarding | Plain | "Enter your server address." |

## Logo

File: `assets/logo.svg` (128 × 128 viewBox).

**Concept.** A single fin shape leans forward. Its leading edge is a long convex curve and its trailing edge is concave, so the shape also reads as a soft "play" arrow. Below it is a horizon line in two parts. The short part on the right is at 45 % opacity and suggests motion past the fin. There is no jellyfish, no triangle-in-a-circle and no purple-to-blue gradient.

**Construction.**
- Fin: gradient from `#FF6A4D` (base, lower left) to `#FFA270` (tip, upper right).
- Horizon: `#FF7A59`, two rounded bars, 7 units tall, with an 8-unit gap from the fin base.
- Clear space: the height of the horizon bar × 3 on all sides (about 20 % of the mark).
- Minimum size: 16 pt for the mark alone. Under 24 pt, remove the faint right segment.

**Lockup.** Mark on the left, wordmark "zoggyfin" on the right. The wordmark cap height equals 55 % of the mark height. The gap between them equals the horizon bar length on the right.

**Colour variants.**

| Variant | Use |
|---|---|
| Ember gradient on ink `#0B0B0E` | Default (splash, sidebar, website) |
| Ember gradient on white | Light backgrounds |
| Solid `#FF7A59` | Small sizes, sidebar header, favicons |
| White mono | On artwork or photos |
| Ink mono `#111114` | Print, one-colour use |

**Do not:** rotate the fin, add outlines or drop shadows, put the mark in a circle, change the gradient to purple or blue, or stretch it.

## App icon

File: `assets/app-icon.svg` (1024 × 1024, full bleed; iOS applies the corner mask).

- Background: radial gradient of graphite, `#2A2A33` at the upper centre to `#09090B` at the corners. It is not pure black, so the icon has depth on the home screen.
- A soft ember glow (`#FF7A59` at 22 % to 0 %) sits behind the fin.
- The mark sits at 5.2× scale, a little above the optical centre.
- A faint reflection of the fin (30 % to 0 %) sits under the horizon.
- iOS 26 dark and tinted icon variants: use the mark alone on transparent. In the tinted variant, the system colours the mark; keep the faint segment.
- Light icon variant: background `#F2F2F5` to `#FFFFFF`, same ember mark.

## Colour

The brand has one accent, **Ember**, on neutral graphite. All other colour comes from the artwork.

| Name | Hex | Role |
|---|---|---|
| Ember | `#FF7A59` | Accent in dark mode, logo |
| Ember deep (light UI) | `#B53A17` | Accent in light mode (5.86:1 on white) |
| Ember gradient | `#FF6A4D` → `#FFA270` | Logo and icon only |
| Ink | `#0B0B0E` | Dark canvas, logo background |
| Graphite | `#16161A` / `#202026` / `#2A2A31` | Surfaces |
| Paper | `#FFFFFF` / `#F2F2F5` | Light canvas |

**Why Ember.** Media clients use red (cinema), green (music), yellow-amber (other self-hosted media servers) and purple-blue (Jellyfin, Streamyfin). A warm coral is free in this space. It is calm on graphite, it stays readable as text (7.66:1 on the dark canvas), and it does not fight poster colours as much as a saturated primary does.

## Typography

The system font on Apple platforms: **SF Pro** for Latin and **SF Arabic** for Arabic. iOS selects SF Arabic for Arabic text in the same label, with matched weights and Dynamic Type. No font file ships with the app, so start-up stays fast.

On web and Android, the stack is `system-ui` first, then **Noto Sans** and **Noto Sans Arabic** (or **IBM Plex Sans Arabic**). These have full Arabic coverage and nine weights. The wordmark uses the same system font at Semibold. It needs no custom font.

## Imagery

- Use the server's artwork. Do not add stock photos, illustrations or mascots to the UI.
- Show items without artwork with generated art (see the design system). Never use an empty grey tile.
- For screenshots and marketing, use generic sample titles ("Sample Movie", "Jane Doe"). Do not use real library names or copyrighted posters.
