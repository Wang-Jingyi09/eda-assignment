import { SNSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { SES_REGION } from "../env";

// Create DynamoDB Document Client
const ddbDocClient = createDDbDocClient();

export const handler: SNSHandler = async (event) => {
    console.log("Event received:", JSON.stringify(event));
    for (const record of event.Records) {
        const snsMessage = JSON.parse(record.Sns.Message);
        // Assuming the deletion message also comes in S3 event format
        const srcKey = decodeURIComponent(snsMessage.Records[0].s3.object.key.replace(/\+/g, " "));
        console.log('Deleting key from DynamoDB:', srcKey);

        try {
            const commandOutput = await ddbDocClient.send(new DeleteCommand({
                TableName: process.env.TABLE_NAME,
                Key: { filename: srcKey }
            }));
            console.log("DynamoDB response:", commandOutput);
        } catch (error) {
            console.error("Error deleting from DynamoDB:", error);
        }
    }
};

function createDDbDocClient() {
    const ddbClient = new DynamoDBClient({ region: SES_REGION });
    const marshallOptions = {
        convertEmptyValues: true,
        removeUndefinedValues: true,
        convertClassInstanceToMap: true,
    };
    const unmarshallOptions = {
        wrapNumbers: false,
    };
    const translateConfig = { marshallOptions, unmarshallOptions };
    return DynamoDBDocumentClient.from(ddbClient, translateConfig);
}
