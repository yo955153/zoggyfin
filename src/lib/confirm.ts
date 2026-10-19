import { Alert, Platform } from 'react-native';

/**
 * A confirm dialog for a destructive action (design system §7.12): the
 * native alert with the action in red. Web uses the browser's confirm.
 */
export function confirmDestructive(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    // RN Web has no Alert with buttons.
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}
