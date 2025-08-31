import { MeiliSearch, Index } from "meilisearch";
import { createAlertService } from "./alertService";

interface LogEntry {
  id: number;
  project: string;
  timestamp: string;
  source: string;
  message: string;
  level: "info" | "warning" | "error";
  details?: {
    ip?: string;
    userAgent?: string;
    userId?: string;
    duration?: number;
    statusCode?: number;
    method?: string;
    path?: string;
    size?: string;
  };
}

interface AlertRule {
  id: string;
  name: string;
  condition: string;
  threshold: string;
  metric: string;
  notify: string;
  channel: "email" | "sms";
  enabled: boolean;
}

interface AlertRuleState {
  ruleId: string;
  lastTriggered: string;
  currentValue: number;
  triggerCount: number;
  windowStart: string;
  isActive: boolean;
}

interface MonitoringConfig {
  meiliSearchHost?: string;
  meiliSearchKey?: string;
  checkIntervalMs?: number;
  windowSizeMs?: number;
}

/**
 * Alert Rule Monitoring Service
 *
 * This service monitors log entries and triggers alerts based on configured rules.
 * It supports various metrics and conditions like error rates, response times, etc.
 */
export class AlertRuleMonitoringService {
  private client: MeiliSearch;
  private logsIndex: Index;
  private alertRulesIndex: Index;
  private alertRuleStatesIndex: Index;
  private alertService: ReturnType<typeof createAlertService>;
  private checkInterval: NodeJS.Timeout | null = null;
  private windowSizeMs: number;
  private isMonitoring = false;

  // In-memory state cache for performance
  private ruleStatesCache = new Map<string, AlertRuleState>();
  private lastProcessedLogId = 0;

  constructor(config: MonitoringConfig = {}) {
    this.client = new MeiliSearch({
      host: config.meiliSearchHost || process.env.MEILISEARCH_HOST || "http://localhost:7700",
      apiKey: config.meiliSearchKey || process.env.MEILISEARCH_KEY || "",
    });

    this.logsIndex = this.client.index("logs");
    this.alertRulesIndex = this.client.index("alert_rules");
    this.alertRuleStatesIndex = this.client.index("alert_rule_states");
    this.alertService = createAlertService();
    this.windowSizeMs = config.windowSizeMs || 5 * 60 * 1000; // 5 minutes default

    this.initializeStateIndex();
  }

  /**
   * Initialize the alert rule states index
   */
  private async initializeStateIndex(): Promise<void> {
    try {
      await this.alertRuleStatesIndex.updateSettings({
        searchableAttributes: ["ruleId"],
        filterableAttributes: ["ruleId", "isActive", "lastTriggered"],
        sortableAttributes: ["lastTriggered", "currentValue", "triggerCount"],
      });
      console.log("Alert rule states index initialized");
    } catch (error) {
      console.error("Failed to initialize alert rule states index:", error);
    }
  }

  /**
   * Start monitoring alert rules
   */
  public async startMonitoring(intervalMs: number = 30000): Promise<void> {
    if (this.isMonitoring) {
      console.warn("Alert rule monitoring is already running");
      return;
    }

    console.log(`🚨 Starting alert rule monitoring (interval: ${intervalMs}ms)`);
    this.isMonitoring = true;

    // Load existing rule states
    await this.loadRuleStatesFromIndex();

    // Start monitoring loop
    this.checkInterval = setInterval(async () => {
      try {
        await this.processAlertRules();
      } catch (error) {
        console.error("Error in alert rule monitoring loop:", error);
      }
    }, intervalMs);

    // Initial check
    await this.processAlertRules();
  }

