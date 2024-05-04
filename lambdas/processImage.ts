/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
import {
    GetObjectCommand,
    PutObjectCommandInput,
    GetObjectCommandInput,
    S3Client,
    PutObjectCommand,
} from "@aws-sdk/client-s3";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";
import { DynamoDB, PutItemCommand } from "@aws-sdk/client-dynamodb";

const s3 = new S3Client();
const dynamoDBClient = new DynamoDB({region: SES_REGION});

export const handler: SQSHandler = async (event) => {
    console.log("Event ", JSON.stringify(event));
    for (const record of event.Records) {
        const recordBody = JSON.parse(record.body);  // Parse SQS message
        const snsMessage = JSON.parse(recordBody.Message); // Parse SNS message

        if (snsMessage.Records) {
            console.log("Record body ", JSON.stringify(snsMessage));
            for (const messageRecord of snsMessage.Records) {
                const s3e = messageRecord.s3;
                const srcBucket = s3e.bucket.name;
                // Object key may have spaces or unicode non-ASCII characters.
                const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));
                let origimage = null;

                // Check the file extension
                if (!srcKey.endsWith('.jpeg') && !srcKey.endsWith('.png')) {
                    throw new Error("Unsupported file type");
                }

                // Proceed to download and process the image
                try {
                    // Download the image from the S3 source bucket.
                    const params: GetObjectCommandInput = {
                        Bucket: srcBucket,
                        Key: srcKey,
                    };
                    origimage = await s3.send(new GetObjectCommand(params));
                    // Process the image ......
                    console.log("Image downloaded successfully");

                    //after processing, store result in DynamoDB
                    const dbParams = {
                        TableName: 'ImageDataTable',
                        Item: {
                            filename: {S: srcKey},
                            bucket: {S: srcBucket},
                            processDate: {S: new Date().toISOString()}
                        }
                    };
                    await dynamoDBClient.send(new PutItemCommand(dbParams));
                    console.log('Image data saved to DynamoDB');
                
                } catch (error) {
                    console.log(error);
                    console.error("Error in processing or saving data:", error);
                    // Error handling

                }
            }
        }
    }
};