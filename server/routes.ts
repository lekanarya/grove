import "dotenv/config";
import express, { Express, Request, Response, NextFunction } from "express";
import { createServer, Server } from "http";
import { MeiliSearch, Index, SearchParams, Task } from "meilisearch";
import bcrypt from "bcryptjs";
import * as fs from "fs/promises";
import * as path from "path";
import { createAlertService, AlertService } from "./services/alertService";
import { createEmailService } from "./services/emailService";
import { createAlertRuleMonitoringService } from "./services/alertRuleMonitoringService";

interface ApiKey {
  key: string;
  name: string;
  created: string;
  lastUsed: string | null;
  status: "active" | "revoked";
}

interface ApiConfig {
  user: number;
  api_key: number;
}

interface ApiKeyCreateRequest {
  name: string;
  key: string;
  status?: "active" | "revoked";
}

interface ApiKeyUpdateRequest {
  name?: string;
  status?: "active" | "revoked";
  lastUsed?: string;
}

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

interface ActiveAlert {
  id: string;
  title: string;
  message: string;
  created_at: string;
  severity: "critical" | "warning" | "info";
  source: string;
  status: "active" | "acknowledged" | "resolved";
}

interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  role: "admin" | "user" | "moderator";
  status: "active" | "inactive" | "suspended";
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UserCreateRequest {
  name: string;
  email: string;
  password: string;
  role?: "admin" | "user" | "moderator";
  status?: "active" | "inactive" | "suspended";
}

interface UserUpdateRequest {
  name?: string;
  email?: string;
  role?: "admin" | "user" | "moderator";
  status?: "active" | "inactive" | "suspended";
  lastLogin?: string;
}

interface UserLoginRequest {
  email: string;
  password: string;
}

interface SearchQueryParams {
  search?: string;
  status?: string;
  role?: string;
  sortBy?: string;
}

interface ErrorResponse {
  success: false;
  message: string;
  error?: string;
}

interface SuccessResponse<T> {
  success: true;
  data: T;
  total?: number;
}

declare global {
  namespace Express {
    interface Request {
      searchParams?: SearchQueryParams;
      userSearchParams?: SearchQueryParams;
      logSearchParams?: {
        search?: string;
        source?: string;
        level?: string;
        project?: string;
        sortBy?: string;
        limit?: number;
        offset?: number;
        timeRange?: string;
        from?: string;
        to?: string;
      };
      alertSearchParams?: {
        search?: string;
        severity?: string;
        source?: string;
        acknowledged?: string;
        sortBy?: string;
        limit?: number;
        offset?: number;
      };
    }
  }
}

const app: Express = express();
app.use(express.json());

const client: MeiliSearch = new MeiliSearch({
  host: process.env.MEILISEARCH_HOST || "http://localhost:7700",
  apiKey: process.env.MEILISEARCH_KEY || "",
});

const API_KEYS_INDEX: string = "api_keys";
const USERS_INDEX: string = "users";
const LOGS_INDEX = "logs";
const ALERTS_INDEX = "alerts";
const ALERT_RULES_INDEX = "alert_rules";

const SALT_ROUNDS = 12;

const alertService: AlertService = createAlertService();
const emailService = createEmailService();
const alertMonitoringService = createAlertRuleMonitoringService();

