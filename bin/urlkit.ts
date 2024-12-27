#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { UrlkitStack } from '../lib/urlkit-stack';

const app = new cdk.App();
new UrlkitStack(app, 'UrlkitStack');
