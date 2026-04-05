resource "google_app_engine_application" "default" {
  count       = var.manage_app_engine ? 1 : 0
  provider    = google-beta
  project     = local.project_id
  location_id = var.app_engine_location_id

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required["appengine.googleapis.com"]]
}

# Default Firebase Storage bootstrap is intentionally unmanaged here.
#
# Firebase no longer supports provisioning the default Storage bucket for new
# projects via Terraform. We still enable the relevant APIs in services.tf; if
# the project needs a default bucket, create it via Firebase's supported flow
# outside Terraform and import it later if we decide to manage it.
