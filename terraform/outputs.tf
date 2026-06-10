output "firebase_web_app_id" {
  value       = google_firebase_web_app.web.app_id
  description = "Firebase web app id."
}

output "project_id" {
  value       = local.project_id
  description = "Active GCP project id for the selected workspace."
}

output "workspace_name" {
  value       = local.workspace_name
  description = "Normalized Terraform workspace name."
}

output "firebase_web_app_config" {
  value       = data.google_firebase_web_app_config.web
  description = "Firebase web app config (API key, auth domain, etc)."
  sensitive   = true
}

output "firebase_auth_authorized_domains" {
  value       = local.firebase_auth_authorized_domains
  description = "Firebase Auth authorized domains managed by Terraform."
}

output "firebase_auth_google_hosted_origins" {
  value = [
    for domain in local.firebase_auth_authorized_domains :
    "https://${domain}"
    if !contains(["localhost", "127.0.0.1"], domain)
  ]
  description = "Hosted JavaScript origins to use if you manually create a Google OAuth web client."
}

output "firebase_auth_google_hosted_redirect_uris" {
  value = [
    for domain in local.firebase_auth_authorized_domains :
    "https://${domain}/__/auth/handler"
    if !contains(["localhost", "127.0.0.1"], domain)
  ]
  description = "Hosted redirect URIs to use if you manually create a Google OAuth web client."
}

output "sheets_api_key_secret_name" {
  value       = var.manage_sheets_api_key ? google_secret_manager_secret.sheets_api_key[0].secret_id : null
  description = "Secret Manager secret id for the deployed Sheets API key."
}

output "sheets_api_key_resource_name" {
  value       = var.manage_sheets_api_key ? google_apikeys_key.sheets[0].id : null
  description = "Resource name of the managed Sheets API key."
}
