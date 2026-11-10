-- CreateEnum
CREATE TYPE "role" AS ENUM ('CUSTOMER', 'ADMIN', 'COMPLIANCE', 'TREASURY', 'SUPPORT', 'PARTNER');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "kyc_tier" AS ENUM ('TIER_0', 'TIER_1', 'TIER_2');

-- CreateEnum
CREATE TYPE "kyc_status" AS ENUM ('NONE', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "risk_level" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "kyc_case_status" AS ENUM ('SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'RESUBMIT_REQUESTED');

-- CreateEnum
CREATE TYPE "kyc_id_type" AS ENUM ('PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE', 'VOTER_CARD', 'RESIDENCE_PERMIT');

-- CreateEnum
CREATE TYPE "kyc_document_kind" AS ENUM ('ID_FRONT', 'ID_BACK', 'SELFIE', 'PROOF_OF_ADDRESS');

-- CreateEnum
CREATE TYPE "provider_environment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "provider_status" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "health_status" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'DOWN');

-- CreateEnum
CREATE TYPE "provider_secret_kind" AS ENUM ('CREDENTIALS', 'WEBHOOK_SECRET');

-- CreateEnum
CREATE TYPE "rail_status" AS ENUM ('PLANNED', 'ACTIVE');

-- CreateEnum
CREATE TYPE "wallet_type" AS ENUM ('CUSTOMER', 'MERCHANT', 'AGENT', 'PARTNER');

-- CreateEnum
CREATE TYPE "wallet_status" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ledger_account_type" AS ENUM ('WALLET', 'FEE_REVENUE', 'FX_REVENUE', 'FX_POSITION', 'SUSPENSE', 'SETTLEMENT', 'COMMISSION_EXPENSE', 'COMMISSION_PAYABLE', 'CAPITAL');

-- CreateEnum
CREATE TYPE "entry_direction" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "journal_kind" AS ENUM ('TRANSFER', 'RESERVE', 'RELEASE', 'REFUND', 'REVERSAL', 'TOPUP', 'COMMISSION', 'SETTLEMENT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "transfer_type" AS ENUM ('W2W', 'W2M', 'W2A', 'INTERNATIONAL', 'TOPUP');

-- CreateEnum
CREATE TYPE "transfer_status" AS ENUM ('PROCESSING', 'ON_HOLD', 'COMPLETED', 'FAILED', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "delivery_method" AS ENUM ('WALLET', 'MOBILE_MONEY');

-- CreateEnum
CREATE TYPE "transfer_channel" AS ENUM ('WEB', 'API', 'ADMIN', 'SEED');

-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('ACTIVE', 'USED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "aml_rule_type" AS ENUM ('AMOUNT_THRESHOLD', 'VELOCITY_COUNT', 'VELOCITY_VALUE', 'STRUCTURING', 'NEW_ACCOUNT_HIGH_VALUE', 'HIGH_RISK_CORRIDOR', 'SANCTIONS_MATCH');

-- CreateEnum
CREATE TYPE "aml_action" AS ENUM ('FLAG', 'HOLD');

-- CreateEnum
CREATE TYPE "aml_alert_status" AS ENUM ('OPEN', 'ESCALATED', 'DISMISSED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "aml_case_status" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RELEASED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "sar_status" AS ENUM ('DRAFT', 'FILED');

-- CreateEnum
CREATE TYPE "sanctions_entry_type" AS ENUM ('SANCTION', 'PEP');

-- CreateEnum
CREATE TYPE "partner_type" AS ENUM ('PARTNER', 'MERCHANT', 'AGENT');

-- CreateEnum
CREATE TYPE "partner_status" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "commission_status" AS ENUM ('ACCRUED', 'SETTLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "settlement_status" AS ENUM ('PENDING', 'PAID');

-- CreateEnum
CREATE TYPE "webhook_delivery_status" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "provider_webhook_status" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "audit_outcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "audit_actor_type" AS ENUM ('USER', 'API_KEY', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "role" NOT NULL DEFAULT 'CUSTOMER',
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "country_code" CHAR(2),
    "date_of_birth" DATE,
    "address_line" TEXT,
    "city" TEXT,
    "occupation" TEXT,
    "kyc_tier" "kyc_tier" NOT NULL DEFAULT 'TIER_0',
    "kyc_status" "kyc_status" NOT NULL DEFAULT 'NONE',
    "risk_score" INTEGER NOT NULL DEFAULT 0,
    "risk_level" "risk_level" NOT NULL DEFAULT 'LOW',
    "risk_factors" JSONB,
    "risk_assessed_at" TIMESTAMPTZ(6),
    "pep_match" BOOLEAN NOT NULL DEFAULT false,
    "sanctions_match" BOOLEAN NOT NULL DEFAULT false,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret_enc" TEXT,
    "mfa_enabled_at" TIMESTAMPTZ(6),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "partner_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "mfa_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "user_id" UUID,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_type" "audit_actor_type" NOT NULL DEFAULT 'USER',
    "actor_id" UUID,
    "actor_label" TEXT,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "outcome" "audit_outcome" NOT NULL DEFAULT 'SUCCESS',
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "data" JSONB,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "kyc_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "status" "kyc_case_status" NOT NULL DEFAULT 'SUBMITTED',
    "target_tier" "kyc_tier" NOT NULL,
    "vendor" TEXT NOT NULL,
    "vendor_ref" TEXT,
    "vendor_decision" TEXT,
    "vendor_score" INTEGER,
    "vendor_result" JSONB,
    "id_type" "kyc_id_type" NOT NULL,
    "id_number" TEXT NOT NULL,
    "id_country" CHAR(2) NOT NULL,
    "reviewer_id" UUID,
    "review_note" TEXT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kyc_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "kyc_document_kind" NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "nickname" TEXT,
    "country_code" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" "delivery_method" NOT NULL,
    "account_number" TEXT NOT NULL,
    "provider_id" UUID,
    "relationship" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "dial_code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "stage" TEXT NOT NULL DEFAULT 'core',
    "risk_level" "risk_level" NOT NULL DEFAULT 'LOW',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "rails" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "rail_status" NOT NULL DEFAULT 'PLANNED',
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "adapter" TEXT NOT NULL DEFAULT 'simulator',
    "environment" "provider_environment" NOT NULL DEFAULT 'SANDBOX',
    "base_url" TEXT,
    "callback_url" TEXT,
    "config" JSONB,
    "credentials_version" INTEGER NOT NULL DEFAULT 0,
    "webhook_secret_version" INTEGER NOT NULL DEFAULT 0,
    "status" "provider_status" NOT NULL DEFAULT 'ACTIVE',
    "health_status" "health_status" NOT NULL DEFAULT 'UNKNOWN',
    "last_health_check_at" TIMESTAMPTZ(6),
    "last_latency_ms" INTEGER,
    "supports_payout" BOOLEAN NOT NULL DEFAULT true,
    "supports_collection" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_secrets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "kind" "provider_secret_kind" NOT NULL,
    "version" INTEGER NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL,
    "hint" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMPTZ(6),

    CONSTRAINT "provider_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_health_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "status" "health_status" NOT NULL,
    "latency_ms" INTEGER,
    "message" TEXT,
    "checked_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "provider_webhook_status" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "transfer_id" UUID,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "provider_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "wallet_type" NOT NULL DEFAULT 'CUSTOMER',
    "status" "wallet_status" NOT NULL DEFAULT 'ACTIVE',
    "currency" CHAR(3) NOT NULL,
    "user_id" UUID,
    "partner_id" UUID,
    "ledger_account_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ledger_account_type" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "normal_side" "entry_direction" NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "allow_negative" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_thresholds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID NOT NULL,
    "low_balance" BIGINT NOT NULL,
    "critical_balance" BIGINT NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "treasury_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "journal_kind" NOT NULL,
    "description" TEXT NOT NULL,
    "transfer_id" UUID,
    "reverses_journal_id" UUID,
    "created_by_id" UUID,
    "metadata" JSONB,
    "posted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "journal_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "direction" "entry_direction" NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "balance_after" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transfer_type" "transfer_type",
    "currency" CHAR(3) NOT NULL,
    "source_country" CHAR(2),
    "target_country" CHAR(2),
    "fixed_amount" BIGINT NOT NULL DEFAULT 0,
    "percent_bps" INTEGER NOT NULL DEFAULT 0,
    "min_fee" BIGINT,
    "max_fee" BIGINT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fee_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "base_currency" CHAR(3) NOT NULL,
    "quote_currency" CHAR(3) NOT NULL,
    "mid_rate" DECIMAL(24,10) NOT NULL,
    "margin_bps" INTEGER NOT NULL DEFAULT 150,
    "source" TEXT NOT NULL DEFAULT 'seed',
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "partner_id" UUID,
    "type" "transfer_type" NOT NULL,
    "delivery_method" "delivery_method" NOT NULL,
    "source_country" CHAR(2) NOT NULL,
    "target_country" CHAR(2) NOT NULL,
    "source_currency" CHAR(3) NOT NULL,
    "target_currency" CHAR(3) NOT NULL,
    "send_amount" BIGINT NOT NULL,
    "fee_amount" BIGINT NOT NULL,
    "fx_margin_amount" BIGINT NOT NULL,
    "total_debit" BIGINT NOT NULL,
    "receive_amount" BIGINT NOT NULL,
    "mid_rate" DECIMAL(24,10) NOT NULL,
    "customer_rate" DECIMAL(24,10) NOT NULL,
    "margin_bps" INTEGER NOT NULL,
    "fee_rule_id" UUID,
    "status" "quote_status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" TEXT NOT NULL,
    "type" "transfer_type" NOT NULL,
    "status" "transfer_status" NOT NULL,
    "delivery_method" "delivery_method" NOT NULL,
    "channel" "transfer_channel" NOT NULL DEFAULT 'WEB',
    "sender_user_id" UUID,
    "sender_partner_id" UUID,
    "sender_wallet_id" UUID,
    "recipient_user_id" UUID,
    "recipient_wallet_id" UUID,
    "beneficiary_id" UUID,
    "sender_name" TEXT NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "recipient_account" TEXT NOT NULL,
    "provider_id" UUID,
    "provider_ref" TEXT,
    "source_country" CHAR(2) NOT NULL,
    "target_country" CHAR(2) NOT NULL,
    "source_currency" CHAR(3) NOT NULL,
    "target_currency" CHAR(3) NOT NULL,
    "send_amount" BIGINT NOT NULL,
    "fee_amount" BIGINT NOT NULL,
    "fx_margin_amount" BIGINT NOT NULL DEFAULT 0,
    "total_debit" BIGINT NOT NULL,
    "receive_amount" BIGINT NOT NULL,
    "mid_rate" DECIMAL(24,10) NOT NULL,
    "customer_rate" DECIMAL(24,10) NOT NULL,
    "margin_bps" INTEGER NOT NULL DEFAULT 0,
    "send_amount_usd" BIGINT NOT NULL,
    "revenue_usd" BIGINT NOT NULL DEFAULT 0,
    "quote_id" UUID,
    "purpose" TEXT,
    "source_of_funds" TEXT,
    "note" TEXT,
    "partner_id" UUID,
    "commission_amount" BIGINT NOT NULL DEFAULT 0,
    "idempotency_scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "aml_score" INTEGER NOT NULL DEFAULT 0,
    "aml_flags" JSONB,
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "reversed_at" TIMESTAMPTZ(6),

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transfer_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aml_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "aml_rule_type" NOT NULL,
    "params" JSONB NOT NULL,
    "severity" "risk_level" NOT NULL DEFAULT 'MEDIUM',
    "score" INTEGER NOT NULL DEFAULT 20,
    "action" "aml_action" NOT NULL DEFAULT 'FLAG',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "aml_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aml_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "transfer_id" UUID,
    "case_id" UUID,
    "rule_code" TEXT NOT NULL,
    "rule_type" "aml_rule_type" NOT NULL,
    "severity" "risk_level" NOT NULL,
    "score" INTEGER NOT NULL,
    "action" "aml_action" NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "status" "aml_alert_status" NOT NULL DEFAULT 'OPEN',
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aml_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aml_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" TEXT NOT NULL,
    "subject_user_id" UUID,
    "transfer_id" UUID,
    "status" "aml_case_status" NOT NULL DEFAULT 'OPEN',
    "priority" "risk_level" NOT NULL DEFAULT 'MEDIUM',
    "summary" TEXT NOT NULL,
    "assigned_to_id" UUID,
    "opened_by_id" UUID,
    "resolution" TEXT,
    "closed_by_id" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "aml_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aml_case_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "author_id" UUID,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aml_case_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sar_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "status" "sar_status" NOT NULL DEFAULT 'DRAFT',
    "narrative" TEXT NOT NULL,
    "reference" TEXT,
    "regulator" TEXT,
    "created_by_id" UUID,
    "filed_by_id" UUID,
    "filed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sar_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sanctions_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "list_name" TEXT NOT NULL,
    "type" "sanctions_entry_type" NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "country_code" CHAR(2),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sanctions_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "type" "partner_type" NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "country_code" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT,
    "website" TEXT,
    "description" TEXT,
    "status" "partner_status" NOT NULL DEFAULT 'PENDING',
    "commission_bps" INTEGER NOT NULL DEFAULT 0,
    "reviewed_by_id" UUID,
    "review_note" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partner_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "secret_enc" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "endpoint_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "status" "webhook_delivery_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "response_status" INTEGER,
    "response_body" TEXT,
    "error" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(6),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partner_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "bps" INTEGER NOT NULL,
    "status" "commission_status" NOT NULL DEFAULT 'ACCRUED',
    "settlement_id" UUID,
    "journal_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" TEXT NOT NULL,
    "partner_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "commission_count" INTEGER NOT NULL,
    "status" "settlement_status" NOT NULL DEFAULT 'PENDING',
    "period_start" TIMESTAMPTZ(6),
    "period_end" TIMESTAMPTZ(6),
    "journal_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(6),

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_kyc_status_idx" ON "users"("kyc_status");

-- CreateIndex
CREATE INDEX "users_country_code_idx" ON "users"("country_code");

-- CreateIndex
CREATE INDEX "users_partner_id_idx" ON "users"("partner_id");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "login_attempts_email_created_at_idx" ON "login_attempts"("email", "created_at");

-- CreateIndex
CREATE INDEX "login_attempts_ip_created_at_idx" ON "login_attempts"("ip", "created_at");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_expires_at_idx" ON "rate_limit_buckets"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "kyc_cases_user_id_idx" ON "kyc_cases"("user_id");

-- CreateIndex
CREATE INDEX "kyc_cases_status_submitted_at_idx" ON "kyc_cases"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "kyc_documents_case_id_idx" ON "kyc_documents"("case_id");

-- CreateIndex
CREATE INDEX "kyc_documents_user_id_idx" ON "kyc_documents"("user_id");

-- CreateIndex
CREATE INDEX "beneficiaries_user_id_idx" ON "beneficiaries"("user_id");

-- CreateIndex
CREATE INDEX "countries_enabled_idx" ON "countries"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "rails_code_key" ON "rails"("code");

-- CreateIndex
CREATE UNIQUE INDEX "providers_code_key" ON "providers"("code");

-- CreateIndex
CREATE INDEX "providers_country_code_idx" ON "providers"("country_code");

-- CreateIndex
CREATE INDEX "providers_status_idx" ON "providers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "provider_secrets_provider_id_kind_version_key" ON "provider_secrets"("provider_id", "kind", "version");

-- CreateIndex
CREATE INDEX "provider_health_checks_provider_id_created_at_idx" ON "provider_health_checks"("provider_id", "created_at");

-- CreateIndex
CREATE INDEX "provider_webhook_events_received_at_idx" ON "provider_webhook_events"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_webhook_events_provider_id_event_id_key" ON "provider_webhook_events"("provider_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_ledger_account_id_key" ON "wallets"("ledger_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_currency_key" ON "wallets"("user_id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_partner_id_currency_key" ON "wallets"("partner_id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");

-- CreateIndex
CREATE INDEX "ledger_accounts_type_currency_idx" ON "ledger_accounts"("type", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_thresholds_account_id_key" ON "treasury_thresholds"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "journals_reverses_journal_id_key" ON "journals"("reverses_journal_id");

-- CreateIndex
CREATE INDEX "journals_transfer_id_idx" ON "journals"("transfer_id");

-- CreateIndex
CREATE INDEX "journals_posted_at_idx" ON "journals"("posted_at");

-- CreateIndex
CREATE INDEX "ledger_entries_journal_id_idx" ON "ledger_entries"("journal_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_created_at_idx" ON "ledger_entries"("account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fee_rules_code_key" ON "fee_rules"("code");

-- CreateIndex
CREATE INDEX "fee_rules_currency_active_idx" ON "fee_rules"("currency", "active");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_base_currency_quote_currency_key" ON "fx_rates"("base_currency", "quote_currency");

-- CreateIndex
CREATE INDEX "quotes_user_id_created_at_idx" ON "quotes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "quotes_status_expires_at_idx" ON "quotes"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_reference_key" ON "transfers"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_quote_id_key" ON "transfers"("quote_id");

-- CreateIndex
CREATE INDEX "transfers_sender_user_id_created_at_idx" ON "transfers"("sender_user_id", "created_at");

-- CreateIndex
CREATE INDEX "transfers_recipient_user_id_created_at_idx" ON "transfers"("recipient_user_id", "created_at");

-- CreateIndex
CREATE INDEX "transfers_sender_partner_id_created_at_idx" ON "transfers"("sender_partner_id", "created_at");

-- CreateIndex
CREATE INDEX "transfers_partner_id_created_at_idx" ON "transfers"("partner_id", "created_at");

-- CreateIndex
CREATE INDEX "transfers_status_created_at_idx" ON "transfers"("status", "created_at");

-- CreateIndex
CREATE INDEX "transfers_created_at_idx" ON "transfers"("created_at");

-- CreateIndex
CREATE INDEX "transfers_provider_id_provider_ref_idx" ON "transfers"("provider_id", "provider_ref");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_idempotency_scope_idempotency_key_key" ON "transfers"("idempotency_scope", "idempotency_key");

-- CreateIndex
CREATE INDEX "transfer_events_transfer_id_created_at_idx" ON "transfer_events"("transfer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "aml_rules_code_key" ON "aml_rules"("code");

-- CreateIndex
CREATE INDEX "aml_alerts_status_created_at_idx" ON "aml_alerts"("status", "created_at");

-- CreateIndex
CREATE INDEX "aml_alerts_user_id_idx" ON "aml_alerts"("user_id");

-- CreateIndex
CREATE INDEX "aml_alerts_transfer_id_idx" ON "aml_alerts"("transfer_id");

-- CreateIndex
CREATE INDEX "aml_alerts_case_id_idx" ON "aml_alerts"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "aml_cases_reference_key" ON "aml_cases"("reference");

-- CreateIndex
CREATE INDEX "aml_cases_status_created_at_idx" ON "aml_cases"("status", "created_at");

-- CreateIndex
CREATE INDEX "aml_cases_subject_user_id_idx" ON "aml_cases"("subject_user_id");

-- CreateIndex
CREATE INDEX "aml_cases_transfer_id_idx" ON "aml_cases"("transfer_id");

-- CreateIndex
CREATE INDEX "aml_case_notes_case_id_created_at_idx" ON "aml_case_notes"("case_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sar_reports_reference_key" ON "sar_reports"("reference");

-- CreateIndex
CREATE INDEX "sar_reports_case_id_idx" ON "sar_reports"("case_id");

-- CreateIndex
CREATE INDEX "sar_reports_status_idx" ON "sar_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sanctions_entries_code_key" ON "sanctions_entries"("code");

-- CreateIndex
CREATE INDEX "sanctions_entries_active_idx" ON "sanctions_entries"("active");

-- CreateIndex
CREATE UNIQUE INDEX "partners_code_key" ON "partners"("code");

-- CreateIndex
CREATE INDEX "partners_type_status_idx" ON "partners"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_partner_id_idx" ON "api_keys"("partner_id");

-- CreateIndex
CREATE INDEX "webhook_endpoints_partner_id_idx" ON "webhook_endpoints"("partner_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpoint_id_created_at_idx" ON "webhook_deliveries"("endpoint_id", "created_at");

-- CreateIndex
CREATE INDEX "commissions_partner_id_status_idx" ON "commissions"("partner_id", "status");

-- CreateIndex
CREATE INDEX "commissions_settlement_id_idx" ON "commissions"("settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_partner_id_transfer_id_key" ON "commissions"("partner_id", "transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_reference_key" ON "settlements"("reference");

-- CreateIndex
CREATE INDEX "settlements_partner_id_created_at_idx" ON "settlements"("partner_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_cases" ADD CONSTRAINT "kyc_cases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "kyc_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "providers" ADD CONSTRAINT "providers_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_secrets" ADD CONSTRAINT "provider_secrets_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_health_checks" ADD CONSTRAINT "provider_health_checks_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_webhook_events" ADD CONSTRAINT "provider_webhook_events_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_ledger_account_id_fkey" FOREIGN KEY ("ledger_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_thresholds" ADD CONSTRAINT "treasury_thresholds_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_reverses_journal_id_fkey" FOREIGN KEY ("reverses_journal_id") REFERENCES "journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_sender_partner_id_fkey" FOREIGN KEY ("sender_partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_sender_wallet_id_fkey" FOREIGN KEY ("sender_wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_recipient_wallet_id_fkey" FOREIGN KEY ("recipient_wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_events" ADD CONSTRAINT "transfer_events_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aml_alerts" ADD CONSTRAINT "aml_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aml_alerts" ADD CONSTRAINT "aml_alerts_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aml_alerts" ADD CONSTRAINT "aml_alerts_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "aml_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aml_cases" ADD CONSTRAINT "aml_cases_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aml_cases" ADD CONSTRAINT "aml_cases_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aml_case_notes" ADD CONSTRAINT "aml_case_notes_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "aml_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sar_reports" ADD CONSTRAINT "sar_reports_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "aml_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written integrity guards (not expressible in the Prisma schema).
-- ---------------------------------------------------------------------------

-- Money movement rule 3: wallets (allow_negative = false) can never go below zero.
ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_balance_non_negative" CHECK ("allow_negative" OR "balance" >= 0);

-- Entries are strictly positive amounts with a direction.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "transfers"
  ADD CONSTRAINT "transfers_amounts_non_negative" CHECK (
    "send_amount" > 0 AND "fee_amount" >= 0 AND "fx_margin_amount" >= 0
    AND "receive_amount" > 0 AND "total_debit" > 0 AND "commission_amount" >= 0
  );

ALTER TABLE "wallets"
  ADD CONSTRAINT "wallets_single_owner" CHECK (
    ("user_id" IS NOT NULL AND "partner_id" IS NULL) OR ("user_id" IS NULL AND "partner_id" IS NOT NULL)
  );

-- Money movement rule 7: audit rows, journals, ledger entries and timeline events are append-only.
CREATE OR REPLACE FUNCTION birem_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (% rejected)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION birem_reject_mutation();
CREATE TRIGGER "journals_append_only" BEFORE UPDATE OR DELETE ON "journals"
  FOR EACH ROW EXECUTE FUNCTION birem_reject_mutation();
CREATE TRIGGER "ledger_entries_append_only" BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION birem_reject_mutation();
CREATE TRIGGER "transfer_events_append_only" BEFORE UPDATE OR DELETE ON "transfer_events"
  FOR EACH ROW EXECUTE FUNCTION birem_reject_mutation();

-- Money movement rule 2: every journal is balanced per currency. Checked at commit time so a
-- journal can be inserted entry by entry inside one transaction.
CREATE OR REPLACE FUNCTION birem_check_journal_balanced() RETURNS trigger AS $$
DECLARE
  unbalanced_currency text;
BEGIN
  SELECT e."currency" INTO unbalanced_currency
  FROM "ledger_entries" e
  WHERE e."journal_id" = NEW."journal_id"
  GROUP BY e."currency"
  HAVING SUM(CASE WHEN e."direction" = 'DEBIT' THEN e."amount" ELSE 0 END)
      <> SUM(CASE WHEN e."direction" = 'CREDIT' THEN e."amount" ELSE 0 END)
  LIMIT 1;
  IF unbalanced_currency IS NOT NULL THEN
    RAISE EXCEPTION 'journal % is not balanced in %', NEW."journal_id", unbalanced_currency
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ledger_entries_journal_balanced"
  AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION birem_check_journal_balanced();
