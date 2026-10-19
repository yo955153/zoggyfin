# Zoggyfin

Zoggyfin is an open-source client for [Jellyfin](https://jellyfin.org) media servers.
It runs on iPhone, iPad, Apple Silicon Macs ("Designed for iPad") and the web.
Android comes later. The goal is a client that is fast, stable and clear.

Zoggyfin is not affiliated with the Jellyfin project.

## Status

Early development. Phase 1 ("Foundation") is in place:

- Sign in with a server address and a username and password, or with Quick Connect.
- Home: Continue Watching, Next Up, Continue Listening, Recently Added per library.
- Library: library grids with sort and filters, shows to seasons to episodes, collections.
- Music: Albums, Artists, Playlists, Songs and Genres in a swipeable pager.
- Item pages for movies, shows, seasons, episodes, albums, artists, people and playlists.
- Search, with results grouped by type and recent searches.
- Every tile has a picture: server art when it exists, generated art when it does not.
- A persisted query cache, so a cold start shows the last content at once.

Playback and downloads are not in yet. The Play button shows a notice.
The design is in [docs/specs](docs/specs/).

## Run a development build

You need Node 22 or later, pnpm 10, and Xcode for iOS.

```sh
pnpm install
pnpm expo run:ios        # builds the native app and starts it in the simulator
pnpm start               # starts Metro for an already installed development build
pnpm expo start --web    # runs the web app in a browser
```

The `ios/` and `android/` folders are generated (Expo CNG) and are not in git.

Checks:

```sh
pnpm typecheck
pnpm test
pnpm lint
```

### Web build

```sh
pnpm expo export --platform web
```

The `dist/` folder is a static site. A self-hosted build can carry an optional
`config.json` next to `index.html` to prefill the server address, for example
`{ "defaultServerUrl": "http://jellyfin.example.lan:8096" }`.
See `public/config.example.json`. The Jellyfin server must allow the web app's origin (CORS).

## License

[Mozilla Public License 2.0](LICENSE).
