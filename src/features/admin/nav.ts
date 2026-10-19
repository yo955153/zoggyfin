/** The sections of the Admin panel and the routes that open them. */
import { router } from 'expo-router';

import type { IconName } from '@/components/icon-names';

export type AdminSection = 'dashboard' | 'sessions' | 'users' | 'libraries' | 'tasks' | 'activity' | 'devices' | 'logs';

export const ADMIN_SECTIONS: readonly { key: AdminSection; label: string; icon: IconName }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'square.grid.2x2' },
  { key: 'sessions', label: 'Now playing', icon: 'play.rectangle' },
  { key: 'users', label: 'Users', icon: 'person.2' },
  { key: 'libraries', label: 'Libraries', icon: 'square.stack' },
  { key: 'tasks', label: 'Scheduled tasks', icon: 'calendar.badge.clock' },
  { key: 'activity', label: 'Activity', icon: 'clock.arrow.circlepath' },
  { key: 'devices', label: 'Devices', icon: 'iphone' },
  { key: 'logs', label: 'Logs', icon: 'doc.text' },
];

export function isAdminSection(v: string | undefined): v is AdminSection {
  return ADMIN_SECTIONS.some((s) => s.key === v);
}

export function sectionLabel(key: AdminSection): string {
  return ADMIN_SECTIONS.find((s) => s.key === key)?.label ?? 'Admin';
}

export function openAdmin(serverId: string): void {
  router.push({ pathname: '/(tabs)/(home)/admin/[serverId]', params: { serverId } });
}

export function openAdminSection(serverId: string, section: AdminSection): void {
  router.push({ pathname: '/(tabs)/(home)/admin/[serverId]/[section]', params: { serverId, section } });
}

export function openAdminUser(serverId: string, userId: string): void {
  router.push({ pathname: '/(tabs)/(home)/admin/[serverId]/user/[userId]', params: { serverId, userId } });
}

export function openAdminLog(serverId: string, name: string): void {
  router.push({ pathname: '/(tabs)/(home)/admin/[serverId]/log/[name]', params: { serverId, name } });
}
