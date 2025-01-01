import json
import logging
import os
import string
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional, TypedDict

import boto3
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError
from constants import MAX_RETRIES, SECONDS_PER_DAY
from utils import format_timestamp, normalize_expiry_days, validate_url

# Configure logging
log_level = os.environ.get("LOG_LEVEL", "INFO")
logger = logging.getLogger()
logger.setLevel(log_level)

# Initialize DynamoDB
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["URL_TABLE"])

CHARSET = string.digits + string.ascii_letters

API_DOMAIN = os.environ.get('API_DOMAIN', 'api.urlkit.io')
MAIN_DOMAIN = os.environ.get('MAIN_DOMAIN', 'urlkit.io')


class URLCreationError(Exception):
    """Custom exception for URL creation errors"""

    pass


@dataclass(frozen=True)
class URLCreationRequest:
    """Data class for URL creation request parameters"""

    original_url: str
    expires_in_days: int
    user_id: Optional[str] = None
    request_id: str = "unknown"


class URLResponse(TypedDict):
    """Type definition for URL response"""

    short_url: str
    original_url: str
    expiration_date: str
    expires_in_days: int
    status: str
    created_at: str
    request_id: str


def generate_short_id(length=7):
    """
    Generate a random short ID of specified length

    Args:
        length (int): Length of the desired short ID (default: 7)

    Returns:
        str: Random string of specified length

    Raises:
        ValueError: If length is less than 1
    """
    if length < 1:
        raise ValueError("Length must be positive")

    # Use uuid4 for randomness
    random_int = uuid.uuid4().int

    # Convert to base62
    short_id = ""
    while random_int and len(short_id) < length:
        short_id = CHARSET[random_int % 62] + short_id
        random_int //= 62

    # Use single UUID for padding if needed
    padding_uuid = uuid.uuid4().int
    while len(short_id) < length:
        short_id = CHARSET[padding_uuid % 62] + short_id
        padding_uuid //= 62

    return short_id


def create_error_response(status_code: int, message: str, request_id: str) -> Dict[str, Any]:
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        },
        'body': json.dumps({
            'error': message,
            'request_id': request_id
        })
    }


def parse_request_body(
    event: Dict[str, Any], request_id: str
) -> Optional[Dict[str, Any]]:
    """Parse and validate request body"""
    try:
        body = json.loads(event.get("body", "{}"))
        if not isinstance(body, dict):
            raise ValueError("Request body must be a JSON object")
        return body
    except json.JSONDecodeError as e:
        logger.warning(
            "Invalid JSON in request",
            extra={
                "request_id": request_id,
                "error": str(e),
                "body": event.get("body"),
            },
        )
        return None


def create_url_item(request: URLCreationRequest, short_id: str) -> Dict[str, Any]:
    """Create DynamoDB item for URL"""
    current_time = int(time.time())
    expiration = current_time + (request.expires_in_days * SECONDS_PER_DAY)

    item = {
        "short_url": short_id,
        "create_at": current_time,
        "original_url": request.original_url,
        "expire_at": expiration,
        "status": "active",
        "clicks": 0,
        "last_accessed": current_time,
        "request_id": request.request_id,
        "expiry_days": request.expires_in_days,
    }

    if request.user_id:
        item["user_id"] = request.user_id

    return item


def create_success_response(
    short_id: str,
    request: URLCreationRequest,
    created_at: int,
    expire_at: int,
) -> URLResponse:
    """Create standardized success response"""
    domain_prefix = os.environ.get("DOMAIN_PREFIX", "https://urlkit.io/")

    return {
        "short_url": f"{domain_prefix}{short_id}",
        "original_url": request.original_url,
        "expiration_date": format_timestamp(expire_at),
        "expires_in_days": request.expires_in_days,
        "status": "active",
        "created_at": format_timestamp(created_at),
        "request_id": request.request_id,
    }


