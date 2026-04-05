resource "google_firestore_database" "default" {
  provider    = google-beta
  project     = local.project_id
  name        = "(default)"
  location_id = var.firestore_location_id
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.required["firestore.googleapis.com"]]
}
