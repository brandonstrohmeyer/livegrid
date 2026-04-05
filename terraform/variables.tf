variable "project_id" {
  type        = string
  description = "Optional override for the GCP project id. Defaults from the active Terraform workspace."
  default     = null
}

variable "region" {
  type        = string
  description = "Primary region for regional Google Cloud resources."
  default     = "us-central1"
}

variable "firebase_web_app_display_name" {
  type        = string
  description = "Optional override for the Firebase web app display name."
  default     = null
}

variable "firebase_hosting_site_id" {
  type        = string
  description = "Optional override for the Firebase Hosting site id."
  default     = null
}

variable "firebase_storage_bucket_id" {
  type        = string
  description = "Optional override for the Firebase Storage bucket id."
  default     = null
}

variable "firestore_location_id" {
  type        = string
  description = "Firestore location id (e.g., nam5, us-central)."
}

variable "app_engine_location_id" {
  type        = string
  description = "App Engine location id for default Firebase Storage bucket provisioning."
}

variable "manage_app_engine" {
  type        = bool
  description = "Whether Terraform should manage the App Engine application bootstrap for this environment."
  default     = true
}

variable "monitoring_host" {
  type        = string
  description = "Optional override for the host monitored by uptime checks."
  default     = null
}

variable "manage_sheets_api_key" {
  type        = bool
  description = "Whether Terraform should create the Sheets API key and Secret Manager secret version for this environment."
  default     = false
}

variable "deploy_service_account_email" {
  type        = string
  description = "Service account email used by CI/CD deploys. When set, Terraform grants it Service Account User on the default runtime service accounts managed for this environment."
  default     = ""
}

variable "firebase_web_app_id" {
  type        = string
  description = "Existing Firebase web app id used only for imports."
  default     = ""
}

variable "firestore_ruleset_id" {
  type        = string
  description = "Existing Firestore ruleset id used only for imports."
  default     = ""
}

variable "sheets_api_key_rotation_token" {
  type        = string
  description = "Change this token to force Terraform to mint a new Sheets API key name and rotate the Secret Manager version."
  default     = "initial"
}

variable "required_services" {
  type        = set(string)
  description = "APIs that must be enabled for LiveGrid."
  default = [
    "serviceusage.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "appengine.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "firebaserules.googleapis.com",
    "firestore.googleapis.com",
    "firebasestorage.googleapis.com",
    "identitytoolkit.googleapis.com",
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "run.googleapis.com",
    "eventarc.googleapis.com",
    "pubsub.googleapis.com",
    "cloudscheduler.googleapis.com",
    "storage.googleapis.com",
    "compute.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "secretmanager.googleapis.com",
    "apikeys.googleapis.com",
    "cloudbilling.googleapis.com",
    "sheets.googleapis.com"
  ]
}

variable "hosting_healthz_uptime_check_id" {
  type        = string
  description = "Existing uptime check config id for /healthz.json imports."
  default     = ""
}

variable "api_health_uptime_check_id" {
  type        = string
  description = "Existing uptime check config id for /api/health imports."
  default     = ""
}

variable "observability_dashboard_id" {
  type        = string
  description = "Existing monitoring dashboard id used only for imports."
  default     = ""
}
