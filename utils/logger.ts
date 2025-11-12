/**
 * Enhanced Logging System
 * Provides structured logging with timestamps, log levels, and source tracking
 */

// ANSI color codes for console output
const COLORS = {
  // Text colors
  GRAY: '\x1b[90m',      // For DEBUG
  CYAN: '\x1b[36m',      // For INFO
  YELLOW: '\x1b[33m',    // For WARN
  RED: '\x1b[31m',       // For ERROR
  
  // Reset
  RESET: '\x1b[0m',
  
  // Bright variants
  BRIGHT_CYAN: '\x1b[96m',
  BRIGHT_GRAY: '\x1b[37m',
};

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export enum LogSource {
  MAP = 'MAP',
  BACKEND_API = 'BACKEND_API',
  LOCAL_DB = 'LOCAL_DB',
  SYNC = 'SYNC',
  CLUSTERING = 'CLUSTERING',
  AUTH = 'AUTH',
  UI = 'UI',
  NETWORK = 'NETWORK',
  STORAGE = 'STORAGE',
  LOCATION = 'LOCATION',
  CACHE = 'CACHE',
  GENERAL = 'GENERAL',
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  data?: any;
}

class AppLogger {
  private minLogLevel: LogLevel = LogLevel.INFO;
  private enableConsole: boolean = true;
  private logHistory: LogEntry[] = [];
  private maxHistorySize: number = 1000;

  /**
   * Set minimum log level (logs below this level will be ignored)
   */
  setMinLevel(level: LogLevel): void {
    this.minLogLevel = level;
  }

  /**
   * Enable or disable console output
   */
  setConsoleOutput(enabled: boolean): void {
    this.enableConsole = enabled;
  }

  /**
   * Get Zulu time (UTC) timestamp in ISO format
   */
  private getZuluTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Format log message with timestamp, level, and source
   */
  private formatMessage(level: LogLevel, source: LogSource, message: string): string {
    const timestamp = this.getZuluTimestamp();
    const levelStr = LogLevel[level].padEnd(5);
    const sourceStr = `[${source}]`.padEnd(16);
    
    // Get color for this log level
    const color = this.getColorForLevel(level);
    const reset = COLORS.RESET;
    
    // Apply color to the entire formatted message
    return `${color}${timestamp} ${levelStr} ${sourceStr}${reset} ${message}`;
  }

