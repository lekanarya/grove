#!/usr/bin/env node

const BASE_URL = "http://localhost:3000";
const API_KEY = process.argv[2] || process.env.API_KEY || "your-api-key-here";

if (!API_KEY || API_KEY === "your-api-key-here") {
  console.error(
    "❌ Please provide an API key as argument or set API_KEY environment variable",
  );
  console.error("Usage: node test-alerts.js YOUR_API_KEY");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

const testScenarios = [
  {
    name: "High Error Rate Alert",
    endpoint: "/api/alerts/trigger/error-rate",
    data: { errorRate: 8.5, source: "Test Script" },
    description: "Testing error rate > 5%",
  },
  {
    name: "Slow Response Time Alert",
    endpoint: "/api/alerts/trigger/response-time",
    data: { responseTime: 1500, source: "Test Script" },
    description: "Testing response time > 1000ms",
  },
  {
    name: "High CPU Usage Alert",
    endpoint: "/api/alerts/trigger/cpu-usage",
    data: { cpuUsage: 90, source: "Test Script" },
    description: "Testing CPU usage > 85%",
  },
  {
    name: "Custom Metric Alert",
    endpoint: "/api/alerts/trigger",
    data: { metric: "disk_usage", value: 88, source: "Test Script" },
    description: "Testing custom disk usage metric",
  },
];

async function createTestAlertRule(rule) {
  try {
    console.log(`📋 Creating alert rule: ${rule.name}`);
    const response = await fetch(`${BASE_URL}/api/alert-rules`, {
      method: "POST",
      headers,
      body: JSON.stringify(rule),
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Rule created with ID: ${data.data.id}`);
      return data.data;
    } else {
      console.log(`ℹ️  Rule "${rule.name}" already exists, skipping creation`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Failed to create rule "${rule.name}":`, error.message);
    return null;
  }
}

async function triggerAlert(scenario) {
  try {
    console.log(`\n🚨 ${scenario.name}`);
    console.log(`   ${scenario.description}`);

    const response = await fetch(`${BASE_URL}${scenario.endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(scenario.data),
    });

    const result = await response.json();

    if (result.success) {
      console.log(`✅ Success: ${result.message}`);
      if (result.data.alertsTriggered > 0) {
        console.log(`   📧 Emails sent: ${result.data.emailsSent}`);
        console.log(`   🚨 Alerts created: ${result.data.alertsTriggered}`);

        result.data.triggeredAlerts.forEach((alert) => {
          console.log(
            `     • ${alert.ruleName}: ${alert.metric} = ${alert.value} ${alert.condition} ${alert.threshold}`,
          );
        });
      } else {
        console.log(`   ℹ️  No alerts triggered (values within thresholds)`);
      }
    } else {
      console.log(`❌ Failed: ${result.message}`);
    }
  } catch (error) {
    console.error(`❌ Error triggering ${scenario.name}:`, error.message);
  }
}

async function setupTestRules() {
  console.log("🔧 Setting up test alert rules...\n");

  const testRules = [
    {
      name: "Test High Error Rate",
      condition: "greater than",
      threshold: "5",
      metric: "error_rate",
      notify: "test@example.com",
      channel: "email",
      enabled: true,
    },
    {
      name: "Test Response Time Alert",
      condition: "greater than",
      threshold: "1000",
      metric: "response_time",
      notify: "dev@example.com",
      channel: "email",
      enabled: true,
    },
    {
      name: "Test CPU Usage Alert",
      condition: "greater than",
      threshold: "85",
      metric: "cpu_usage",
      notify: "ops@example.com",
      channel: "email",
      enabled: true,
    },
    {
      name: "Test Disk Usage Alert",
      condition: "greater than",
      threshold: "80",
      metric: "disk_usage",
      notify: "sysadmin@example.com",
      channel: "email",
      enabled: true,
    },
  ];

  for (const rule of testRules) {
    await createTestAlertRule(rule);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log("\n✅ Test rules setup complete!\n");
}

async function runTests() {
  console.log("🧪 Alert System Test Suite\n");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`API Key: ${API_KEY.substring(0, 8)}...`);
  console.log("=" * 50);

  await setupTestRules();

  console.log("⏳ Waiting for index updates...");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log("\n🚀 Running alert trigger tests...");

  for (const scenario of testScenarios) {
    await triggerAlert(scenario);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("\n📊 Test Summary");
  console.log("=" * 50);
  console.log("✅ All tests completed!");
  console.log("💡 Check your email and the dashboard for triggered alerts");
  console.log("💡 You can view alerts at: http://localhost:3000/alerts");
}

async function checkServerStatus() {
  try {
    const response = await fetch(`${BASE_URL}/api/health`, { headers });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function main() {
  console.log("🏥 Checking server status...");

  const serverUp = await checkServerStatus();
  if (!serverUp) {
    console.error("❌ Server is not running or not accessible at:", BASE_URL);
    console.error("💡 Make sure the server is running: npm run dev");
    process.exit(1);
  }

  console.log("✅ Server is running");

  await runTests();
}

main().catch((error) => {
  console.error("❌ Test execution failed:", error.message);
  process.exit(1);
});
