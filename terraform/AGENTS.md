# Terraform Agent Notes

## Execution

- Terraform is applied locally; there is no GitHub Actions Terraform plan/apply pipeline in this repo.
- Always run `terraform plan` before suggesting or running `terraform apply`.
- Do not apply Terraform unless the user explicitly asks for it.

## State

- Backend: GCS bucket `stro-livegrid-tfstate`, prefix `terraform/state`.

## Workspaces

- Use Terraform workspace `dev` for the development Firebase/GCP project.
- Use Terraform workspace `prod` for the production Firebase/GCP project.
- Do not use `development` or `production` as the workspace names for normal operations.

## Commands

```bash
terraform init

terraform workspace select dev
terraform plan -var-file=development.tfvars
terraform apply -var-file=development.tfvars

terraform workspace select prod
terraform plan -var-file=production.tfvars
terraform apply -var-file=production.tfvars
```

## Local Google Cloud Auth

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project livegrid-dev-7acfc
gcloud auth application-default set-quota-project livegrid-dev-7acfc
```

- For production Terraform, use project `livegrid-c33c6` for both the active project and ADC quota project.

## Firebase Auth / Google Sign-In

- Terraform manages the base Firebase Auth config and authorized domains.
- Google sign-in provider management is optional and only active when both variables are set:
  - `TF_VAR_firebase_auth_google_client_id`
  - `TF_VAR_firebase_auth_google_client_secret`
- If those values are not provided, use Terraform outputs for manual Firebase console setup:
  - `firebase_auth_google_hosted_origins`
  - `firebase_auth_google_hosted_redirect_uris`
