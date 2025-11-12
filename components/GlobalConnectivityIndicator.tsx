import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { ConnectivityStatus } from '@/services/connectivityService';
import { useTheme } from '@/styles/ThemeContext';
import { tr } from '@/i18n/i18n';

export const GlobalConnectivityIndicator: React.FC = () => {
  const { status, issues, isOffline, isDegraded } = useConnectivity();
  const { theme } = useTheme();
  const [showModal, setShowModal] = useState(false);

  // Don't show indicator if online with no issues
  if (status === ConnectivityStatus.ONLINE) {
    return null;
  }

  const styles = getStyles(theme);
  const indicatorColor = isOffline ? '#EF4444' : '#F59E0B'; // Red for offline, orange for degraded
  const iconName = isOffline ? 'cloud-offline' : 'cloud-done';

  return (
    <>
      {/* Floating Indicator */}
      <TouchableOpacity
        style={[styles.indicator, { backgroundColor: indicatorColor }]}
        onPress={() => setShowModal(true)}
        activeOpacity={0.8}
      >
        <Ionicons name={iconName} size={20} color="#FFFFFF" />
      </TouchableOpacity>

      {/* Details Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowModal(false)}
      >
        <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{tr('Connectivity.title')}</Text>
            <TouchableOpacity onPress={() => setShowModal(false)} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            {/* Status Section */}
            <View style={[styles.statusCard, { borderLeftColor: indicatorColor }]}>
              <View style={styles.statusHeader}>
                <Ionicons name={iconName} size={32} color={indicatorColor} />
                <View style={styles.statusTextContainer}>
                  <Text style={styles.statusTitle}>
                    {isOffline ? tr('Connectivity.offline') : tr('Connectivity.degraded')}
                  </Text>
                  <Text style={styles.statusDescription}>
                    {isOffline 
                      ? tr('Connectivity.offlineDescription')
                      : tr('Connectivity.degradedDescription')}
                  </Text>
                </View>
              </View>
            </View>

            {/* Issues Section */}
            {isDegraded && issues.length > 0 && (
              <View style={styles.issuesSection}>
                <Text style={styles.sectionTitle}>{tr('Connectivity.recentIssues')}</Text>
                {issues.map((issue, index) => (
                  <View key={`${issue.service}-${index}`} style={styles.issueCard}>
                    <View style={styles.issueHeader}>
                      <Ionicons name="warning" size={20} color="#F59E0B" />
                      <Text style={styles.issueService}>{issue.service}</Text>
                    </View>
                    <Text style={styles.issueError}>{issue.error}</Text>
                    <Text style={styles.issueTime}>
                      {new Date(issue.timestamp).toLocaleTimeString()}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* What This Means Section */}
            <View style={styles.infoSection}>
              <Text style={styles.sectionTitle}>{tr('Connectivity.whatThisMeans')}</Text>
              <Text style={styles.infoText}>
                {isOffline 
                  ? tr('Connectivity.offlineExplanation')
                  : tr('Connectivity.degradedExplanation')}
              </Text>
            </View>

            {/* What You Can Do Section */}
            <View style={styles.infoSection}>
              <Text style={styles.sectionTitle}>{tr('Connectivity.whatYouCanDo')}</Text>
              <Text style={styles.infoText}>
                {isOffline 
                  ? tr('Connectivity.offlineSuggestions')
                  : tr('Connectivity.degradedSuggestions')}
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
};

const getStyles = (theme: any) => StyleSheet.create({
  indicator: {
    position: 'absolute',
    top: 60,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    zIndex: 1000,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
  },
  closeButton: {
    padding: 8,
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  statusCard: {
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderLeftWidth: 4,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  statusTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  statusDescription: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    lineHeight: 20,
  },
  issuesSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginBottom: 12,
  },
  issueCard: {
    backgroundColor: theme.colors.backgroundSecondary,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  issueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  issueService: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginLeft: 8,
  },
  issueError: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginBottom: 4,
  },
  issueTime: {
    fontSize: 11,
    color: theme.colors.textTertiary,
  },
  infoSection: {
    marginBottom: 20,
  },
  infoText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    lineHeight: 20,
  },
});
