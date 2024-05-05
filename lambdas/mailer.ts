import { SQSHandler } from "aws-lambda";
// import AWS from 'aws-sdk';
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";
import {
    SESClient,
    SendEmailCommand,
    SendEmailCommandInput,
} from "@aws-sdk/client-ses";

type ContactDetails = {
    name: string;
    email: string;
    message: string;
    isRejection: boolean;
};

const client = new SESClient({ region: SES_REGION });

export const handler: SQSHandler = async (event: any) => {
    console.log("Event ", JSON.stringify(event));

    for (const record of event.Records) {
        const recordBody = JSON.parse(record.body);
        const snsMessage = JSON.parse(recordBody.Message);
        const isRejection = record.eventSourceARN.includes("DLQ");

        if (snsMessage.Records) {
            console.log("Record body ", JSON.stringify(snsMessage));
            for (const messageRecord of snsMessage.Records) {
                const s3e = messageRecord.s3;
                const srcBucket = s3e.bucket.name;
                // Object key may have spaces or unicode non-ASCII characters.
                const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));

                const { name, email, message, }: ContactDetails = {
                    name: "The Photo Album",
                    email: SES_EMAIL_FROM,
                    message: isRejection ? `Failed to process your image due to an unsupported file type: ${srcKey}.` : `We received your Image. Its URL is s3://${srcBucket}/${srcKey}`,
                    isRejection: isRejection
                };
                const params = sendEmailParams({ name, email, message, isRejection });
                try {
                    await client.send(new SendEmailCommand(params));
                    console.log("Email sent successfully.")
                } catch (error: unknown) {
                    console.log("ERROR in sending email: ", error);
                    // return;
                }
            }
        }
    }
};

function sendEmailParams({ name, email, message, isRejection }: ContactDetails) {
    const parameters: SendEmailCommandInput = {
        Destination: {
            ToAddresses: [SES_EMAIL_TO],
        },
        Message: {
            Body: {
                Html: {
                    Charset: "UTF-8",
                    Data: getHtmlContent({ name, email, message, isRejection }),
                },
                // Text: {.           // For demo purposes
                //   Charset: "UTF-8",
                //   Data: getTextContent({ name, email, message }),
                // },
            },
            Subject: {
                Charset: "UTF-8",
                Data: isRejection ? `File Type Rejection Notification` : `Image Upload notification`,
            },
        },
        Source: SES_EMAIL_FROM,
    };
    return parameters;
}

function getHtmlContent({ name, email, message, isRejection }: ContactDetails): string {
    return `
    <html>
      <body>
        <h2>Sent from: </h2>
        <ul>
          <li style="font-size:18px">👤 <b>${name}</b></li>
          <li style="font-size:18px">✉️ <b>${email}</b></li>
        </ul>
        <p style="font-size:18px">${isRejection ? `Unsupported file type detected: ${message}` : message}</p>
      </body>
    </html> 
  `;
}

// For demo purposes - not used here.
// function getTextContent({ name, email, message }: ContactDetails) {
//     return `
//     Received an Email. 📬
//     Sent from:
//         👤 ${name}
//         ✉️ ${email}
//     ${message}
//   `;
// }