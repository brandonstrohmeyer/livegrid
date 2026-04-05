resource "google_firebase_project" "default" {
  provider = google-beta
  project  = local.project_id

  depends_on = [
    google_project_service.required["serviceusage.googleapis.com"],
    google_project_service.required["firebase.googleapis.com"]
  ]
}

resource "google_firebase_web_app" "web" {
  provider        = google-beta
  project         = local.project_id
  display_name    = local.firebase_web_app_display_name
  deletion_policy = "ABANDON"

  depends_on = [google_firebase_project.default]
}

data "google_firebase_web_app_config" "web" {
  provider   = google-beta
  web_app_id = google_firebase_web_app.web.app_id
}
