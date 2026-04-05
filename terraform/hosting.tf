resource "google_firebase_hosting_site" "default" {
  provider = google-beta
  project  = local.project_id
  site_id  = local.firebase_hosting_site_id
  app_id   = google_firebase_web_app.web.app_id

  depends_on = [google_project_service.required["firebasehosting.googleapis.com"]]
}
