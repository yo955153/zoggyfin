/**
 * The app config is app.json. This file adds the parts that depend on the build.
 *
 * ZOGGYFIN_TV_SELF_UPDATE=1 (the EAS profile `tv`, the sideloaded Android TV
 * APK): the app may install its own updates. The build gets the permission
 * REQUEST_INSTALL_PACKAGES and the FileProvider that shares the downloaded APK
 * with the system installer (`modules/zoggyfin-native`, ZoggyfinUpdaterModule).
 * Every other build (phones, the Play build `tv-play`) has neither: Google Play
 * does not allow an app to update itself, and the updater in the app stays off
 * when the permission is not in the manifest.
 */
import { type ConfigContext, type ExpoConfig } from 'expo/config';
import { AndroidConfig, type ConfigPlugin, withAndroidManifest } from 'expo/config-plugins';

const SELF_UPDATE = process.env.ZOGGYFIN_TV_SELF_UPDATE === '1';
const INSTALL_PERMISSION = 'android.permission.REQUEST_INSTALL_PACKAGES';
const PROVIDER = 'expo.modules.zoggyfinnative.ZoggyfinUpdateFileProvider';

type Provider = { $: Record<string, string>; 'meta-data'?: { $: Record<string, string> }[] };

const withTvSelfUpdate: ConfigPlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults) as AndroidConfig.Manifest.ManifestApplication & {
      provider?: Provider[];
    };
    const pkg = mod.android?.package ?? 'com.zogtech.zoggyfin';
    app.provider = (app.provider ?? []).filter((p) => p.$['android:name'] !== PROVIDER);
    app.provider.push({
      $: {
        'android:name': PROVIDER,
        'android:authorities': `${pkg}.zoggyfin.updates`,
        'android:exported': 'false',
        'android:grantUriPermissions': 'true',
      },
      'meta-data': [{ $: { 'android:name': 'android.support.FILE_PROVIDER_PATHS', 'android:resource': '@xml/zoggyfin_update_paths' } }],
    });
    return mod;
  });

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  if (!SELF_UPDATE) return base;
  const withPermission: ExpoConfig = {
    ...base,
    android: { ...base.android, permissions: [...(base.android?.permissions ?? []), INSTALL_PERMISSION] },
  };
  return withTvSelfUpdate(withPermission);
};
