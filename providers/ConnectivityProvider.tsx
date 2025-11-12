import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { connectivityService, ConnectivityStatus, ConnectivityIssue } from '@/services/connectivityService';

interface ConnectivityContextType {
  status: ConnectivityStatus;
  issues: ConnectivityIssue[];
  isOnline: boolean;
  isDegraded: boolean;
  isOffline: boolean;
}

const ConnectivityContext = createContext<ConnectivityContextType | undefined>(undefined);

export const ConnectivityProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<ConnectivityStatus>(connectivityService.getStatus());
  const [issues, setIssues] = useState<ConnectivityIssue[]>(connectivityService.getIssues());

  useEffect(() => {
    // Subscribe to connectivity changes
    const unsubscribe = connectivityService.subscribe((newStatus, newIssues) => {
      setStatus(newStatus);
      setIssues(newIssues);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const value: ConnectivityContextType = {
    status,
    issues,
    isOnline: status === ConnectivityStatus.ONLINE,
    isDegraded: status === ConnectivityStatus.DEGRADED,
    isOffline: status === ConnectivityStatus.OFFLINE,
  };

  return (
    <ConnectivityContext.Provider value={value}>
      {children}
    </ConnectivityContext.Provider>
  );
};

export const useConnectivity = (): ConnectivityContextType => {
  const context = useContext(ConnectivityContext);
  if (!context) {
    throw new Error('useConnectivity must be used within a ConnectivityProvider');
  }
  return context;
};
