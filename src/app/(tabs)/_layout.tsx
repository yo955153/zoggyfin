import { NativeTabs } from 'expo-router/native-tabs';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MiniPlayer, useMiniPlayerVisible } from '@/features/player/mini-player';
import { colors } from '@/theme';
import { spacing } from '@/theme/theme';

/** iOS 26 has the tab bar bottom accessory slot; elsewhere the mini player floats. */
const HAS_ACCESSORY = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26;

/** The accessory renders twice (regular and inline); each copy picks its layout. */
function Accessory() {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  return <MiniPlayer inline={placement === 'inline'} />;
}

/** Native tab bar height, for the floating mini player on web and older iOS. */
const TAB_BAR_HEIGHT = Platform.OS === 'web' ? 0 : 49;

function FloatingMiniPlayer() {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={[styles.floating, { bottom: insets.bottom + TAB_BAR_HEIGHT + spacing.sm, left: spacing.lg, right: spacing.lg }]}>
      <MiniPlayer floating />
    </View>
  );
}

/**
 * The five native tabs. On iPad and Mac the bar can turn into a sidebar
 * (sidebarAdaptable). Each tab has its own stack.
 */
export default function TabsLayout() {
  const mini = useMiniPlayerVisible();
  const tabs = (
    <NativeTabs tintColor={colors.accent} sidebarAdaptable minimizeBehavior="onScrollDown">
      {HAS_ACCESSORY && mini ? (
        <NativeTabs.BottomAccessory>
          <Accessory />
        </NativeTabs.BottomAccessory>
      ) : null}
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(library)">
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} md="grid_view" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(music)">
        <NativeTabs.Trigger.Label>Music</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="music.note" md="music_note" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(downloads)" hidden={Platform.OS === 'web'}>
        <NativeTabs.Trigger.Label>Downloads</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'arrow.down.circle', selected: 'arrow.down.circle.fill' }} md="download" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(search)" role="search">
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
  if (HAS_ACCESSORY) return tabs;
  return (
    <View style={styles.flex}>
      {tabs}
      {mini ? <FloatingMiniPlayer /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  floating: { position: 'absolute' },
});
