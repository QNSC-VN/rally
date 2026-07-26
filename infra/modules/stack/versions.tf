// No `backend` block and no `provider` blocks: a module inherits both from its
// caller. Provider REQUIREMENTS are declared so a caller cannot satisfy this module
// with an incompatible major version.
terraform {
  required_version = ">= 1.9"
  required_providers {
    aws        = { source = "hashicorp/aws", version = "~> 5.0" }
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.0" }
  }
}
