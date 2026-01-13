/**
 * Predictive Agent - The Oracle
 * AI Lead Strategies LLC
 *
 * Forecasts issues before they happen
 */

const { createLogger } = require('../utils/logger');
const { generateId, linearRegression, average } = require('../utils/helpers');
const { eventBus, CHANNELS } = require('../shared/EventBus');
const { metricsStore, METRIC_NAMES } = require('../shared/MetricsStore');
const { alertManager } = require('../shared/AlertManager');
const config = require('../config');

const logger = createLogger('Predictive');

class PredictiveAgent {
  constructor() {
    this.name = 'Predictive';
    this.running = false;
    this.db = null;
    this.analysisInterval = null;
    this.predictions = new Map();
  }

  /**
   * Initialize the agent
   */
  async initialize(options = {}) {
    const { db } = options;
    this.db = db;

    logger.lifecycle('starting');
  }

  /**
   * Start the agent
   */
  async start() {
    if (this.running) {
      logger.warn('Predictive Agent already running');
      return;
    }

    this.running = true;

    // Start prediction analysis loop
    this.startAnalysis();

    await eventBus.publish(CHANNELS.AGENT_STARTED, {
      source: this.name,
      agent: this.name,
      timestamp: new Date().toISOString()
    });

    logger.lifecycle('started');
  }

  /**
   * Start periodic analysis
   */
  startAnalysis() {
    // Run predictions every 5 minutes
    this.analysisInterval = setInterval(async () => {
      if (!this.running) return;

      await this.runPredictions();
    }, config.intervals.predictiveAnalysis);

    // Run initial prediction
    setTimeout(() => this.runPredictions(), 10000);
  }

  /**
   * Run all prediction analyses
   */
  async runPredictions() {
    logger.debug('Running predictive analysis');

    try {
      await Promise.all([
        this.predictDiskUsage(),
        this.predictMemoryIssues(),
        this.predictTrafficSpike(),
        this.predictDatabaseSlowdown(),
        this.predictEmailReputation(),
        this.predictCostOverrun()
      ]);
    } catch (error) {
      logger.error('Prediction analysis failed', { error: error.message });
    }
  }

  /**
   * Predict disk usage and potential full disk
   */
  async predictDiskUsage() {
    const metrics = metricsStore.get(METRIC_NAMES.DISK_USAGE, { limit: 100 });

    if (metrics.length < config.agents.predictive.minDataPoints) {
      return; // Not enough data
    }

    const values = metrics.map(m => m.value);
    const regression = linearRegression(values);

    // Predict when disk will be at 90%
    const currentUsage = values[values.length - 1];
    const threshold = config.thresholds.disk.usage;

    if (currentUsage >= threshold) {
      return; // Already at threshold, handled by Monitor
    }

    // Calculate time to threshold
    const pointsPerHour = metrics.length / ((metrics[metrics.length - 1].timestamp - metrics[0].timestamp) / 3600000);
    const pointsToThreshold = (threshold - currentUsage) / regression.slope;
    const hoursToThreshold = pointsToThreshold / pointsPerHour;

    if (hoursToThreshold > 0 && hoursToThreshold < config.agents.predictive.forecastHorizon) {
      const prediction = await this.createPrediction({
        type: 'DISK_FULL',
        issue: `Disk usage predicted to reach ${threshold}% in ${hoursToThreshold.toFixed(1)} hours`,
        predictedTime: new Date(Date.now() + hoursToThreshold * 3600000),
        confidence: this.calculateConfidence(values, regression),
        proactiveAction: 'CLEANUP_LOGS',
        data: {
          currentUsage,
          predictedUsage: threshold,
          hoursToThreshold,
          slope: regression.slope
        }
      });

      // Take proactive action if high confidence
      if (prediction.confidence >= config.agents.predictive.confidenceThreshold) {
        await this.takeProactiveAction(prediction);
      }
    }
  }

  /**
   * Predict memory issues
   */
  async predictMemoryIssues() {
    const metrics = metricsStore.get(METRIC_NAMES.MEMORY_USAGE, { limit: 100 });

    if (metrics.length < config.agents.predictive.minDataPoints) {
      return;
    }

    const values = metrics.map(m => m.value);
    const regression = linearRegression(values);

    // Check for memory leak pattern (steady increase)
    if (regression.slope > 0.01) { // Growing more than 0.01% per data point
      const currentUsage = values[values.length - 1];
      const threshold = config.thresholds.memory.usage;
      const pointsPerHour = metrics.length / ((metrics[metrics.length - 1].timestamp - metrics[0].timestamp) / 3600000);
      const hoursToThreshold = (threshold - currentUsage) / (regression.slope * pointsPerHour);

      if (hoursToThreshold > 0 && hoursToThreshold < config.agents.predictive.forecastHorizon) {
        await this.createPrediction({
          type: 'MEMORY_LEAK',
          issue: `Possible memory leak detected. Memory will reach ${threshold}% in ${hoursToThreshold.toFixed(1)} hours`,
          predictedTime: new Date(Date.now() + hoursToThreshold * 3600000),
          confidence: this.calculateConfidence(values, regression),
          proactiveAction: 'SCHEDULE_RESTART',
          data: {
            currentUsage,
            growthRate: regression.slope,
            hoursToThreshold
          }
        });
      }
    }
  }

