resource "google_firestore_field" "scheduled_notifications_expires_at" {
  provider   = google-beta
  project    = local.project_id
  database   = "(default)"
  collection = "scheduledNotifications"
  field      = "expiresAt"

  ttl_config {}

  depends_on = [
    google_project_service.required["firestore.googleapis.com"],
    google_firestore_database.default
  ]
}

resource "google_firestore_field" "visitor_telemetry_expires_at" {
  provider   = google-beta
  project    = local.project_id
  database   = "(default)"
  collection = "visitorTelemetry"
  field      = "expiresAt"

  ttl_config {}

  depends_on = [
    google_project_service.required["firestore.googleapis.com"],
    google_firestore_database.default
  ]
}
