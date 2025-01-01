import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as waf from 'aws-cdk-lib/aws-wafv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';

const DOMAIN_NAME = 'urlkit.io';
const API_DOMAIN = `api.${DOMAIN_NAME}`;
const WWW_DOMAIN = `www.${DOMAIN_NAME}`;

export class UrlkitStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Get hosted zone
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'UrlkitHostedZone', {
      zoneName: DOMAIN_NAME,
      hostedZoneId: 'Z04063223475XQ4Z762SW',
    });

    // Create certificate for CloudFront (must be in us-east-1)
    const webCertificate = new acm.Certificate(this, 'WebsiteCertificate', {
      domainName: DOMAIN_NAME,
      subjectAlternativeNames: [WWW_DOMAIN],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // Create certificate for API Gateway (in stack region)
    const apiCertificate = new acm.Certificate(this, 'ApiCertificate', {
      domainName: API_DOMAIN,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // Create IAM role for API Gateway CloudWatch logging
    const apigwLogRole = new iam.Role(this, 'ApiGatewayCloudWatchRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs')
      ]
    });

    // Create API Gateway Account
    new apigw.CfnAccount(this, 'ApiGatewayAccount', {
      cloudWatchRoleArn: apigwLogRole.roleArn
    });

    // Lambda Function
    const urlkit_handler = new lambda.Function(this, "URLKit", {
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset("lambda"),
      handler: "urlkit.lambda_handler",
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        LOG_LEVEL: "INFO",
        DOMAIN_PREFIX: `https://${DOMAIN_NAME}/`
      },
      logRetention: logs.RetentionDays.ONE_WEEK
    });

    // DynamoDB Table
    const urlTable = new ddb.Table(this, 'UrlTable', {
      partitionKey: { name: 'short_url', type: ddb.AttributeType.STRING },
      sortKey: { name: 'create_at', type: ddb.AttributeType.NUMBER },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expire_at',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true
    });

    urlTable.addGlobalSecondaryIndex({
      indexName: 'user-url-index',
      partitionKey: { name: 'user_id', type: ddb.AttributeType.STRING },
      sortKey: { name: 'create_at', type: ddb.AttributeType.NUMBER },
      projectionType: ddb.ProjectionType.ALL
    });

    urlkit_handler.addEnvironment("URL_TABLE", urlTable.tableName);
    urlTable.grantReadWriteData(urlkit_handler);

    // S3 Bucket for frontend
    const websiteBucket = new s3.Bucket(this, 'UrlShortenerWebsiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{
        enabled: true,
        noncurrentVersionExpiration: cdk.Duration.days(30)
      }]
    });

    // CloudFront logging bucket
    const logBucket = new s3.Bucket(this, 'UrlShortenerLogBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{
        expiration: cdk.Duration.days(30)
      }],
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
    });

    // WAF Web ACL
    const webAcl = new waf.CfnWebACL(this, 'UrlShortenerWebAcl', {
      defaultAction: { allow: {} },
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'UrlShortenerWebAclMetrics',
        sampledRequestsEnabled: true
      },
      rules: [
        {
          name: 'RateLimitRule',
          priority: 1,
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP'
            }
          },
          action: { block: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitMetric',
            sampledRequestsEnabled: true
          }
        }
      ]
    });

    // Security headers policy
    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeadersPolicy', {
      responseHeadersPolicyName: 'URLShortenerSecurityHeaders',
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: "default-src 'self' https://*.urlkit.io; connect-src 'self' https://*.urlkit.io https://*.execute-api.us-east-1.amazonaws.com; img-src 'self' https://*.urlkit.io data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'",
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(366),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        xssProtection: { protection: true, modeBlock: true, override: true },
        referrerPolicy: { 
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, 
          override: true 
        }
      }
    });

    // Create cache policy
    const cachePolicy = new cloudfront.CachePolicy(this, 'UrlShortenerCachePolicy', {
      defaultTtl: cdk.Duration.hours(1),
      maxTtl: cdk.Duration.days(365),
      minTtl: cdk.Duration.minutes(5),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    // CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'UrlShortenerDistribution', {
      certificate: webCertificate,
      domainNames: [DOMAIN_NAME, WWW_DOMAIN],
      
      // Static content behavior
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cachePolicy,
        responseHeadersPolicy: responseHeadersPolicy,
        compress: true,
      },
      
      additionalBehaviors: {
        '/urls': {  // Changed from /urls/* to just /urls
          origin: new origins.HttpOrigin(API_DOMAIN),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
        '/index.html': {  // Explicit handling for index.html
          origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cachePolicy,
        },
        '/assets/*': {  // Static assets from S3
          origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cachePolicy,
        },
        '/*': {  // All other paths go to API
          origin: new origins.HttpOrigin(API_DOMAIN),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        }
      },
      defaultRootObject: 'index.html',    
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5)
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5)
        }
      ],
      enableLogging: true,
      logBucket: logBucket,
      logFilePrefix: 'cdn-logs/',
      webAclId: webAcl.attrArn,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // Create Log Group for API Gateway
    const apiLogGroup = new logs.LogGroup(this, 'ApiGatewayLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // API Gateway
    const api = new apigw.RestApi(this, 'UrlkitApi', {
      restApiName: 'Urlkit Service',
      domainName: {
        domainName: API_DOMAIN,
        certificate: apiCertificate,
        securityPolicy: apigw.SecurityPolicy.TLS_1_2,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: [
          `https://${DOMAIN_NAME}`,
          `https://${WWW_DOMAIN}`,
          'http://localhost:3000'  // For local development
        ],
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: true,
        maxAge: cdk.Duration.days(1)
      },
      deployOptions: {
        accessLogDestination: new apigw.LogGroupLogDestination(apiLogGroup),
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        stageName: 'prod'
      }
    });

    new route53.ARecord(this, 'ApiDomainRecord', {
      zone: hostedZone,
      recordName: API_DOMAIN,
      target: route53.RecordTarget.fromAlias(
        new targets.ApiGatewayDomain(api.domainName!)
      )
    });

    new route53.ARecord(this, 'WebsiteARecord', {
      zone: hostedZone,
      recordName: DOMAIN_NAME,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution)
      )
    });

    new route53.ARecord(this, 'WwwARecord', {
      zone: hostedZone,
      recordName: WWW_DOMAIN,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution)
      )
    });

    // API resources
    const urls = api.root.addResource('urls');
    urls.addMethod('POST', new apigw.LambdaIntegration(urlkit_handler));

    const shortUrl = api.root.addResource('{shortUrl}');
    shortUrl.addMethod('GET', new apigw.LambdaIntegration(urlkit_handler));

    // Deploy frontend with configuration
    new s3deploy.BucketDeployment(this, 'WebsiteDeployment', {
      sources: [
        s3deploy.Source.asset('./frontend/dist'),
        s3deploy.Source.jsonData('config.json', {
          apiUrl: `https://${API_DOMAIN}`,
          region: this.region,
          deployTime: new Date().toISOString(),
        })
      ],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: 1024,
      prune: true,
    });

    // Create SNS Topic for alarms
    const alarmTopic = new sns.Topic(this, 'UrlKitAlarmTopic', {
      displayName: 'URLKit Alarms',
    });

    // Add email subscription
    alarmTopic.addSubscription(
      new subscriptions.EmailSubscription('shubhamtyagiop@gmail.com')
    );

    // CloudWatch Alarms
    new cloudwatch.Alarm(this, 'ApiGateway5XXAlarm', {
      metric: api.metricServerError(),
      threshold: 5,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'API Gateway is returning 5XX errors',
      alarmName: `${id}-ApiGateway5XXErrors`,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      actionsEnabled: true,
    }).addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    new cloudwatch.Alarm(this, 'ApiGateway4XXAlarm', {
      metric: api.metricClientError(),
      threshold: 50,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'High number of API Gateway 4XX errors',
      alarmName: `${id}-ApiGateway4XXErrors`,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      actionsEnabled: true,
    }).addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    urlkit_handler.addEnvironment("DOMAIN_PREFIX", `https://${DOMAIN_NAME}/`);
    urlkit_handler.addEnvironment("API_DOMAIN", API_DOMAIN);
    urlkit_handler.addEnvironment("MAIN_DOMAIN", DOMAIN_NAME);

    // Outputs
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Frontend URL'
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL'
    });

    new cdk.CfnOutput(this, 'WebsiteBucketName', {
      value: websiteBucket.bucketName,
      description: 'Website bucket name'
    });
  }
}