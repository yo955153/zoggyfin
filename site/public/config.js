// Store and download links for the whole site (/, /download and /join).
// Change a value here when a store listing or an Android build is published.
// An empty value means "not yet". The pages keep working links without this file.
window.ZOGGYFIN_CONFIG = {
  // The App Store link of the iPhone and iPad app. Until it exists, the site uses TestFlight.
  appStoreUrl: '',
  testFlightUrl: 'https://testflight.apple.com/join/qRFABNBJ',
  // The numeric App Store id, for the Smart App Banner in Safari.
  appStoreId: '6824646949',
  // The latest Android APK, or the Play Store link later. Empty: "coming soon".
  androidUrl: '',
  // The Mac disk image (Apple silicon).
  macUrl: 'https://releases.zog-tech.com/zoggyfin/latest/Zoggyfin-arm64.dmg',
  // The newest Android TV APK (Fire TV, Google TV). scripts/release-android-tv.sh overwrites it.
  tvApkUrl: 'https://releases.zog-tech.com/zoggyfin/android-tv/zoggyfin-tv-latest.apk',
  // The Google Play listing of the TV app. Empty: the Play button stays hidden.
  tvPlayUrl: '',
  // A hosted web app, if one exists. Empty: no browser option.
  webAppUrl: '',
};