  /**
   * Get color code for log level
   */
  private getColorForLevel(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG: return COLORS.GRAY;
      case LogLevel.INFO: return COLORS.CYAN;
      case LogLevel.WARN: return COLORS.YELLOW;
      case LogLevel.ERROR: return COLORS.RED;
      default: return COLORS.RESET;
    }
  }

  /**
   * Get appropriate emoji for log level
   */
  private getEmoji(level: LogLevel, message: string): string {
    // Check for specific keywords in message first
    if (message.includes('fetch') || message.includes('request')) return '🌐';
    if (message.includes('cache') || message.includes('cached')) return '💾';
    if (message.includes('sync')) return '🔄';
    if (message.includes('success') || message.includes('complete')) return '✅';
    if (message.includes('start') || message.includes('begin')) return '🚀';
    if (message.includes('cluster')) return '📊';
    if (message.includes('database') || message.includes('SQLite')) return '💾';
    if (message.includes('zoom')) return '🔍';
    if (message.includes('move') || message.includes('pan')) return '📍';
    
    // Default emojis by level
    switch (level) {
      case LogLevel.DEBUG: return '🔍';
      case LogLevel.INFO: return '💡';  // Changed from ℹ️ to 💡 for consistent spacing
      case LogLevel.WARN: return '⚠️';
      case LogLevel.ERROR: return '❌';
      default: return '📝';
    }
  }

  /**
   * Core logging function
   */
  private log(level: LogLevel, source: LogSource, message: string, data?: any): void {
    if (level < this.minLogLevel) return;

    const formattedMessage = this.formatMessage(level, source, message);
    const emoji = this.getEmoji(level, message);
    
    // Store in history
    const entry: LogEntry = {
      timestamp: this.getZuluTimestamp(),
      level,
      source,
      message,
      data,
    };
    
    this.logHistory.push(entry);
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory.shift();
    }

    // Console output
    if (this.enableConsole) {
      const displayMessage = `${emoji} ${formattedMessage}`;
      
      switch (level) {
        case LogLevel.DEBUG:
          if (data !== undefined) {
            console.log(displayMessage, data);
          } else {
            console.log(displayMessage);
          }
          break;
        case LogLevel.INFO:
          if (data !== undefined) {
            console.log(displayMessage, data);
          } else {
            console.log(displayMessage);
          }
          break;
        case LogLevel.WARN:
          if (data !== undefined) {
            console.warn(displayMessage, data);
          } else {
            console.warn(displayMessage);
          }
          break;
        case LogLevel.ERROR:
          if (data !== undefined) {
            console.error(displayMessage, data);
          } else {
            console.error(displayMessage);
          }
          break;
      }
    }
  }

  /**
   * Debug level logging
   */
  debug(source: LogSource, message: string, data?: any): void {
    this.log(LogLevel.DEBUG, source, message, data);
  }

  /**
   * Info level logging
   */
  info(source: LogSource, message: string, data?: any): void {
    this.log(LogLevel.INFO, source, message, data);
  }

  /**
   * Warning level logging
   */
  warn(source: LogSource, message: string, data?: any): void {
    this.log(LogLevel.WARN, source, message, data);
  }

  /**
   * Error level logging
   */
  error(source: LogSource, message: string, data?: any): void {
    this.log(LogLevel.ERROR, source, message, data);
  }

  /**
   * Get log history
   */
  getHistory(filter?: { level?: LogLevel; source?: LogSource; limit?: number }): LogEntry[] {
    let filtered = this.logHistory;

    if (filter?.level !== undefined) {
      const filterLevel = filter.level;
      filtered = filtered.filter(entry => entry.level >= filterLevel);
    }

    if (filter?.source) {
      filtered = filtered.filter(entry => entry.source === filter.source);
    }

    if (filter?.limit) {
      filtered = filtered.slice(-filter.limit);
    }

    return filtered;
  }

  /**
   * Clear log history
   */
  clearHistory(): void {
    this.logHistory = [];
  }

  /**
   * Export logs as text
   */
  exportLogs(filter?: { level?: LogLevel; source?: LogSource }): string {
    const entries = this.getHistory(filter);
    return entries.map(entry => {
      const levelStr = LogLevel[entry.level];
      const dataStr = entry.data ? ` | Data: ${JSON.stringify(entry.data)}` : '';
      return `${entry.timestamp} [${levelStr}] [${entry.source}] ${entry.message}${dataStr}`;
    }).join('\n');
  }
}

// Export singleton instance
export const logger = new AppLogger();