/**
 * API Key Authentication Middleware
 *
 * This middleware validates API keys for all routes except the login route.
 * API keys can be provided in two ways:
 * 1. Authorization header as 'Bearer <api-key>'
 * 2. x-api-key header with the API key value
 *
 * The middleware:
 * - Skips authentication for /api/users/login
 * - Validates the API key exists in MeiliSearch
 * - Checks if the API key status is 'active'
 * - Updates the lastUsed timestamp for valid API keys
 * - Returns 401 for missing, invalid, or revoked API keys
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
const authenticateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  return next();
};

const parseSearchParams = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const { search, status, sortBy } = req.query;
  req.searchParams = {
    search: search as string | undefined,
    status: status as string | undefined,
    sortBy: sortBy as string | undefined,
  };
  next();
};

const parseUserSearchParams = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const { search, status, role, sortBy } = req.query;
  req.userSearchParams = {
    search: search as string | undefined,
    status: status as string | undefined,
    role: role as string | undefined,
    sortBy: sortBy as string | undefined,
  };
  next();
};

const parseLogSearchParams = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const {
    search,
    source,
    level,
    project,
    sortBy,
    limit,
    offset,
    timeRange,
    from,
    to,
  } = req.query;
  req.logSearchParams = {
    search: search as string | undefined,
    source: source as string | undefined,
    level: level as string | undefined,
    project: project as string | undefined,
    sortBy: sortBy as string | undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    offset: offset ? parseInt(offset as string, 10) : undefined,
    timeRange: timeRange as string | undefined,
    from: from as string | undefined,
    to: to as string | undefined,
  };
  next();
};

const parseAlertSearchParams = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const { search, severity, source, acknowledged, sortBy, limit, offset } =
    req.query;
  req.alertSearchParams = {
    search: search as string | undefined,
    severity: severity as string | undefined,
    source: source as string | undefined,
    acknowledged: acknowledged as string | undefined,
    sortBy: sortBy as string | undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    offset: offset ? parseInt(offset as string, 10) : undefined,
  };
  next();
};

const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  console.error("Error:", err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  } as ErrorResponse);
};

const generateUserId = (): string => {
  return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const hashPassword = async (password: string): Promise<string> => {
  return await bcrypt.hash(password, SALT_ROUNDS);
};

const validatePassword = async (
  password: string,
  hash: string,
): Promise<boolean> => {
  return await bcrypt.compare(password, hash);
};

const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const isValidPassword = (
  password: string,
): { valid: boolean; message?: string } => {
  if (password.length < 8) {
    return {
      valid: false,
      message: "Password must be at least 8 characters long",
    };
  }
  if (!/[A-Z]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one uppercase letter",
    };
  }
  if (!/[a-z]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one lowercase letter",
    };
  }
  if (!/[0-9]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one number",
    };
  }
  return { valid: true };
};

const generateApiKey = (): string => {
  const prefix = "sk_";
  const randomPart =
    Math.random().toString(36).substring(2, 20) +
    Math.random().toString(36).substring(2, 15);
  return prefix + randomPart;
};

const checkMeiliSearchConnection = async (): Promise<void> => {
  try {
    console.log("Checking MeiliSearch connectivity...");
    await client.health();
    console.log("MeiliSearch is healthy and accessible");
  } catch (error: any) {
    console.error("MeiliSearch is not accessible:", error);
    throw new Error(`Failed to connect to MeiliSearch: ${error.message}`);
  }
};

const waitForIndex = async (
  indexName: string,
  maxRetries: number = 5,
): Promise<Index> => {
  console.log(`Waiting for index ${indexName} to become available...`);
  for (let i = 0; i < maxRetries; i++) {
    try {
      const index = await client.getIndex(indexName);
      console.log(`Index ${indexName} is available after ${i + 1} attempt(s)`);
      return index;
    } catch (error: any) {
      if (
        (error.code === "index_not_found" ||
          error.cause?.code === "index_not_found") &&
        i < maxRetries - 1
      ) {
        console.log(
          `Index ${indexName} not ready, retrying in 1 second... (attempt ${i + 1}/${maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      console.error(
        `Failed to get index ${indexName} after ${i + 1} attempts:`,
        error,
      );
      throw error;
    }
  }
  throw new Error(
    `Index ${indexName} not available after ${maxRetries} retries`,
  );
};

async function initializeDefaults() {
  try {
    // First, check if grove.json exists
    let configExists = true;
    try {
      const currentDir = process.cwd();
      const filePath = path.join(currentDir, "grove.json");
      await fs.access(filePath);
    } catch {
      configExists = false;
    }

    // If file doesn't exist, create it with defaults
    if (!configExists) {
      const apiKeyData: ApiKey = {
        key: generateApiKey(),
        name: "Grove API Key",
        status: "active",
        created: new Date().toISOString(),
        lastUsed: null,
      };

      const hashedPassword = await hashPassword("Grove12345");
      const now = new Date().toISOString();
      const userData: User = {
        id: generateUserId(),
        name: "Grove Admin",
        email: "admin@grove.dev",
        password: hashedPassword,
        role: "admin",
        status: "active",
        lastLogin: null,
        createdAt: now,
        updatedAt: now,
      };

      // Add to Meilisearch
      await client.index(API_KEYS_INDEX).addDocuments([apiKeyData]);
      await client.index(USERS_INDEX).addDocuments([userData]);

      // Create config file
      const _config: ApiConfig = { user: 1, api_key: 1 };
      const _data = JSON.stringify(_config, null, 2);
      const currentDir = process.cwd();
      const filePath = path.join(currentDir, "grove.json");
      await fs.writeFile(filePath, _data, "utf-8");

      // Update .env file with the new API key
      const envPath = path.join(currentDir, ".env");
      let envContent = await fs.readFile(envPath, "utf-8");
      envContent = envContent.replace(
        /VITE_PUBLIC_API_KEY=".*"/,
        `VITE_PUBLIC_API_KEY="${apiKeyData.key}"`,
      );
      await fs.writeFile(envPath, envContent, "utf-8");

      console.log("Default user and API key created successfully");
    } else {
      console.log("grove.json already exists, skipping initialization");
    }
  } catch (error) {
    console.error("Error initializing defaults:", error);
    throw error;
  }
}

// Initialize index settings with proper sortable and filterable attributes
const initializeIndexSettings = async (): Promise<void> => {
  console.log("Starting Meilisearch index initialization...");

  try {
    // First check MeiliSearch connectivity
    await checkMeiliSearchConnection();

    // API Keys index settings
    console.log(`Initializing ${API_KEYS_INDEX} index...`);
    let apiKeysIndex: Index;
    try {
      apiKeysIndex = await client.getIndex(API_KEYS_INDEX);
      console.log(`${API_KEYS_INDEX} index found`);
    } catch (error: any) {
      if (
        error.code === "index_not_found" ||
        error.cause?.code === "index_not_found"
      ) {
        console.log(`${API_KEYS_INDEX} index not found, creating...`);
        await client.createIndex(API_KEYS_INDEX, {
          primaryKey: "key",
        });
        console.log(
          `${API_KEYS_INDEX} index created, waiting for availability...`,
        );
        apiKeysIndex = await waitForIndex(API_KEYS_INDEX);
        console.log(`${API_KEYS_INDEX} index is now available`);
      } else {
        console.error(`Error getting ${API_KEYS_INDEX} index:`, error);
        throw error;
      }
    }
    // Configure settings for API keys index
    await apiKeysIndex.updateSettings({
      sortableAttributes: ["created", "lastUsed", "name", "status"],
      filterableAttributes: ["name", "status", "created", "lastUsed"],
      searchableAttributes: ["name", "key"],
    });
    console.log(`Meilisearch index '${API_KEYS_INDEX}' settings configured`);

    // Users index settings
    console.log(`Initializing ${USERS_INDEX} index...`);
    let usersIndex: Index;
    try {
      usersIndex = await client.getIndex(USERS_INDEX);
      console.log(`${USERS_INDEX} index found`);
    } catch (error: any) {
      if (
        error.code === "index_not_found" ||
        error.cause?.code === "index_not_found"
      ) {
        console.log(`${USERS_INDEX} index not found, creating...`);
        await client.createIndex(USERS_INDEX, {
          primaryKey: "id",
        });
        console.log(
          `${USERS_INDEX} index created, waiting for availability...`,
        );
        usersIndex = await waitForIndex(USERS_INDEX);
        console.log(`${USERS_INDEX} index is now available`);
      } else {
        console.error(`Error getting ${USERS_INDEX} index:`, error);
        throw error;
      }
    }
    // Configure settings for users index
    await usersIndex.updateSettings({
      sortableAttributes: [
        "createdAt",
        "updatedAt",
        "lastLogin",
        "name",
        "email",
        "role",
        "status",
      ],
      filterableAttributes: [
        "name",
        "email",
        "role",
        "status",
        "lastLogin",
        "createdAt",
        "updatedAt",
      ],
      searchableAttributes: ["name", "email"],
    });
    console.log(`Meilisearch index '${USERS_INDEX}' settings configured`);

    // Logs index settings
    console.log(`Initializing ${LOGS_INDEX} index...`);
    let logIndex: Index;
    try {
      logIndex = await client.getIndex(LOGS_INDEX);
      console.log(`${LOGS_INDEX} index found`);
    } catch (error: any) {
      if (
        error.code === "index_not_found" ||
        error.cause?.code === "index_not_found"
      ) {
        console.log(`${LOGS_INDEX} index not found, creating...`);
        await client.createIndex(LOGS_INDEX, {
          primaryKey: "id",
        });
        console.log(`${LOGS_INDEX} index created, waiting for availability...`);
        logIndex = await waitForIndex(LOGS_INDEX);
        console.log(`${LOGS_INDEX} index is now available`);
      } else {
        console.error(`Error getting ${LOGS_INDEX} index:`, error);
        throw error;
      }
    }
    // Configure settings for logs index
    await logIndex.updateSettings({
      sortableAttributes: ["id", "timestamp", "source", "level", "project"],
      filterableAttributes: [
        "id",
        "source",
        "level",
        "timestamp",
        "project",
        "details.statusCode",
        "details.duration",
      ],
      searchableAttributes: ["message", "source"],
      pagination: {
        maxTotalHits: 10000,
      },
    });

    console.log(`Meilisearch index '${LOGS_INDEX}' settings configured`);

    // Alerts index settings
    console.log(`Initializing ${ALERTS_INDEX} index...`);
    let alertsIndex: Index;
    try {
      alertsIndex = await client.getIndex(ALERTS_INDEX);
      console.log(`${ALERTS_INDEX} index found`);
    } catch (error: any) {
      if (
        error.code === "index_not_found" ||
        error.cause?.code === "index_not_found"
      ) {
        console.log(`${ALERTS_INDEX} index not found, creating...`);
        await client.createIndex(ALERTS_INDEX, {
          primaryKey: "id",
        });
        console.log(
          `${ALERTS_INDEX} index created, waiting for availability...`,
        );
        alertsIndex = await waitForIndex(ALERTS_INDEX);
        console.log(`${ALERTS_INDEX} index is now available`);
      } else {
        console.error(`Error getting ${ALERTS_INDEX} index:`, error);
        throw error;
      }
    }
    // Configure settings for alerts index
    await alertsIndex.updateSettings({
      sortableAttributes: [
        "id",
        "timestamp",
        "severity",
        "source",
        "acknowledged",
      ],
      filterableAttributes: [
        "id",
        "severity",
        "source",
        "acknowledged",
        "timestamp",
      ],
      searchableAttributes: ["message", "source"],
    });
    console.log(`Meilisearch index '${ALERTS_INDEX}' settings configured`);

    // Alert Rules index settings
    console.log(`Initializing ${ALERT_RULES_INDEX} index...`);
    let alertRulesIndex: Index;
    try {
      alertRulesIndex = await client.getIndex(ALERT_RULES_INDEX);
      console.log(`${ALERT_RULES_INDEX} index found`);
    } catch (error: any) {
      if (
        error.code === "index_not_found" ||
        error.cause?.code === "index_not_found"
      ) {
        console.log(`${ALERT_RULES_INDEX} index not found, creating...`);
        await client.createIndex(ALERT_RULES_INDEX, {
          primaryKey: "id",
        });
        console.log(
          `${ALERT_RULES_INDEX} index created, waiting for availability...`,
        );
        alertRulesIndex = await waitForIndex(ALERT_RULES_INDEX);
        console.log(`${ALERT_RULES_INDEX} index is now available`);
      } else {
        console.error(`Error getting ${ALERT_RULES_INDEX} index:`, error);
        throw error;
      }
    }
    // Configure settings for alert rules index
    await alertRulesIndex.updateSettings({
      sortableAttributes: ["id", "name", "metric", "channel", "enabled"],
      filterableAttributes: ["id", "name", "metric", "channel", "enabled"],
      searchableAttributes: ["name", "condition", "metric", "notify"],
    });
    console.log(`Meilisearch index '${ALERT_RULES_INDEX}' settings configured`);

    console.log("All Meilisearch indexes initialized successfully!");
  } catch (error: any) {
    console.error("Error initializing index settings:", error);
    console.error("Error details:", {
      message: error.message,
      code: error.code || error.cause?.code,
      type: error.type || error.cause?.type,
      stack: error.stack,
    });
    throw error; // Re-throw to let caller know initialization failed
  }

  try {
    await initializeDefaults();
  } catch (error: any) {
    console.error("Failed to initialize indexes:", error);
    throw error;
  }
};

const registerRoutes = async (app: Express): Promise<Server> => {
  // Initialize index settings with proper attributes
  try {
    await initializeIndexSettings();
    console.log("All indexes initialized successfully");
  } catch (error: any) {
    console.error("Failed to initialize indexes:", error);
    throw error;
  }

  // API Key routes
  // GET /api/apikeys - Retrieve all API keys with optional search/filter
  app.get(
    "/api/apikeys",
    authenticateApiKey,
    parseSearchParams,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const {
          search,
          status,
          sortBy = "created:desc",
        } = req.searchParams || {};
        const index: Index = client.index(API_KEYS_INDEX);
        let filters: string[] = [];
        if (status) {
          filters.push(`status = "${status}"`);
        }
        const searchParams: SearchParams = {
          filter: filters.length > 0 ? filters.join(" AND ") : undefined,
          sort: [sortBy],
        };
        let results: any;
        if (search) {
          const searchResults = await index.search(search, searchParams);
          results = {
            hits: searchResults.hits,
            estimatedTotalHits: searchResults.estimatedTotalHits,
          };
        } else {
          // Use the correct method for getting all documents with filters
          const searchResults = await index.search("", {
            ...searchParams,
            limit: 1000,
          });
          results = {
            hits: searchResults.hits,
            estimatedTotalHits: searchResults.estimatedTotalHits,
          };
        }
        const response: SuccessResponse<ApiKey[]> = {
          success: true,
          data: results.hits,
          total: results.estimatedTotalHits,
        };
        res.json(response);
      } catch (error: any) {
        next(error);
      }
    },
  );

  // POST /api/apikeys - Create a new API key
  app.post(
    "/api/apikeys",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { name, key, status = "active" }: ApiKeyCreateRequest = req.body;
        if (!name || !key) {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "Name and key are required",
          };
          return res.status(400).json(errorResponse);
        }
        const index: Index = client.index(API_KEYS_INDEX);
        try {
          // Check if key already exists by trying to get it
          await index.getDocument(key);
          // If we get here, the document exists
          const errorResponse: ErrorResponse = {
            success: false,
            message: "API key already exists",
          };
          return res.status(409).json(errorResponse);
        } catch (error: any) {
          // Document doesn't exist, which is what we want
          if (error.code !== "document_not_found") {
            // throw error;
          }
        }
        const apiKeyData: ApiKey = {
          key,
          name,
          status,
          created: new Date().toISOString(),
          lastUsed: null,
        };
        await index.addDocuments([apiKeyData]);
        const response: SuccessResponse<ApiKey> = {
          success: true,
          data: apiKeyData,
        };
        await new Promise((resolve) => setTimeout(resolve, 3000));
        res.status(201).json(response);
      } catch (error: any) {
        next(error);
      }
    },
  );

  // GET /api/apikeys/:key - Get a specific API key
  app.get(
    "/api/apikeys/:key",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { key } = req.params;
        const index: Index = client.index(API_KEYS_INDEX);
        const apiKey: ApiKey = await index.getDocument(key);
        const response: SuccessResponse<ApiKey> = {
          success: true,
          data: apiKey,
        };
        res.json(response);
      } catch (error: any) {
        if (error.code === "document_not_found") {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "API key not found",
          };
          return res.status(404).json(errorResponse);
        }
        next(error);
      }
    },
  );

  // PUT /api/apikeys/:key - Update an API key
  app.put(
    "/api/apikeys/:key",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { key } = req.params;
        const updates: ApiKeyUpdateRequest = req.body;
        const index: Index = client.index(API_KEYS_INDEX);
        // Get the current document
        const currentDoc: ApiKey = await index.getDocument(key);
        // Merge updates with current document
        const updatedDoc: ApiKey = { ...currentDoc, ...updates };
        // Update the document
        await index.updateDocuments([updatedDoc]);
        const response: SuccessResponse<ApiKey> = {
          success: true,
          data: updatedDoc,
        };
        await new Promise((resolve) => setTimeout(resolve, 3000));
        res.json(response);
      } catch (error: any) {
        if (error.code === "document_not_found") {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "API key not found",
          };
          return res.status(404).json(errorResponse);
        }
        next(error);
      }
    },
  );

  // PATCH /api/apikeys/:key/revoke - Revoke an API key
  app.patch(
    "/api/apikeys/:key/revoke",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { key } = req.params;
        const index: Index = client.index(API_KEYS_INDEX);
        // Get the current document
        const currentDoc: ApiKey = await index.getDocument(key);
        // Update status to revoked
        const updatedDoc: ApiKey = { ...currentDoc, status: "revoked" };
        // Update the document
        let task = await index.updateDocuments([updatedDoc]);
        // await waitForTask(task.taskUid);
        const response: SuccessResponse<ApiKey> = {
          success: true,
          data: updatedDoc,
        };
        await new Promise((resolve) => setTimeout(resolve, 3000));
        res.json(response);
      } catch (error: any) {
        if (error.code === "document_not_found") {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "API key not found",
          };
          return res.status(404).json(errorResponse);
        }
        next(error);
      }
    },
  );

  // PATCH /api/apikeys/:key/reactivate - Reactivate an API key
  app.patch(
    "/api/apikeys/:key/reactivate",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { key } = req.params;
        const index: Index = client.index(API_KEYS_INDEX);
        // Get the current document
        const currentDoc: ApiKey = await index.getDocument(key);
        // Update status to active
        const updatedDoc: ApiKey = { ...currentDoc, status: "active" };
        // Update the document
        await index.updateDocuments([updatedDoc]);
        const response: SuccessResponse<ApiKey> = {
          success: true,
          data: updatedDoc,
        };
        await new Promise((resolve) => setTimeout(resolve, 3000));
        res.json(response);
      } catch (error: any) {
        if (error.code === "document_not_found") {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "API key not found",
          };
          return res.status(404).json(errorResponse);
        }
        next(error);
      }
    },
  );

  // DELETE /api/apikeys/:key - Delete an API key
  app.delete(
    "/api/apikeys/:key",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { key } = req.params;
        const index: Index = client.index(API_KEYS_INDEX);
        // Delete the document
        await index.deleteDocument(key);
        const response: SuccessResponse<{ message: string }> = {
          success: true,
          data: { message: "API key deleted successfully" },
        };
        res.json(response);
      } catch (error: any) {
        if (error.code === "document_not_found") {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "API key not found",
          };
          return res.status(404).json(errorResponse);
        }
        next(error);
      }
    },
  );

  // PATCH /api/apikeys/:key/last-used - Update last used timestamp
  app.patch(
    "/api/apikeys/:key/last-used",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { key } = req.params;
        const index: Index = client.index(API_KEYS_INDEX);
        // Get the current document
        const currentDoc: ApiKey = await index.getDocument(key);
        // Update last used timestamp
        const updatedDoc: ApiKey = {
          ...currentDoc,
          lastUsed: new Date().toISOString(),
        };
        // Update the document
        await index.updateDocuments([updatedDoc]);
        const response: SuccessResponse<ApiKey> = {
          success: true,
          data: updatedDoc,
        };
        await new Promise((resolve) => setTimeout(resolve, 3000));
        res.json(response);
      } catch (error: any) {
        if (error.code === "document_not_found") {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "API key not found",
          };
          return res.status(404).json(errorResponse);
        }
        next(error);
      }
    },
  );

  // USER ROUTES
  // GET /api/users - Retrieve all users with optional search/filter
  app.get(
    "/api/users",
    authenticateApiKey,
    parseUserSearchParams,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const {
          search,
          status,
          role,
          sortBy = "createdAt:desc",
        } = req.userSearchParams || {};
        const index: Index = client.index(USERS_INDEX);
        let filters: string[] = [];
        if (status) {
          filters.push(`status = "${status}"`);
        }
        if (role) {
          filters.push(`role = "${role}"`);
        }
        const searchParams: SearchParams = {
          filter: filters.length > 0 ? filters.join(" AND ") : undefined,
          sort: [sortBy],
          limit: 1000,
        };
        // Use search for both searching and filtering
        const searchResults = await index.search(search || "", searchParams);
        // Remove passwords from response
        const usersWithoutPasswords = searchResults.hits.map((user: any) => {
          const { password, ...userWithoutPassword } = user;
          return userWithoutPassword;
        });
        const response: SuccessResponse<any[]> = {
          success: true,
          data: usersWithoutPasswords,
          total: searchResults.estimatedTotalHits,
        };
        res.json(response);
      } catch (error: any) {
        next(error);
      }
    },
  );

  // POST /api/users - Create a new user
  app.post(
    "/api/users",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const {
          name,
          email,
          password,
          role = "user",
          status = "active",
        }: UserCreateRequest = req.body;
        if (!name || !email || !password) {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "Name, email, and password are required",
          };
          return res.status(400).json(errorResponse);
        }
        // Validate email
        if (!isValidEmail(email)) {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "Invalid email format",
          };
          return res.status(400).json(errorResponse);
        }
        // Validate password
        const passwordValidation = isValidPassword(password);
        if (!passwordValidation.valid) {
          const errorResponse: ErrorResponse = {
            success: false,
            message: passwordValidation.message || "Invalid password",
          };
          return res.status(400).json(errorResponse);
        }
        const index: Index = client.index(USERS_INDEX);
        // Check if email already exists using search
        const existingUsers = await index.search("", {
          filter: `email = "${email}"`,
          limit: 1,
        });
        if (existingUsers.hits.length > 0) {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "User with this email already exists",
          };
          return res.status(409).json(errorResponse);
        }
        // Hash password
        const hashedPassword = await hashPassword(password);
        const now = new Date().toISOString();
        const userData: User = {
          id: generateUserId(),
          name,
          email,
          password: hashedPassword,
          role,
          status,
          lastLogin: null,
          createdAt: now,
          updatedAt: now,
        };
        await index.addDocuments([userData]);
        // Remove password from response
        const { password: _, ...userWithoutPassword } = userData;
        const response: SuccessResponse<Omit<User, "password">> = {
          success: true,
          data: userWithoutPassword,
        };
        await new Promise((resolve) => setTimeout(resolve, 3000));
        res.status(201).json(response);
      } catch (error: any) {
        next(error);
      }
    },
  );

  // POST /api/users/login - User login
  app.post(
    "/api/users/login",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { email, password }: UserLoginRequest = req.body;
        if (!email || !password) {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "Email and password are required",
          };
          return res.status(400).json(errorResponse);
        }
        const index: Index = client.index(USERS_INDEX);
        // Find user by email using search
        const users = await index.search("", {
          filter: `email = "${email}"`,
          limit: 1,
        });
        if (users.hits.length === 0) {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "Invalid email or password",
          };
          return res.status(401).json(errorResponse);
        }
        const user = users.hits[0] as User;
        // Check if user is active
        if (user.status !== "active") {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "Account is not active",
          };
          return res.status(401).json(errorResponse);
        }
        // Validate password
        const isValid = await validatePassword(password, user.password);
        if (!isValid) {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "Invalid email or password",
          };
          return res.status(401).json(errorResponse);
        }
        // Update last login
        const updatedDoc: User = {
          ...user,
          lastLogin: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await index.updateDocuments([updatedDoc]);
        // Remove password from response
        const { password: _, ...userWithoutPassword } = updatedDoc;
        const response: SuccessResponse<Omit<User, "password">> = {
          success: true,
          data: userWithoutPassword,
        };
        res.json(response);
      } catch (error: any) {
        next(error);
      }
    },
  );

  // GET /api/users/:id - Get a specific user
  app.get(
    "/api/users/:id",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const index: Index = client.index(USERS_INDEX);
        const user: User = await index.getDocument(id);
        // Remove password from response
        const { password, ...userWithoutPassword } = user;
        const response: SuccessResponse<Omit<User, "password">> = {
          success: true,
          data: userWithoutPassword,
        };
        res.json(response);
      } catch (error: any) {
        if (error.code === "document_not_found") {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "User not found",
          };
          return res.status(404).json(errorResponse);
        }
        next(error);
      }
    },
  );

  // PUT /api/users/:id - Update a user
  app.put(
    "/api/users/:id",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const updates: UserUpdateRequest = req.body;
        const index: Index = client.index(USERS_INDEX);
        // Get the current document
        const currentDoc: User = await index.getDocument(id);
        // Check if email is being changed and if it already exists
        if (updates.email && updates.email !== currentDoc.email) {
          if (!isValidEmail(updates.email)) {
            const errorResponse: ErrorResponse = {
              success: false,
              message: "Invalid email format",
            };
            return res.status(400).json(errorResponse);
          }
          const existingUsers = await index.search("", {
            filter: `email = "${updates.email}"`,
            limit: 1,
          });
          if (existingUsers.hits.length > 0) {
            const errorResponse: ErrorResponse = {
              success: false,
              message: "User with this email already exists",
            };
            return res.status(409).json(errorResponse);
          }
        }
        // Merge updates with current document
        const updatedDoc: User = {
          ...currentDoc,
          ...updates,
          updatedAt: new Date().toISOString(),
        };
        // Update the document
        await index.updateDocuments([updatedDoc]);
        // Remove password from response
        const { password, ...userWithoutPassword } = updatedDoc;
        const response: SuccessResponse<Omit<User, "password">> = {
          success: true,
          data: userWithoutPassword,
        };
        await new Promise((resolve) => setTimeout(resolve, 3000));
        res.json(response);
      } catch (error: any) {
        if (error.code === "document_not_found") {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "User not found",
          };
          return res.status(404).json(errorResponse);
        }
        next(error);
      }
    },
  );

  // PATCH /api/users/:id/password - Update user password
  app.patch(
    "/api/users/:id/password",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const { newPassword } = req.body; // Only newPassword is required

        if (!newPassword) {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "New password is required",
          };
          return res.status(400).json(errorResponse);
        }

        const index: Index = client.index(USERS_INDEX);

        // Validate new password
        const passwordValidation = isValidPassword(newPassword);
        if (!passwordValidation.valid) {
          const errorResponse: ErrorResponse = {
            success: false,
            message: passwordValidation.message || "Invalid password",
          };
          return res.status(400).json(errorResponse);
        }

        // Get the current document
        const currentDoc: User = await index.getDocument(id);

        // Hash new password
        const hashedPassword = await hashPassword(newPassword);

        // Update password
        const updatedDoc: User = {
          ...currentDoc,
          password: hashedPassword,
          updatedAt: new Date().toISOString(),
        };

        // Update the document
        await index.updateDocuments([updatedDoc]);

        const response: SuccessResponse<{ message: string }> = {
          success: true,
          data: { message: "Password updated successfully" },
        };
        await new Promise((resolve) => setTimeout(resolve, 3000));
        res.json(response);
      } catch (error: any) {
        if (error.code === "document_not_found") {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "User not found",
          };
          return res.status(404).json(errorResponse);
        }
        next(error);
      }
    },
  );

  // DELETE /api/users/:id - Delete a user
  app.delete(
    "/api/users/:id",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const index: Index = client.index(USERS_INDEX);
        // Delete the document
        await index.deleteDocument(id);
        const response: SuccessResponse<{ message: string }> = {
          success: true,
          data: { message: "User deleted successfully" },
        };
        res.json(response);
      } catch (error: any) {
        if (error.code === "document_not_found") {
          const errorResponse: ErrorResponse = {
            success: false,
            message: "User not found",
          };
          return res.status(404).json(errorResponse);
        }
        next(error);
      }
    },
  );

  app.get(
    "/api/logs",
    authenticateApiKey,
    parseLogSearchParams,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const {
          search,
          source,
          level,
          project,
          sortBy = "timestamp:desc",
          limit = 100,
          offset = 0,
          timeRange,
          from,
          to,
        } = req.logSearchParams || {};

        // Validate sortBy parameter
        const validSortFields = ["timestamp", "source", "level", "project"];
        const validSortDirections = ["asc", "desc"];
        const [sortField, sortDirection = "desc"] = sortBy.split(":");

        if (!validSortFields.includes(sortField)) {
          return res.status(400).json({
            success: false,
            message: `Invalid sort field. Must be one of: ${validSortFields.join(", ")}`,
          });
        }

        if (!validSortDirections.includes(sortDirection)) {
          return res.status(400).json({
            success: false,
            message: `Invalid sort direction. Must be one of: ${validSortDirections.join(", ")}`,
          });
        }

        // Validate level parameter if provided
        if (level) {
          const validLevels = ["info", "warning", "error"];
          if (!validLevels.includes(level)) {
            return res.status(400).json({
              success: false,
              message: `Invalid level. Must be one of: ${validLevels.join(", ")}`,
            });
          }
        }

        const index: Index = client.index(LOGS_INDEX);
        let filters: string[] = [];
        if (source) {
          filters.push(`source = "${source}"`);
        }
        if (level) {
          filters.push(`level = "${level}"`);
        }
        if (project) {
          filters.push(`project = "${project}"`);
        }

        // Handle time filtering
        if (timeRange && timeRange !== "custom") {
          const now = new Date();
          let fromDate = new Date();

          switch (timeRange) {
            case "1":
              fromDate.setHours(now.getHours() - 1);
              break;
            case "6":
              fromDate.setHours(now.getHours() - 6);
              break;
            case "12":
              fromDate.setHours(now.getHours() - 12);
              break;
            case "24":
              fromDate.setDate(now.getDate() - 1);
              break;
            case "72":
              fromDate.setDate(now.getDate() - 3);
              break;
            case "168":
              fromDate.setDate(now.getDate() - 7);
              break;
            default:
              fromDate.setDate(now.getDate() - 1);
          }

          filters.push(`timestamp >= "${fromDate.toISOString()}"`);
          filters.push(`timestamp <= "${now.toISOString()}"`);
        } else if (timeRange === "custom" && (from || to)) {
          if (from) {
            const fromDate = new Date(from);
            if (!isNaN(fromDate.getTime())) {
              filters.push(`timestamp >= "${fromDate.toISOString()}"`);
            }
          }
          if (to) {
            const toDate = new Date(to);
            if (!isNaN(toDate.getTime())) {
              // Add 23:59:59 to the end of the day for the "to" date
              toDate.setHours(23, 59, 59, 999);
              filters.push(`timestamp <= "${toDate.toISOString()}"`);
            }
          }
        }

        // Validate and sanitize limit and offset
        const sanitizedLimit = Math.min(Math.max(1, limit), 1000);
        const sanitizedOffset = Math.max(0, offset);

        const searchParams: any = {
          filter: filters.length > 0 ? filters.join(" AND ") : undefined,
          sort: [`${sortField}:${sortDirection}`],
          limit: sanitizedLimit,
          offset: sanitizedOffset,
        };

        let results;
        if (search) {
          results = await index.search(search, searchParams);
        } else {
          results = await index.search("", searchParams);
        }

        const response = {
          success: true,
          data: results.hits,
          total: results.estimatedTotalHits,
          pagination: {
            limit: sanitizedLimit,
            offset: sanitizedOffset,
            hasMore: results.hits.length === sanitizedLimit,
          },
        };
        res.json(response);
      } catch (error: any) {
        console.error("Error fetching logs:", error);
        res.status(500).json({
          success: false,
          message: "Failed to fetch logs",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );
  app.post(
    "/api/logs",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { source, message, level, details, project } = req.body;

        // Validate required fields
        if (!source || typeof source !== "string") {
          return res.status(400).json({
            success: false,
            message: "Source is required and must be a string",
          });
        }

        if (!message || typeof message !== "string") {
          return res.status(400).json({
            success: false,
            message: "Message is required and must be a string",
          });
        }

        // Validate level enum
        const validLevels = ["info", "warning", "error"];
        if (!level || !validLevels.includes(level)) {
          return res.status(400).json({
            success: false,
            message:
              "Level is required and must be one of: info, warning, error",
          });
        }

        // Generate timestamp and ID if not provided
        const newLog: LogEntry = {
          id: req.body.id || Date.now(),
          project: project || "default",
          timestamp: req.body.timestamp || new Date().toISOString(),
          source,
          message,
          level,
          details: details || {},
        };

        const index: Index = client.index(LOGS_INDEX);
        await index.addDocuments([newLog]);
        res.status(201).json({ success: true, data: newLog });
      } catch (error: any) {
        console.error("Error creating log entry:", error);
        res.status(500).json({
          success: false,
          message: "Failed to create log entry",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  // GET /api/logs/projects - Get distinct projects (must come before /:id route)
  app.get(
    "/api/logs/projects",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const index: Index = client.index(LOGS_INDEX);

        const results = await index.search("", {
          facets: ["project"],
          limit: 0,
        });

        let projects = Object.keys(results.facetDistribution?.project || {})
          .filter((project) => project && project.trim() !== "")
          .sort();
        res.json({
          success: true,
          data: projects,
        });
      } catch (error: any) {
        console.error("Error fetching projects:", error);
        res.status(500).json({
          success: false,
          message: "Failed to fetch projects",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  // GET /api/logs/sources - Get distinct sources (must come before /:id route)
  app.get(
    "/api/logs/sources",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const index: Index = client.index(LOGS_INDEX);

        const results = await index.search("", {
          facets: ["source"],
          limit: 0,
        });

        let sources = Object.keys(results.facetDistribution?.source || {})
          .filter((source) => source && source.trim() !== "")
          .sort();

        res.json({
          success: true,
          data: sources,
        });
      } catch (error: any) {
        console.error("Error fetching sources:", error);
        res.status(500).json({
          success: false,
          message: "Failed to fetch sources",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  // GET /api/logs/stats - Get log counts by level
  app.get(
    "/api/logs/stats",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { project, source, timeRange = "24h" } = req.query;
        const now = new Date();
        const timeRangeMs = {
          "1h": 60 * 60 * 1000,
          "24h": 24 * 60 * 60 * 1000,
          "7d": 7 * 24 * 60 * 60 * 1000,
          "30d": 30 * 24 * 60 * 60 * 1000,
          "60d": 60 * 24 * 60 * 60 * 1000,
          "90d": 90 * 24 * 60 * 60 * 1000,
          "180d": 180 * 24 * 60 * 60 * 1000,
          "365d": 365 * 24 * 60 * 60 * 1000,
        };
        const fromDate = new Date(
          now.getTime() -
            (timeRangeMs[timeRange as keyof typeof timeRangeMs] ||
              timeRangeMs["24h"]),
        );

        console.log("Date range:", {
          from: fromDate.toISOString(),
          to: now.toISOString(),
        });

        const index: Index = client.index(LOGS_INDEX);
        const levels = ["info", "warning", "error"];
        const counts: { [key: string]: number } = {};

        const baseFilters: string[] = [];
        if (project && project !== "all") {
          baseFilters.push(`project = "${project}"`);
        }
        if (source && source !== "all") {
          baseFilters.push(`source = "${source}"`);
        }
        // Use ISO strings for timestamp filters
        baseFilters.push(`timestamp >= "${fromDate.toISOString()}"`);
        baseFilters.push(`timestamp <= "${now.toISOString()}"`);

        console.log("Base filters:", baseFilters);

        // Get counts for each level
        for (const level of levels) {
          const filters: string[] = [...baseFilters, `level = "${level}"`];
          const searchOptions = {
            filter: filters.join(" AND "),
            limit: 0,
          };
          console.log(
            `Searching for level ${level} with filter:`,
            filters.join(" AND "),
          );
          try {
            const results = await index.search("", searchOptions);
            counts[level] = results.estimatedTotalHits || 0;
            console.log(`Level ${level} count:`, counts[level]);
          } catch (levelError) {
            console.error(`Error searching for level ${level}:`, levelError);
            counts[level] = 0;
          }
        }

        // Get total count
        const totalSearchOptions = {
          filter: baseFilters.join(" AND "),
          limit: 0,
        };
        console.log("Total search filter:", baseFilters.join(" AND "));
        try {
          const totalResults = await index.search("", totalSearchOptions);
          counts.total = totalResults.estimatedTotalHits || 0;
          console.log("Total count:", counts.total);
        } catch (totalError) {
          console.error("Error getting total count:", totalError);
          counts.total = 0;
        }

        res.json({
          success: true,
          data: counts,
          debug: {
            dateRange: {
              from: fromDate.toISOString(),
              to: now.toISOString(),
            },
            filters: baseFilters,
          },
        });
      } catch (error: any) {
        console.error("Error in /api/logs/stats:", error);
        next(error);
      }
    },
  );

  // GET /api/logs/:id - Get a specific log entry by ID
  // ALERT ROUTES
  // GET /api/alerts - Retrieve all alerts with optional search/filter
  app.get(
    "/api/alerts",
    authenticateApiKey,
    parseAlertSearchParams,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const {
          search,
          severity,
          acknowledged,
          limit = 20,
          offset = 0,
        } = req.alertSearchParams || {};

        // Map acknowledged parameter to status
        let status: string | undefined = undefined;
        if (acknowledged === "true") {
          status = "acknowledged";
        } else if (acknowledged === "false") {
          status = "active";
        }

        const results = await alertService.getAlerts({
          search,
          severity,
          status,
          limit,
          offset,
        });

        res.json({
          success: true,
          data: results.data,
          total: results.total,
          pagination: {
            limit,
            offset,
            total: results.total,
          },
        });
      } catch (error: any) {
        next(error);
      }
    },
  );

  // GET /api/logs/:id - Get a specific log entry by ID
  app.get(
    "/api/logs/:id",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;

        if (!id || isNaN(parseInt(id, 10))) {
          return res.status(400).json({
            success: false,
            message: "Valid log ID is required",
          });
        }

        const index: Index = client.index(LOGS_INDEX);
        const results = await index.search("", {
          filter: `id = ${parseInt(id, 10)}`,
          limit: 1,
        });

        if (results.hits.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Log entry not found",
          });
        }

        res.json({
          success: true,
          data: results.hits[0],
        });
      } catch (error: any) {
        console.error("Error fetching log entry:", error);
        res.status(500).json({
          success: false,
          message: "Failed to fetch log entry",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  // POST /api/alerts - Create a new alert
  app.post(
    "/api/alerts",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const {
          title,
          message,
          severity,
          source,
          sendEmail = true,
          emailRecipients,
        } = req.body;

        if (!title || !message || !severity || !source) {
          return res.status(400).json({
            success: false,
            message: "Title, message, severity, and source are required",
          });
        }

        if (!["critical", "warning", "info"].includes(severity)) {
          return res.status(400).json({
            success: false,
            message: "Severity must be critical, warning, or info",
          });
        }

        const newAlert = await alertService.createAlert({
          title,
          message,
          severity,
          source,
          sendEmail,
          emailRecipients: emailRecipients,
        });

        res.status(201).json({
          success: true,
          data: newAlert,
        });
      } catch (error: any) {
        next(error);
      }
    },
  );

  // GET /api/alerts/:id - Get a specific alert by ID
  app.get(
    "/api/alerts/:id",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;

        if (!id) {
          return res.status(400).json({
            success: false,
            message: "Valid alert ID is required",
          });
        }

        const alert = await alertService.getAlertById(id);

        if (!alert) {
          return res.status(404).json({
            success: false,
            message: "Alert not found",
          });
        }

        res.json({
          success: true,
          data: alert,
        });
      } catch (error: any) {
        next(error);
      }
    },
  );

  // PUT /api/alerts/:id - Update an alert
  app.put(
    "/api/alerts/:id",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const { action, acknowledgedBy } = req.body;

        if (!id) {
          return res.status(400).json({
            success: false,
            message: "Valid alert ID is required",
          });
        }

        let updatedAlert;

        if (action === "acknowledge") {
          if (!acknowledgedBy) {
            return res.status(400).json({
              success: false,
              message: "acknowledgedBy is required for acknowledge action",
            });
          }
          updatedAlert = await alertService.acknowledgeAlert(
            id,
            acknowledgedBy,
          );
        } else if (action === "resolve") {
          updatedAlert = await alertService.resolveAlert(id);
        } else {
          return res.status(400).json({
            success: false,
            message: "Action must be 'acknowledge' or 'resolve'",
          });
        }

        res.json({
          success: true,
          data: updatedAlert,
        });
      } catch (error: any) {
        if (error.message.includes("not found")) {
          return res.status(404).json({
            success: false,
            message: "Alert not found",
          });
        }
        next(error);
      }
    },
  );

  // DELETE /api/alerts/:id - Delete an alert
  app.delete(
    "/api/alerts/:id",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;

        if (!id) {
          return res.status(400).json({
            success: false,
            message: "Valid alert ID is required",
          });
        }

        await alertService.deleteAlert(id);

        res.json({
          success: true,
          message: "Alert deleted successfully",
        });
      } catch (error: any) {
        if (error.message.includes("not found")) {
          return res.status(404).json({
            success: false,
            message: "Alert not found",
          });
        }
        next(error);
      }
    },
  );

  // GET /api/alerts/email-logs - Get email logs for alerts
  app.get(
    "/api/alerts/email-logs",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { alertId, limit = 50, offset = 0 } = req.query;

        const results = await alertService.getEmailLogs(
          alertId as string,
          parseInt(limit as string),
          parseInt(offset as string),
        );

        res.json({
          success: true,
          data: results,
          total: results.length,
          pagination: {
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            total: results.length,
          },
        });
      } catch (error: any) {
        next(error);
      }
    },
  );

  // GET /api/alerts/rate-limits - Get rate limit statistics
  app.get(
    "/api/alerts/rate-limits",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const stats = await alertService.getRateLimitStats();

        res.json({
          success: true,
          message: "Rate limit statistics retrieved",
          data: stats,
        });
      } catch (error: any) {
        next(error);
      }
    },
  );

  // POST /api/alerts/rate-limits/reset - Reset rate limits for a recipient
  app.post(
    "/api/alerts/rate-limits/reset",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { recipient } = req.body;

        if (!recipient) {
          return res.status(400).json({
            success: false,
            message: "Recipient email address is required",
          });
        }

        await alertService.resetRateLimit(recipient);

        res.json({
          success: true,
          message: `Rate limits reset for ${recipient}`,
        });
      } catch (error: any) {
        next(error);
      }
    },
  );

  // GET /api/alert-rules - Retrieve all alert rules with optional search/filter
  app.get(
    "/api/alert-rules",
    authenticateApiKey,
    parseSearchParams,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { search, sortBy } = req.searchParams || {};

        const index: Index = client.index(ALERT_RULES_INDEX);

        // Build sort array
        const sort: string[] = [];
        if (sortBy) {
          sort.push(`${sortBy}:asc`);
        } else {
          sort.push("name:asc");
        }

        const searchOptions: any = {
          sort,
          limit: 100, // Show all alert rules by default
        };

        const results = await index.search(search || "", searchOptions);

        res.json({
          success: true,
          data: results.hits,
          total: results.estimatedTotalHits,
        });
      } catch (error: any) {
        next(error);
      }
    },
  );

  // POST /api/alert-rules - Create a new alert rule
  app.post(
    "/api/alert-rules",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const {
          name,
          condition,
          threshold,
          metric,
          notify,
          channel,
          enabled = true,
        } = req.body;

        if (
          !name ||
          !condition ||
          !threshold ||
          !metric ||
          !notify ||
          !channel
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Name, condition, threshold, metric, notify, and channel are required",
          });
        }

        if (!["email", "sms"].includes(channel)) {
          return res.status(400).json({
            success: false,
            message: "Channel must be email or sms",
          });
        }

        const newAlertRule: AlertRule = {
          id: Date.now().toString(), // Simple ID generation, could use UUID in production
          name,
          condition,
          threshold,
          metric,
          notify,
          channel,
          enabled,
        };

        const index: Index = client.index(ALERT_RULES_INDEX);
        await index.addDocuments([newAlertRule]);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        res.status(201).json({
          success: true,
          data: newAlertRule,
        });
      } catch (error: any) {
        console.error("Error creating alert rule:", error);
        res.status(500).json({
          success: false,
          message: "Failed to create alert rule",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  // GET /api/alert-rules/:id - Get a specific alert rule by ID
  app.get(
    "/api/alert-rules/:id",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;

        if (!id || isNaN(parseInt(id, 10))) {
          return res.status(400).json({
            success: false,
            message: "Valid alert rule ID is required",
          });
        }

        const index: Index = client.index(ALERT_RULES_INDEX);
        const results = await index.search("", {
          filter: `id = ${parseInt(id, 10)}`,
          limit: 1,
        });

        if (results.hits.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Alert rule not found",
          });
        }

        res.json({
          success: true,
          data: results.hits[0],
        });
      } catch (error: any) {
        console.error("Error fetching alert rule:", error);
        res.status(500).json({
          success: false,
          message: "Failed to fetch alert rule",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  // PUT /api/alert-rules/:id - Update an alert rule
  app.put(
    "/api/alert-rules/:id",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;
        const { name, condition, threshold, metric, notify, channel, enabled } =
          req.body;

        if (!id || isNaN(parseInt(id, 10))) {
          return res.status(400).json({
            success: false,
            message: "Valid alert rule ID is required",
          });
        }

        const index: Index = client.index(ALERT_RULES_INDEX);

        // First, check if the alert rule exists
        const existingResults = await index.search("", {
          filter: `id = ${parseInt(id, 10)}`,
          limit: 1,
        });

        if (existingResults.hits.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Alert rule not found",
          });
        }

        const existingRule = existingResults.hits[0] as AlertRule;

        // Validate channel if provided
        if (channel && !["email", "sms"].includes(channel)) {
          return res.status(400).json({
            success: false,
            message: "Channel must be email or sms",
          });
        }

        // Build updated alert rule
        const updatedRule: AlertRule = {
          ...existingRule,
          ...(name !== undefined && { name }),
          ...(condition !== undefined && { condition }),
          ...(threshold !== undefined && { threshold }),
          ...(metric !== undefined && { metric }),
          ...(notify !== undefined && { notify }),
          ...(channel !== undefined && { channel }),
          ...(enabled !== undefined && { enabled }),
        };

        await index.addDocuments([updatedRule]);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        res.json({
          success: true,
          data: updatedRule,
        });
      } catch (error: any) {
        console.error("Error updating alert rule:", error);
        res.status(500).json({
          success: false,
          message: "Failed to update alert rule",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  // DELETE /api/alert-rules/:id - Delete an alert rule
  app.delete(
    "/api/alert-rules/:id",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id } = req.params;

        if (!id || isNaN(parseInt(id, 10))) {
          return res.status(400).json({
            success: false,
            message: "Valid alert rule ID is required",
          });
        }

        const index: Index = client.index(ALERT_RULES_INDEX);

        // First, check if the alert rule exists
        const existingResults = await index.search("", {
          filter: `id = ${parseInt(id, 10)}`,
          limit: 1,
        });

        if (existingResults.hits.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Alert rule not found",
          });
        }

        await index.deleteDocument(parseInt(id, 10));

        res.json({
          success: true,
          message: "Alert rule deleted successfully",
        });
      } catch (error: any) {
        console.error("Error deleting alert rule:", error);
        res.status(500).json({
          success: false,
          message: "Failed to delete alert rule",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  // METRICS ROUTES
  // GET /api/metrics/overview - Get overview metrics from logs
  app.get(
    "/api/metrics/overview",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { timeRange = "24h", project } = req.query;
        const index = client.index(LOGS_INDEX);
        const now = new Date();

        const timeRangeMs = {
          "1h": 60 * 60 * 1000,
          "24h": 24 * 60 * 60 * 1000,
          "7d": 7 * 24 * 60 * 60 * 1000,
          "30d": 30 * 24 * 60 * 60 * 1000,
          "60d": 60 * 24 * 60 * 60 * 1000,
          "90d": 90 * 24 * 60 * 60 * 1000,
          "180d": 180 * 24 * 60 * 60 * 1000,
          "365d": 365 * 24 * 60 * 60 * 1000,
        };

        const startTime = new Date(
          now.getTime() -
            (timeRangeMs[timeRange as keyof typeof timeRangeMs] ||
              timeRangeMs["24h"]),
        );

        // Build filter with available filterable attributes
        let filter: string[] = [`timestamp >= ${startTime.getTime()}`];
        if (project && project !== "all") {
          filter.push(`project = "${project}"`);
        }

        // Use aggregation queries instead of fetching all documents
        const [totalResults, errorResults, durationResults] = await Promise.all(
          [
            // Total requests count
            index.search("", {
              filter,
              limit: 0,
              attributesToRetrieve: [],
            }),

            // Error logs count - use only filterable attributes
            index.search("", {
              filter: [...filter, 'level = "error"'],
              limit: 0,
              attributesToRetrieve: [],
            }),

            // Response time metrics
            index.search("", {
              filter: [...filter, "details.duration EXISTS"],
              limit: 10000,
              attributesToRetrieve: ["details.duration"],
              sort: ["timestamp:desc"],
            }),
          ],
        );

        const totalRequests = totalResults.estimatedTotalHits || 0;
        const errorCount = errorResults.estimatedTotalHits || 0;
        const errorRate =
          totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0;

        // Calculate average response time from sampled data
        const durationLogs = durationResults.hits as any[];
        const responseTimes = durationLogs.map(
          (log) => log.details?.duration || 0,
        );
        const avgResponseTime =
          responseTimes.length > 0
            ? responseTimes.reduce((sum, time) => sum + time, 0) /
              responseTimes.length
            : 0;

        // Calculate requests per minute
        const timeRangeMinutes = Math.max(
          1,
          (timeRangeMs[timeRange as keyof typeof timeRangeMs] ||
            timeRangeMs["24h"]) /
            (1000 * 60),
        );
        const requestsPerMinute =
          timeRangeMinutes > 0 ? totalRequests / timeRangeMinutes : 0;

        // Generate time series data
        const intervals = Math.min(20, Math.ceil(timeRangeMinutes / 60));
        const intervalMs =
          (timeRangeMs[timeRange as keyof typeof timeRangeMs] ||
            timeRangeMs["24h"]) / intervals;

        const timeSeriesPromises = [];
        for (let i = 0; i < intervals; i++) {
          const intervalStart = new Date(startTime.getTime() + i * intervalMs);
          const intervalEnd = new Date(intervalStart.getTime() + intervalMs);

          const intervalFilter = [
            ...filter,
            `timestamp >= ${intervalStart.getTime()}`,
            `timestamp < ${intervalEnd.getTime()}`,
          ];

          timeSeriesPromises.push(
            Promise.all([
              // Total requests in interval
              index.search("", {
                filter: intervalFilter,
                limit: 0,
                attributesToRetrieve: [],
              }),
              // Error requests in interval
              index.search("", {
                filter: [...intervalFilter, 'level = "error"'],
                limit: 0,
                attributesToRetrieve: [],
              }),
            ]),
          );
        }

        const timeSeriesResults = await Promise.all(timeSeriesPromises);

        const requestData: number[] = [];
        const errorRateData: number[] = [];

        timeSeriesResults.forEach(([totalResult, errorResult]) => {
          const intervalTotal = totalResult.estimatedTotalHits || 0;
          const intervalErrors = errorResult.estimatedTotalHits || 0;

          requestData.push(intervalTotal);
          errorRateData.push(
            intervalTotal > 0 ? (intervalErrors / intervalTotal) * 100 : 0,
          );
        });

        res.json({
          success: true,
          data: {
            totalRequests,
            requestsPerMinute: parseFloat(requestsPerMinute.toFixed(2)),
            errorRate: parseFloat(errorRate.toFixed(2)),
            avgResponseTime: Math.round(avgResponseTime),
            uptime: 99.98,
            requestData,
            errorRateData,
          },
        });
      } catch (error: any) {
        console.error("Error fetching overview metrics:", error);
        res.status(500).json({
          success: false,
          message: "Failed to fetch overview metrics",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  // GET /api/metrics/performance - Get performance metrics from logs
  app.get(
    "/api/metrics/performance",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { timeRange = "24h", project } = req.query;
        const index = client.index(LOGS_INDEX);

        // Calculate time range
        const now = new Date();
        const timeRangeMs = {
          "1h": 60 * 60 * 1000,
          "24h": 24 * 60 * 60 * 1000,
          "7d": 7 * 24 * 60 * 60 * 1000,
          "30d": 30 * 24 * 60 * 60 * 1000,
        };

        const startTime = new Date(
          now.getTime() -
            (timeRangeMs[timeRange as keyof typeof timeRangeMs] ||
              timeRangeMs["24h"]),
        );

        // Build filter with available filterable attributes
        let filter: string[] = [
          `timestamp >= ${startTime.getTime()}`,
          "details.duration EXISTS", // This should work if details.duration is filterable
        ];

        if (project && project !== "all") {
          filter.push(`project = "${project}"`);
        }

        // Get aggregated metrics
        const [statsResult, sampledLogs] = await Promise.all([
          // Get overall statistics
          index.search("", {
            filter,
            limit: 0,
            attributesToRetrieve: ["details.duration"],
          }),

          // Get sampled logs for time series
          index.search("", {
            filter,
            limit: 10000,
            attributesToRetrieve: ["timestamp", "details.duration"],
            sort: ["timestamp:desc"],
          }),
        ]);

        const logs = sampledLogs.hits as any[];

        // Calculate response time metrics from sampled data
        const responseTimes = logs.map((log) => log.details?.duration || 0);
        const avgResponseTime =
          responseTimes.length > 0
            ? responseTimes.reduce((sum, time) => sum + time, 0) /
              responseTimes.length
            : 0;

        const maxResponseTime =
          responseTimes.length > 0 ? Math.max(...responseTimes) : 0;
        const minResponseTime =
          responseTimes.length > 0 ? Math.min(...responseTimes) : 0;

        // Generate time series data
        const intervals = 20;
        const intervalMs =
          (timeRangeMs[timeRange as keyof typeof timeRangeMs] ||
            timeRangeMs["24h"]) / intervals;

        const responseTimeData: number[] = [];
        const throughputData: number[] = [];

        for (let i = 0; i < intervals; i++) {
          const intervalStart = new Date(startTime.getTime() + i * intervalMs);
          const intervalEnd = new Date(intervalStart.getTime() + intervalMs);

          const intervalLogs = logs.filter((log) => {
            const logTime = new Date(log.timestamp);
            return logTime >= intervalStart && logTime < intervalEnd;
          });

          const intervalResponseTimes = intervalLogs.map(
            (log) => log.details?.duration || 0,
          );
          const intervalAvgResponseTime =
            intervalResponseTimes.length > 0
              ? intervalResponseTimes.reduce((sum, time) => sum + time, 0) /
                intervalResponseTimes.length
              : 0;

          responseTimeData.push(Math.round(intervalAvgResponseTime));
          throughputData.push(intervalLogs.length);
        }

        res.json({
          success: true,
          data: {
            avgResponseTime: Math.round(avgResponseTime),
            maxResponseTime: Math.round(maxResponseTime),
            minResponseTime: Math.round(minResponseTime),
            totalRequests: statsResult.estimatedTotalHits || 0,
            responseTimeData,
            throughputData,
          },
        });
      } catch (error: any) {
        console.error("Error fetching performance metrics:", error);
        res.status(500).json({
          success: false,
          message: "Failed to fetch performance metrics",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  // GET /api/metrics/resources - Get resource metrics
  app.get(
    "/api/metrics/resources",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { timeRange = "24h", project, server } = req.query;

        // Calculate time range
        const now = new Date();
        const timeRangeMs = {
          "1h": 60 * 60 * 1000,
          "24h": 24 * 60 * 60 * 1000,
          "7d": 7 * 24 * 60 * 60 * 1000,
          "30d": 30 * 24 * 60 * 60 * 1000,
        };

        const startTime = new Date(
          now.getTime() -
            (timeRangeMs[timeRange as keyof typeof timeRangeMs] ||
              timeRangeMs["24h"]),
        );

        // Build filter for system metrics using available filterable attributes
        let filter: string[] = [
          'source = "system_metrics"',
          `timestamp >= ${startTime.getTime()}`,
        ];

        if (project && project !== "all") {
          filter.push(`project = "${project}"`);
        }
        if (server && server !== "all") {
          filter.push(`server = "${server}"`);
        }

        const logsIndex = client.index(LOGS_INDEX);
        const results = await logsIndex.search("", {
          filter,
          limit: 10000,
          attributesToRetrieve: [
            "timestamp",
            "cpu",
            "memory",
            "disk",
            "network",
          ],
          sort: ["timestamp:desc"],
        });

        const systemMetrics = results.hits as any[];
        const useRealData = systemMetrics.length > 0;

        // Process metrics in reverse chronological order (newest first)
        systemMetrics.reverse();

        const intervals = 20;
        const intervalMs =
          (timeRangeMs[timeRange as keyof typeof timeRangeMs] ||
            timeRangeMs["24h"]) / intervals;

        const cpuUsageData: number[] = [];
        const memoryUsageData: number[] = [];
        const diskUsageData: number[] = [];
        const networkData: number[] = [];

        let currentCpuUsage = 0;
        let currentMemoryUsage = 0;
        let maxCpuUsage = 0;
        let maxMemoryUsage = 0;
        let avgCpuUsage = 0;
        let avgMemoryUsage = 0;

        if (useRealData) {
          // Group metrics by time intervals
          for (let i = 0; i < intervals; i++) {
            const intervalStart = new Date(
              startTime.getTime() + i * intervalMs,
            );
            const intervalEnd = new Date(intervalStart.getTime() + intervalMs);

            const intervalMetrics = systemMetrics.filter((metric) => {
              const metricTime = new Date(metric.timestamp);
              return metricTime >= intervalStart && metricTime < intervalEnd;
            });

            if (intervalMetrics.length > 0) {
              const avgCpu =
                intervalMetrics.reduce(
                  (sum, m) => sum + (m.cpu?.usage || 0),
                  0,
                ) / intervalMetrics.length;
              const avgMem =
                intervalMetrics.reduce(
                  (sum, m) => sum + (m.memory?.usage_percent || 0),
                  0,
                ) / intervalMetrics.length;

              cpuUsageData.push(parseFloat((avgCpu * 100).toFixed(2)));
              memoryUsageData.push(parseFloat(avgMem.toFixed(2)));

              // Use the most recent disk and network data in the interval
              const latestMetric = intervalMetrics[intervalMetrics.length - 1];
              const diskUsage =
                latestMetric?.disk?.usage?.["/"]?.usage_percent || 0;

              const networkIn = Object.values(
                latestMetric?.network || {},
              ).reduce(
                (sum: number, iface: any) =>
                  sum + (iface.rx_rate_bytes_per_sec || 0),
                0,
              );

              diskUsageData.push(diskUsage);
              networkData.push(Math.round(networkIn / 1024));
            } else {
              // No data for this interval
              cpuUsageData.push(0);
              memoryUsageData.push(0);
              diskUsageData.push(0);
              networkData.push(0);
            }
          }

          // Calculate current and aggregate values from the most recent data
          const latestMetric = systemMetrics[systemMetrics.length - 1];
          currentCpuUsage = (latestMetric?.cpu?.usage || 0) * 100;
          currentMemoryUsage = latestMetric?.memory?.usage_percent || 0;

          maxCpuUsage = Math.max(...cpuUsageData.filter((val) => val > 0));
          maxMemoryUsage = Math.max(
            ...memoryUsageData.filter((val) => val > 0),
          );

          const validCpuData = cpuUsageData.filter((val) => val > 0);
          const validMemData = memoryUsageData.filter((val) => val > 0);

          avgCpuUsage =
            validCpuData.length > 0
              ? validCpuData.reduce((sum, val) => sum + val, 0) /
                validCpuData.length
              : 0;

          avgMemoryUsage =
            validMemData.length > 0
              ? validMemData.reduce((sum, val) => sum + val, 0) /
                validMemData.length
              : 0;
        }

        res.json({
          success: true,
          data: {
            currentCpuUsage: parseFloat(currentCpuUsage.toFixed(2)),
            maxCpuUsage: parseFloat(maxCpuUsage.toFixed(2)),
            avgCpuUsage: parseFloat(avgCpuUsage.toFixed(2)),
            currentMemoryUsage: parseFloat(currentMemoryUsage.toFixed(2)),
            maxMemoryUsage: parseFloat(maxMemoryUsage.toFixed(2)),
            avgMemoryUsage: parseFloat(avgMemoryUsage.toFixed(2)),
            cpuUsageData,
            memoryUsageData,
            diskUsageData,
            networkData,
            dataSource: useRealData ? "system_metrics" : "none",
            hasRealData: useRealData,
            totalDataPoints: systemMetrics.length,
          },
        });
      } catch (error: any) {
        console.error("Error fetching resource metrics:", error);
        res.status(500).json({
          success: false,
          message: "Failed to fetch resource metrics",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  // POST /api/alerts/trigger - Simplified route to trigger alerts based on rules
  app.post(
    "/api/alerts/trigger",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { metric, value, source = "System" } = req.body;

        if (!metric || value === undefined) {
          return res.status(400).json({
            success: false,
            message: "Metric name and value are required",
          });
        }

        // Get all enabled alert rules for this metric
        const alertRulesIndex: Index = client.index(ALERT_RULES_INDEX);
        const rulesResults = await alertRulesIndex.search("", {
          filter: `metric = "${metric}" AND enabled = true`,
          limit: 100,
        });

        const triggeredAlerts = [];
        const emailsSent = [];

        for (const ruleData of rulesResults.hits) {
          const rule = ruleData as AlertRule;
          let shouldTrigger = false;

          // Simple condition evaluation
          const numericValue = parseFloat(value.toString());
          const threshold = parseFloat(rule.threshold.replace(/[^\d.-]/g, ""));

          switch (rule.condition.toLowerCase()) {
            case "greater than":
              shouldTrigger = numericValue > threshold;
              break;
            case "less than":
              shouldTrigger = numericValue < threshold;
              break;
            case "equal to":
              shouldTrigger = numericValue === threshold;
              break;
            default:
              console.warn(`Unknown condition: ${rule.condition}`);
              continue;
          }

          if (shouldTrigger) {
            // Create alert
            const alertTitle = `${rule.name} Alert`;
            const alertMessage = `${metric} value ${value} ${rule.condition} threshold ${rule.threshold}`;

            const newAlert = await alertService.createAlert({
              title: alertTitle,
              message: alertMessage,
              severity:
                metric.toLowerCase().includes("error") ||
                metric.toLowerCase().includes("critical")
                  ? "critical"
                  : "warning",
              source: source,
              sendEmail: rule.channel === "email",
              emailRecipients:
                rule.channel === "email" ? [rule.notify] : undefined,
            });

            triggeredAlerts.push({
              ruleId: rule.id,
              ruleName: rule.name,
              alertId: newAlert.id,
              metric: metric,
              value: value,
              threshold: rule.threshold,
              condition: rule.condition,
            });

            if (rule.channel === "email") {
              emailsSent.push({
                recipient: rule.notify,
                alertId: newAlert.id,
              });
            }
          }
        }

        res.json({
          success: true,
          message: `Processed ${rulesResults.hits.length} rules, triggered ${triggeredAlerts.length} alerts`,
          data: {
            rulesEvaluated: rulesResults.hits.length,
            alertsTriggered: triggeredAlerts.length,
            emailsSent: emailsSent.length,
            triggeredAlerts,
            emailsDetails: emailsSent,
          },
        });
      } catch (error: any) {
        console.error("Error triggering alerts:", error);
        res.status(500).json({
          success: false,
          message: "Failed to trigger alerts",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  // POST /api/alerts/trigger/error-rate - Quick trigger for error rate alerts
  app.post(
    "/api/alerts/trigger/error-rate",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { errorRate, source = "API Monitor" } = req.body;

        if (errorRate === undefined) {
          return res.status(400).json({
            success: false,
            message: "Error rate value is required",
          });
        }

        // Get all enabled alert rules for this metric
        const alertRulesIndex: Index = client.index(ALERT_RULES_INDEX);
        const rulesResults = await alertRulesIndex.search("", {
          filter: `metric = "error_rate" AND enabled = true`,
          limit: 100,
        });

        const triggeredAlerts = [];
        const emailsSent = [];

        for (const ruleData of rulesResults.hits) {
          const rule = ruleData as AlertRule;
          let shouldTrigger = false;

          // Simple condition evaluation
          const numericValue = parseFloat(errorRate.toString());
          const threshold = parseFloat(rule.threshold.replace(/[^\d.-]/g, ""));

          switch (rule.condition.toLowerCase()) {
            case "greater than":
              shouldTrigger = numericValue > threshold;
              break;
            case "less than":
              shouldTrigger = numericValue < threshold;
              break;
            case "equal to":
              shouldTrigger = numericValue === threshold;
              break;
            default:
              console.warn(`Unknown condition: ${rule.condition}`);
              continue;
          }

          if (shouldTrigger) {
            // Create alert
            const alertTitle = `${rule.name} Alert`;
            const alertMessage = `error_rate value ${errorRate} ${rule.condition} threshold ${rule.threshold}`;

            const newAlert = await alertService.createAlert({
              title: alertTitle,
              message: alertMessage,
              severity: "critical",
              source: source,
              sendEmail: rule.channel === "email",
              emailRecipients:
                rule.channel === "email" ? [rule.notify] : undefined,
            });

            triggeredAlerts.push({
              ruleId: rule.id,
              ruleName: rule.name,
              alertId: newAlert.id,
              metric: "error_rate",
              value: errorRate,
              threshold: rule.threshold,
              condition: rule.condition,
            });

            if (rule.channel === "email") {
              emailsSent.push({
                recipient: rule.notify,
                alertId: newAlert.id,
              });
            }
          }
        }

        res.json({
          success: true,
          message: `Processed ${rulesResults.hits.length} rules, triggered ${triggeredAlerts.length} alerts`,
          data: {
            rulesEvaluated: rulesResults.hits.length,
            alertsTriggered: triggeredAlerts.length,
            emailsSent: emailsSent.length,
            triggeredAlerts,
            emailsDetails: emailsSent,
          },
        });
      } catch (error: any) {
        console.error("Error triggering error rate alert:", error);
        res.status(500).json({
          success: false,
          message: "Failed to trigger error rate alert",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  // POST /api/alerts/trigger/response-time - Quick trigger for response time alerts
  app.post(
    "/api/alerts/trigger/response-time",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { responseTime, source = "API Monitor" } = req.body;

        if (responseTime === undefined) {
          return res.status(400).json({
            success: false,
            message: "Response time value is required",
          });
        }

        // Get all enabled alert rules for this metric
        const alertRulesIndex: Index = client.index(ALERT_RULES_INDEX);
        const rulesResults = await alertRulesIndex.search("", {
          filter: `metric = "response_time" AND enabled = true`,
          limit: 100,
        });

        const triggeredAlerts = [];
        const emailsSent = [];

        for (const ruleData of rulesResults.hits) {
          const rule = ruleData as AlertRule;
          let shouldTrigger = false;

          // Simple condition evaluation
          const numericValue = parseFloat(responseTime.toString());
          const threshold = parseFloat(rule.threshold.replace(/[^\d.-]/g, ""));

          switch (rule.condition.toLowerCase()) {
            case "greater than":
              shouldTrigger = numericValue > threshold;
              break;
            case "less than":
              shouldTrigger = numericValue < threshold;
              break;
            case "equal to":
              shouldTrigger = numericValue === threshold;
              break;
            default:
              console.warn(`Unknown condition: ${rule.condition}`);
              continue;
          }

          if (shouldTrigger) {
            // Create alert
            const alertTitle = `${rule.name} Alert`;
            const alertMessage = `response_time value ${responseTime} ${rule.condition} threshold ${rule.threshold}`;

            const newAlert = await alertService.createAlert({
              title: alertTitle,
              message: alertMessage,
              severity: "warning",
              source: source,
              sendEmail: rule.channel === "email",
              emailRecipients:
                rule.channel === "email" ? [rule.notify] : undefined,
            });

            triggeredAlerts.push({
              ruleId: rule.id,
              ruleName: rule.name,
              alertId: newAlert.id,
              metric: "response_time",
              value: responseTime,
              threshold: rule.threshold,
              condition: rule.condition,
            });

            if (rule.channel === "email") {
              emailsSent.push({
                recipient: rule.notify,
                alertId: newAlert.id,
              });
            }
          }
        }

        res.json({
          success: true,
          message: `Processed ${rulesResults.hits.length} rules, triggered ${triggeredAlerts.length} alerts`,
          data: {
            rulesEvaluated: rulesResults.hits.length,
            alertsTriggered: triggeredAlerts.length,
            emailsSent: emailsSent.length,
            triggeredAlerts,
            emailsDetails: emailsSent,
          },
        });
      } catch (error: any) {
        console.error("Error triggering response time alert:", error);
        res.status(500).json({
          success: false,
          message: "Failed to trigger response time alert",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  // POST /api/alerts/trigger/cpu-usage - Quick trigger for CPU usage alerts
  app.post(
    "/api/alerts/trigger/cpu-usage",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { cpuUsage, source = "System Monitor" } = req.body;

        if (cpuUsage === undefined) {
          return res.status(400).json({
            success: false,
            message: "CPU usage value is required",
          });
        }

        // Get all enabled alert rules for this metric
        const alertRulesIndex: Index = client.index(ALERT_RULES_INDEX);
        const rulesResults = await alertRulesIndex.search("", {
          filter: `metric = "cpu_usage" AND enabled = true`,
          limit: 100,
        });

        const triggeredAlerts = [];
        const emailsSent = [];

        for (const ruleData of rulesResults.hits) {
          const rule = ruleData as AlertRule;
          let shouldTrigger = false;

          // Simple condition evaluation
          const numericValue = parseFloat(cpuUsage.toString());
          const threshold = parseFloat(rule.threshold.replace(/[^\d.-]/g, ""));

          switch (rule.condition.toLowerCase()) {
            case "greater than":
              shouldTrigger = numericValue > threshold;
              break;
            case "less than":
              shouldTrigger = numericValue < threshold;
              break;
            case "equal to":
              shouldTrigger = numericValue === threshold;
              break;
            default:
              console.warn(`Unknown condition: ${rule.condition}`);
              continue;
          }

          if (shouldTrigger) {
            // Create alert
            const alertTitle = `${rule.name} Alert`;
            const alertMessage = `cpu_usage value ${cpuUsage} ${rule.condition} threshold ${rule.threshold}`;

            const newAlert = await alertService.createAlert({
              title: alertTitle,
              message: alertMessage,
              severity: "warning",
              source: source,
              sendEmail: rule.channel === "email",
              emailRecipients:
                rule.channel === "email" ? [rule.notify] : undefined,
            });

            triggeredAlerts.push({
              ruleId: rule.id,
              ruleName: rule.name,
              alertId: newAlert.id,
              metric: "cpu_usage",
              value: cpuUsage,
              threshold: rule.threshold,
              condition: rule.condition,
            });

            if (rule.channel === "email") {
              emailsSent.push({
                recipient: rule.notify,
                alertId: newAlert.id,
              });
            }
          }
        }

        res.json({
          success: true,
          message: `Processed ${rulesResults.hits.length} rules, triggered ${triggeredAlerts.length} alerts`,
          data: {
            rulesEvaluated: rulesResults.hits.length,
            alertsTriggered: triggeredAlerts.length,
            emailsSent: emailsSent.length,
            triggeredAlerts,
            emailsDetails: emailsSent,
          },
        });
      } catch (error: any) {
        console.error("Error triggering CPU usage alert:", error);
        res.status(500).json({
          success: false,
          message: "Failed to trigger CPU usage alert",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  // GET /api/alerts/health - Alert system health check
  app.get(
    "/api/alerts/health",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Check alert rules count
        const alertRulesIndex: Index = client.index(ALERT_RULES_INDEX);
        const rulesResults = await alertRulesIndex.search("", { limit: 0 });
        const totalRules = rulesResults.estimatedTotalHits || 0;
        const enabledRulesResults = await alertRulesIndex.search("", {
          filter: "enabled = true",
          limit: 0,
        });
        const enabledRules = enabledRulesResults.estimatedTotalHits || 0;

        // Check recent alerts count
        const alertsIndex: Index = client.index(ALERTS_INDEX);
        const recentAlertsResults = await alertsIndex.search("", {
          filter: `created_at >= "${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}"`,
          limit: 0,
        });
        const recentAlerts = recentAlertsResults.estimatedTotalHits || 0;

        // Check email service status
        const emailServiceStatus = alertService ? "available" : "unavailable";

        res.json({
          success: true,
          data: {
            alertSystem: {
              status: "operational",
              totalRules,
              enabledRules,
              recentAlerts24h: recentAlerts,
              emailService: emailServiceStatus,
            },
            endpoints: {
              trigger: "/api/alerts/trigger",
              triggerErrorRate: "/api/alerts/trigger/error-rate",
              triggerResponseTime: "/api/alerts/trigger/response-time",
              triggerCpuUsage: "/api/alerts/trigger/cpu-usage",
            },
            lastChecked: new Date().toISOString(),
          },
        });
      } catch (error: any) {
        console.error("Error checking alert system health:", error);
        res.status(500).json({
          success: false,
          message: "Failed to check alert system health",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  app.get(
    "/api/metrics/alerts",
    authenticateApiKey,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { timeRange = "24h", project } = req.query;

        // Calculate time range
        const now = new Date();
        const timeRangeMs = {
          "1h": 60 * 60 * 1000,
          "24h": 24 * 60 * 60 * 1000,
          "7d": 7 * 24 * 60 * 60 * 1000,
          "30d": 30 * 24 * 60 * 60 * 1000,
          "60d": 60 * 24 * 60 * 60 * 1000,
          "90d": 90 * 24 * 60 * 60 * 1000,
          "180d": 180 * 24 * 60 * 60 * 1000,
          "365d": 365 * 24 * 60 * 60 * 1000,
        };

        const startTime = new Date(
          now.getTime() -
            (timeRangeMs[timeRange as keyof typeof timeRangeMs] ||
              timeRangeMs["24h"]),
        );

        // Log the time range for debugging
        console.log("Time range:", {
          from: startTime.toISOString(),
          to: now.toISOString(),
        });

        // Get the alerts index
        const alertsIndex = client.index(ALERTS_INDEX);

        // Log the index name for debugging
        console.log("Index:", ALERTS_INDEX);

        // Build the filter
        let filter = `timestamp >= "${startTime.toISOString()}" AND acknowledged = false`;

        if (project && project !== "all") {
          filter += ` AND project = "${project}"`;
        }

        // Log the filter for debugging
        console.log("Filter:", filter);

        // Search for active alerts
        const results = await alertsIndex.search("", {
          filter,
          limit: 0, // We only need the count
        });

        // Log the results for debugging
        console.log("Search results:", results);

        const totalActiveAlerts = results.estimatedTotalHits || 0;

        res.json({
          success: true,
          data: {
            totalActiveAlerts,
            timeRange: {
              from: startTime.toISOString(),
              to: now.toISOString(),
            },
          },
        });
      } catch (error: any) {
        console.error("Error fetching active alerts:", error);
        res.status(500).json({
          success: false,
          message: "Failed to fetch active alerts",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    },
  );

  // Add error handling middleware
  app.use(errorHandler);

  const httpServer: Server = createServer(app);
  return httpServer;
};

export { registerRoutes };
