import React from "react";
import { TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/styles/ThemeContext";

interface AddButtonProps {
  onPress: () => void;
}

const AddButton: React.FC<AddButtonProps> = ({ onPress }) => {
  const { theme } = useTheme();
  const styles = getStyles(theme);

  return (
    <TouchableOpacity style={styles.button} onPress={onPress}>
      <Ionicons name="trash-outline" size={24} color="red" />
    </TouchableOpacity>
  );
};

export default AddButton;

const getStyles = (theme: any) =>
  StyleSheet.create({
    button: {
      padding: 8,
      // backgroundColor: theme.colors.primary,
      // borderRadius: 8,
    },
  });
