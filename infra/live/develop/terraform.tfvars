# live/develop/terraform.tfvars.example
# ─────────────────────────────────────────────────────────────────────────────
# Copy to terraform.tfvars (git-ignored) and fill in your values.
# ─────────────────────────────────────────────────────────────────────────────

# ACM certificate for the ALB HTTPS listener — must be in ap-southeast-1
# Request via: aws acm request-certificate --region ap-southeast-1 \
#   --domain-name api-dev.yourdomain.com --validation-method DNS
acm_cert_arn = "arn:aws:acm:ap-southeast-1:074487692297:certificate/16527e4f-8c01-4209-a1c2-34d64491ae5c"

# ACM certificate for CloudFront — MUST be in us-east-1 (global CloudFront requirement)
# Request via: aws acm request-certificate --region us-east-1 \
#   --domain-name app-dev.yourdomain.com --validation-method DNS
web_acm_cert_arn = "arn:aws:acm:us-east-1:074487692297:certificate/4a36b6fb-95b0-45ed-a927-4195b400e96b"

# Microsoft Entra (Azure AD) SSO — optional; leave empty ("") to disable SSO
# Find in Azure Portal → App registrations → your app → Overview
entra_tenant_id = "dc0f2078-ac28-4ff2-b21a-d4b28df32361"
entra_client_id = "45fabceb-e51c-446b-894e-af4c4b7f30f8"