// Export convenience functions that don't require importing LogSource/LogLevel
export const log = {
  // Map operations
  map: {
    debug: (msg: string, data?: any) => logger.debug(LogSource.MAP, msg, data),
    info: (msg: string, data?: any) => logger.info(LogSource.MAP, msg, data),
    warn: (msg: string, data?: any) => logger.warn(LogSource.MAP, msg, data),
    error: (msg: string, data?: any) => logger.error(LogSource.MAP, msg, data),
  },
  
  // Backend API operations
  api: {
    debug: (msg: string, data?: any) => logger.debug(LogSource.BACKEND_API, msg, data),
    info: (msg: string, data?: any) => logger.info(LogSource.BACKEND_API, msg, data),
    warn: (msg: string, data?: any) => logger.warn(LogSource.BACKEND_API, msg, data),
    error: (msg: string, data?: any) => logger.error(LogSource.BACKEND_API, msg, data),
  },
  
  // Local database operations
  db: {
    debug: (msg: string, data?: any) => logger.debug(LogSource.LOCAL_DB, msg, data),
    info: (msg: string, data?: any) => logger.info(LogSource.LOCAL_DB, msg, data),
    warn: (msg: string, data?: any) => logger.warn(LogSource.LOCAL_DB, msg, data),
    error: (msg: string, data?: any) => logger.error(LogSource.LOCAL_DB, msg, data),
  },
  
  // Sync operations
  sync: {
    debug: (msg: string, data?: any) => logger.debug(LogSource.SYNC, msg, data),
    info: (msg: string, data?: any) => logger.info(LogSource.SYNC, msg, data),
    warn: (msg: string, data?: any) => logger.warn(LogSource.SYNC, msg, data),
    error: (msg: string, data?: any) => logger.error(LogSource.SYNC, msg, data),
  },
  
  // Clustering operations
  clustering: {
    debug: (msg: string, data?: any) => logger.debug(LogSource.CLUSTERING, msg, data),
    info: (msg: string, data?: any) => logger.info(LogSource.CLUSTERING, msg, data),
    warn: (msg: string, data?: any) => logger.warn(LogSource.CLUSTERING, msg, data),
    error: (msg: string, data?: any) => logger.error(LogSource.CLUSTERING, msg, data),
  },
  
  // Authentication operations
  auth: {
    debug: (msg: string, data?: any) => logger.debug(LogSource.AUTH, msg, data),
    info: (msg: string, data?: any) => logger.info(LogSource.AUTH, msg, data),
    warn: (msg: string, data?: any) => logger.warn(LogSource.AUTH, msg, data),
    error: (msg: string, data?: any) => logger.error(LogSource.AUTH, msg, data),
  },
  
  // UI operations
  ui: {
    debug: (msg: string, data?: any) => logger.debug(LogSource.UI, msg, data),
    info: (msg: string, data?: any) => logger.info(LogSource.UI, msg, data),
    warn: (msg: string, data?: any) => logger.warn(LogSource.UI, msg, data),
    error: (msg: string, data?: any) => logger.error(LogSource.UI, msg, data),
  },
  
  // Network operations
  network: {
    debug: (msg: string, data?: any) => logger.debug(LogSource.NETWORK, msg, data),
    info: (msg: string, data?: any) => logger.info(LogSource.NETWORK, msg, data),
    warn: (msg: string, data?: any) => logger.warn(LogSource.NETWORK, msg, data),
    error: (msg: string, data?: any) => logger.error(LogSource.NETWORK, msg, data),
  },
  
  // Storage operations
  storage: {
    debug: (msg: string, data?: any) => logger.debug(LogSource.STORAGE, msg, data),
    info: (msg: string, data?: any) => logger.info(LogSource.STORAGE, msg, data),
    warn: (msg: string, data?: any) => logger.warn(LogSource.STORAGE, msg, data),
    error: (msg: string, data?: any) => logger.error(LogSource.STORAGE, msg, data),
  },
  
  // Location operations
  location: {
    debug: (msg: string, data?: any) => logger.debug(LogSource.LOCATION, msg, data),
    info: (msg: string, data?: any) => logger.info(LogSource.LOCATION, msg, data),
    warn: (msg: string, data?: any) => logger.warn(LogSource.LOCATION, msg, data),
    error: (msg: string, data?: any) => logger.error(LogSource.LOCATION, msg, data),
  },
  
  // Cache operations
  cache: {
    debug: (msg: string, data?: any) => logger.debug(LogSource.CACHE, msg, data),
    info: (msg: string, data?: any) => logger.info(LogSource.CACHE, msg, data),
    warn: (msg: string, data?: any) => logger.warn(LogSource.CACHE, msg, data),
    error: (msg: string, data?: any) => logger.error(LogSource.CACHE, msg, data),
  },
  
  // General operations
  general: {
    debug: (msg: string, data?: any) => logger.debug(LogSource.GENERAL, msg, data),
    info: (msg: string, data?: any) => logger.info(LogSource.GENERAL, msg, data),
    warn: (msg: string, data?: any) => logger.warn(LogSource.GENERAL, msg, data),
    error: (msg: string, data?: any) => logger.error(LogSource.GENERAL, msg, data),
  },
};
