#!/usr/bin/env bash
set -euo pipefail

awslocal sqs create-queue --queue-name wager-transactions-dlq.fifo --attributes FifoQueue=true,ContentBasedDeduplication=false
awslocal sqs create-queue --queue-name wager-transactions.fifo --attributes FifoQueue=true,ContentBasedDeduplication=false
awslocal sqs create-queue --queue-name wager-events.fifo --attributes FifoQueue=true,ContentBasedDeduplication=false

DLQ_URL=$(awslocal sqs get-queue-url --queue-name wager-transactions-dlq.fifo --query QueueUrl --output text)
QUEUE_URL=$(awslocal sqs get-queue-url --queue-name wager-transactions.fifo --query QueueUrl --output text)
DLQ_ARN=$(awslocal sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal sqs set-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attributes "RedrivePolicy={\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"5\"},ReceiveMessageWaitTimeSeconds=20,VisibilityTimeout=30"
