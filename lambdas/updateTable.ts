import { SNSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

// create DynamoDB Document Client
const ddbClient = new DynamoDBClient();
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

export const handler: SNSHandler = async (event) => {
    console.log("Received Event: ", JSON.stringify(event));
    for (const record of event.Records) {
        const message = JSON.parse(record.Sns.Message);
        const { name, description } = message;

        const updateCommand = new UpdateCommand({
            TableName: process.env.TABLE_NAME,
            Key: { filename: name }, // 注意这里使用简化的对象格式
            UpdateExpression: 'set description = :desc',
            ExpressionAttributeValues: {
                ':desc': description
            }
        });

        try {
            const result = await ddbDocClient.send(updateCommand);
            console.log('Description updated successfully:', result);
        } catch (error) {
            console.error('Error updating description:', error);
        }
    }
};
