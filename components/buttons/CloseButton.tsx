import React from "react";
import { TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/styles/ThemeContext";

interface CloseButtonProps {
  onPress: () => void;
}

const CloseButton: React.FC<CloseButtonProps> = ({ onPress }) => {
  const { theme } = useTheme();
  const styles = getStyles(theme);

  return (
    <TouchableOpacity style={styles.button} onPress={onPress}>
      <Feather name="x" size={24} color={theme.colors.textTertiary} />
    </TouchableOpacity>
  );
};

export default CloseButton;

const getStyles = (theme: any) =>
  StyleSheet.create({
    button: {
      padding: 6,
      backgroundColor: theme.colors.primary,
      borderRadius: 8,
    },
  });