  /**
   * Predict traffic spikes
   */
  async predictTrafficSpike() {
    const metrics = metricsStore.get(METRIC_NAMES.API_REQUEST_COUNT, { limit: 200 });

    if (metrics.length < config.agents.predictive.minDataPoints) {
      return;
    }

    // Analyze hourly patterns
    const hourlyAverages = this.calculateHourlyAverages(metrics);
    const currentHour = new Date().getHours();
    const nextHourAvg = hourlyAverages[(currentHour + 1) % 24] || 0;
    const currentAvg = hourlyAverages[currentHour] || 0;

    // If next hour typically has 50%+ more traffic
    if (nextHourAvg > currentAvg * 1.5) {
      await this.createPrediction({
        type: 'TRAFFIC_SPIKE',
        issue: `Traffic spike expected in the next hour (${((nextHourAvg / currentAvg - 1) * 100).toFixed(0)}% increase)`,
        predictedTime: new Date(Date.now() + 3600000),
        confidence: 0.7,
        proactiveAction: 'SCALE_RESOURCES',
        data: {
          currentAvg,
          expectedAvg: nextHourAvg,
          increasePercent: ((nextHourAvg / currentAvg - 1) * 100).toFixed(0)
        }
      });
    }
  }

  /**
   * Predict database slowdown
   */
  async predictDatabaseSlowdown() {
    const metrics = metricsStore.get(METRIC_NAMES.DB_QUERY_TIME, { limit: 100 });

    if (metrics.length < config.agents.predictive.minDataPoints) {
      return;
    }

    const values = metrics.map(m => m.value);
    const regression = linearRegression(values);

    // Check for increasing query times
    if (regression.slope > 0.5) { // Growing more than 0.5ms per data point
      const currentTime = values[values.length - 1];
      const threshold = config.thresholds.database.slowQueryThreshold;
      const pointsToThreshold = (threshold - currentTime) / regression.slope;

      if (pointsToThreshold > 0 && pointsToThreshold < 1000) {
        await this.createPrediction({
          type: 'DATABASE_SLOWDOWN',
          issue: `Database queries slowing down. May reach ${threshold}ms threshold soon`,
          predictedTime: new Date(Date.now() + pointsToThreshold * 5000), // Assuming 5s between data points
          confidence: this.calculateConfidence(values, regression),
          proactiveAction: 'ANALYZE_QUERIES',
          data: {
            currentQueryTime: currentTime,
            growthRate: regression.slope,
            threshold
          }
        });
      }
    }
  }

  /**
   * Predict email reputation issues
   */
  async predictEmailReputation() {
    const bounceMetrics = metricsStore.get(METRIC_NAMES.EMAIL_BOUNCE_RATE, { limit: 50 });

    if (bounceMetrics.length < 10) {
      return;
    }

    const values = bounceMetrics.map(m => m.value);
    const avgBounceRate = average(values);
    const recentBounceRate = average(values.slice(-5));

    // If recent bounce rate is increasing
    if (recentBounceRate > avgBounceRate * 1.5 && recentBounceRate > 2) {
      await this.createPrediction({
        type: 'EMAIL_REPUTATION_DECLINE',
        issue: `Email bounce rate increasing (${recentBounceRate.toFixed(1)}%). Reputation may decline`,
        predictedTime: new Date(Date.now() + 24 * 3600000),
        confidence: 0.6,
        proactiveAction: 'PAUSE_CAMPAIGNS',
        data: {
          avgBounceRate,
          recentBounceRate,
          threshold: config.thresholds.email.bounceRate
        }
      });
    }
  }

  /**
   * Predict cost overrun (placeholder for actual cost tracking)
   */
  async predictCostOverrun() {
    // This would integrate with billing/cost data
    // Placeholder for future implementation
  }

  /**
   * Calculate hourly averages from metrics
   */
  calculateHourlyAverages(metrics) {
    const hourlyData = {};

    for (const metric of metrics) {
      const hour = new Date(metric.timestamp).getHours();
      if (!hourlyData[hour]) {
        hourlyData[hour] = [];
      }
      hourlyData[hour].push(metric.value);
    }

    const hourlyAverages = {};
    for (const [hour, values] of Object.entries(hourlyData)) {
      hourlyAverages[hour] = average(values);
    }

    return hourlyAverages;
  }

  /**
   * Calculate confidence score for prediction
   */
  calculateConfidence(values, regression) {
    // Calculate R-squared for the regression
    const yMean = average(values);
    let ssTotal = 0;
    let ssResidual = 0;

    values.forEach((y, i) => {
      const yPredicted = regression.predict(i);
      ssTotal += Math.pow(y - yMean, 2);
      ssResidual += Math.pow(y - yPredicted, 2);
    });

    const rSquared = ssTotal === 0 ? 0 : 1 - (ssResidual / ssTotal);

    // Adjust confidence based on data points
    const dataPointFactor = Math.min(values.length / config.agents.predictive.minDataPoints, 1);

    return Math.max(0, Math.min(1, rSquared * dataPointFactor));
  }

