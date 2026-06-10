resource "google_identity_platform_config" "default" {
  provider = google-beta
  project  = local.project_id

  authorized_domains         = local.firebase_auth_authorized_domains
  autodelete_anonymous_users = false

  multi_tenant {
    allow_tenants = false
  }

  sign_in {
    allow_duplicate_emails = false

    email {
      enabled           = true
      password_required = true
    }

    phone_number {
      enabled            = false
      test_phone_numbers = {}
    }
  }

  depends_on = [
    google_project_service.required["identitytoolkit.googleapis.com"],
    google_firebase_project.default
  ]
}

resource "google_identity_platform_default_supported_idp_config" "google" {
  provider = google-beta
  count    = local.manage_google_sign_in ? 1 : 0

  project       = local.project_id
  idp_id        = "google.com"
  enabled       = true
  client_id     = var.firebase_auth_google_client_id
  client_secret = var.firebase_auth_google_client_secret

  depends_on = [google_identity_platform_config.default]
}
