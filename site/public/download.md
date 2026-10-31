# Download Zoggyfin

Zoggyfin is free on iPhone, iPad, Mac and TV. You need your own Jellyfin server, version 10.11 or later. Page: https://zoggyfin.zog-tech.com/download

## Mac

Needs a Mac with Apple silicon (M1 or later) and macOS 13 Ventura or later. The app is signed and notarized by Apple.

1. Download the disk image: https://releases.zog-tech.com/zoggyfin/latest/Zoggyfin-arm64.dmg
2. Open Zoggyfin-arm64.dmg.
3. Drag Zoggyfin to the Applications folder.
4. Open Zoggyfin from Applications or Launchpad.

Zoggyfin looks for updates by itself and asks before it installs one. To look now, select Check for Updates in the Zoggyfin menu.

## iPhone and iPad

Needs iOS or iPadOS 16.4 or later. The app is in beta on TestFlight.

1. Install TestFlight from the App Store.
2. Open the beta link on the iPhone or iPad: https://testflight.apple.com/join/qRFABNBJ
3. Tap Accept, then Install.

## Fire TV, Google TV and Android TV

Needs Android TV 7 or later, or Fire OS 6 or later. The app is an APK that you sideload with the Downloader app. On the TV, type this short address into Downloader: zoggyfin.zog-tech.com/tv.apk (it points to https://releases.zog-tech.com/zoggyfin/android-tv/zoggyfin-tv-latest.apk).

Fire TV:
1. Install Downloader from the Amazon Appstore.
2. If you do not see Developer options, go to Settings, My Fire TV, About. Select the device name 7 times.
3. Go to Settings, My Fire TV, Developer options, Install unknown apps. Turn on Downloader.
4. Open Downloader, type zoggyfin.zog-tech.com/tv.apk and select Install.

Google TV and Android TV:
1. Install Downloader from Google Play on the TV.
2. Go to Settings, Apps, Security and restrictions, Unknown sources. Turn on Downloader.
3. Open Downloader, type zoggyfin.zog-tech.com/tv.apk and select Install.

With a computer on the same network, you can also use ADB: `adb install zoggyfin-tv-latest.apk`.

Zoggyfin TV looks for updates by itself. The first update asks you to let Zoggyfin install apps.

## Android phones and tablets

Coming soon. The download page links to it when it is ready.

## No server yet?

Try the app with the public Jellyfin demo server: address https://demo.jellyfin.org/stable , user name `demo`, no password. For help, see [support.md](https://zoggyfin.zog-tech.com/support.md) or write to admin@zog-tech.com.
