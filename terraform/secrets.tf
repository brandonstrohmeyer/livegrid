resource "random_id" "sheets_key_suffix" {
  count       = var.manage_sheets_api_key ? 1 : 0
  byte_length = 4

  keepers = {
    rotation = var.sheets_api_key_rotation_token
  }
}

resource "google_apikeys_key" "sheets" {
  count        = var.manage_sheets_api_key ? 1 : 0
  provider     = google-beta
  project      = local.project_id
  name         = "${local.workspace_name}-livegrid-sheets-${random_id.sheets_key_suffix[0].hex}"
  display_name = local.workspace_name == "production" ? "LiveGrid Sheets API Key" : "LiveGrid Development Sheets API Key"

  restrictions {
    api_targets {
      service = "sheets.googleapis.com"
    }
  }

  depends_on = [
    google_project_service.required["apikeys.googleapis.com"],
    google_project_service.required["sheets.googleapis.com"]
  ]

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_secret_manager_secret" "sheets_api_key" {
  count     = var.manage_sheets_api_key ? 1 : 0
  provider  = google-beta
  project   = local.project_id
  secret_id = "SHEETS_API_KEY"

  replication {
    auto {}
  }

  depends_on = [google_project_service.required["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "sheets_api_key" {
  count       = var.manage_sheets_api_key ? 1 : 0
  provider    = google-beta
  secret      = google_secret_manager_secret.sheets_api_key[0].id
  secret_data = google_apikeys_key.sheets[0].key_string

  lifecycle {
    create_before_destroy = true
  }
}
