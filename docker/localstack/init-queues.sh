#!/usr/bin/env bash
set -euo pipefail

create_fifo_queue() {
  awslocal sqs create-queue --queue-name "$1" --attributes FifoQueue=true,ContentBasedDeduplication=false
}

configure_transaction_queue() {
  local queue_name="$1"
  local dlq_name="$2"
  local dlq_url
  local queue_url
  local dlq_arn
  local attributes

  dlq_url=$(awslocal sqs get-queue-url --queue-name "$dlq_name" --query QueueUrl --output text)
  queue_url=$(awslocal sqs get-queue-url --queue-name "$queue_name" --query QueueUrl --output text)
  dlq_arn=$(awslocal sqs get-queue-attributes --queue-url "$dlq_url" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)
  attributes=$(printf '{"RedrivePolicy":"{\\"deadLetterTargetArn\\":\\"%s\\",\\"maxReceiveCount\\":\\"5\\"}","ReceiveMessageWaitTimeSeconds":"20","VisibilityTimeout":"30"}' "$dlq_arn")

  awslocal sqs set-queue-attributes \
    --queue-url "$queue_url" \
    --attributes "$attributes"
}

for queue_name in wager-transactions-dlq.fifo wager-transactions.fifo wager-events.fifo wager-transactions-test-dlq.fifo wager-transactions-test.fifo wager-events-test.fifo; do
  create_fifo_queue "$queue_name"
done

configure_transaction_queue wager-transactions.fifo wager-transactions-dlq.fifo
configure_transaction_queue wager-transactions-test.fifo wager-transactions-test-dlq.fifo
