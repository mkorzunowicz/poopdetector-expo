import { useSafeAreaInsets } from 'react-native-safe-area-context'

export const CONTENT_SPACING = 15

export const SAFE_AREA_PADDING = {
  paddingTop: 44,
  paddingBottom: 34,
  paddingLeft: 16,
  paddingRight: 16,
}

// Hook to get dynamic safe area values
export const useSafeAreaPadding = () => {
  const insets = useSafeAreaInsets()
  return {
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
    paddingLeft: insets.left,
    paddingRight: insets.right,
  }
}