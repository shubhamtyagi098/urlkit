# URLkit - URL Shortener Service

A robust, secure, and scalable URL shortening service built with AWS serverless architecture.

## Features

### Core Functionality
- Create short URLs from long URLs
- Configurable expiration dates
- User-based URL tracking
- Secure URL validation
- UTC timestamp handling

### Security Features
- Protection against malicious URLs
- Domain validation and blocking
- Private IP protection
- Prevention of common URL-based attacks
- Input sanitization

### Technical Details
- AWS Lambda and DynamoDB
- Base62 encoding for short URLs
- Collision handling
- Comprehensive error handling
- Detailed logging

## API Documentation

### Create Short URL

```http
POST /urls
Content-Type: application/json
```

#### Request Body
```json
{
    "url": "https://example.com/very/long/path",
    "expires_in_days": 30,          // Optional (Default: 365 days)
    "user_id": "user123"            // Optional
}
```

#### Success Response
```json
{
    "short_url": "https://urlkit.io/abc123",
    "original_url": "https://example.com/very/long/path",
    "expiration_date": "2024-12-28T10:00:00.000000Z",
    "expires_in_days": 30,
    "status": "active",
    "created_at": "2024-11-28T10:00:00.000000Z",
    "request_id": "abc-123"
}
```

### Validation Rules

#### URL Validation
- Length: 3-2048 characters
- Protocol: Must be HTTP or HTTPS
- Domains: No localhost or internal domains
- IP Addresses: No private IP addresses
- Security: Filters suspicious patterns

#### Expiration Rules
- Minimum: 1 day
- Maximum: 3650 days (10 years)
- Default: 365 days (1 year)
- Invalid values default to 365 days

### Error Responses

#### Invalid URL
```json
{
    "error": "URL must include scheme (http/https)",
    "request_id": "abc-123"
}
```

#### Invalid Expiration
```json
{
    "error": "Expiration must be between 1 and 3650 days",
    "request_id": "abc-123"
}
```

#### Security Violation
```json
{
    "error": "Security violation: Domain not allowed",
    "request_id": "abc-123"
}
```

## Security Considerations

### Blocked Patterns
- Directory traversal attempts
- URL credentials in path
- Data URLs
- JavaScript/VBScript URLs
- File protocol
- Hex encoding
- Null bytes
- Control characters

### Blocked Domains
- localhost
- internal domains
- private networks
- reserved addresses
- test domains

## Implementation Details

### Short URL Generation
- Base62 encoding (0-9, a-z, A-Z)
- 7-character unique identifiers
- Collision handling with retries
- UUID-based randomness

### Timestamp Handling
- All timestamps in UTC
- ISO 8601 format
- Timezone-aware responses
- Microsecond precision

## Error Handling

- Input validation errors (400)
- Security violations (400)
- Resource conflicts (409)
- Server errors (500)
- Detailed error messages
- Request ID tracking

## Best Practices

### URL Submission
- Always include protocol (http/https)
- Use valid domains
- Avoid internal/private URLs
- Consider expiration needs

### Error Handling
- Check response status codes
- Use request IDs for support
- Handle timeout scenarios
- Implement retry logic

## Rate Limiting and Quotas

- Maximum URL length: 2048 characters
- Maximum expiration: 10 years
- Retry attempts: 3
- Request timeout: 30 seconds