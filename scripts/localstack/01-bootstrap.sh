#!/usr/bin/env bash
#
# LocalStack bootstrap — provisions the SNS/SQS topology and the S3 buckets the
# Rally API and worker expect.
#
# Runs automatically via the /etc/localstack/init/ready.d hook every time
# LocalStack becomes ready (mounted from ./scripts/localstack in
# docker-compose.dev.yml). Mirrors how db/init/ bootstraps Postgres.
#
# Idempotent: create-topic / create-queue / subscribe all return the existing
# resource if it already exists, so re-runs are safe.
#
# Topology (mirrors the Terraform in the rally-infra repo for real AWS):
#
#   SNS topic  rally-domain-events
#     └─ fan-out (raw message delivery) ─┬─→ SQS rally-notifications
#                                        ├─→ SQS rally-audit
#                                        ├─→ SQS rally-reporting
#                                        └─→ SQS rally-search
#
#   Each main queue redrives to <queue>-dlq after MAX_RECEIVE failed receives.
#
#   S3 buckets (mirrors the Cloudflare R2 buckets in platform/storage-*):
#     rally-attachments    — PRIVATE. Every permission-gated upload.
#     rally-public-assets  — PUBLIC. Avatars / logos only.
#
#   Without these, attachment upload could not be exercised locally at all,
#   which is how a frontend/backend contract mismatch went unnoticed.
#
# Names / account / region are kept in sync with .env (SNS_TOPIC_ARN, SQS_*_URL,
# S3_ATTACHMENTS_BUCKET, S3_PUBLIC_ASSETS_BUCKET).
set -euo pipefail

REGION="ap-southeast-1"
ACCOUNT="000000000000"
TOPIC_NAME="rally-domain-events"
MAX_RECEIVE=5
QUEUES=(rally-notifications rally-audit rally-reporting rally-search)
PRIVATE_BUCKET="rally-attachments"
PUBLIC_BUCKET="rally-public-assets"
# Vite dev server origin — the SPA PUTs directly to the bucket from here.
WEB_ORIGIN="http://localhost:5173"

echo "[localstack-init] provisioning SNS/SQS topology…"

TOPIC_ARN="$(awslocal sns create-topic --name "$TOPIC_NAME" --output text --query 'TopicArn')"
echo "[localstack-init]   topic: $TOPIC_ARN"

for queue in "${QUEUES[@]}"; do
  dlq="${queue}-dlq"
  dlq_arn="arn:aws:sqs:${REGION}:${ACCOUNT}:${dlq}"
  queue_arn="arn:aws:sqs:${REGION}:${ACCOUNT}:${queue}"

  # Dead-letter queue first — its ARN is referenced by the main queue's redrive policy.
  awslocal sqs create-queue --queue-name "$dlq" >/dev/null

  # RedrivePolicy's value is itself a JSON string, so it must be escaped inside
  # the --attributes JSON map (shorthand form can't express nested JSON).
  redrive="{\"deadLetterTargetArn\":\"${dlq_arn}\",\"maxReceiveCount\":\"${MAX_RECEIVE}\"}"
  awslocal sqs create-queue \
    --queue-name "$queue" \
    --attributes "{\"RedrivePolicy\":\"${redrive//\"/\\\"}\"}" \
    >/dev/null

  # Raw message delivery: the SQS body is the bare SNS message (no envelope),
  # which is what the consumers parse (see audit.consumer.ts message format).
  awslocal sns subscribe \
    --topic-arn "$TOPIC_ARN" \
    --protocol sqs \
    --notification-endpoint "$queue_arn" \
    --attributes RawMessageDelivery=true \
    >/dev/null

  echo "[localstack-init]   queue + subscription ready: $queue (dlq: $dlq)"
done

echo "[localstack-init] provisioning S3 buckets…"

for bucket in "$PRIVATE_BUCKET" "$PUBLIC_BUCKET"; do
  # create-bucket is not idempotent in the way create-queue is: it returns
  # BucketAlreadyOwnedByYou on re-run, which is harmless under `set -e` only if
  # we swallow it explicitly.
  awslocal s3api create-bucket \
    --bucket "$bucket" \
    --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION" \
    >/dev/null 2>&1 || true

  # CORS must mirror the R2 rules in platform/qnsc-infra/live/storage-*.
  # x-amz-checksum-sha256 is required: the presigned PUT binds the checksum into
  # its signature, so the browser must be allowed to send that header or every
  # upload fails preflight.
  awslocal s3api put-bucket-cors --bucket "$bucket" --cors-configuration "{
    \"CORSRules\": [{
      \"AllowedMethods\": [\"PUT\"],
      \"AllowedOrigins\": [\"${WEB_ORIGIN}\"],
      \"AllowedHeaders\": [\"Content-Type\", \"Content-Disposition\", \"x-amz-checksum-sha256\"],
      \"ExposeHeaders\": [\"ETag\"],
      \"MaxAgeSeconds\": 3600
    }]
  }" >/dev/null

  echo "[localstack-init]   bucket ready: $bucket"
done

# Abort incomplete multipart uploads so abandoned uploads don't accrue storage.
# Mirrors the lifecycle rule on the real R2 buckets.
awslocal s3api put-bucket-lifecycle-configuration --bucket "$PRIVATE_BUCKET" \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "abort-incomplete-multipart",
      "Status": "Enabled",
      "Filter": {"Prefix": ""},
      "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}
    }]
  }' >/dev/null

echo "[localstack-init] done."
