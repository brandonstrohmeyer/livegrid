locals {
  workspace_name                = contains(["default", "development", "dev"], terraform.workspace) ? "development" : contains(["production", "prod"], terraform.workspace) ? "production" : terraform.workspace
  project_id                    = var.project_id
  firebase_web_app_display_name = coalesce(var.firebase_web_app_display_name, local.workspace_name == "production" ? "LiveGrid" : "LiveGrid Development")
  firebase_hosting_site_id      = coalesce(var.firebase_hosting_site_id, local.project_id)
  firebase_storage_bucket_id    = coalesce(var.firebase_storage_bucket_id, "${local.project_id}.firebasestorage.app")
  monitoring_host               = coalesce(var.monitoring_host, local.workspace_name == "production" ? "livegrid.stro.io" : "${local.project_id}.web.app")
  firebase_auth_authorized_domains = distinct(compact(concat([
    "localhost",
    "127.0.0.1",
    "${local.project_id}.firebaseapp.com",
    "${local.project_id}.web.app",
    local.firebase_hosting_site_id == local.project_id ? "" : "${local.firebase_hosting_site_id}.web.app",
    local.monitoring_host
  ], var.firebase_auth_authorized_domains)))
  manage_google_sign_in = trimspace(var.firebase_auth_google_client_id) != "" && trimspace(var.firebase_auth_google_client_secret) != ""
}
