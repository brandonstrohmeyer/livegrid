resource "google_logging_metric" "notification_stuck" {
  name        = "livegrid_stuck_notifications"
  description = "Count of scheduled notifications skipped because non-pending (backlog)."
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"schedulednotificationdispatcher\" AND resource.labels.location=\"${var.region}\" AND jsonPayload.event=\"scheduler.skip_non_pending\""
}

resource "google_logging_metric" "notification_undeliverable" {
  name        = "livegrid_notification_undeliverable"
  description = "Count of undeliverable notifications."
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"schedulednotificationdispatcher\" AND resource.labels.location=\"${var.region}\" AND jsonPayload.event=\"scheduler.undeliverable\""
}

resource "google_logging_metric" "notification_errors" {
  name        = "livegrid_notification_errors"
  description = "Count of notification dispatch errors."
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"schedulednotificationdispatcher\" AND resource.labels.location=\"${var.region}\" AND jsonPayload.event=\"scheduler.dispatch_failed\""
}

resource "google_logging_metric" "notification_success" {
  name        = "livegrid_notification_success"
  description = "Count of successful notification dispatches."
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"schedulednotificationdispatcher\" AND resource.labels.location=\"${var.region}\" AND jsonPayload.event=\"scheduler.dispatch_result\" AND jsonPayload.successCount>0"
}

resource "google_logging_metric" "active_users_current" {
  name            = "livegrid_active_users_current"
  description     = "Current count of active signed-in users based on recent client heartbeats."
  filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.location=\"${var.region}\" AND jsonPayload.event=\"presence.active_user_count\""
  value_extractor = "EXTRACT(jsonPayload.count)"

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "1"
  }

  bucket_options {
    linear_buckets {
      num_finite_buckets = 100
      width              = 1
      offset             = 0
    }
  }
}

resource "google_monitoring_metric_descriptor" "active_users_current" {
  description  = "Current count of active signed-in users based on recent client heartbeats."
  display_name = "LiveGrid Active Users Current"
  type         = "custom.googleapis.com/livegrid/active_users_current"
  metric_kind  = "GAUGE"
  value_type   = "INT64"
  unit         = "1"
}

resource "google_monitoring_metric_descriptor" "users_with_pending_notifications" {
  description  = "Current count of users with registered notification tokens and at least one pending scheduled notification."
  display_name = "LiveGrid Users With Pending Notifications"
  type         = "custom.googleapis.com/livegrid/users_with_pending_notifications"
  metric_kind  = "GAUGE"
  value_type   = "INT64"
  unit         = "1"
}

resource "google_logging_metric" "client_errors" {
  name        = "livegrid_client_errors"
  description = "Count of client-side error telemetry events."
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.location=\"${var.region}\" AND jsonPayload.event=\"client.error\""
}

resource "google_logging_metric" "client_health_failures" {
  name        = "livegrid_client_health_failures"
  description = "Count of client-side health failures such as missing Firebase config."
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.location=\"${var.region}\" AND jsonPayload.event=\"client.health_failed\""
}

resource "google_logging_metric" "backend_health_failures" {
  name        = "livegrid_backend_health_failures"
  description = "Count of backend health check failures or degraded states."
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.location=\"${var.region}\" AND jsonPayload.event=\"system.health_failed\""
}

resource "google_logging_metric" "health_check_failures" {
  name        = "livegrid_health_check_failures"
  description = "Count of individual backend health check failures grouped by subsystem."
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.location=\"${var.region}\" AND jsonPayload.event=\"system.health_check_failed\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"

    labels {
      key         = "check"
      value_type  = "STRING"
      description = "The specific backend health check that failed."
    }

    labels {
      key         = "status"
      value_type  = "STRING"
      description = "The failing health check status."
    }
  }

  label_extractors = {
    check  = "EXTRACT(jsonPayload.check)"
    status = "EXTRACT(jsonPayload.checkStatus)"
  }
}

