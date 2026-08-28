"""Budget-triggered, idempotent workload lockdown for the supermarket stack."""

import json
import os
from datetime import datetime, timezone

import boto3


lambda_client = boto3.client("lambda")
events_client = boto3.client("events")
pipes_client = boto3.client("pipes")
scheduler_client = boto3.client("scheduler")
sfn_client = boto3.client("stepfunctions")
ssm_client = boto3.client("ssm")
ses_client = boto3.client("sesv2")


def env_json(name):
    return json.loads(os.environ.get(name, "[]"))


def threshold_from_record(record):
    try:
        message = json.loads(record["Sns"]["Message"])
    except (KeyError, TypeError, json.JSONDecodeError):
        return None

    detail = message.get("detail") if isinstance(message.get("detail"), dict) else {}
    raw_threshold = message.get(
        "Threshold",
        message.get("threshold", detail.get("Threshold", detail.get("threshold"))),
    )
    try:
        return float(raw_threshold)
    except (TypeError, ValueError):
        return None


def disable_pipe(name, results):
    pipes_client.update_pipe(Name=name, DesiredState="STOPPED")
    results.append(f"pipe stopped: {name}")


def attempt(description, operation, results):
    try:
        operation()
        return True
    except Exception as error:  # Keep applying the remaining kill switches.
        print(f"[cost-guard] {description} failed: {error}")
        results.append(f"FAILED {description}: {type(error).__name__}")
        return False


def disable_rule(rule, results):
    events_client.disable_rule(Name=rule["name"], EventBusName=rule["eventBusName"])
    results.append(f"rule disabled: {rule['name']}")


def disable_schedule(name, group_name, results):
    current = scheduler_client.get_schedule(Name=name, GroupName=group_name)
    request = {
        "Name": name,
        "GroupName": group_name,
        "ScheduleExpression": current["ScheduleExpression"],
        "FlexibleTimeWindow": current["FlexibleTimeWindow"],
        "Target": current["Target"],
        "State": "DISABLED",
    }
    for source_key, target_key in (
        ("ScheduleExpressionTimezone", "ScheduleExpressionTimezone"),
        ("StartDate", "StartDate"),
        ("EndDate", "EndDate"),
        ("Description", "Description"),
        ("KmsKeyArn", "KmsKeyArn"),
        ("ActionAfterCompletion", "ActionAfterCompletion"),
    ):
        if current.get(source_key) is not None:
            request[target_key] = current[source_key]
    scheduler_client.update_schedule(**request)
    results.append(f"schedule disabled: {group_name}/{name}")


def disable_configured_schedules(results):
    for schedule in env_json("STATIC_SCHEDULES"):
        attempt(
            f"disable schedule {schedule['groupName']}/{schedule['name']}",
            lambda schedule=schedule: disable_schedule(schedule["name"], schedule["groupName"], results),
            results,
        )

    group_name = os.environ["SALE_SCHEDULE_GROUP"]
    paginator = scheduler_client.get_paginator("list_schedules")
    for page in paginator.paginate(GroupName=group_name):
        for schedule in page.get("Schedules", []):
            attempt(
                f"disable schedule {group_name}/{schedule['Name']}",
                lambda schedule=schedule: disable_schedule(schedule["Name"], group_name, results),
                results,
            )


def throttle_functions(functions, results):
    for function_name in functions:
        succeeded = attempt(
            f"throttle lambda {function_name}",
            lambda function_name=function_name: lambda_client.put_function_concurrency(
                FunctionName=function_name,
                ReservedConcurrentExecutions=0,
            ),
            results,
        )
        if succeeded:
            results.append(f"lambda throttled: {function_name}")


def stop_executions(state_machines, results):
    for state_machine_arn in state_machines:
        paginator = sfn_client.get_paginator("list_executions")
        for page in paginator.paginate(stateMachineArn=state_machine_arn, statusFilter="RUNNING"):
            for execution in page.get("executions", []):
                succeeded = attempt(
                    f"stop state machine execution {execution['executionArn']}",
                    lambda execution=execution: sfn_client.stop_execution(
                        executionArn=execution["executionArn"],
                        cause="CostGuard lockdown: monthly spend exceeded USD 100",
                    ),
                    results,
                )
                if succeeded:
                    results.append(f"state machine execution stopped: {execution['executionArn']}")


def send_alert(threshold, level, results):
    subject = f"[CostGuard] {level}: monthly AWS spend exceeded USD {threshold:g}"
    actions = [f"- {item}" for item in results] or ["- Notification only"]
    body = "\n".join([
        f"CostGuard level: {level}",
        f"Budget threshold: USD {threshold:g}",
        f"Time (UTC): {datetime.now(timezone.utc).isoformat()}",
        "Actions:",
        *actions,
    ])

    try:
        ses_client.send_email(
            FromEmailAddress=os.environ["SES_FROM_EMAIL"],
            Destination={"ToAddresses": [os.environ["ALERT_EMAIL"]]},
            Content={"Simple": {
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {"Text": {"Data": body, "Charset": "UTF-8"}},
            }},
        )
    except Exception as error:
        # The workload action has already completed. Do not retry it just because SES
        # is still in sandbox mode or its recipient is unverified.
        print(f"[cost-guard] SES alert failed: {error}")


def put_state(level, threshold, results):
    ssm_client.put_parameter(
        Name=os.environ["STATE_PARAMETER_NAME"],
        Type="String",
        Overwrite=True,
        Value=json.dumps({
            "state": (
                "LOCKED" if level == "FULL_LOCKDOWN"
                else "PARTIALLY_LOCKED" if level == "PARTIAL_LOCKDOWN"
                else "WARNING"
            ),
            "level": level,
            "thresholdUsd": threshold,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "actions": results,
        }),
    )


def handler(event, _context):
    thresholds = [threshold_from_record(record) for record in event.get("Records", [])]
    threshold = max((value for value in thresholds if value is not None), default=None)
    if threshold is None:
        raise ValueError("CostGuard received an SNS message without a valid budget threshold.")

    results = []
    if threshold >= 100:
        level = "FULL_LOCKDOWN"
        for pipe in env_json("ALL_PIPES"):
            attempt(f"stop pipe {pipe}", lambda pipe=pipe: disable_pipe(pipe, results), results)
        for rule in env_json("ALL_RULES"):
            attempt(f"disable rule {rule['name']}", lambda rule=rule: disable_rule(rule, results), results)
        disable_configured_schedules(results)
        throttle_functions(env_json("ALL_APPLICATION_LAMBDAS"), results)
        stop_executions(env_json("STATE_MACHINES"), results)
    elif threshold >= 70:
        level = "PARTIAL_LOCKDOWN"
        for pipe in env_json("PARTIAL_PIPES"):
            attempt(f"stop pipe {pipe}", lambda pipe=pipe: disable_pipe(pipe, results), results)
        for rule in env_json("PARTIAL_RULES"):
            attempt(f"disable rule {rule['name']}", lambda rule=rule: disable_rule(rule, results), results)
        for schedule in env_json("PARTIAL_SCHEDULES"):
            attempt(
                f"disable schedule {schedule['groupName']}/{schedule['name']}",
                lambda schedule=schedule: disable_schedule(schedule["name"], schedule["groupName"], results),
                results,
            )
        throttle_functions(env_json("PARTIAL_LAMBDAS"), results)
    else:
        level = "NOTIFICATION_ONLY"

    put_state(level, threshold, results)
    send_alert(threshold, level, results)
    return {"level": level, "threshold": threshold, "actions": results}
