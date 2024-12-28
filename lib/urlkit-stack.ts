import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as apigw from 'aws-cdk-lib/aws-apigateway'; 

export class UrlkitStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const urlkit_handler = new lambda.Function(this, "URLKit", {
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset("lambda"),
      handler: "urlkit.lambda_handler",
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        LOG_LEVEL: "INFO"
      }
    });

    const api = new apigw.RestApi(this, 'UrlkitApi', {
      restApiName: 'Urlkit Service',
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: true
      }
    });

    const urls = api.root.addResource('urls', {
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: true
      }
    });
    urls.addMethod('POST', new apigw.LambdaIntegration(urlkit_handler));

    const shortUrl = api.root.addResource('{shortUrl}', {
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: true
      }
    });
    shortUrl.addMethod('GET', new apigw.LambdaIntegration(urlkit_handler));

    const urlTable = new ddb.Table(this, 'UrlTable', {
      partitionKey: {name: 'short_url', type: ddb.AttributeType.STRING},
      sortKey: { name: 'create_at', type: ddb.AttributeType.NUMBER},
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expire_at',
      removalPolicy: cdk.RemovalPolicy.DESTROY
    }
    );

    urlTable.addGlobalSecondaryIndex(
      {
        indexName: 'user-url-index',
        partitionKey: {name: 'user_id', type: ddb.AttributeType.STRING},
        sortKey: {name: 'create_at', type: ddb.AttributeType.NUMBER},
        projectionType: ddb.ProjectionType.ALL
      }
    );

    urlkit_handler.addEnvironment("URL_TABLE", urlTable.tableName);
    urlTable.grantReadWriteData(urlkit_handler);

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API endpoint URL'
    });
  }
}