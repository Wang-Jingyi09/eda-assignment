import { DynamoDBStreamHandler } from "aws-lambda";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";
import { SESClient, SendEmailCommand, SendEmailCommandInput } from "@aws-sdk/client-ses";

const client = new SESClient({ region: SES_REGION });

export const handler: DynamoDBStreamHandler = async (event) => {
    console.log("DynamoDB Stream Event: ", JSON.stringify(event));

    for (const record of event.Records) {
        if (record.eventName === "REMOVE") {
            const oldImage = record.dynamodb?.OldImage;
            const filename = oldImage?.filename?.S || "Unknown"; // Ensure the filename field is correctly named and handled

            try {
                const message = `The image "${filename}" has been deleted from the DynamoDB table.`;
                await sendEmailMessage(message);
                console.log("Email sent successfully for:", filename);

            } catch (error: unknown) {
                console.log("Error occurred while sending email for: ", filename, error);
            }
        }
    }
};

async function sendEmailMessage(message: string) {
    const parameters: SendEmailCommandInput = {
        Destination: {
            ToAddresses: [SES_EMAIL_TO],
        },
        Message: {
            Body: {
                Html: {
                    Charset: "UTF-8",
                    Data: getHtmlContent(message),
                },
            },
            Subject: {
                Charset: "UTF-8",
                Data: "Record Deleted",
            },
        },
        Source: SES_EMAIL_FROM,
    };
    await client.send(new SendEmailCommand(parameters));
}

function getHtmlContent(message: string): string {
    return `
    <html>
      <body>
        <h1>Deletion Notification</h1>
        <p style="font-size:18px">${message}</p>
      </body>
    </html>
  `;
}