resource "google_firebaserules_ruleset" "firestore" {
  project = local.project_id

  source {
    files {
      name    = "firestore.rules"
      content = file("${path.root}/../firestore.rules")
    }
  }

  depends_on = [google_project_service.required["firebaserules.googleapis.com"]]
}

resource "google_firebaserules_release" "firestore" {
  project      = local.project_id
  name         = "cloud.firestore"
  ruleset_name = "projects/${local.project_id}/rulesets/${google_firebaserules_ruleset.firestore.name}"

  depends_on = [google_firebaserules_ruleset.firestore]
}
