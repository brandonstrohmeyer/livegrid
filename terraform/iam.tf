data "google_project" "current" {
  project_id = local.project_id
}

resource "google_project_iam_member" "compute_default_cloudbuild_builder" {
  project = local.project_id
  role    = "roles/cloudbuild.builds.builder"
  member  = "serviceAccount:${data.google_project.current.number}-compute@developer.gserviceaccount.com"
}

resource "google_project_iam_member" "compute_default_firestore_user" {
  project = local.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${data.google_project.current.number}-compute@developer.gserviceaccount.com"
}

resource "google_project_iam_member" "compute_default_editor_dev" {
  count   = local.workspace_name == "development" ? 1 : 0
  project = local.project_id
  role    = "roles/editor"
  member  = "serviceAccount:${data.google_project.current.number}-compute@developer.gserviceaccount.com"
}

resource "google_service_account_iam_member" "app_engine_default_service_account_user" {
  count              = var.manage_app_engine && var.deploy_service_account_email != "" ? 1 : 0
  service_account_id = "projects/${local.project_id}/serviceAccounts/${local.project_id}@appspot.gserviceaccount.com"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.deploy_service_account_email}"

  depends_on = [google_app_engine_application.default]
}

resource "google_service_account_iam_member" "compute_default_service_account_user" {
  count              = var.deploy_service_account_email != "" ? 1 : 0
  service_account_id = "projects/${local.project_id}/serviceAccounts/${data.google_project.current.number}-compute@developer.gserviceaccount.com"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.deploy_service_account_email}"

  depends_on = [google_project_service.required["compute.googleapis.com"]]
}

resource "google_project_iam_member" "deploy_service_usage_consumer" {
  count   = var.deploy_service_account_email != "" ? 1 : 0
  project = local.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = "serviceAccount:${var.deploy_service_account_email}"
}

resource "google_project_iam_member" "deploy_cloudfunctions_admin" {
  count   = var.deploy_service_account_email != "" ? 1 : 0
  project = local.project_id
  role    = "roles/cloudfunctions.admin"
  member  = "serviceAccount:${var.deploy_service_account_email}"
}

resource "google_project_iam_member" "deploy_firebase_hosting_admin" {
  count   = var.deploy_service_account_email != "" ? 1 : 0
  project = local.project_id
  role    = "roles/firebasehosting.admin"
  member  = "serviceAccount:${var.deploy_service_account_email}"
}

resource "google_project_iam_member" "deploy_cloudscheduler_admin" {
  count   = var.deploy_service_account_email != "" ? 1 : 0
  project = local.project_id
  role    = "roles/cloudscheduler.admin"
  member  = "serviceAccount:${var.deploy_service_account_email}"
}

resource "google_project_iam_member" "deploy_api_keys_viewer" {
  count   = var.deploy_service_account_email != "" ? 1 : 0
  project = local.project_id
  role    = "roles/serviceusage.apiKeysViewer"
  member  = "serviceAccount:${var.deploy_service_account_email}"
}

resource "google_project_iam_member" "deploy_project_viewer" {
  count   = var.deploy_service_account_email != "" ? 1 : 0
  project = local.project_id
  role    = "roles/viewer"
  member  = "serviceAccount:${var.deploy_service_account_email}"
}

resource "google_project_iam_member" "deploy_firebase_admin" {
  count   = var.deploy_service_account_email != "" ? 1 : 0
  project = local.project_id
  role    = "roles/firebase.admin"
  member  = "serviceAccount:${var.deploy_service_account_email}"
}

resource "google_secret_manager_secret_iam_member" "deploy_sheets_secret_viewer" {
  count     = var.deploy_service_account_email != "" && var.manage_sheets_api_key ? 1 : 0
  project   = local.project_id
  secret_id = google_secret_manager_secret.sheets_api_key[0].secret_id
  role      = "roles/secretmanager.viewer"
  member    = "serviceAccount:${var.deploy_service_account_email}"
}
