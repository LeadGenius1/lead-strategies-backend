-- Add Admin Tables Only
-- This script ONLY adds new tables, does not modify existing ones

-- Admin Users table
CREATE TABLE IF NOT EXISTS "admin_users" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) UNIQUE NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "role" VARCHAR(50) DEFAULT 'admin',
    "permissions" TEXT[] DEFAULT '{}',
    "mfa_enabled" BOOLEAN DEFAULT false,
    "mfa_secret" VARCHAR(255),
    "last_login_at" TIMESTAMP,
    "last_login_ip" VARCHAR(50),
    "failed_logins" INTEGER DEFAULT 0,
    "locked_until" TIMESTAMP,
    "created_by" UUID,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Admin Audit Logs table
CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "admin_user_id" UUID NOT NULL REFERENCES "admin_users"("id"),
    "action" VARCHAR(100) NOT NULL,
    "resource" VARCHAR(100),
    "resource_id" VARCHAR(100),
    "details" JSONB,
    "ip_address" VARCHAR(50),
    "user_agent" TEXT,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Admin Sessions table
CREATE TABLE IF NOT EXISTS "admin_sessions" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "admin_user_id" UUID NOT NULL,
    "token" VARCHAR(500) UNIQUE NOT NULL,
    "ip_address" VARCHAR(50),
    "user_agent" TEXT,
    "expires_at" TIMESTAMP NOT NULL,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- System Health Metrics table
CREATE TABLE IF NOT EXISTS "system_health_metrics" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "metric_name" VARCHAR(100) NOT NULL,
    "metric_value" DECIMAL(15,4) NOT NULL,
    "metric_unit" VARCHAR(50),
    "component" VARCHAR(50) NOT NULL,
    "severity" VARCHAR(20) DEFAULT 'normal',
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Diagnostic Reports table
CREATE TABLE IF NOT EXISTS "diagnostic_reports" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "alert_id" UUID,
    "issue_type" VARCHAR(100) NOT NULL,
    "root_cause" TEXT,
    "evidence" JSONB,
    "ai_analysis" TEXT,
    "ai_model" VARCHAR(100),
    "confidence_score" DECIMAL(3,2),
    "suggested_fix" TEXT,
    "severity" VARCHAR(20),
    "affected_users" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Repair History table
CREATE TABLE IF NOT EXISTS "repair_history" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "diagnostic_id" UUID REFERENCES "diagnostic_reports"("id"),
    "repair_type" VARCHAR(100) NOT NULL,
    "fix_applied" TEXT,
    "fix_code" TEXT,
    "success" BOOLEAN NOT NULL,
    "time_to_fix_seconds" INTEGER,
    "verification_result" JSONB,
    "rollback_plan" TEXT,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Learning Patterns table
CREATE TABLE IF NOT EXISTS "learning_patterns" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "pattern_hash" VARCHAR(64) UNIQUE NOT NULL,
    "symptoms" JSONB NOT NULL,
    "root_cause" TEXT,
    "solution" TEXT,
    "success_count" INTEGER DEFAULT 0,
    "failure_count" INTEGER DEFAULT 0,
    "avg_fix_time_seconds" INTEGER,
    "auto_fix_enabled" BOOLEAN DEFAULT false,
    "last_applied_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Predictions table
CREATE TABLE IF NOT EXISTS "predictions" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "prediction_type" VARCHAR(50) NOT NULL,
    "predicted_issue" TEXT,
    "predicted_time" TIMESTAMP,
    "confidence" DECIMAL(3,2),
    "data_points" JSONB,
    "proactive_action" TEXT,
    "action_taken" BOOLEAN DEFAULT false,
    "outcome" VARCHAR(50),
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Security Incidents table
CREATE TABLE IF NOT EXISTS "security_incidents" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "threat_type" VARCHAR(100) NOT NULL,
    "severity" VARCHAR(20),
    "source_ip" VARCHAR(50),
    "target_endpoint" VARCHAR(255),
    "payload" TEXT,
    "user_id" UUID,
    "mitigation_action" TEXT,
    "blocked" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Performance Metrics table
CREATE TABLE IF NOT EXISTS "performance_metrics" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "metric_type" VARCHAR(50) NOT NULL,
    "endpoint" VARCHAR(255),
    "query_hash" VARCHAR(64),
    "value_ms" DECIMAL(10,2),
    "percentile_95" DECIMAL(10,2),
    "percentile_99" DECIMAL(10,2),
    "sample_count" INTEGER,
    "optimization_applied" TEXT,
    "improvement_percent" DECIMAL(5,2),
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- System Alerts table
CREATE TABLE IF NOT EXISTS "system_alerts" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "alert_type" VARCHAR(100) NOT NULL,
    "component" VARCHAR(50),
    "message" TEXT,
    "severity" VARCHAR(20),
    "threshold_value" DECIMAL(15,4),
    "actual_value" DECIMAL(15,4),
    "acknowledged" BOOLEAN DEFAULT false,
    "acknowledged_by" UUID,
    "resolved" BOOLEAN DEFAULT false,
    "resolved_at" TIMESTAMP,
    "auto_resolved" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_admin_user_id" ON "admin_audit_logs"("admin_user_id");
CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_action" ON "admin_audit_logs"("action");
CREATE INDEX IF NOT EXISTS "idx_admin_audit_logs_created_at" ON "admin_audit_logs"("created_at");
CREATE INDEX IF NOT EXISTS "idx_admin_sessions_token" ON "admin_sessions"("token");
CREATE INDEX IF NOT EXISTS "idx_admin_sessions_admin_user_id" ON "admin_sessions"("admin_user_id");
CREATE INDEX IF NOT EXISTS "idx_system_health_metrics_name" ON "system_health_metrics"("metric_name", "created_at");
CREATE INDEX IF NOT EXISTS "idx_system_alerts_resolved" ON "system_alerts"("resolved");
CREATE INDEX IF NOT EXISTS "idx_system_alerts_severity" ON "system_alerts"("severity");

SELECT 'Admin tables created successfully!' as result;