  /**
   * Create and store a prediction
   */
  async createPrediction(data) {
    const prediction = {
      id: generateId(),
      type: data.type,
      issue: data.issue,
      predictedTime: data.predictedTime,
      confidence: data.confidence,
      proactiveAction: data.proactiveAction,
      data: data.data,
      actionTaken: false,
      outcome: null,
      createdAt: new Date()
    };

    // Store in memory
    this.predictions.set(prediction.id, prediction);

    // Store in database
    if (this.db) {
      try {
        await this.db.prediction.create({
          data: {
            predictionType: prediction.type,
            predictedIssue: prediction.issue,
            predictedTime: prediction.predictedTime,
            confidence: prediction.confidence,
            dataPoints: prediction.data,
            proactiveAction: prediction.proactiveAction,
            actionTaken: false
          }
        });
      } catch (error) {
        logger.warn('Failed to store prediction in database', { error: error.message });
      }
    }

    // Publish prediction event
    await eventBus.publish(CHANNELS.PREDICTION, {
      source: this.name,
      prediction
    });

    logger.info(`Prediction created: ${data.type}`, {
      confidence: data.confidence.toFixed(2),
      predictedIn: `${((data.predictedTime - Date.now()) / 3600000).toFixed(1)}h`
    });

    return prediction;
  }

  /**
   * Take proactive action based on prediction
   */
  async takeProactiveAction(prediction) {
    logger.info(`Taking proactive action: ${prediction.proactiveAction}`, {
      predictionId: prediction.id
    });

    switch (prediction.proactiveAction) {
      case 'CLEANUP_LOGS':
        // Would trigger log cleanup
        await alertManager.create('PROACTIVE_CLEANUP', {
          component: 'system',
          message: `Proactive log cleanup recommended: ${prediction.issue}`,
          severity: config.severity.LOW,
          metadata: { prediction }
        });
        break;

      case 'SCHEDULE_RESTART':
        // Would schedule a graceful restart
        await alertManager.create('PROACTIVE_RESTART', {
          component: 'system',
          message: `Graceful restart recommended: ${prediction.issue}`,
          severity: config.severity.MEDIUM,
          metadata: { prediction }
        });
        break;

      case 'SCALE_RESOURCES':
        // Would trigger auto-scaling
        await alertManager.create('PROACTIVE_SCALE', {
          component: 'infrastructure',
          message: `Resource scaling recommended: ${prediction.issue}`,
          severity: config.severity.LOW,
          metadata: { prediction }
        });
        break;

      case 'ANALYZE_QUERIES':
        // Would trigger query analysis
        await alertManager.create('PROACTIVE_OPTIMIZE', {
          component: 'database',
          message: `Query optimization recommended: ${prediction.issue}`,
          severity: config.severity.MEDIUM,
          metadata: { prediction }
        });
        break;

      case 'PAUSE_CAMPAIGNS':
        // Would pause email campaigns
        await alertManager.create('PROACTIVE_PAUSE', {
          component: 'email',
          message: `Campaign pause recommended: ${prediction.issue}`,
          severity: config.severity.HIGH,
          metadata: { prediction }
        });
        break;
    }

    // Mark action as taken
    prediction.actionTaken = true;

    // Publish proactive action event
    await eventBus.publish(CHANNELS.PROACTIVE_ACTION, {
      source: this.name,
      prediction,
      action: prediction.proactiveAction
    });
  }

  /**
   * Get prediction statistics
   */
  getStats() {
    const predictions = Array.from(this.predictions.values());
    const now = Date.now();

    return {
      totalPredictions: predictions.length,
      actionsTaken: predictions.filter(p => p.actionTaken).length,
      byType: this.groupByType(predictions),
      activePredictions: predictions.filter(p =>
        new Date(p.predictedTime) > now &&
        !p.outcome
      ).length,
      avgConfidence: predictions.length > 0
        ? (average(predictions.map(p => p.confidence)) * 100).toFixed(1) + '%'
        : '0%'
    };
  }

  /**
   * Group predictions by type
   */
  groupByType(predictions) {
    const groups = {};

    for (const prediction of predictions) {
      if (!groups[prediction.type]) {
        groups[prediction.type] = 0;
      }
      groups[prediction.type]++;
    }

    return groups;
  }

  /**
   * Stop the agent
   */
  async stop() {
    if (!this.running) return;

    this.running = false;

    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
    }

    await eventBus.publish(CHANNELS.AGENT_STOPPED, {
      source: this.name,
      agent: this.name,
      timestamp: new Date().toISOString()
    });

    logger.lifecycle('stopped');
  }
}

module.exports = { PredictiveAgent };
