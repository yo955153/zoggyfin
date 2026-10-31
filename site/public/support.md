# Zoggyfin support

Page: https://zoggyfin.zog-tech.com/support

## Contact

Send an email to admin@zog-tech.com. Tell us your device, your iOS version, the app version (Settings, App version) and your Jellyfin server version. We answer in English.

## What do I need?

A Jellyfin server (version 10.11 or later) and a user account on it. Zoggyfin is only a client: it plays the media that is on your server. To try the app without a server, use the public Jellyfin demo server: address https://demo.jellyfin.org/stable , user name `demo`, no password.

## Sign in

- Enter the server address with http:// or https:// and the port, for example `http://10.0.0.20:8096`.
- You can also sign in with Quick Connect. Approve the code in the Jellyfin web app, signed in as the same user.
- If the server is not reachable, check that your device is on the same network, or that the internet address of the server is correct.

## Home and internet addresses

A server can have more than one address. Open Settings, then the server, to add addresses. The app uses the first address that answers. With the Wi-Fi rule, the app uses the home address on your home Wi-Fi. This needs location access, because iOS gives the Wi-Fi name only with it. The app does not use your location.

## Playback

- The server plays files directly when the device can open them. Other files are converted by the server, so the server needs enough power for that.
- If a video does not start, set a lower quality in the player or in Settings, Playback.
- Picture in Picture, AirPlay and background audio work from the player controls.

## Downloads

Tap the download button on a movie, an episode, a season, an album or a playlist. The Downloads tab shows the queue, the progress and the space used. Downloads continue in the background. Downloaded items play without a connection, and the app sends your progress to the server later.

## Watch together

Tap Together on Home. Join a session from the list, or tap Start a session, pick what to play and choose who can join: people near you (same Wi-Fi or Bluetooth, no internet needed) or anyone on your server (they join from anywhere). Sessions on your server use Jellyfin SyncPlay, so other Jellyfin apps can join too. To join nearby, the other device must allow local network access. As the host, you accept each person. You can remove or block a device, stop new people, or hide the session so that only people with your code can join.

## Privacy

Zoggyfin collects no data. See [privacy.md](https://zoggyfin.zog-tech.com/privacy.md).
