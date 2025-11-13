import { log } from '@/utils/logger';
import NetInfo from '@react-native-community/netinfo';

export enum ConnectivityStatus {
  ONLINE = 'online',
  DEGRADED = 'degraded', // Connected but experiencing issues
  OFFLINE = 'offline'
}

export interface ConnectivityIssue {
  service: string; 
  error: string;
  timestamp: number;
}

type ConnectivityListener = (status: ConnectivityStatus, issues: ConnectivityIssue[]) => void;

class ConnectivityService {
  private status: ConnectivityStatus = ConnectivityStatus.ONLINE;
  private issues: ConnectivityIssue[] = [];
  private listeners: ConnectivityListener[] = [];
  private netInfoUnsubscribe: (() => void) | null = null;
  private issueTimeoutMs = 60000; // Clear issues older than 1 minute
  
  constructor() {
    this.initialize();
  }

  private async initialize() {
    // Subscribe to network state changes
    this.netInfoUnsubscribe = NetInfo.addEventListener(state => {
      const wasOffline = this.status === ConnectivityStatus.OFFLINE;
      const isConnected = state.isConnected === true && state.isInternetReachable !== false;
      
      if (!isConnected) {
        this.updateStatus(ConnectivityStatus.OFFLINE);
      } else if (wasOffline) {
        // Just came back online - clear issues and set to online
        this.issues = [];
        this.updateStatus(ConnectivityStatus.ONLINE);
      } else {
        // Already online, check if we have recent issues
        this.recalculateStatus();
      }
    });

    // Initial status check
    const state = await NetInfo.fetch();
    const isConnected = state.isConnected === true && state.isInternetReachable !== false;
    this.status = isConnected ? ConnectivityStatus.ONLINE : ConnectivityStatus.OFFLINE;
    
    // Clean up old issues periodically
    setInterval(() => this.cleanupOldIssues(), 30000); // Every 30 seconds
  }

  /**
   * Report a connectivity issue from an external service
   */
  reportIssue(service: string, error: string) {
    const issue: ConnectivityIssue = {
      service,
      error,
      timestamp: Date.now()
    };
    
    log.network.warn(`Connectivity issue reported: ${service}`, { error });
    
    this.issues.push(issue);
    
    // Keep only last 10 issues
    if (this.issues.length > 10) {
      this.issues = this.issues.slice(-10);
    }
    
    this.recalculateStatus();
  }

  /**
   * Clear issues for a specific service (called after successful request)
   */
  clearIssues(service: string) {
    const hadIssues = this.issues.some(i => i.service === service);
    this.issues = this.issues.filter(i => i.service !== service);
    
    if (hadIssues) {
      this.recalculateStatus();
    }
  }

  /**
   * Remove issues older than the timeout period
   */
  private cleanupOldIssues() {
    const now = Date.now();
    const oldLength = this.issues.length;
    
    this.issues = this.issues.filter(
      issue => now - issue.timestamp < this.issueTimeoutMs
    );
    
    if (this.issues.length !== oldLength) {
      this.recalculateStatus();
    }
  }

  /**
   * Recalculate connectivity status based on current issues
   */
  private recalculateStatus() {
    const now = Date.now();
    const recentIssues = this.issues.filter(
      issue => now - issue.timestamp < this.issueTimeoutMs
    );
    
    let newStatus: ConnectivityStatus;
    
    if (this.status === ConnectivityStatus.OFFLINE) {
      // Stay offline until NetInfo says we're connected
      newStatus = ConnectivityStatus.OFFLINE;
    } else if (recentIssues.length > 0) {
      newStatus = ConnectivityStatus.DEGRADED;
    } else {
      newStatus = ConnectivityStatus.ONLINE;
    }
    
    if (newStatus !== this.status) {
      this.updateStatus(newStatus);
    }
  }

  /**
   * Update status and notify listeners
   */
  private updateStatus(newStatus: ConnectivityStatus) {
    if (this.status !== newStatus) {
      log.network.info(`Connectivity status changed: ${this.status} -> ${newStatus}`);
      this.status = newStatus;
    }
    
    this.notifyListeners();
  }

  /**
   * Subscribe to connectivity status changes
   */
  subscribe(listener: ConnectivityListener): () => void {
    this.listeners.push(listener);
    
    // Immediately notify with current status
    listener(this.status, [...this.issues]);
    
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Notify all listeners of current status
   */
  private notifyListeners() {
    const currentIssues = [...this.issues];
    this.listeners.forEach(listener => {
      try {
        listener(this.status, currentIssues);
      } catch (error) {
        log.network.error('Error notifying connectivity listener', error);
      }
    });
  }

  /**
   * Get current connectivity status
   */
  getStatus(): ConnectivityStatus {
    return this.status;
  }

  /**
   * Get current issues
   */
  getIssues(): ConnectivityIssue[] {
    return [...this.issues];
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.netInfoUnsubscribe) {
      this.netInfoUnsubscribe();
      this.netInfoUnsubscribe = null;
    }
    this.listeners = [];
  }
}

// Singleton instance
export const connectivityService = new ConnectivityService();