  /**
   * Stop monitoring alert rules
   */
  public stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isMonitoring = false;
    console.log("🔴 Alert rule monitoring stopped");
  }

  /**
   * Load existing rule states from index
   */
  private async loadRuleStatesFromIndex(): Promise<void> {
    try {
      const results = await this.alertRuleStatesIndex.search("", {
        limit: 1000,
      });

      for (const state of results.hits as AlertRuleState[]) {
        this.ruleStatesCache.set(state.ruleId, state);
      }

      console.log(`Loaded ${this.ruleStatesCache.size} rule states from index`);
    } catch (error) {
      console.error("Failed to load rule states from index:", error);
    }
  }

  /**
   * Main processing loop for alert rules
   */
  private async processAlertRules(): Promise<void> {
    try {
      // Get all enabled alert rules
      const alertRules = await this.getEnabledAlertRules();
      if (alertRules.length === 0) {
        return;
      }

      console.log(`Processing ${alertRules.length} alert rules...`);

      // Get new log entries since last check
      const newLogs = await this.getNewLogEntries();
      if (newLogs.length === 0) {
        return;
      }

      console.log(`Found ${newLogs.length} new log entries to process`);

      // Process each rule
      for (const rule of alertRules) {
        await this.evaluateRule(rule, newLogs);
      }

      // Update last processed log ID
      if (newLogs.length > 0) {
        const maxLogId = Math.max(...newLogs.map(log => log.id));
        this.lastProcessedLogId = maxLogId;
      }

    } catch (error) {
      console.error("Failed to process alert rules:", error);
    }
  }

  /**
   * Get all enabled alert rules
   */
  private async getEnabledAlertRules(): Promise<AlertRule[]> {
    try {
      const results = await this.alertRulesIndex.search("", {
        filter: "enabled = true",
        limit: 1000,
      });

      return results.hits as AlertRule[];
    } catch (error) {
      console.error("Failed to fetch alert rules:", error);
      return [];
    }
  }

  /**
   * Get new log entries since last processed ID
   */
  private async getNewLogEntries(): Promise<LogEntry[]> {
    try {
      const results = await this.logsIndex.search("", {
        filter: `id > ${this.lastProcessedLogId}`,
        sort: ["id:asc"],
        limit: 1000,
      });

      return results.hits as LogEntry[];
    } catch (error) {
      console.error("Failed to fetch new log entries:", error);
      return [];
    }
  }

  /**
   * Evaluate a single alert rule against log entries
   */
  private async evaluateRule(rule: AlertRule, logs: LogEntry[]): Promise<void> {
    try {
      const currentValue = await this.calculateMetricValue(rule, logs);
      const threshold = this.parseThreshold(rule.threshold);

      // Get or create rule state
      let ruleState = this.getRuleState(rule.id);
      const now = new Date().toISOString();

      // Update current value
      ruleState.currentValue = currentValue;

      // Check if threshold is exceeded
      const thresholdExceeded = this.evaluateCondition(rule.condition, currentValue, threshold);

      if (thresholdExceeded && !ruleState.isActive) {
        // Trigger alert
        await this.triggerAlert(rule, ruleState, currentValue, threshold);
        ruleState.isActive = true;
        ruleState.lastTriggered = now;
        ruleState.triggerCount++;
      } else if (!thresholdExceeded && ruleState.isActive) {
        // Reset state when condition is no longer met
        ruleState.isActive = false;
      }

      // Update rule state
      this.ruleStatesCache.set(rule.id, ruleState);
      await this.saveRuleState(ruleState);

    } catch (error) {
      console.error(`Failed to evaluate rule ${rule.name}:`, error);
    }
  }

  /**
   * Calculate metric value based on rule configuration
   */
  private async calculateMetricValue(rule: AlertRule, logs: LogEntry[]): Promise<number> {
    const now = Date.now();
    const windowStart = now - this.windowSizeMs;

    // Filter logs within the time window
    const windowLogs = logs.filter(log =>
      new Date(log.timestamp).getTime() >= windowStart
    );

    // Add recent logs from index for more comprehensive analysis
    const recentLogs = await this.getLogsInWindow(windowStart);
    const allLogs = [...windowLogs, ...recentLogs];

    switch (rule.metric.toLowerCase()) {
      case 'error_rate':
        return this.calculateErrorRate(allLogs);

      case 'error_count':
        return this.calculateErrorCount(allLogs);

      case 'log_count':
        return this.calculateLogCount(allLogs);

      case 'avg_response_time':
        return this.calculateAverageResponseTime(allLogs);

      case 'max_response_time':
        return this.calculateMaxResponseTime(allLogs);

      case '4xx_rate':
        return this.calculate4xxRate(allLogs);

      case '5xx_rate':
        return this.calculate5xxRate(allLogs);

      case 'unique_errors':
        return this.calculateUniqueErrors(allLogs);

      default:
        console.warn(`Unknown metric: ${rule.metric}`);
        return 0;
    }
  }

  /**
   * Get logs within a specific time window
   */
  private async getLogsInWindow(windowStart: number): Promise<LogEntry[]> {
    try {
      const startTime = new Date(windowStart).toISOString();
      const results = await this.logsIndex.search("", {
        filter: `timestamp >= "${startTime}"`,
        limit: 5000,
      });
      return results.hits as LogEntry[];
    } catch (error) {
      console.error("Failed to get logs in window:", error);
      return [];
    }
  }

  // Metric calculation methods
  private calculateErrorRate(logs: LogEntry[]): number {
    const totalLogs = logs.length;
    if (totalLogs === 0) return 0;

    const errorLogs = logs.filter(log => log.level === 'error').length;
    return (errorLogs / totalLogs) * 100;
  }

  private calculateErrorCount(logs: LogEntry[]): number {
    return logs.filter(log => log.level === 'error').length;
  }

  private calculateLogCount(logs: LogEntry[]): number {
    return logs.length;
  }

  private calculateAverageResponseTime(logs: LogEntry[]): number {
    const logsWithDuration = logs.filter(log => log.details?.duration);
    if (logsWithDuration.length === 0) return 0;

    const totalDuration = logsWithDuration.reduce(
      (sum, log) => sum + (log.details?.duration || 0),
      0
    );
    return totalDuration / logsWithDuration.length;
  }

  private calculateMaxResponseTime(logs: LogEntry[]): number {
    const durations = logs
      .filter(log => log.details?.duration)
      .map(log => log.details!.duration!);

    return durations.length > 0 ? Math.max(...durations) : 0;
  }

  private calculate4xxRate(logs: LogEntry[]): number {
    const httpLogs = logs.filter(log => log.details?.statusCode);
    if (httpLogs.length === 0) return 0;

    const count4xx = httpLogs.filter(log => {
      const status = log.details?.statusCode;
      return status && status >= 400 && status < 500;
    }).length;

    return (count4xx / httpLogs.length) * 100;
  }

  private calculate5xxRate(logs: LogEntry[]): number {
    const httpLogs = logs.filter(log => log.details?.statusCode);
    if (httpLogs.length === 0) return 0;

    const count5xx = httpLogs.filter(log => {
      const status = log.details?.statusCode;
      return status && status >= 500 && status < 600;
    }).length;

    return (count5xx / httpLogs.length) * 100;
  }

  private calculateUniqueErrors(logs: LogEntry[]): number {
    const errorLogs = logs.filter(log => log.level === 'error');
    const uniqueMessages = new Set(errorLogs.map(log => log.message));
    return uniqueMessages.size;
  }

  /**
   * Parse threshold value from string
   */
  private parseThreshold(threshold: string): number {
    const numericThreshold = parseFloat(threshold.replace(/[^\d.-]/g, ''));
    return isNaN(numericThreshold) ? 0 : numericThreshold;
  }

  /**
   * Evaluate condition against current value and threshold
   */
  private evaluateCondition(condition: string, currentValue: number, threshold: number): boolean {
    switch (condition.toLowerCase()) {
      case 'greater_than':
      case '>':
        return currentValue > threshold;

      case 'greater_than_or_equal':
      case '>=':
        return currentValue >= threshold;

      case 'less_than':
      case '<':
        return currentValue < threshold;

      case 'less_than_or_equal':
      case '<=':
        return currentValue <= threshold;

      case 'equal':
      case '==':
        return currentValue === threshold;

      case 'not_equal':
      case '!=':
        return currentValue !== threshold;

      default:
        console.warn(`Unknown condition: ${condition}`);
        return false;
    }
  }

  /**
   * Get or create rule state
   */
  private getRuleState(ruleId: string): AlertRuleState {
    let state = this.ruleStatesCache.get(ruleId);

    if (!state) {
      state = {
        ruleId,
        lastTriggered: "",
        currentValue: 0,
        triggerCount: 0,
        windowStart: new Date().toISOString(),
        isActive: false,
      };
    }

    return state;
  }

  /**
   * Save rule state to index
   */
  private async saveRuleState(state: AlertRuleState): Promise<void> {
    try {
      await this.alertRuleStatesIndex.addDocuments([state]);
    } catch (error) {
      console.error("Failed to save rule state:", error);
    }
  }

  /**
   * Trigger alert based on rule configuration
   */
  private async triggerAlert(
    rule: AlertRule,
    state: AlertRuleState,
    currentValue: number,
    threshold: number
  ): Promise<void> {
    try {
      const alertTitle = `Alert: ${rule.name}`;
      const alertMessage = this.generateAlertMessage(rule, currentValue, threshold);
      const severity = this.determineSeverity(rule, currentValue, threshold);

      // Determine if email should be sent
      const sendEmail = rule.channel === 'email';
      const recipients = this.parseEmailRecipients(rule.notify);

      console.log(`🚨 Triggering alert: ${alertTitle}`);

      const alert = await this.alertService.createAlert({
        title: alertTitle,
        message: alertMessage,
        severity,
        source: `alert-rule:${rule.id}`,
        metadata: {
          ruleId: rule.id,
          ruleName: rule.name,
          metric: rule.metric,
          condition: rule.condition,
          threshold: threshold,
          currentValue: currentValue,
          triggerCount: state.triggerCount + 1,
          windowSizeMinutes: this.windowSizeMs / (1000 * 60),
        },
        sendEmail,
        emailRecipients: recipients,
      });

      console.log(`✅ Alert created: ${alert.id}`);

    } catch (error) {
      console.error(`Failed to trigger alert for rule ${rule.name}:`, error);
    }
  }

  /**
   * Generate alert message based on rule and values
   */
  private generateAlertMessage(rule: AlertRule, currentValue: number, threshold: number): string {
    const valueStr = rule.metric.includes('rate') || rule.metric.includes('percent')
      ? `${currentValue.toFixed(2)}%`
      : currentValue.toString();

    const thresholdStr = rule.metric.includes('rate') || rule.metric.includes('percent')
      ? `${threshold}%`
      : threshold.toString();

    return `Alert rule "${rule.name}" has been triggered.

Metric: ${rule.metric}
Current Value: ${valueStr}
Condition: ${rule.condition}
Threshold: ${thresholdStr}

The ${rule.metric} has ${this.getConditionDescription(rule.condition)} ${thresholdStr}.

Time Window: ${this.windowSizeMs / (1000 * 60)} minutes
Notification: ${rule.notify}`;
  }

  /**
   * Get human-readable condition description
   */
  private getConditionDescription(condition: string): string {
    switch (condition.toLowerCase()) {
      case 'greater_than':
      case '>':
        return 'exceeded';
      case 'greater_than_or_equal':
      case '>=':
        return 'met or exceeded';
      case 'less_than':
      case '<':
        return 'fallen below';
      case 'less_than_or_equal':
      case '<=':
        return 'fallen to or below';
      case 'equal':
      case '==':
        return 'reached exactly';
      case 'not_equal':
      case '!=':
        return 'deviated from';
      default:
        return 'triggered the condition for';
    }
  }

  /**
   * Determine alert severity based on rule and values
   */
  private determineSeverity(rule: AlertRule, currentValue: number, threshold: number): 'critical' | 'warning' | 'info' {
    // Default severity mapping based on metric type and value
    const ratio = currentValue / threshold;

    // For error rates and counts - higher values are more critical
    if (rule.metric.includes('error') || rule.metric.includes('5xx')) {
      if (ratio >= 3) return 'critical';
      if (ratio >= 1.5) return 'warning';
      return 'info';
    }

    // For response times - higher values are more critical
    if (rule.metric.includes('response_time')) {
      if (currentValue >= threshold * 2) return 'critical';
      if (currentValue >= threshold * 1.5) return 'warning';
      return 'info';
    }

    // For 4xx rates - moderate severity
    if (rule.metric.includes('4xx')) {
      if (ratio >= 2) return 'warning';
      return 'info';
    }

    // Default based on how much the threshold is exceeded
    if (ratio >= 2) return 'critical';
    if (ratio >= 1.5) return 'warning';
    return 'info';
  }

  /**
   * Parse email recipients from notify string
   */
  private parseEmailRecipients(notify: string): string[] {
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const matches = notify.match(emailRegex);
    return matches || [];
  }

  /**
   * Get monitoring statistics
   */
  public getMonitoringStats(): {
    isRunning: boolean;
    rulesMonitored: number;
    activeAlerts: number;
    totalTriggers: number;
    lastProcessedLogId: number;
  } {
    const activeAlerts = Array.from(this.ruleStatesCache.values()).filter(state => state.isActive).length;
    const totalTriggers = Array.from(this.ruleStatesCache.values()).reduce(
      (sum, state) => sum + state.triggerCount,
      0
    );

    return {
      isRunning: this.isMonitoring,
      rulesMonitored: this.ruleStatesCache.size,
      activeAlerts,
      totalTriggers,
      lastProcessedLogId: this.lastProcessedLogId,
    };
  }

  /**
   * Get rule states for debugging/monitoring
   */
  public async getRuleStates(): Promise<AlertRuleState[]> {
    return Array.from(this.ruleStatesCache.values());
  }

  /**
   * Reset rule state (admin function)
   */
  public async resetRuleState(ruleId: string): Promise<void> {
    try {
      const state: AlertRuleState = {
        ruleId,
        lastTriggered: "",
        currentValue: 0,
        triggerCount: 0,
        windowStart: new Date().toISOString(),
        isActive: false,
      };

      this.ruleStatesCache.set(ruleId, state);
      await this.saveRuleState(state);

      console.log(`Rule state reset for rule: ${ruleId}`);
    } catch (error) {
      console.error(`Failed to reset rule state for ${ruleId}:`, error);
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    this.stopMonitoring();
    this.ruleStatesCache.clear();
  }
}

// Factory function to create monitoring service instance
export function createAlertRuleMonitoringService(config?: MonitoringConfig): AlertRuleMonitoringService {
  return new AlertRuleMonitoringService(config);
}
