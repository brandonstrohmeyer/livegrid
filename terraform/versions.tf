terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.26, < 7.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = ">= 5.26, < 7.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.4, < 3.0"
    }
    null = {
      source  = "hashicorp/null"
      version = ">= 3.2, < 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6, < 4.0"
    }
  }
}
