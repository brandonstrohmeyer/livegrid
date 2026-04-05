terraform {
  backend "gcs" {
    bucket = "stro-livegrid-tfstate"
    prefix = "terraform/state"
  }
}