resource "google_logging_metric" "auth_health_failures" {
  name        = "livegrid_auth_health_failures"
  description = "Count of backend auth health check failures or degraded auth states."
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.location=\"${var.region}\" AND jsonPayload.event=\"system.auth_health_failed\""
}

resource "google_logging_metric" "client_auth_failures" {
  name        = "livegrid_client_auth_failures"
  description = "Count of client-side auth redirect failures reported through telemetry."
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.location=\"${var.region}\" AND jsonPayload.event=\"client.error\" AND jsonPayload.sourceEvent=\"auth.redirect_failed\""
}

resource "google_logging_metric" "client_telemetry_rejected" {
  name        = "livegrid_client_telemetry_rejected"
  description = "Count of rejected or rate-limited client telemetry requests."
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.location=\"${var.region}\" AND jsonPayload.event=\"client.telemetry_rejected\""
}

resource "google_logging_metric" "visitor_opened" {
  name        = "livegrid_visitor_opened"
  description = "Count of visitor session-open telemetry events."
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.location=\"${var.region}\" AND jsonPayload.event=\"visitor.opened\""
}

resource "google_logging_metric" "visitor_event_selected" {
  name        = "livegrid_visitor_event_selected"
  description = "Count of visitor event-selection telemetry events."
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.location=\"${var.region}\" AND jsonPayload.event=\"visitor.event_selected\""
}

resource "google_monitoring_metric_descriptor" "all_active_visitors_current" {
  description  = "Current count of all active LiveGrid visitors."
  display_name = "LiveGrid All Active Visitors Current"
  type         = "custom.googleapis.com/livegrid/all_active_visitors_current"
  metric_kind  = "GAUGE"
  value_type   = "INT64"
  unit         = "1"
}

resource "google_monitoring_metric_descriptor" "anonymous_active_visitors_current" {
  description  = "Current count of anonymous LiveGrid visitors."
  display_name = "LiveGrid Anonymous Active Visitors Current"
  type         = "custom.googleapis.com/livegrid/anonymous_active_visitors_current"
  metric_kind  = "GAUGE"
  value_type   = "INT64"
  unit         = "1"
}

resource "google_monitoring_metric_descriptor" "unique_interacting_visitors_24h" {
  description  = "Rolling 24-hour count of unique interacting LiveGrid visitors."
  display_name = "LiveGrid Unique Interacting Visitors 24h"
  type         = "custom.googleapis.com/livegrid/unique_interacting_visitors_24h"
  metric_kind  = "GAUGE"
  value_type   = "INT64"
  unit         = "1"
}

resource "google_monitoring_uptime_check_config" "hosting_healthz" {
  display_name = "LiveGrid Hosting Healthz"
  timeout      = "10s"
  period       = "300s"

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = local.project_id
      host       = local.monitoring_host
    }
  }

  http_check {
    path         = "/healthz.json"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  content_matchers {
    content = "\"status\": \"ok\""
    matcher = "CONTAINS_STRING"
  }
}

resource "google_monitoring_uptime_check_config" "api_health" {
  display_name = "LiveGrid API Health"
  timeout      = "10s"
  period       = "300s"

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = local.project_id
      host       = local.monitoring_host
    }
  }

  http_check {
    path         = "/api/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  content_matchers {
    content = "\"status\": \"ok\""
    matcher = "CONTAINS_STRING"
  }
}

resource "google_monitoring_dashboard" "observability" {
  dashboard_json = templatefile("${path.module}/../docs/observability-dashboard-health.json", {
    hosting_health_check_id = replace(google_monitoring_uptime_check_config.hosting_healthz.id, "projects/${local.project_id}/uptimeCheckConfigs/", "")
    api_health_check_id     = replace(google_monitoring_uptime_check_config.api_health.id, "projects/${local.project_id}/uptimeCheckConfigs/", "")
    project_id              = local.project_id
  })
}

resource "google_monitoring_dashboard" "usage_performance" {
  dashboard_json = file("${path.module}/../docs/observability-dashboard-usage.json")
}
