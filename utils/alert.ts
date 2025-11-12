import { Alert, Platform } from 'react-native';

interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface AlertOptions {
  cancelable?: boolean;
}

/**
 * Cross-platform alert that works on both mobile and web
 */
export const showAlert = (
  title: string,
  message?: string,
  buttons: AlertButton[] = [{ text: 'OK' }],
  options?: AlertOptions
) => {
  if (Platform.OS === 'web') {
    // For web, use window.alert for simple cases or window.confirm for yes/no
    if (buttons.length === 1) {
      const result = window.alert(`${title}\n\n${message || ''}`);
      if (buttons[0].onPress) {
        buttons[0].onPress();
      }
    } else if (buttons.length === 2) {
      const result = window.confirm(`${title}\n\n${message || ''}`);
      if (result && buttons[1].onPress) {
        buttons[1].onPress();
      } else if (!result && buttons[0].onPress) {
        buttons[0].onPress();
      }
    } else {
      // For more complex cases, use window.alert and handle the first button
      window.alert(`${title}\n\n${message || ''}`);
      if (buttons[0].onPress) {
        buttons[0].onPress();
      }
    }
  } else {
    // For mobile, use React Native's Alert
    Alert.alert(title, message, buttons, options);
  }
};
