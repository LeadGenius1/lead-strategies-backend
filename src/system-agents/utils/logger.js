/**
 * Self-Healing System Logger
 * AI Lead Strategies LLC
 *
 * Structured logging for all agents with color-coded output
 */

const config = require('../config');

// ANSI color codes for terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m'
};

// Agent-specific colors and icons
const agentStyles = {
  Monitor: { color: colors.cyan, icon: '👁️' },
  Diagnostic: { color: colors.magenta, icon: '🔬' },
  Repair: { color: colors.green, icon: '🔧' },
  Learning: { color: colors.blue, icon: '🧠' },
  Predictive: { color: colors.yellow, icon: '🔮' },
  Security: { color: colors.red, icon: '🛡️' },
  Performance: { color: colors.white, icon: '⚡' },
  System: { color: colors.bright, icon: '🚀' }
};

// Severity colors
const severityColors = {
  critical: colors.bgRed + colors.white,
  high: colors.red,
  medium: colors.yellow,
  low: colors.blue,
  info: colors.dim
};

class Logger {
  constructor(agentName = 'System') {
    this.agentName = agentName;
    this.style = agentStyles[agentName] || agentStyles.System;
  }

  /**
   * Format timestamp
   */
  getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * Format log message with agent context
   */
  formatMessage(level, message, meta = {}) {
    const timestamp = this.getTimestamp();
    const icon = this.style.icon;
    const agentColor = this.style.color;

    // Build structured log object
    const logObject = {
      timestamp,
      level,
      agent: this.agentName,
      message,
      ...meta
    };

    // Console output with colors
    const levelColor = severityColors[level] || colors.reset;
    const prefix = `${colors.dim}[${timestamp}]${colors.reset} ${icon} ${agentColor}[${this.agentName}]${colors.reset}`;
    const levelTag = `${levelColor}[${level.toUpperCase()}]${colors.reset}`;

    return {
      consoleOutput: `${prefix} ${levelTag} ${message}`,
      structured: logObject
    };
  }

  /**
   * Log info message
   */
  info(message, meta = {}) {
    const { consoleOutput, structured } = this.formatMessage('info', message, meta);
    console.log(consoleOutput);

    if (Object.keys(meta).length > 0) {
      console.log(`${colors.dim}   └─ ${JSON.stringify(meta)}${colors.reset}`);
    }

    return structured;
  }

  /**
   * Log warning message
   */
  warn(message, meta = {}) {
    const { consoleOutput, structured } = this.formatMessage('medium', message, meta);
    console.warn(consoleOutput);

    if (Object.keys(meta).length > 0) {
      console.warn(`${colors.yellow}   └─ ${JSON.stringify(meta)}${colors.reset}`);
    }

    return structured;
  }

  /**
   * Log error message
   */
  error(message, meta = {}) {
    const { consoleOutput, structured } = this.formatMessage('high', message, meta);
    console.error(consoleOutput);

    if (meta.error instanceof Error) {
      console.error(`${colors.red}   └─ Stack: ${meta.error.stack}${colors.reset}`);
    } else if (Object.keys(meta).length > 0) {
      console.error(`${colors.red}   └─ ${JSON.stringify(meta)}${colors.reset}`);
    }

    return structured;
  }

  /**
   * Log critical message
   */
  critical(message, meta = {}) {
    const { consoleOutput, structured } = this.formatMessage('critical', message, meta);
    console.error(`\n${colors.bgRed}${colors.white} CRITICAL ${colors.reset}`);
    console.error(consoleOutput);

    if (Object.keys(meta).length > 0) {
      console.error(`${colors.red}   └─ ${JSON.stringify(meta)}${colors.reset}`);
    }

    return structured;
  }

  /**
   * Log debug message (only in development)
   */
  debug(message, meta = {}) {
    if (process.env.NODE_ENV === 'production') return;

    const { consoleOutput, structured } = this.formatMessage('low', message, meta);
    console.log(`${colors.dim}${consoleOutput}${colors.reset}`);

    if (Object.keys(meta).length > 0) {
      console.log(`${colors.dim}   └─ ${JSON.stringify(meta)}${colors.reset}`);
    }

    return structured;
  }

  /**
   * Log metric
   */
  metric(name, value, unit = '', meta = {}) {
    const message = `📊 ${name}: ${value}${unit}`;
    return this.info(message, { metric: name, value, unit, ...meta });
  }

  /**
   * Log alert
   */
  alert(alertType, severity, message, meta = {}) {
    const severityMethod = severity === 'critical' ? 'critical' : severity === 'high' ? 'error' : 'warn';
    return this[severityMethod](`🚨 [${alertType}] ${message}`, { alertType, severity, ...meta });
  }

  /**
   * Log repair action
   */
  repair(action, success, meta = {}) {
    const icon = success ? '✅' : '❌';
    const method = success ? 'info' : 'error';
    return this[method](`${icon} Repair: ${action}`, { repair: action, success, ...meta });
  }

  /**
   * Log agent lifecycle
   */
  lifecycle(event, meta = {}) {
    const icons = {
      starting: '🔄',
      started: '✅',
      stopping: '🔄',
      stopped: '⏹️',
      error: '❌'
    };
    const icon = icons[event] || '📌';
    return this.info(`${icon} Agent ${event}`, { lifecycle: event, ...meta });
  }

  /**
   * Create a child logger with additional context
   */
  child(context) {
    const childLogger = new Logger(this.agentName);
    childLogger.context = { ...this.context, ...context };
    return childLogger;
  }
}

/**
 * Create a logger for a specific agent
 */
function createLogger(agentName) {
  return new Logger(agentName);
}

/**
 * System-wide logger
 */
const systemLogger = new Logger('System');

module.exports = {
  Logger,
  createLogger,
  systemLogger,
  colors
};