def create_short_url(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle URL creation with comprehensive validation and error handling

    Args:
        event (Dict[str, Any]): Lambda event object

    Returns:
        Dict[str, Any]: API Gateway response object
    """
    request_id = event.get("requestContext", {}).get("requestId", "unknown")
    logger.info("Processing URL creation request", extra={"request_id": request_id})

    try:
        # Parse request body
        body = parse_request_body(event, request_id)
        if body is None:
            return create_error_response(
                400, "Invalid JSON in request body", request_id
            )

        # Extract and validate URL
        original_url = body.get("url")
        if not original_url:
            logger.warning("Missing URL in request", extra={"request_id": request_id})
            return create_error_response(400, "URL is required", request_id)

        # Validate URL
        is_valid, error_message = validate_url(original_url)
        if not is_valid:
            logger.warning(
                "URL validation failed",
                extra={
                    "request_id": request_id,
                    "url": original_url,
                    "error": error_message,
                },
            )
            return create_error_response(400, error_message, request_id)

        # Get and normalize expiry days
        raw_expiry_days = body.get("expires_in_days")
        days_to_expire = normalize_expiry_days(raw_expiry_days)

        # Create request object
        request = URLCreationRequest(
            original_url=original_url,
            expires_in_days=days_to_expire,
            user_id=body.get("user_id"),
            request_id=request_id,
        )

        # TODO: Implement a more efficient collision resolution strategy
        # Consider using a distributed counter or a pre-generated pool of unique IDs
        for attempt in range(MAX_RETRIES):
            try:
                short_id = generate_short_id()
                item = create_url_item(request, short_id)

                # Ensure short_id doesn't exist
                table.put_item(
                    Item=item, ConditionExpression=Attr("short_url").not_exists()
                )

                # Create success response
                response_data = create_success_response(
                    short_id=short_id,
                    request=request,
                    created_at=item["create_at"],
                    expire_at=item["expire_at"],
                )

                logger.info(
                    "Successfully created short URL",
                    extra={
                        "request_id": request_id,
                        "short_id": short_id,
                        "expiry_days": days_to_expire,
                    },
                )

                return {
                    "statusCode": 200,
                    "body": json.dumps(response_data),
                    "headers": {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*",
                        "Cache-Control": "no-store",
                        "Pragma": "no-cache",
                        "X-Request-ID": request_id,
                    },
                }

            except ClientError as e:
                if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                    raise URLCreationError(f"DynamoDB error: {str(e)}")

                if attempt == MAX_RETRIES - 1:
                    logger.error(
                        "Max retries reached for generating unique short_id",
                        extra={"request_id": request_id, "attempts": MAX_RETRIES},
                    )
                    raise URLCreationError("Unable to generate unique short URL")

                logger.warning(
                    "Collision detected, retrying",
                    extra={"request_id": request_id, "attempt": attempt + 1},
                )

    except URLCreationError as e:
        logger.error(
            "URL creation error",
            extra={"request_id": request_id, "error": str(e)},
            exc_info=True,
        )
        return create_error_response(500, str(e), request_id)

    except ClientError as e:
        logger.error(
            "DynamoDB error",
            extra={"request_id": request_id, "error": str(e)},
            exc_info=True,
        )
        return create_error_response(500, "Database error", request_id)

    except ValueError as e:
        logger.error(
            "Value error",
            extra={"request_id": request_id, "error": str(e)},
            exc_info=True,
        )
        return create_error_response(400, str(e), request_id)

    except Exception as e:
        logger.error(
            "Unexpected error creating short URL",
            extra={"request_id": request_id, "error": str(e)},
            exc_info=True,
        )
        error_message = (
            str(e)
            if os.environ.get("ENVIRONMENT") == "development"
            else "Internal server error"
        )
        return create_error_response(500, error_message, request_id)


def redirect_url(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle URL redirection with proper validation and error handling

    Args:
        event (Dict[str, Any]): Lambda event object

    Returns:
        Dict[str, Any]: Response object with redirection or error
    """
    request_id = event.get("requestContext", {}).get("requestId", "unknown")
    logger.info("Processing URL redirect request", extra={"request_id": request_id})

    try:
        # Extract short_id based on request source
        if 'Records' in event:  # CloudFront request
            cf_request = event['Records'][0]['cf']['request']
            short_id = cf_request['uri'].strip('/')
            is_api_gateway = False
        else:  # API Gateway request
            path_parameters = event.get("pathParameters", {})
            short_id = path_parameters.get("shortUrl", "")
            if not short_id:
                path = event.get("path", "")
                short_id = path.strip("/")
            is_api_gateway = True

        if not short_id:
            logger.warning("Missing short URL", extra={"request_id": request_id})
            return create_error_response(400, "Short URL is required", request_id)

        # Query DynamoDB for the URL
        response = table.query(
            KeyConditionExpression="short_url = :short_id",
            ExpressionAttributeValues={":short_id": short_id},
            Limit=1,
        )

        items = response.get("Items", [])
        if not items:
            logger.warning(
                "URL not found", extra={"request_id": request_id, "short_id": short_id}
            )
            return create_error_response(404, "URL not found", request_id)

        item = items[0]
        current_time = int(datetime.now(timezone.utc).timestamp())

        # Check expiration
        expiration_time = item["expire_at"]
        if expiration_time < current_time:
            logger.info(
                "URL has expired",
                extra={
                    "request_id": request_id,
                    "short_id": short_id,
                    "expired_at": format_timestamp(expiration_time),
                    "difference_hours": round(
                        (current_time - expiration_time) / 3600, 2
                    ),
                },
            )
            return create_error_response(410, "URL has expired", request_id)

        # Update click count and last accessed time
        try:
            table.update_item(
                Key={"short_url": short_id, "create_at": item["create_at"]},
                UpdateExpression="SET clicks = clicks + :inc, last_accessed = :time",
                ExpressionAttributeValues={":inc": 1, ":time": current_time},
            )
        except ClientError as e:
            logger.error(
                "Failed to update click count",
                extra={"request_id": request_id, "short_id": short_id, "error": str(e)},
            )
            # Continue with redirect even if update fails

        logger.info(
            "Redirecting to original URL",
            extra={
                "request_id": request_id,
                "short_id": short_id,
                "clicks": item.get("clicks", 0) + 1,
            },
        )

        # Prepare headers
        if is_api_gateway:
            return {
                "statusCode": 301,
                "headers": {
                    "Location": item["original_url"],
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0",
                    "X-Request-ID": request_id,
                }
            }
        else:
            # CloudFront response format
            return {
                "status": "301",
                "statusDescription": "Moved Permanently",
                "headers": {
                    "location": [{"key": "Location", "value": item["original_url"]}],
                    "cache-control": [{"key": "Cache-Control", "value": "no-cache, no-store, must-revalidate"}],
                    "pragma": [{"key": "Pragma", "value": "no-cache"}],
                    "expires": [{"key": "Expires", "value": "0"}],
                    "x-request-id": [{"key": "X-Request-ID", "value": request_id}],
                }
            }

    except ClientError as e:
        logger.error(
            "DynamoDB error",
            extra={
                "request_id": request_id,
                "error": str(e),
                "short_id": short_id if "short_id" in locals() else None,
            },
        )
        return create_error_response(500, "Error retrieving URL", request_id)

    except Exception as e:
        logger.error(
            "Unexpected error in redirect",
            extra={"request_id": request_id, "error": str(e)},
            exc_info=True,
        )
        return create_error_response(400, "Invalid request", request_id)


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler that routes requests to appropriate handlers

    Args:
        event (Dict[str, Any]): Lambda event object
        context (Any): Lambda context object

    Returns:
        Dict[str, Any]: API Gateway response object
    """
    request_id = event.get("requestContext", {}).get("requestId", "unknown")
    http_method = event.get("httpMethod")
    path = event.get("path", "")

    logger.info(
        "Processing request",
        extra={
            "request_id": request_id,
            "method": http_method,
            "path": path,
        },
    )

    try:
        if http_method == "POST" and path == "/urls":
            return create_short_url(event)
        elif http_method == "GET" and path != "/urls":
            return redirect_url(event)
        else:
            logger.warning(
                "Method not allowed or invalid path",
                extra={"request_id": request_id, "method": http_method, "path": path},
            )
            return create_error_response(405, "Method not allowed or invalid path", request_id)

    except Exception as e:
        logger.error(
            "Unexpected error in handler",
            extra={"request_id": request_id, "error": str(e)},
            exc_info=True,
        )
        error_message = (
            str(e)
            if os.environ.get("ENVIRONMENT") == "development"
            else "Internal server error"
        )
        return create_error_response(500, error_message, request_id)