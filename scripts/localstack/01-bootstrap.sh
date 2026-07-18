#!/usr/bin/env bash
#
# LocalStack bootstrap — provisions the SNS/SQS topology the Rally worker expects.
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
# Names / account / region are kept in sync with .env (SNS_TOPIC_ARN, SQS_*_URL).
set -euo pipefail

REGION="ap-southeast-1"
ACCOUNT="000000000000"
TOPIC_NAME="rally-domain-events"
MAX_RECEIVE=5
QUEUES=(rally-notifications rally-audit rally-reporting rally-search)

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

echo "[localstack-init] done."
