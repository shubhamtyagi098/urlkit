#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { UrlkitStack } from '../lib/urlkit-stack';

const app = new cdk.App();
new UrlkitStack(app, 'UrlkitStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT, // or your specific account ID
    region: process.env.CDK_DEFAULT_REGION    // or your specific region
  }
});
