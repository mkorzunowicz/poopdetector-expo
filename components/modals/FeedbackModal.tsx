import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/styles/ThemeContext";
import { tr } from "@/i18n/i18n";

interface FeedbackModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (feedback: {
    rating: number | null;
    message: string;
    email?: string;
    screenshotUri?: string;
    pageContext?: string;
  }) => Promise<void>;
  screenshotUri?: string;
  pageContext?: string;
}

export function FeedbackModal({
  visible,
  onClose,
  onSubmit,
  screenshotUri: initialScreenshotUri,
  pageContext,
}: FeedbackModalProps) {
  const { theme } = useTheme();
  const styles = getStyles(theme);

  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [screenshotUri, setScreenshotUri] = useState(initialScreenshotUri);
  const [includeScreenshot, setIncludeScreenshot] = useState(!!initialScreenshotUri);
  const [isLoading, setIsLoading] = useState(false);

  // Update screenshot when prop changes
  useEffect(() => {
    setScreenshotUri(initialScreenshotUri);
    setIncludeScreenshot(!!initialScreenshotUri);
  }, [initialScreenshotUri]);

  const resetForm = () => {
    setRating(null);
    setMessage("");
    setEmail("");
    setScreenshotUri(initialScreenshotUri);
    setIncludeScreenshot(!!initialScreenshotUri);
    setIsLoading(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const validateForm = () => {
    if (!message.trim()) {
      Alert.alert(tr("Feedback.error"), tr("Feedback.messageRequired"));
      return false;
    }

    if (email && !isValidEmail(email)) {
      Alert.alert(tr("Feedback.error"), tr("Feedback.invalidEmail"));
      return false;
    }

    return true;
  };

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    try {
      setIsLoading(true);
      await onSubmit({
        rating,
        message,
        email: email.trim() || undefined,
        screenshotUri: includeScreenshot ? screenshotUri : undefined,
        pageContext,
      });

      Alert.alert(
        tr("Feedback.success"),
        tr("Feedback.thankYou"),
        [{ text: "OK", onPress: handleClose }]
      );
    } catch (error) {
      console.error("Feedback submission failed:", error);
      const errorMessage =
        error instanceof Error ? error.message : tr("Feedback.genericError");
      Alert.alert(tr("Feedback.error"), errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const renderStars = () => {
    return (
      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity
            key={star}
            onPress={() => setRating(star)}
            style={styles.starButton}
          >
            <Ionicons
              name={rating && star <= rating ? "star" : "star-outline"}
              size={36}
              color={rating && star <= rating ? "#FFD700" : theme.colors.textSecondary}
            />
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleClose}
    >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.keyboardView}
        >
          <View style={styles.overlay}>
            <View style={styles.modalContent}>
              {/* Header */}
              <View style={styles.header}>
                <Text style={styles.title}>{tr("Feedback.title")}</Text>
                <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                  <Ionicons
                    name="close"
                    size={24}
                    color={theme.colors.textPrimary}
                  />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.scrollView}
                showsVerticalScrollIndicator={false}
              >
              {/* Page Context */}
              {pageContext && (
                <View style={styles.contextContainer}>
                  <Ionicons
                    name="information-circle-outline"
                    size={16}
                    color={theme.colors.textSecondary}
                  />
                  <Text style={styles.contextText}>
                    {tr("Feedback.feedbackFor")}: {pageContext}
                  </Text>
                </View>
              )}

              {/* Rating */}
              <View style={styles.section}>
                <Text style={styles.label}>{tr("Feedback.ratingLabel")}</Text>
                <Text style={styles.optionalText}>({tr("Feedback.optional")})</Text>
                {renderStars()}
              </View>

              {/* Message */}
              <View style={styles.section}>
                <Text style={styles.label}>{tr("Feedback.messageLabel")} *</Text>
                <TextInput
                  style={styles.textArea}
                  placeholder={tr("Feedback.messagePlaceholder")}
                  placeholderTextColor={theme.colors.textSecondary}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                  maxLength={1000}
                />
                <Text style={styles.charCount}>
                  {message.length}/1000
                </Text>
              </View>

              {/* Email */}
              <View style={styles.section}>
                <Text style={styles.label}>{tr("Feedback.emailLabel")}</Text>
                <Text style={styles.optionalText}>
                  ({tr("Feedback.optionalEmail")})
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder={tr("Feedback.emailPlaceholder")}
                  placeholderTextColor={theme.colors.textSecondary}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* Screenshot */}
              {screenshotUri && (
                <View style={styles.section}>
                  <View style={styles.screenshotHeader}>
                    <Text style={styles.label}>{tr("Feedback.screenshot")}</Text>
                    <TouchableOpacity
                      onPress={() => setIncludeScreenshot(!includeScreenshot)}
                      style={styles.checkboxContainer}
                    >
                      <Ionicons
                        name={includeScreenshot ? "checkbox" : "square-outline"}
                        size={24}
                        color={theme.colors.primary}
                      />
                      <Text style={styles.checkboxText}>
                        {tr("Feedback.includeScreenshot")}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {includeScreenshot && (
                    <Image
                      source={{ uri: screenshotUri }}
                      style={styles.screenshot}
                      resizeMode="contain"
                    />
                  )}
                </View>
              )}

              {/* Submit Button */}
              <TouchableOpacity
                style={[
                  styles.submitButton,
                  isLoading && styles.submitButtonDisabled,
                ]}
                onPress={handleSubmit}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="send" size={20} color="#fff" />
                    <Text style={styles.submitButtonText}>
                      {tr("Feedback.submit")}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const getStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    keyboardView: {
      flex: 1,
    },
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      justifyContent: "flex-end",
    },
    modalContent: {
      backgroundColor: theme.colors.backgroundPrimary,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: "90%",
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    title: {
      fontSize: 22,
      fontWeight: "bold",
      color: theme.colors.textPrimary,
    },
    closeButton: {
      padding: 4,
    },
    scrollView: {
      paddingHorizontal: 20,
    },
    contextContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.colors.backgroundSecondary,
      padding: 12,
      borderRadius: 8,
      marginTop: 16,
      gap: 8,
    },
    contextText: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      flex: 1,
    },
    section: {
      marginTop: 20,
    },
    label: {
      fontSize: 16,
      fontWeight: "600",
      color: theme.colors.textPrimary,
      marginBottom: 8,
    },
    optionalText: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      marginBottom: 8,
    },
    starsContainer: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 12,
    },
    starButton: {
      padding: 4,
    },
    input: {
      backgroundColor: theme.colors.backgroundSecondary,
      borderRadius: 8,
      padding: 12,
      fontSize: 15,
      color: theme.colors.textPrimary,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    textArea: {
      backgroundColor: theme.colors.backgroundSecondary,
      borderRadius: 8,
      padding: 12,
      fontSize: 15,
      color: theme.colors.textPrimary,
      borderWidth: 1,
      borderColor: theme.colors.border,
      minHeight: 120,
    },
    charCount: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      textAlign: "right",
      marginTop: 4,
    },
    screenshotHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    checkboxContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    checkboxText: {
      fontSize: 14,
      color: theme.colors.textPrimary,
    },
    screenshot: {
      width: "100%",
      height: 200,
      borderRadius: 8,
      backgroundColor: theme.colors.backgroundSecondary,
    },
    submitButton: {
      backgroundColor: theme.colors.primary,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
      borderRadius: 8,
      marginTop: 24,
      marginBottom: 20,
      gap: 8,
    },
    submitButtonDisabled: {
      opacity: 0.6,
    },
    submitButtonText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "600",
    },
  });
