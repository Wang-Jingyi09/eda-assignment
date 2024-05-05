import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";
import { Construct } from "constructs";
import * as dynamodbstreams from "aws-cdk-lib/aws-lambda-event-sources";
import { DynamoDBStreamHandler } from "aws-lambda";

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    //create an S3 bucket
    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });
    //create DLQ
    const dlq = new sqs.Queue(this, "DLQ", {
      queueName: "ImageProcessingDLQ",
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    })
    // Integration infrastructure
    //DynamoDB Table
    const imageDataTable = new dynamodb.Table(this, 'ImageDataTable', {
      partitionKey: {
        name: 'filename',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES
    })
    //create a standard queue
    const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 2
      }
    });
    // //create an SNS topic
    // const newImageTopic = new sns.Topic(this, "NewImageTopic", {
    //   displayName: "New Image topic",
    // });

    // //the second topic
    // const deleteAndUpdateTopic = new sns.Topic(this, "DeleteAndUpdateTopic", {
    //   displayName: "Delete Image and Update Description Topic",
    // });

    const mainTopic = new sns.Topic(this, "MainTopic", {
      displayName: "Main Topic for User Events",
    });

    const mailerQ = new sqs.Queue(this, "mailer-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });
    // Lambda functions
    const processImageFn = new lambdanode.NodejsFunction(
      this,
      "ProcessImageFn",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/processImage.ts`,
        timeout: cdk.Duration.seconds(15),
        memorySize: 128,
        environment: {
          TABLE_NAME: imageDataTable.tableName,
          REGION: SES_REGION
        }
      }
    );
    const mailerFn = new lambdanode.NodejsFunction(this, "mailer-function", {
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/mailer.ts`,
    });

    //delete lambda
    const processDeleteFn = new lambdanode.NodejsFunction(this, "ProcessDeleteFunction", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/processDelete.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        TABLE_NAME: imageDataTable.tableName,
        REGION: SES_REGION
      }
    });

    //update table lambda
    const updateTableFn = new lambdanode.NodejsFunction(this, "UpdateTableFn", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/updateTable.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        TABLE_NAME: imageDataTable.tableName,
        REGION: SES_REGION
      }
    })
    const deleteMailerFn = new lambdanode.NodejsFunction(this, "DeleteMailerFunction", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/deleteMailer.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        TABLE_NAME: imageDataTable.tableName,
        REGION: SES_REGION,
        SES_EMAIL_FROM: SES_EMAIL_FROM,
        SES_EMAIL_TO: SES_EMAIL_TO
      }
    });

    // deleteAndUpdateTopic.addSubscription(
    //   new subs.LambdaSubscription(processDeleteFn)
    // );
    // deleteAndUpdateTopic.addSubscription(
    //   new subs.LambdaSubscription(updateTableFn, {
    //     filterPolicy: {
    //       comment_type: sns.SubscriptionFilter.stringFilter({
    //         allowlist: ["Caption"]
    //       })
    //     }
    //   })
    // )

    mainTopic.addSubscription(
      new subs.LambdaSubscription(processDeleteFn)
    );
    mainTopic.addSubscription(
      new subs.LambdaSubscription(updateTableFn, {
        filterPolicy: {
          comment_type: sns.SubscriptionFilter.stringFilter({
            allowlist: ["Caption"]
          })
        }
      })
    );

    // S3 --> SQS
    //set up event notifications for new images upladed to the bucket
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(mainTopic)
    );

    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED_DELETE,
      new s3n.SnsDestination(mainTopic)
    );

    //subscribe the image processing queue to the topic
    mainTopic.addSubscription(
      new subs.SqsSubscription(imageProcessQueue)
    );
    mainTopic.addSubscription(
      new subs.SqsSubscription(mailerQ)
    );
    // SQS --> Lambda
    const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
    });
    processImageFn.addEventSource(newImageEventSource);
    const newImageMailEventSource = new events.SqsEventSource(mailerQ, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
    });

    mailerFn.addEventSource(newImageMailEventSource);
    //add DLQ event source to mailerFn
    const dlqEventSource = new events.SqsEventSource(dlq, {
      batchSize: 1
    });
    mailerFn.addEventSource(dlqEventSource);


    // Permissions
    imagesBucket.grantRead(processImageFn);
    imageDataTable.grantReadWriteData(processDeleteFn);
    imageDataTable.grantReadWriteData(updateTableFn);

    mailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );
    processImageFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "dynamodb:PutItem"
        ],
        resources: [imageDataTable.tableArn],
      })
    );

    // Add event source, listen to delete events of DynamoDB table
    deleteMailerFn.addEventSource(
      new dynamodbstreams.DynamoEventSource(imageDataTable, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 5,
      })
    );

    deleteMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ],
        resources: ["*"],
        conditions: {
          "ForAllValues:StringLike": {
            "ses:Recipients": [SES_EMAIL_TO]
          }
        }
      })
    );


    // Output

    // new cdk.CfnOutput(this, "NewImageTopicArn", {
    //   value: newImageTopic.topicArn,
    //   description: "ARN of the SNS topic for new images",
    // });
    // new cdk.CfnOutput(this, "DeleteAndUpdateTopicArn", {
    //   value: deleteAndUpdateTopic.topicArn,
    //   description: "ARN of the SNS topic for delete and update operations",
    // });
    
    new cdk.CfnOutput(this, "MainTopicArn", {
      value: mainTopic.topicArn,
      description: "ARN of the main SNS topic for user events",
    });

    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName,
    });
    new cdk.CfnOutput(this, "DLQArn", {
      value: dlq.queueArn,
    });
    new cdk.CfnOutput(this, "MailerQueueURL", {
      value: mailerQ.queueUrl
    });
    new cdk.CfnOutput(this, "ImageDataTableName", {
      value: imageDataTable.tableName,
    });
  }
}