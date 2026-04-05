project_id                    = "livegrid-c33c6"
firebase_web_app_display_name = "LiveGrid"
firebase_hosting_site_id      = "livegrid-c33c6"
firebase_storage_bucket_id    = "livegrid-c33c6.firebasestorage.app"
monitoring_host               = "livegrid.stro.io"
manage_app_engine             = false
manage_sheets_api_key         = true
deploy_service_account_email  = "gitlab-ci@livegrid-c33c6.iam.gserviceaccount.com"

# Existing prod resource ids used by the one-time import manifest.
firebase_web_app_id             = "1:63136246686:web:c706734c4276f0be23848f"
firestore_ruleset_id            = "7850467f-3f2f-470c-9533-f2b14d61fcc6"
hosting_healthz_uptime_check_id = "projects/livegrid-c33c6/uptimeCheckConfigs/livegrid-hosting-healthz-rm97rNSuW7s"
api_health_uptime_check_id      = "projects/livegrid-c33c6/uptimeCheckConfigs/livegrid-api-health-I2rBVWLpOmU"
observability_dashboard_id      = "projects/livegrid-c33c6/dashboards/f41fa337-eb78-478c-b879-f4376a84fd9c"

# Confirm these match the existing production project before apply.
firestore_location_id  = "us-central1"
app_engine_location_id = "us-central"
