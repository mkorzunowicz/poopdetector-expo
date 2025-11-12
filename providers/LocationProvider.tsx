import { MyLocation } from '@/services/locationService';
import React, { useState, createContext, ReactNode, useEffect } from 'react';
import { localDataSync } from '@/services/localDataSync';
import { log } from '@/utils/logger';

interface UserLocationContextProps {
  userLocation: MyLocation | null;
  setUserLocation: React.Dispatch<React.SetStateAction<MyLocation | null>>;
}


export const UserLocationContext = createContext<UserLocationContextProps>({
  userLocation: null,
  setUserLocation: () => {},
});

export const UserLocationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [userLocation, setUserLocation] = useState<MyLocation | null>(null);

  // Initialize local data sync when user location is available
  useEffect(() => {
    if (userLocation) {
      log.sync.info("Initializing local data sync with user location", {
        latitude: userLocation.coords.latitude,
        longitude: userLocation.coords.longitude
      });
      localDataSync.initialize({
        latitude: userLocation.coords.latitude,
        longitude: userLocation.coords.longitude,
      }).catch(error => {
        log.sync.error("Failed to initialize local data sync", { error });
      });
    }
  }, [userLocation?.coords.latitude, userLocation?.coords.longitude]);

  // Cleanup ONLY on unmount (not on location changes)
  useEffect(() => {
    return () => {
      localDataSync.shutdown().catch(error => {
        log.sync.error("Error during shutdown", { error });
      });
    };
  }, []); // Empty deps - only run on mount/unmount

  return (
    <UserLocationContext.Provider value={{ userLocation: userLocation, setUserLocation: setUserLocation }}>
      {children}
    </UserLocationContext.Provider>
  );
};